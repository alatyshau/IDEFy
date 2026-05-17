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
import { findScanRoot, sidecarPathFor } from "@idefy/loader";
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

    const onCreate = watcher.onDidCreate(async (uri) => {
        pipeline.invalidateFile(uri);
        await revalidateAffectedScanRoot(pipeline, fs, uri, output);
    });

    const onChange = watcher.onDidChange(async (uri) => {
        pipeline.invalidateFile(uri);
        await revalidateAffectedScanRoot(pipeline, fs, uri, output);
    });

    const onDelete = watcher.onDidDelete(async (uri) => {
        pipeline.invalidateFile(uri);
        await revalidateAffectedScanRoot(pipeline, fs, uri, output);
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
            await revalidateAffectedScanRoot(pipeline, fs, oldUri, output);
            await revalidateAffectedScanRoot(pipeline, fs, newUri, output);
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

// Determine the scan root that owns the changed file and refresh diagnostics
// for the whole project rooted there — independently of which editor is
// currently active. Without this, an external change to a closed file would
// leave stale diagnostics in Problems panel until the user happened to
// switch to the affected tab.
async function revalidateAffectedScanRoot(
    pipeline: ValidationPipeline,
    fs: FsAdapter,
    uri: vscode.Uri,
    output: vscode.OutputChannel,
): Promise<void> {
    try {
        const path = uriToPath(uri);
        const scanRoot = await findScanRoot(path, fs);
        if (scanRoot === null) return; // file lives outside any `src/idef0/`
        await pipeline.revalidateScanRoot(scanRoot);
    } catch (err) {
        output.appendLine(
            `revalidate-on-change failed for ${uri.toString()}: ${formatError(err)}`,
        );
    }
}

function isIdef0Path(posixPath: string): boolean {
    return posixPath.endsWith(".idef0");
}

function formatError(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
}
