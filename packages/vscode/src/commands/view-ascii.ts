// `IDEFy: View ASCII` command.
//
// Contract from packages/vscode/spec/COMPONENT.md §Команда "View ASCII":
//   1. Runtime guard: editor + idef0 + in valid project (not orphan,
//      not invalid project where projectRoot === scanRoot).
//   2. Compute sidecar URI from the `.idef0` URI.
//   3. Notify if sidecar doesn't exist.
//   4. Open the sidecar in the active editor group via vscode.openWith with
//      our custom editor view type (not preview, not split).
//
// All FS-touching steps run inside one try/catch — FS adapter errors get
// surfaced via Output channel + a notification (COMPONENT.md §Errors).

import * as vscode from "vscode";
import type { FsAdapter } from "@idefy/loader";
import { sidecarPathFor } from "@idefy/loader";
import { pathToUri, uriToPath } from "../fs/adapter.js";
import type { ValidationPipeline } from "../diagnostics/pipeline.js";
import { ASCII_VIEWER_VIEW_TYPE } from "../sidecar/custom-editor.js";

export function registerViewAsciiCommand(
    pipeline: ValidationPipeline,
    fs: FsAdapter,
    output: vscode.OutputChannel,
): vscode.Disposable {
    return vscode.commands.registerCommand("idefy.viewAscii", async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined || editor.document.languageId !== "idef0") {
            await vscode.window.showInformationMessage(
                "IDEFy: View ASCII is available only for `.idef0` editors.",
            );
            return;
        }

        try {
            const classification = await pipeline.classify(editor.document);
            if (classification.kind !== "in-project") {
                await vscode.window.showInformationMessage(
                    "File outside IDEF project; ASCII view unavailable.",
                );
                return;
            }
            if (classification.project!.projectRoot === classification.scanRoot) {
                await vscode.window.showInformationMessage(
                    "Project root sits directly in `src/idef0/`; fix project layout to view ASCII.",
                );
                return;
            }

            const sourcePath = uriToPath(editor.document.uri);
            const sidecarPath = sidecarPathFor(sourcePath);
            if (!(await fs.exists(sidecarPath))) {
                await vscode.window.showInformationMessage(
                    "Sidecar not found. Run `IDEFy: Format Document` to generate.",
                );
                return;
            }

            await vscode.commands.executeCommand(
                "vscode.openWith",
                pathToUri(sidecarPath),
                ASCII_VIEWER_VIEW_TYPE,
                { viewColumn: vscode.ViewColumn.Active, preview: false },
            );
        } catch (err) {
            output.appendLine(`viewAscii failed: ${formatError(err)}`);
            await vscode.window.showErrorMessage(
                "IDEFy: View ASCII failed (see IDEFy Output).",
            );
        }
    });
}

function formatError(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
}
