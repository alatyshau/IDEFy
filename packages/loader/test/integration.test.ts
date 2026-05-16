// Integration tests: run the loader end-to-end against real on-disk fixture
// workspaces via createNodeFsAdapter. These verify the full pipeline (adapter
// → discovery → orphan detection) AND act as living documentation of the
// workspace shapes the loader is expected to handle in production.

import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    createNodeFsAdapter,
    discoverProjects,
    findScanRoot,
    isOrphan,
    listProjectFiles,
} from "../src/index.js";
import type { NestedProjectMarker } from "../src/index.js";

// REGRESSION: NestedProjectMarker must be re-exported from the loader root
// alongside the other public types. Without this, downstream consumers
// (`@idefy/vscode`) have to deep-import via `./types.js`, breaking the
// stated public contract.
function _assertNestedProjectMarkerType(): void {
    const m: NestedProjectMarker = {
        outerProjectRoot: "/x",
        innerProjectRoot: "/x/y",
        innerMarkerPath: "/x/y/A0.idef0",
    };
    void m;
}
void _assertNestedProjectMarkerType;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");
const fs = createNodeFsAdapter();

function scanRootOf(workspace: string): string {
    return path.join(FIXTURES_DIR, workspace, "src", "idef0");
}

describe("integration: simple workspace (one valid project)", () => {
    it("finds the project via findScanRoot + discoverProjects", async () => {
        const filePath = path.join(
            scanRootOf("simple"),
            "coffee/brewing/A1.idef0"
        );
        const scanRoot = await findScanRoot(filePath, fs);
        expect(scanRoot).toBe(scanRootOf("simple"));
        const { projects, orphans } = await discoverProjects(scanRoot!, fs);
        expect(orphans).toEqual([]);
        expect(projects).toHaveLength(1);
        const p = projects[0]!;
        expect(p.name).toBe("coffee.brewing");
        expect(p.files.map((f) => path.basename(f)).sort()).toEqual([
            "A-0.idef0",
            "A0.idef0",
            "A1.idef0",
        ]);
    });

    it("listProjectFiles returns the same files as discoverProjects[0].files", async () => {
        const projectRoot = path.join(
            scanRootOf("simple"),
            "coffee/brewing"
        );
        const direct = await listProjectFiles(projectRoot, fs);
        const { projects } = await discoverProjects(scanRootOf("simple"), fs);
        expect([...direct].sort()).toEqual([...projects[0]!.files].sort());
    });
});

describe("integration: multi_project workspace (two parallel projects)", () => {
    it("discovers both projects independently", async () => {
        const { projects, orphans } = await discoverProjects(
            scanRootOf("multi_project"),
            fs
        );
        expect(orphans).toEqual([]);
        const names = projects.map((p) => p.name).sort();
        expect(names).toEqual(["coffee.brewing", "hr.recruitment"]);
    });
});

describe("integration: with_orphans workspace", () => {
    it("reports both .idef0 files as orphans (no A0 marker → no project)", async () => {
        const { projects, orphans } = await discoverProjects(
            scanRootOf("with_orphans"),
            fs
        );
        expect(projects).toEqual([]);
        expect(orphans.map((f) => path.basename(f)).sort()).toEqual([
            "A-0.idef0",
            "stray.idef0",
        ]);
    });

    it("isOrphan agrees with discoverProjects on the stray files", async () => {
        const scanRoot = scanRootOf("with_orphans");
        const { projects } = await discoverProjects(scanRoot, fs);
        const stray = path.join(scanRoot, "foo/stray.idef0");
        expect(isOrphan(stray, scanRoot, projects)).toBe(true);
    });
});

