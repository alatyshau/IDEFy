// Unit tests for createNodeFsAdapter. FsAdapter is a generic FS contract —
// it doesn't know about `.idef0` files. These tests verify the contract using
// minimal synthetic content in os.tmpdir(); they're decoupled from project
// fixtures by design.
//
// Integration (real fixtures × adapter × loader pipeline) lives in
// integration.test.ts — if the adapter regresses, those tests catch it
// against actual .idef0 content. No need to mix the layers here.

import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNodeFsAdapter } from "../src/node-fs-adapter.js";

describe("createNodeFsAdapter — generic FsAdapter contract against tmpdir", () => {
    it("read/write/list/exists/rename/delete round-trip", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idefy-loader-"));
        try {
            const adapter = createNodeFsAdapter();
            const aPath = path.join(dir, "a.txt");
            await adapter.writeFile(aPath, "hello");
            expect(await adapter.exists(aPath)).toBe(true);
            expect(await adapter.readFile(aPath)).toBe("hello");

            const entries = await adapter.listDirectory(dir);
            expect(entries.map((e) => e.name)).toContain("a.txt");
            expect(entries.find((e) => e.name === "a.txt")?.kind).toBe("file");

            const bPath = path.join(dir, "b.txt");
            await adapter.renameFile(aPath, bPath);
            expect(await adapter.exists(aPath)).toBe(false);
            expect(await adapter.readFile(bPath)).toBe("hello");

            await adapter.deleteFile(bPath);
            expect(await adapter.exists(bPath)).toBe(false);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it("listDirectory returns 'directory' kind for subdirs", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idefy-loader-"));
        try {
            await fs.mkdir(path.join(dir, "child"));
            await fs.writeFile(path.join(dir, "file.txt"), "x");
            const adapter = createNodeFsAdapter();
            const entries = await adapter.listDirectory(dir);
            const child = entries.find((e) => e.name === "child");
            const file = entries.find((e) => e.name === "file.txt");
            expect(child?.kind).toBe("directory");
            expect(file?.kind).toBe("file");
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
