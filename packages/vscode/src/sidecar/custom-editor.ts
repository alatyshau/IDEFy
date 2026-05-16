// Custom editor for `.idef0.ascii` sidecars.
//
// Contract from packages/vscode/spec/UI.md §Custom Editor:
//   - WebView with strict CSP (see webview-html.ts).
//   - Toolbar: Copy as Text (raw sidecar content); Copy as PNG (canvas render,
//     clipboard image with showSaveDialog fallback).
//   - Read-only (no DOM editing affordance).
//   - Refresh on file change via per-sidecar FileSystemWatcher — host posts
//     `{ kind: "refresh", payload: { content } }`. On read failure, host
//     posts `{ kind: "error", payload: { message } }`.
//
// WebView → host messages:
//   - `copy-text`           — host writes sidecar content to clipboard.
//   - `copy-png-ok`         — WebView wrote PNG via navigator.clipboard.write.
//   - `copy-png-fallback`   — image clipboard unsupported; WebView ships
//                             base64 PNG to host for showSaveDialog.
//   - `copy-png-failed`     — render or clipboard failed; host warns user.

import * as vscode from "vscode";
import type { FsAdapter } from "@idefy/loader";
import { buildAsciiViewerHtml, generateNonce } from "./webview-html.js";
import { computeAsciiTokens } from "./ascii-tokens.js";
import { validateAndDecodePng } from "./png-validate.js";
import { uriToPath, writeBinaryToWorkspace } from "../fs/adapter.js";

export const ASCII_VIEWER_VIEW_TYPE = "idefy.asciiViewer";

type InboundMessage =
    | { readonly kind: "copy-text" }
    | { readonly kind: "copy-png-ok" }
    | { readonly kind: "copy-png-failed"; readonly payload?: { readonly reason?: unknown } }
    | { readonly kind: "copy-png-fallback"; readonly payload: { readonly base64: string } };

function parseInboundMessage(value: unknown): InboundMessage | null {
    if (value === null || typeof value !== "object") return null;
    const kind = (value as { kind?: unknown }).kind;
    if (kind === "copy-text" || kind === "copy-png-ok") {
        return { kind };
    }
    if (kind === "copy-png-failed") {
        const payload = (value as { payload?: unknown }).payload;
        if (payload === undefined) return { kind };
        if (typeof payload !== "object" || payload === null) return null;
        return { kind, payload: payload as { reason?: unknown } };
    }
    if (kind === "copy-png-fallback") {
        const payload = (value as { payload?: unknown }).payload;
        if (
            payload === null ||
            typeof payload !== "object" ||
            typeof (payload as { base64?: unknown }).base64 !== "string"
        ) {
            return null;
        }
        return { kind, payload: payload as { base64: string } };
    }
    return null;
}

interface ReadOk {
    readonly ok: true;
    readonly content: string;
}
interface ReadErr {
    readonly ok: false;
    readonly message: string;
}
type ReadResult = ReadOk | ReadErr;

const MAX_PNG_BYTES = 16 * 1024 * 1024; // 16 MiB safety cap

