// Workspace-wide watcher for `.idef0` lifecycle events.
//
// Two responsibilities, served by a single FS watcher to avoid duplicate
// subscriptions:
//   1. Sidecar lifecycle (per packages/vscode/spec/COMPONENT.md §Sidecar lifecycle):
//      delete `.idef0` → drop matching `.idef0.ascii`; rename `.idef0` → move
//      sidecar along (via workspace.onDidRenameFiles).
//   2. Validation cache invalidation (per §Behaviors): external `.idef0`
//      changes invalidate the ParsedFile cache and reschedule the affected
//      document's validation.
//
// Content sync of ASCII is NOT done here — ASCII is regenerated only by the
// format command. The custom editor has its own per-sidecar watcher.

import * as vscode from "vscode";
import type { FsAdapter } from "@idefy/loader";
import { sidecarPathFor } from "@idefy/loader";
import { uriToPath } from "../fs/adapter.js";
import type { ValidationPipeline } from "../diagnostics/pipeline.js";

export function registerSidecarLifecycle(
    fs: FsAdapter,
    pipeline: ValidationPipeline,
    output: vscode.OutputChannel,
): vscode.Disposable[] {
    const watcher = vscode.workspace.createFileSystemWatcher(
        "**/*.idef0",
        false,
        false,
        false,
    );

    const onCreate = watcher.onDidCreate((uri) => {
        pipeline.invalidateFile(uri);
        rescheduleIfOpen(pipeline, uri);
    });

    const onChange = watcher.onDidChange((uri) => {
        pipeline.invalidateFile(uri);
        rescheduleIfOpen(pipeline, uri);
    });

    const onDelete = watcher.onDidDelete(async (uri) => {
        pipeline.invalidateFile(uri);
        try {
            const sidecarPath = sidecarPathFor(uriToPath(uri));
            if (await fs.exists(sidecarPath)) {
                await fs.deleteFile(sidecarPath);
            }
        } catch (err) {
            output.appendLine(
                `Failed to delete sidecar for ${uri.toString()}: ${formatError(err)}`,
            );
        }
    });

    const onRename = vscode.workspace.onDidRenameFiles(async (event) => {
        for (const { oldUri, newUri } of event.files) {
            if (!isIdef0Path(oldUri.path)) continue;
            pipeline.invalidateFile(oldUri);
            pipeline.invalidateFile(newUri);
            try {
                const oldSidecar = sidecarPathFor(uriToPath(oldUri));
                if (!(await fs.exists(oldSidecar))) continue;
                const newSidecar = sidecarPathFor(uriToPath(newUri));
                await fs.renameFile(oldSidecar, newSidecar);
            } catch (err) {
                output.appendLine(
                    `Failed to move sidecar for ${oldUri.toString()} → ${newUri.toString()}: ${formatError(err)}`,
                );
            }
        }
    });

    return [watcher, onCreate, onChange, onDelete, onRename];
}

function rescheduleIfOpen(
    pipeline: ValidationPipeline,
    uri: vscode.Uri,
): void {
    const uriStr = uri.toString();
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.toString() === uriStr && doc.languageId === "idef0") {
            pipeline.scheduleRevalidate(doc);
            return;
        }
    }
    const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document.languageId === "idef0",
    );
    if (editor !== undefined) {
        pipeline.scheduleRevalidate(editor.document);
    }
}

function isIdef0Path(posixPath: string): boolean {
    return posixPath.endsWith(".idef0");
}

function formatError(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
}
