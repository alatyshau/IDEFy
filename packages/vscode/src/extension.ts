// Activation entry point for the IDEFy VS Code extension.
//
// Wires the pieces from packages/vscode/spec/COMPONENT.md into VS Code:
//   - One FsAdapter backed by vscode.workspace.fs.
//   - One ValidationPipeline owning the debounced revalidate loop.
//   - Semantic tokens provider + IdefyDecorator for `idef0`.
//   - Format and View ASCII commands.
//   - Custom editor for `.idef0.ascii`.
//   - Sidecar lifecycle watcher (also invalidates the validation cache on
//     external `.idef0` changes).
//
// Everything that touches the filesystem goes through the adapter — the
// invariant from COMPONENT.md §Invariants.

import * as vscode from "vscode";
import { createVsCodeFsAdapter } from "./fs/adapter.js";
import { ValidationPipeline } from "./diagnostics/pipeline.js";
import { registerFormatCommand } from "./commands/format.js";
import { registerViewAsciiCommand } from "./commands/view-ascii.js";
import {
    AsciiViewerProvider,
    ASCII_VIEWER_VIEW_TYPE,
} from "./sidecar/custom-editor.js";
import { registerSidecarLifecycle } from "./sidecar/lifecycle-watcher.js";
import {
    IdefArrowSemanticTokensProvider,
    semanticTokensLegend,
} from "./providers/semantic-tokens.js";
import { IdefyDecorator } from "./providers/bracket-decorator.js";

const IDEF0_SELECTOR: vscode.DocumentSelector = { language: "idef0" };

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel("IDEFy");
    context.subscriptions.push(output);

    const fs = createVsCodeFsAdapter();
    const pipeline = new ValidationPipeline(fs, output);
    context.subscriptions.push(pipeline);

    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            IDEF0_SELECTOR,
            new IdefArrowSemanticTokensProvider(),
            semanticTokensLegend,
        ),
    );

    const decorator = new IdefyDecorator();
    context.subscriptions.push(decorator);
    decorator.refreshAllVisible();

    context.subscriptions.push(registerFormatCommand(pipeline, fs, output));
    context.subscriptions.push(registerViewAsciiCommand(pipeline, fs, output));

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            ASCII_VIEWER_VIEW_TYPE,
            new AsciiViewerProvider(fs, output),
            {
                supportsMultipleEditorsPerDocument: false,
                webviewOptions: { retainContextWhenHidden: true },
            },
        ),
    );

    for (const d of registerSidecarLifecycle(fs, pipeline, output)) {
        context.subscriptions.push(d);
    }

    // Run an initial context-key reset so menus/keybindings start from a clean
    // state until the first validation pass completes.
    void pipeline.resetContextKeysForEditor(vscode.window.activeTextEditor);

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            pipeline.scheduleRevalidate(e.document);
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document === e.document) decorator.refresh(editor);
            }
        }),
        vscode.workspace.onDidOpenTextDocument((doc) => {
            pipeline.scheduleRevalidate(doc);
        }),
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            // Reset context keys immediately so the previous editor's
            // `idefy.*` state doesn't linger for Command Palette and
            // keybindings until the 500 ms validation debounce fires.
            void pipeline.resetContextKeysForEditor(editor);
            if (editor === undefined) return;
            if (editor.document.languageId === "idef0") {
                pipeline.scheduleRevalidate(editor.document);
            }
            decorator.refresh(editor);
        }),
        vscode.window.onDidChangeVisibleTextEditors(() => {
            decorator.refreshAllVisible();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            pipeline.invalidateAll();
        }),
    );

    for (const editor of vscode.window.visibleTextEditors) {
        pipeline.scheduleRevalidate(editor.document);
    }
}

export function deactivate(): void {
    // No-op: VS Code disposes registered subscriptions automatically.
}
