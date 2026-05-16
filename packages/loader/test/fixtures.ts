// In-memory FsAdapter for tests. Build a workspace from a flat dict
// `{path: content}` — directories are inferred from path prefixes; missing
// intermediate directories are created on the fly.

import type { DirectoryEntry, FsAdapter } from "../src/types.js";

export interface InMemoryFs extends FsAdapter {
    /** Inspect the underlying file map (read-only). */
    readonly files: ReadonlyMap<string, string>;
}

function normalize(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function dirname(p: string): string {
    const n = normalize(p);
    const i = n.lastIndexOf("/");
    if (i < 0) return "";
    if (i === 0) return "/";
    return n.substring(0, i);
}

function basename(p: string): string {
    const n = normalize(p);
    const i = n.lastIndexOf("/");
    return i < 0 ? n : n.substring(i + 1);
}

export function createInMemoryFs(seed: Record<string, string>): InMemoryFs {
    const files = new Map<string, string>();
    for (const [path, content] of Object.entries(seed)) {
        files.set(normalize(path), content);
    }
    return {
        files,
        async readFile(path: string): Promise<string> {
            const v = files.get(normalize(path));
            if (v === undefined) throw new Error("ENOENT: " + path);
            return v;
        },
        async writeFile(path: string, content: string): Promise<void> {
            files.set(normalize(path), content);
        },
        async deleteFile(path: string): Promise<void> {
            files.delete(normalize(path));
        },
        async renameFile(from: string, to: string): Promise<void> {
            const v = files.get(normalize(from));
            if (v === undefined) throw new Error("ENOENT: " + from);
            files.delete(normalize(from));
            files.set(normalize(to), v);
        },
        async listDirectory(path: string): Promise<readonly DirectoryEntry[]> {
            const dir = normalize(path);
            const seen = new Map<string, "file" | "directory">();
            for (const filePath of files.keys()) {
                if (!filePath.startsWith(dir + "/") && dir !== "") {
                    if (dir !== "" && !filePath.startsWith(dir + "/")) continue;
                }
                // For empty `dir` (root), every path's first segment is a child.
                const rest =
                    dir === ""
                        ? filePath
                        : filePath.startsWith(dir + "/")
                          ? filePath.substring(dir.length + 1)
                          : null;
                if (rest === null) continue;
                const slashIdx = rest.indexOf("/");
                if (slashIdx < 0) {
                    seen.set(rest, "file");
                } else {
                    const childDir = rest.substring(0, slashIdx);
                    if (!seen.has(childDir)) seen.set(childDir, "directory");
                }
            }
            return [...seen.entries()].map(([name, kind]) => ({ name, kind }));
        },
        async exists(path: string): Promise<boolean> {
            const norm = normalize(path);
            if (files.has(norm)) return true;
            // Directory exists if any file lives under it.
            for (const f of files.keys()) {
                if (f.startsWith(norm + "/")) return true;
            }
            return false;
        },
    };
}

// Re-export helper functions for tests that want to verify path inputs.
export { basename, dirname, normalize };
