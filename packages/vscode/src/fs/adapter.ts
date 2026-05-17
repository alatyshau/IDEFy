// FsAdapter implementation backed by vscode.workspace.fs.
//
// **URI identity preservation.** Adapter использует **полную URI-строку** как
// opaque path-identifier (`uri.toString()`), не `uri.path`. Это сохраняет
// `scheme` и `authority` через round-trip — критично для не-`file://`
// workspaces (Remote-SSH, WSL, Codespaces, Dev Containers, custom virtual
// FS). Loader's path utilities (`@idefy/loader/paths`) URI-aware и
// прозрачно обрабатывают `<scheme>://<authority>` префикс.
//
// Старая реализация делала `Uri.file(uri.path)` и теряла `scheme/authority`
// на каждом round-trip, превращая `vscode-remote://wsl/foo` в `file:///foo`
// и роняя remote-сценарии.
//
// This module is the **only** place in the package that imports vscode.workspace.fs.
// Invariant from COMPONENT.md §Invariants: «FS-операции никогда не идут мимо
// @idefy/loader-адаптера». Anything that needs FS must go through this adapter.

import * as vscode from "vscode";
import type { DirectoryEntry, FsAdapter } from "@idefy/loader";

const utf8Decoder = new TextDecoder("utf-8");
const utf8Encoder = new TextEncoder();

export function createVsCodeFsAdapter(): FsAdapter {
    return {
        async readFile(path) {
            const bytes = await vscode.workspace.fs.readFile(pathToUri(path));
            return utf8Decoder.decode(bytes);
        },
        async writeFile(path, content) {
            await vscode.workspace.fs.writeFile(
                pathToUri(path),
                utf8Encoder.encode(content),
            );
        },
        async deleteFile(path) {
            await vscode.workspace.fs.delete(pathToUri(path));
        },
        async renameFile(from, to) {
            await vscode.workspace.fs.rename(pathToUri(from), pathToUri(to), {
                overwrite: false,
            });
        },
        async listDirectory(path): Promise<DirectoryEntry[]> {
            const entries = await vscode.workspace.fs.readDirectory(pathToUri(path));
            return entries.map(([name, type]) => ({
                name,
                kind: type === vscode.FileType.Directory ? "directory" : "file",
            }));
        },
        async exists(path) {
            try {
                await vscode.workspace.fs.stat(pathToUri(path));
                return true;
            } catch (err) {
                if (isFileNotFound(err)) return false;
                throw err;
            }
        },
        isNotFound: isFileNotFound,
    };
}

// Convert an opaque loader path-identifier back into a vscode.Uri without
// losing scheme/authority. The identifier produced by `uriToPath()` is a
// full URI string (e.g. `vscode-remote://wsl/home/foo/A0.idef0`), so
// `Uri.parse` round-trips it exactly. For paths that came from somewhere
// else (e.g. a plain `/Users/...` string from a Node-FS adapter context),
// `Uri.parse` recognizes the lack of scheme and falls back to a relative
// URI — caller's responsibility not to mix path-spaces between adapters.
export function pathToUri(opaquePath: string): vscode.Uri {
    // `Uri.parse` requires at least a scheme to behave well; if the string
    // doesn't have one, fall back to `Uri.file` (legacy local-only path).
    if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(opaquePath)) {
        return vscode.Uri.parse(opaquePath);
    }
    return vscode.Uri.file(opaquePath);
}

export function uriToPath(uri: vscode.Uri): string {
    return uri.toString();
}

// Binary write helper. The FsAdapter contract from `@idefy/loader` is text-only
// (read/write `string`), which is correct for loader's needs — the DSL and
// ASCII sidecar are both text. This helper exists for the few host-side paths
// that legitimately produce binary content (PNG export via showSaveDialog) and
// is kept in this module so the «FS goes through fs/adapter.ts» invariant
// remains: vscode.workspace.fs is never imported from anywhere else.
export async function writeBinaryToWorkspace(
    target: vscode.Uri,
    bytes: Uint8Array,
): Promise<void> {
    await vscode.workspace.fs.writeFile(target, bytes);
}

function isFileNotFound(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const code = (err as { code?: unknown }).code;
    if (code === "FileNotFound") return true;
    if (code === "ENOENT") return true;
    return err.message.includes("not exist") || err.message.includes("ENOENT");
}
