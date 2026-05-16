// FsAdapter implementation backed by vscode.workspace.fs.
//
// The loader contract (packages/loader/spec/COMPONENT.md §FS adapter) treats
// paths as opaque POSIX-form strings. VS Code Uris use forward-slash paths in
// `uri.path` on every platform, so we round-trip via `vscode.Uri.file(p)` and
// expose the URI path back to the loader. Windows backslash normalization is
// handled by VS Code itself at the URI boundary.
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
    };
}

export function pathToUri(posixPath: string): vscode.Uri {
    return vscode.Uri.file(posixPath);
}

export function uriToPath(uri: vscode.Uri): string {
    return uri.path;
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