export class AsciiViewerProvider
    implements vscode.CustomReadonlyEditorProvider
{
    constructor(
        private readonly fs: FsAdapter,
        private readonly output: vscode.OutputChannel,
    ) {}

    openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        return {
            uri,
            dispose: () => {},
        };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        panel: vscode.WebviewPanel,
    ): Promise<void> {
        const sidecarPath = uriToPath(document.uri);
        let lastRead = await this.readSidecar(sidecarPath);

        panel.webview.options = {
            enableScripts: true,
            enableCommandUris: false,
            localResourceRoots: [],
        };

        const nonce = generateNonce();
        const initialContent = lastRead.ok ? lastRead.content : "";
        const initialTokens = computeAsciiTokens(initialContent);
        panel.webview.html = buildAsciiViewerHtml({
            cspSource: panel.webview.cspSource,
            nonce,
            initialContent,
            initialTokens,
            initialError: lastRead.ok ? undefined : lastRead.message,
        });

        const disposables: vscode.Disposable[] = [];

        disposables.push(
            panel.webview.onDidReceiveMessage(async (raw: unknown) => {
                const msg = parseInboundMessage(raw);
                if (msg === null) {
                    this.output.appendLine(
                        `Ignored malformed webview message: ${JSON.stringify(raw)}`,
                    );
                    return;
                }
                try {
                    await this.handleWebviewMessage(msg, lastRead, document);
                } catch (err) {
                    this.output.appendLine(
                        `WebView message ${msg.kind} failed: ${formatError(err)}`,
                    );
                }
            }),
        );

        const folder = vscode.Uri.joinPath(document.uri, "..");
        const basename = posixBasename(document.uri.path);
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, basename),
            true,
            false,
            true,
        );
        disposables.push(watcher);
        disposables.push(
            watcher.onDidChange(async () => {
                lastRead = await this.readSidecar(sidecarPath);
                if (lastRead.ok) {
                    await panel.webview.postMessage({
                        kind: "refresh",
                        payload: {
                            content: lastRead.content,
                            tokens: computeAsciiTokens(lastRead.content),
                        },
                    });
                } else {
                    await panel.webview.postMessage({
                        kind: "error",
                        payload: { message: lastRead.message },
                    });
                }
            }),
        );

        panel.onDidDispose(() => {
            for (const d of disposables) d.dispose();
        });
    }

    private async handleWebviewMessage(
        msg: InboundMessage,
        lastRead: ReadResult,
        document: vscode.CustomDocument,
    ): Promise<void> {
        if (msg.kind === "copy-text") {
            if (!lastRead.ok) {
                await vscode.window.showInformationMessage(
                    "IDEFy: ASCII content unavailable — see viewer for details.",
                );
                return;
            }
            await vscode.env.clipboard.writeText(lastRead.content);
            await vscode.window.setStatusBarMessage("IDEFy: ASCII copied", 2000);
            return;
        }

        if (msg.kind === "copy-png-ok") {
            await vscode.window.setStatusBarMessage(
                "IDEFy: ASCII copied as PNG",
                2000,
            );
            return;
        }

        if (msg.kind === "copy-png-failed") {
            const reason =
                typeof msg.payload?.reason === "string"
                    ? `: ${msg.payload.reason}`
                    : "";
            this.output.appendLine(`copy-png-failed${reason}`);
            await vscode.window.showWarningMessage(
                "IDEFy: failed to copy ASCII as PNG (see IDEFy Output).",
            );
            return;
        }

        if (msg.kind === "copy-png-fallback") {
            // Validate-then-decode: payload is workspace/attacker-controlled.
            // See sidecar/png-validate.ts for the rules.
            const validated = validateAndDecodePng(
                msg.payload.base64,
                MAX_PNG_BYTES,
            );
            if (!validated.ok) {
                this.output.appendLine(
                    `copy-png-fallback rejected: ${validated.reason}`,
                );
                const userMsg =
                    validated.reason === "not-png"
                        ? "IDEFy: refused to save — payload is not a PNG."
                        : "IDEFy: PNG too large to save.";
                await vscode.window.showWarningMessage(userMsg);
                return;
            }
            const defaultName = posixBasename(document.uri.path).replace(
                /\.idef0\.ascii$/,
                ".png",
            );
            const defaultUri = vscode.Uri.joinPath(document.uri, "..", defaultName);
            const target = await vscode.window.showSaveDialog({
                defaultUri,
                filters: { "PNG image": ["png"] },
            });
            if (target === undefined) return;
            await writeBinaryToWorkspace(target, validated.bytes);
            await vscode.window.setStatusBarMessage(
                `IDEFy: saved ${posixBasename(target.path)}`,
                3000,
            );
            return;
        }
    }

    private async readSidecar(path: string): Promise<ReadResult> {
        try {
            return { ok: true, content: await this.fs.readFile(path) };
        } catch (err) {
            const message = `Failed to read ASCII sidecar: ${formatError(err)}`;
            this.output.appendLine(`${message} (${path})`);
            return { ok: false, message };
        }
    }
}

function posixBasename(p: string): string {
    const slash = p.lastIndexOf("/");
    return slash < 0 ? p : p.slice(slash + 1);
}

function formatError(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
}
