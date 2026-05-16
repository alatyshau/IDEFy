import { describe, expect, it } from "vitest";
import path from "node:path";
import { createRendererRegistry } from "../src/renderers/registry.js";
import { loadFixtureProject } from "./fixtures.js";

describe("renderer registry — defaults and override", () => {
    it("registers ASCII renderer by default", () => {
        const reg = createRendererRegistry();
        expect(reg.listAvailable()).toContain("ascii");
        expect(reg.get("ascii")).not.toBeNull();
        expect(reg.get("nonexistent")).toBeNull();
    });
    it("supports custom renderer override", () => {
        const reg = createRendererRegistry();
        reg.register({
            id: "ascii",
            render() {
                return {
                    sidecars: new Map([["x", "OVERRIDDEN"]]),
                    diagnostics: [],
                };
            },
        });
        const r = reg.get("ascii")!.render({} as never);
        expect(r.sidecars.get("x")).toBe("OVERRIDDEN");
    });
});

describe("ASCII placeholder renderer over fixture project", () => {
    it("emits one sidecar per activity file (skips A-0 context)", () => {
        const { project } = loadFixtureProject("renderer", "coffee/brewing");
        const reg = createRendererRegistry();
        const result = reg.get("ascii")!.render(project);
        const a0Path = path.join(project.projectRoot, "A0.idef0");
        const a1Path = path.join(project.projectRoot, "A1.idef0");
        const ctxPath = path.join(project.projectRoot, "A-0.idef0");
        expect(result.sidecars.size).toBe(2);
        expect(result.sidecars.has(a0Path)).toBe(true);
        expect(result.sidecars.has(a1Path)).toBe(true);
        expect(result.sidecars.has(ctxPath)).toBe(false);
        expect(result.diagnostics).toHaveLength(0);
    });

    it("placeholder summary contains the activity header and real DSL IDs", () => {
        const { project } = loadFixtureProject("renderer", "coffee/brewing");
        const reg = createRendererRegistry();
        const result = reg.get("ascii")!.render(project);
        const a0Path = path.join(project.projectRoot, "A0.idef0");
        const a0 = result.sidecars.get(a0Path)!;
        expect(a0).toMatch(/^# IDEFy ASCII placeholder for A0/);
        // The summary lists role-grouped IDs from the fixture.
        expect(a0).toContain("I:");
        expect(a0).toContain("children: A1");
        // Trailing newline keeps the file POSIX-clean.
        expect(a0.endsWith("\n")).toBe(true);
    });
});
