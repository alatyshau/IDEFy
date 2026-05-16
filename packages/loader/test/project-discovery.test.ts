import { describe, expect, it } from "vitest";
import {
    discoverProjects,
    listProjectFiles,
} from "../src/project-discovery.js";
import { createInMemoryFs } from "./fixtures.js";

describe("listProjectFiles", () => {
    it("recursively lists .idef0 files (and ignores .idef0.ascii sidecars)", async () => {
        const fs = createInMemoryFs({
            "/ws/foo/A-0.idef0": "context A-0 \"\" {}",
            "/ws/foo/A0.idef0": "activity A0 \"\" {}",
            "/ws/foo/sub/A1.idef0": "activity A1 \"\" {}",
            "/ws/foo/sub/A1.idef0.ascii": "ASCII\n",
            "/ws/foo/notes.md": "ignored",
        });
        const files = await listProjectFiles("/ws/foo", fs);
        expect(files).toEqual([
            "/ws/foo/A-0.idef0",
            "/ws/foo/A0.idef0",
            "/ws/foo/sub/A1.idef0",
        ]);
    });
});

describe("discoverProjects — basic", () => {
    it("groups files under a single project rooted at the A0 marker dir", async () => {
        const fs = createInMemoryFs({
            "/ws/src/idef0/coffee/brewing/A-0.idef0": "",
            "/ws/src/idef0/coffee/brewing/A0.idef0": "",
            "/ws/src/idef0/coffee/brewing/A1.idef0": "",
        });
        const { projects, orphans } = await discoverProjects(
            "/ws/src/idef0",
            fs
        );
        expect(orphans).toEqual([]);
        expect(projects).toHaveLength(1);
        const p = projects[0]!;
        expect(p.name).toBe("coffee.brewing");
        expect(p.projectRoot).toBe("/ws/src/idef0/coffee/brewing");
        expect(p.files).toEqual([
            "/ws/src/idef0/coffee/brewing/A-0.idef0",
            "/ws/src/idef0/coffee/brewing/A0.idef0",
            "/ws/src/idef0/coffee/brewing/A1.idef0",
        ]);
    });

    it("treats A0 directly in scanRoot as a project with projectRoot===scanRoot (rule 14 case)", async () => {
        const fs = createInMemoryFs({
            "/ws/src/idef0/A-0.idef0": "",
            "/ws/src/idef0/A0.idef0": "",
        });
        const { projects, orphans } = await discoverProjects(
            "/ws/src/idef0",
            fs
        );
        expect(orphans).toEqual([]);
        expect(projects).toHaveLength(1);
        const p = projects[0]!;
        expect(p.projectRoot).toBe("/ws/src/idef0");
        expect(p.name).toBe("");
    });

    it("recognizes A0 markers with cosmetic suffix (A0.brewing.idef0)", async () => {
        const fs = createInMemoryFs({
            "/ws/src/idef0/coffee/A-0.context.idef0": "",
            "/ws/src/idef0/coffee/A0.brewing.idef0": "",
        });
        const { projects } = await discoverProjects("/ws/src/idef0", fs);
        expect(projects).toHaveLength(1);
        expect(projects[0]!.projectRoot).toBe("/ws/src/idef0/coffee");
    });
});

