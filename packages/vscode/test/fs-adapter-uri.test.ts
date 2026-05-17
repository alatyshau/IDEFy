// REGRESSION: VS Code FsAdapter used to do `Uri.file(uri.path)`, dropping the
// scheme and authority on every round-trip. Any non-`file://` workspace
// (Remote-SSH, WSL, Codespaces, Dev Containers, custom virtual FS) was
// silently aliased to `file:///<path>`, with predictable breakage. After
// the fix, the adapter preserves the original URI through the opaque
// path-identifier exposed to the loader.

import { describe, expect, it, vi } from "vitest";

// Mock `vscode` module: a tiny URI shim that preserves scheme/authority/path
// the way the real one does. Pure Node tests can't `import "vscode"`, so we
// stub the few APIs `fs/adapter.ts` uses (Uri.parse / Uri.file).
vi.mock("vscode", () => {
    class Uri {
        constructor(
            readonly scheme: string,
            readonly authority: string,
            readonly path: string,
            readonly query: string = "",
            readonly fragment: string = "",
        ) {}
        toString(): string {
            const a = this.authority;
            const auth = a.length > 0 ? `${a}` : "";
            return `${this.scheme}://${auth}${this.path}`;
        }
        static parse(s: string): Uri {
            const m = /^([a-z][a-z0-9+.\-]*):\/\/([^/]*)(.*)$/i.exec(s);
            if (m === null) throw new Error(`bad URI: ${s}`);
            return new Uri(m[1]!, m[2]!, m[3] || "/");
        }
        static file(p: string): Uri {
            return new Uri("file", "", p);
        }
    }
    return { Uri };
});

import * as vscode from "vscode";
import { pathToUri, uriToPath } from "../src/fs/adapter.js";

describe("vscode FsAdapter — URI scheme/authority preservation", () => {
    it("uriToPath round-trips a `vscode-remote://` URI without loss", () => {
        const original = vscode.Uri.parse(
            "vscode-remote://wsl.localhost/home/me/proj/A0.idef0",
        );
        const opaque = uriToPath(original);
        const restored = pathToUri(opaque);
        expect(restored.toString()).toBe(original.toString());
        expect(restored.scheme).toBe("vscode-remote");
        expect(restored.authority).toBe("wsl.localhost");
    });

    it("uriToPath round-trips a `vscode-vfs://` URI", () => {
        const original = vscode.Uri.parse(
            "vscode-vfs://github/user/repo/src/A0.idef0",
        );
        const opaque = uriToPath(original);
        const restored = pathToUri(opaque);
        expect(restored.toString()).toBe(original.toString());
        expect(restored.scheme).toBe("vscode-vfs");
        expect(restored.authority).toBe("github");
    });

    it("uriToPath round-trips a local `file://` URI", () => {
        const original = vscode.Uri.file("/Users/me/proj/A0.idef0");
        const opaque = uriToPath(original);
        const restored = pathToUri(opaque);
        expect(restored.toString()).toBe(original.toString());
        expect(restored.scheme).toBe("file");
    });

    it("pathToUri accepts a bare POSIX path as fallback (legacy local case)", () => {
        // Backwards-compat: some call sites still pass plain `/foo/bar`
        // strings. Adapter falls back to `Uri.file()` for those.
        const result = pathToUri("/Users/me/proj/A0.idef0");
        expect(result.scheme).toBe("file");
        expect(result.path).toBe("/Users/me/proj/A0.idef0");
    });
});
