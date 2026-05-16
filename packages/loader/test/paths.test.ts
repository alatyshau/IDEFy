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