describe("discoverProjects — nested A0 (rule 15 surface)", () => {
    it("emits one ProjectDescriptor per A0 marker; nested A0 file appears in both outer and inner descriptors", async () => {
        const fs = createInMemoryFs({
            "/ws/src/idef0/outer/A-0.idef0": "",
            "/ws/src/idef0/outer/A0.idef0": "",
            "/ws/src/idef0/outer/sub/A0.idef0": "", // nested marker
        });
        const { projects } = await discoverProjects("/ws/src/idef0", fs);
        expect(projects).toHaveLength(2);
        // Outer project includes the nested A0 in its file list.
        const outer = projects.find(
            (p) => p.projectRoot === "/ws/src/idef0/outer"
        )!;
        const inner = projects.find(
            (p) => p.projectRoot === "/ws/src/idef0/outer/sub"
        )!;
        expect(outer.files).toContain("/ws/src/idef0/outer/sub/A0.idef0");
        expect(inner.files).toEqual(["/ws/src/idef0/outer/sub/A0.idef0"]);
    });

    it("populates DiscoveryResult.nestedProjects with the outer/inner pair", async () => {
        const fs = createInMemoryFs({
            "/ws/src/idef0/outer/A-0.idef0": "",
            "/ws/src/idef0/outer/A0.idef0": "",
            "/ws/src/idef0/outer/sub/A0.idef0": "",
        });
        const { nestedProjects } = await discoverProjects("/ws/src/idef0", fs);
        expect(nestedProjects).toHaveLength(1);
        const pair = nestedProjects[0]!;
        expect(pair.outerProjectRoot).toBe("/ws/src/idef0/outer");
        expect(pair.innerProjectRoot).toBe("/ws/src/idef0/outer/sub");
        expect(pair.innerMarkerPath).toBe("/ws/src/idef0/outer/sub/A0.idef0");
    });

    it("empty nestedProjects when no nesting (control case)", async () => {
        const fs = createInMemoryFs({
            "/ws/src/idef0/a/A-0.idef0": "",
            "/ws/src/idef0/a/A0.idef0": "",
            "/ws/src/idef0/b/A-0.idef0": "",
            "/ws/src/idef0/b/A0.idef0": "",
        });
        const { projects, nestedProjects } = await discoverProjects(
            "/ws/src/idef0",
            fs
        );
        expect(projects).toHaveLength(2);
        expect(nestedProjects).toEqual([]);
    });

    it("detects multiple levels of nesting (outer → mid → inner)", async () => {
        const fs = createInMemoryFs({
            "/ws/src/idef0/outer/A-0.idef0": "",
            "/ws/src/idef0/outer/A0.idef0": "",
            "/ws/src/idef0/outer/mid/A0.idef0": "",
            "/ws/src/idef0/outer/mid/inner/A0.idef0": "",
        });
        const { nestedProjects } = await discoverProjects("/ws/src/idef0", fs);
        // Expect 3 pairs:
        //   outer/A0  contains mid/A0
        //   outer/A0  contains mid/inner/A0
        //   mid/A0    contains mid/inner/A0
        expect(nestedProjects).toHaveLength(3);
        const innerRoots = nestedProjects.map((n) => n.innerProjectRoot).sort();
        expect(innerRoots).toEqual([
            "/ws/src/idef0/outer/mid",
            "/ws/src/idef0/outer/mid/inner",
            "/ws/src/idef0/outer/mid/inner",
        ]);
    });
});

describe("discoverProjects — error policy", () => {
    it("propagates non-ENOENT errors from the adapter (permission/catastrophic)", async () => {
        const failingAdapter = {
            ...createInMemoryFs({}),
            async listDirectory(): Promise<never> {
                const err: Error & { code?: string } = new Error("EACCES: permission denied");
                err.code = "EACCES";
                throw err;
            },
        };
        await expect(
            discoverProjects("/ws/src/idef0", failingAdapter)
        ).rejects.toThrow(/permission denied/);
    });

    it("swallows ENOENT (missing scanRoot directory) and returns empty result", async () => {
        const enoentAdapter = {
            ...createInMemoryFs({}),
            async listDirectory(): Promise<never> {
                const err: Error & { code?: string } = new Error("ENOENT: no such file or directory");
                err.code = "ENOENT";
                throw err;
            },
        };
        const result = await discoverProjects("/ws/src/idef0", enoentAdapter);
        expect(result.projects).toEqual([]);
        expect(result.orphans).toEqual([]);
        expect(result.nestedProjects).toEqual([]);
    });
});

describe("discoverProjects — orphans", () => {
    it("reports .idef0 files not contained in any project as orphans", async () => {
        const fs = createInMemoryFs({
            "/ws/src/idef0/A-0.idef0": "", // no A0 — won't be a project root
            "/ws/src/idef0/stray.idef0": "",
            "/ws/src/idef0/foo/lone.idef0": "",
        });
        const { projects, orphans } = await discoverProjects(
            "/ws/src/idef0",
            fs
        );
        expect(projects).toEqual([]);
        expect(orphans).toEqual([
            "/ws/src/idef0/A-0.idef0",
            "/ws/src/idef0/foo/lone.idef0",
            "/ws/src/idef0/stray.idef0",
        ]);
    });

    it("does not include files of a valid project among orphans", async () => {
        const fs = createInMemoryFs({
            "/ws/src/idef0/coffee/A-0.idef0": "",
            "/ws/src/idef0/coffee/A0.idef0": "",
            "/ws/src/idef0/loose.idef0": "",
        });
        const { projects, orphans } = await discoverProjects(
            "/ws/src/idef0",
            fs
        );
        expect(projects).toHaveLength(1);
        expect(orphans).toEqual(["/ws/src/idef0/loose.idef0"]);
    });
});

describe("discoverProjects — determinism", () => {
    it("files within a project are sorted lexicographically", async () => {
        const fs = createInMemoryFs({
            "/ws/src/idef0/foo/A-0.idef0": "",
            "/ws/src/idef0/foo/A0.idef0": "",
            "/ws/src/idef0/foo/zzz.idef0": "",
            "/ws/src/idef0/foo/aaa.idef0": "",
        });
        const { projects } = await discoverProjects("/ws/src/idef0", fs);
        const sorted = [...projects[0]!.files].sort();
        expect(projects[0]!.files).toEqual(sorted);
    });
});
