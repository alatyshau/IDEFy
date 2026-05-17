import { describe, expect, it } from "vitest";
import {
    basename,
    dirname,
    isDescendant,
    join,
    normalize,
    segments,
} from "../src/paths.js";

describe("paths — POSIX helpers", () => {
    it("normalize collapses trailing slashes and converts backslashes", () => {
        expect(normalize("a/b/c/")).toBe("a/b/c");
        expect(normalize("a\\b\\c")).toBe("a/b/c");
        expect(normalize("/a/b//")).toBe("/a/b");
    });

    it("dirname returns parent path", () => {
        expect(dirname("a/b/c")).toBe("a/b");
        expect(dirname("/a/b/c")).toBe("/a/b");
        expect(dirname("/a")).toBe("/");
        expect(dirname("file")).toBe("");
    });

    it("basename returns last segment", () => {
        expect(basename("a/b/c")).toBe("c");
        expect(basename("/a/b/c")).toBe("c");
        expect(basename("file")).toBe("file");
    });

    it("join concatenates with single slash and respects absolute prefix", () => {
        expect(join("a", "b", "c")).toBe("a/b/c");
        expect(join("/a", "b", "c")).toBe("/a/b/c");
        expect(join("a/", "/b", "c")).toBe("a/b/c");
        expect(join("a", "", "b")).toBe("a/b");
    });

    it("segments splits and skips empty parts", () => {
        expect(segments("/a/b/c")).toEqual(["a", "b", "c"]);
        expect(segments("a/b/c")).toEqual(["a", "b", "c"]);
        expect(segments("/")).toEqual([]);
    });

    it("isDescendant — same path counts; lexical prefix only", () => {
        expect(isDescendant("/a/b", "/a/b/c")).toBe(true);
        expect(isDescendant("/a/b", "/a/b")).toBe(true);
        expect(isDescendant("/a/b", "/a/bb")).toBe(false);
        expect(isDescendant("/a/b", "/a")).toBe(false);
    });
});

describe("paths — POSIX `.` / `..` resolution (per spec invariant)", () => {
    it("normalize resolves `.` segments", () => {
        expect(normalize("/a/./b/./c")).toBe("/a/b/c");
        expect(normalize("./a/b")).toBe("a/b");
    });

    it("normalize resolves `..` segments by popping previous", () => {
        expect(normalize("/a/b/../c")).toBe("/a/c");
        expect(normalize("/a/b/c/../..")).toBe("/a");
        expect(normalize("/ws/src/idef0/foo/../bar/A0.idef0")).toBe(
            "/ws/src/idef0/bar/A0.idef0"
        );
    });

    it("normalize drops excess `..` at absolute root", () => {
        expect(normalize("/../a")).toBe("/a");
        expect(normalize("/a/../../..")).toBe("/");
    });

    it("normalize preserves excess `..` in relative paths", () => {
        expect(normalize("../a")).toBe("../a");
        expect(normalize("a/../../b")).toBe("../b");
    });

    it("normalize collapses redundant slashes", () => {
        expect(normalize("a///b//c")).toBe("a/b/c");
        expect(normalize("///a//b")).toBe("/a/b");
    });

    it("isDescendant works correctly through `..` resolution", () => {
        expect(isDescendant("/a/b", "/a/b/c/../d")).toBe(true);
        expect(isDescendant("/a/b", "/a/b/c/../../d")).toBe(false);
    });

    it("join resolves `..` between parts", () => {
        expect(join("/a/b", "..", "c")).toBe("/a/c");
        expect(join("/a", "b", "..", "c")).toBe("/a/c");
    });
});

describe("paths — preserve URI scheme/authority through operations", () => {
    // BUG: previous implementation treated URI strings as relative paths,
    // collapsing `vscode-remote://wsl/home/foo` into `vscode-remote:/wsl/home/foo`
    // (one slash less). All path utilities must be transparent to the
    // `<scheme>://<authority>` prefix — the prefix passes through verbatim,
    // and only the path portion is normalised/split/joined.

    it("normalize preserves `<scheme>://<authority>` prefix", () => {
        expect(
            normalize("vscode-remote://wsl.localhost/home/foo/A0.idef0"),
        ).toBe("vscode-remote://wsl.localhost/home/foo/A0.idef0");
        expect(normalize("file:///Users/me/proj/A0.idef0")).toBe(
            "file:///Users/me/proj/A0.idef0",
        );
        expect(normalize("vscode-vfs://github/user/repo/A0.idef0")).toBe(
            "vscode-vfs://github/user/repo/A0.idef0",
        );
    });

    it("normalize resolves `..` inside path portion of a URI", () => {
        expect(
            normalize("vscode-remote://wsl/a/b/../c/A0.idef0"),
        ).toBe("vscode-remote://wsl/a/c/A0.idef0");
    });

    it("basename of a URI returns last path segment", () => {
        expect(
            basename("vscode-remote://wsl/home/foo/A0.idef0"),
        ).toBe("A0.idef0");
    });

    it("dirname of a URI returns parent path with scheme intact", () => {
        expect(
            dirname("vscode-remote://wsl/home/foo/A0.idef0"),
        ).toBe("vscode-remote://wsl/home/foo");
    });

    it("isDescendant works inside a single URI scheme/authority", () => {
        expect(
            isDescendant(
                "vscode-remote://wsl/home/foo",
                "vscode-remote://wsl/home/foo/bar/A0.idef0",
            ),
        ).toBe(true);
    });

    it("isDescendant is false across different scheme/authority", () => {
        // Same path portion under different hosts must NOT collide.
        expect(
            isDescendant(
                "vscode-remote://hostA/home/foo",
                "vscode-remote://hostB/home/foo/bar",
            ),
        ).toBe(false);
        expect(
            isDescendant(
                "file:///Users/me/foo",
                "vscode-remote://wsl/Users/me/foo/bar",
            ),
        ).toBe(false);
    });

    it("join applies relative parts inside URI without losing prefix", () => {
        expect(
            join("vscode-remote://wsl/home/foo", "bar", "A0.idef0"),
        ).toBe("vscode-remote://wsl/home/foo/bar/A0.idef0");
    });
});