describe("integration: nested_a0 workspace (rule 15 surface)", () => {
    it("emits ONE ProjectDescriptor per A0 marker (outer + inner)", async () => {
        const { projects } = await discoverProjects(
            scanRootOf("nested_a0"),
            fs
        );
        expect(projects).toHaveLength(2);
        const projectRoots = projects.map((p) =>
            path.relative(scanRootOf("nested_a0"), p.projectRoot)
        );
        expect(projectRoots.sort()).toEqual(["outer", "outer/sub"]);
    });

    it("outer project's files INCLUDE the nested A0 (so core can detect duplicate)", async () => {
        const { projects } = await discoverProjects(
            scanRootOf("nested_a0"),
            fs
        );
        const outer = projects.find((p) => p.projectRoot.endsWith("/outer"))!;
        const nestedA0 = outer.files.find((f) => f.endsWith("/outer/sub/A0.idef0"));
        expect(nestedA0).toBeTruthy();
    });
});

describe("integration: a0_in_scanroot workspace (rule 14 surface)", () => {
    it("emits ProjectDescriptor with projectRoot === scanRoot and empty name", async () => {
        const scanRoot = scanRootOf("a0_in_scanroot");
        const { projects, orphans } = await discoverProjects(scanRoot, fs);
        expect(orphans).toEqual([]);
        expect(projects).toHaveLength(1);
        const p = projects[0]!;
        expect(p.projectRoot).toBe(scanRoot);
        expect(p.name).toBe("");
    });
});

describe("integration: cosmetic_suffix workspace (filename ID before first dot)", () => {
    it("recognizes A0.brewing.idef0 as an A0 marker", async () => {
        const { projects, orphans } = await discoverProjects(
            scanRootOf("cosmetic_suffix"),
            fs
        );
        expect(orphans).toEqual([]);
        expect(projects).toHaveLength(1);
        expect(projects[0]!.name).toBe("coffee");
        expect(projects[0]!.files.map((f) => path.basename(f)).sort()).toEqual([
            "A-0.context.idef0",
            "A0.brewing.idef0",
        ]);
    });
});

describe("integration: deep_nesting workspace (4 decomposition levels, flat layout)", () => {
    it("groups all 5 files under one project regardless of decomposition depth", async () => {
        const scanRoot = scanRootOf("deep_nesting");
        const { projects, orphans } = await discoverProjects(scanRoot, fs);
        expect(orphans).toEqual([]);
        expect(projects).toHaveLength(1);
        const p = projects[0]!;
        expect(p.name).toBe("business.process");
        expect(p.files.map((f) => path.basename(f)).sort()).toEqual([
            "A-0.idef0",
            "A0.idef0",
            "A1.idef0",
            "A11.idef0",
            "A111.idef0",
        ]);
    });
});

describe("integration: decomp_folders workspace (same content as deep_nesting but folders mirror hierarchy)", () => {
    it("subfolders are ignored — same project shape as the flat layout", async () => {
        const scanRoot = scanRootOf("decomp_folders");
        const { projects, orphans } = await discoverProjects(scanRoot, fs);
        expect(orphans).toEqual([]);
        expect(projects).toHaveLength(1);
        const p = projects[0]!;
        expect(p.name).toBe("business.process");
        expect(p.files.map((f) => path.basename(f)).sort()).toEqual([
            "A-0.idef0",
            "A0.idef0",
            "A1.idef0",
            "A11.idef0",
            "A111.idef0",
        ]);
    });

    it("listProjectFiles walks into A0/A1/A11/ subfolders", async () => {
        const projectRoot = path.join(
            scanRootOf("decomp_folders"),
            "business/process"
        );
        const files = await listProjectFiles(projectRoot, fs);
        const deepest = files.find((f) => f.endsWith("/A0/A1/A11/A111.idef0"));
        expect(deepest).toBeTruthy();
    });

    it("deep_nesting and decomp_folders produce equivalent project content (file set by basename)", async () => {
        const a = await discoverProjects(scanRootOf("deep_nesting"), fs);
        const b = await discoverProjects(scanRootOf("decomp_folders"), fs);
        const namesA = a.projects[0]!.files.map((f) => path.basename(f)).sort();
        const namesB = b.projects[0]!.files.map((f) => path.basename(f)).sort();
        expect(namesA).toEqual(namesB);
        expect(a.projects[0]!.name).toBe(b.projects[0]!.name);
    });
});
