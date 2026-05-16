// `IDEFy: Format Document` command.
//
// Contract from packages/vscode/spec/COMPONENT.md §Команда форматирования:
//   1. Runtime guard: editor + idef0 + in valid project.
//   2. Parse in-memory content.
//   3. Abort with notification if parseErrors > 0.
//   4. core.format with configured maxLineWidth.
//   5. Apply replacement via WorkspaceEdit (undoable).
//   6. Build IdefProject, render ASCII sidecars.
//   7. Write each sidecar via fs adapter.

import * as vscode from "vscode";
import {
    assembleProject,
    createRendererRegistry,
    format,
    parse,
    type ParsedFile,
} from "@idefy/core";
import type { FsAdapter } from "@idefy/loader";
import { sidecarPathFor } from "@idefy/loader";
import { uriToPath } from "../fs/adapter.js";
import type { ValidationPipeline } from "../diagnostics/pipeline.js";

export function registerFormatCommand(
    pipeline: ValidationPipeline,
    fs: FsAdapter,
    output: vscode.OutputChannel,
): vscode.Disposable {
    return vscode.commands.registerCommand(
        "idefy.formatDocument",
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor === undefined || editor.document.languageId !== "idef0") {
                await vscode.window.showInformationMessage(
                    "IDEFy: Format Document is available only for `.idef0` editors.",
                );
                return;
            }

            try {
                const classification = await pipeline.classify(editor.document);
                if (classification.kind !== "in-project") {
                    await vscode.window.showInformationMessage(
                        "File outside IDEF project; cannot format.",
                    );
                    return;
                }
                if (
                    classification.project!.projectRoot ===
                    classification.scanRoot
                ) {
                    await vscode.window.showInformationMessage(
                        "Project root sits directly in `src/idef0/`; fix project layout before formatting.",
                    );
                    return;
                }

                const text = editor.document.getText();
                const path = uriToPath(editor.document.uri);
                const parseResult = parse(text, {
                    filePath: path,
                    basename: basenameOf(path),
                });
                if (parseResult.errors.length > 0 || parseResult.ast === null) {
                    await vscode.window.showInformationMessage(
                        "Cannot format: file has parse errors. Fix diagnostics first.",
                    );
                    return;
                }

                const config = vscode.workspace.getConfiguration("idefy");
                const maxLineWidth = config.get<number>(
                    "formatter.maxLineWidth",
                    120,
                );
                const formatted = format(parseResult.ast, { maxLineWidth });

                const fullRange = new vscode.Range(
                    editor.document.positionAt(0),
                    editor.document.positionAt(text.length),
                );
                const edit = new vscode.WorkspaceEdit();
                edit.replace(editor.document.uri, fullRange, formatted);
                const ok = await vscode.workspace.applyEdit(edit);
                if (!ok) {
                    output.appendLine(
                        `Format edit was not applied for ${editor.document.uri.toString()}`,
                    );
                    return;
                }

                try {
                    await renderSidecars(
                        classification.project!,
                        classification.scanRoot!,
                        editor.document,
                        formatted,
                        fs,
                    );
                } catch (err) {
                    output.appendLine(
                        `Sidecar render failed: ${formatError(err)}`,
                    );
                    await vscode.window.showWarningMessage(
                        "IDEFy: file formatted, but ASCII sidecar render failed (see IDEFy Output).",
                    );
                }
            } catch (err) {
                output.appendLine(`formatDocument failed: ${formatError(err)}`);
                await vscode.window.showErrorMessage(
                    "IDEFy: Format Document failed (see IDEFy Output).",
                );
            }
        },
    );
}

async function renderSidecars(
    project: { projectRoot: string; files: readonly string[] },
    scanRoot: string,
    liveDocument: vscode.TextDocument,
    liveContent: string,
    fs: FsAdapter,
): Promise<void> {
    const parsed: ParsedFile[] = [];
    const livePath = uriToPath(liveDocument.uri);
    for (const filePath of project.files) {
        const isLive = filePath === livePath;
        const content = isLive ? liveContent : await fs.readFile(filePath);
        const r = parse(content, {
            filePath,
            basename: basenameOf(filePath),
        });
        parsed.push({
            path: filePath,
            ast: r.ast,
            parseErrors: r.errors,
        });
    }
    const { project: assembled } = assembleProject(
        parsed,
        scanRoot,
        project.projectRoot,
    );
    if (assembled === null) return;
    const renderer = createRendererRegistry().get("ascii");
    if (renderer === null) return;
    const { sidecars } = renderer.render(assembled);
    for (const [idef0Path, content] of sidecars) {
        const sidecar = sidecarPathFor(idef0Path);
        await fs.writeFile(sidecar, content);
    }
}

function basenameOf(p: string): string {
    const slash = p.lastIndexOf("/");
    return slash < 0 ? p : p.slice(slash + 1);
}

function formatError(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
}
