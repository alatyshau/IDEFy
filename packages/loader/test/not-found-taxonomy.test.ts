// REGRESSION: loader hardcoded a check for Node's `ENOENT` to recognise the
// "this path doesn't exist" case. VS Code's FS bridge throws `FileNotFound`
// with a different `code`. Without a way for the adapter to declare what
// not-found looks like in its world, opening a workspace without `src/idef0/`
// surfaces as a fatal error instead of an empty discovery — a real-world bug
// for non-Node adapters. The fix is to let the adapter own that taxonomy via
// an optional `isNotFound(err)` method, and loader consults it before falling
// back to its built-in heuristic.

import { describe, expect, it } from "vitest";
import { discoverProjects } from "../src/index.js";
import type { FsAdapter, DirectoryEntry } from "../src/index.js";

class TaggedNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TaggedNotFoundError";
    }
}

function stubAdapter(): FsAdapter & { listCalls: string[] } {
    const calls: string[] = [];
    return {
        async readFile() {
            throw new Error("not used");
        },
        async writeFile() {},
        async deleteFile() {},
        async renameFile() {},
        async listDirectory(path: string): Promise<DirectoryEntry[]> {
            calls.push(path);
            // Every directory throws an adapter-flavoured not-found error —
            // no Node `ENOENT`, no posix-`code` shape. This simulates a VS
            // Code or web-FS adapter whose errors don't match Node patterns.
            throw new TaggedNotFoundError(`adapter says: nothing at ${path}`);
        },
        async exists() {
            return false;
        },
        isNotFound(err: unknown): boolean {
            return err instanceof TaggedNotFoundError;
        },
        listCalls: calls,
    } as FsAdapter & { listCalls: string[] };
}

describe("FsAdapter.isNotFound — adapter owns not-found taxonomy", () => {
    it("discoverProjects returns empty result when adapter reports not-found", async () => {
        const fs = stubAdapter();
        // Without the fix: TaggedNotFoundError is not Node-style ENOENT, so
        // loader propagates it as a fatal error — pulls down discovery.
        // With the fix: adapter's isNotFound is consulted, listDirectory's
        // throw is interpreted as "no entries" and discovery yields empty.
        const result = await discoverProjects("/some/scan/root", fs);
        expect(result.projects).toEqual([]);
        expect(result.orphans).toEqual([]);
        expect(result.nestedProjects).toEqual([]);
        expect(fs.listCalls.length).toBeGreaterThan(0);
    });
});
