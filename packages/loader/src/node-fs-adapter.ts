import { promises as fsp } from "node:fs";
import type { DirectoryEntry, FsAdapter } from "./types.js";

// Distinguish "path doesn't exist" (ENOENT) from other errors (permission
// denied, I/O failure). Per packages/loader/spec/COMPONENT.md Errors section:
// missing paths → empty/false; permission/catastrophic → propagate.
function isNotFoundError(err: unknown): boolean {
    return (
        !!err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: unknown }).code === "ENOENT"
    );
}

// Node.js-backed FsAdapter — provided for tests and CLI usage. In production,
// `@idefy/vscode` injects an adapter built on top of `vscode.workspace.fs`
// (which transparently handles remote workspaces, virtual file systems, etc.).
export function createNodeFsAdapter(): FsAdapter {
    return {
        async readFile(path: string): Promise<string> {
            return fsp.readFile(path, "utf8");
        },
        async writeFile(path: string, content: string): Promise<void> {
            await fsp.writeFile(path, content, "utf8");
        },
        async deleteFile(path: string): Promise<void> {
            await fsp.unlink(path);
        },
        async renameFile(from: string, to: string): Promise<void> {
            await fsp.rename(from, to);
        },
        async listDirectory(path: string): Promise<readonly DirectoryEntry[]> {
            const entries = await fsp.readdir(path, { withFileTypes: true });
            const out: DirectoryEntry[] = [];
            for (const e of entries) {
                if (e.isFile()) out.push({ name: e.name, kind: "file" });
                else if (e.isDirectory()) out.push({ name: e.name, kind: "directory" });
            }
            return out;
        },
        async exists(path: string): Promise<boolean> {
            try {
                await fsp.stat(path);
                return true;
            } catch (err: unknown) {
                if (isNotFoundError(err)) return false;
                throw err;
            }
        },
    };
}
