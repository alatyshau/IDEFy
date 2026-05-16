import { describe, expect, it } from "vitest";
import { computeProjectName } from "../src/assembler/assemble.js";
import { loadFixtureProject } from "./fixtures.js";

describe("computeProjectName", () => {
    it("derives Java-package name from scanRoot → projectRoot path", () => {
        expect(
            computeProjectName("src/idef0", "src/idef0/coffee/brewing")
        ).toBe("coffee.brewing");
        expect(
            computeProjectName(
                "src/idef0",
                "src/idef0/banking/lending/as_is"
            )
        ).toBe("banking.lending.as_is");
    });
    it("returns empty when projectRoot equals scanRoot", () => {
        expect(computeProjectName("src/idef0", "src/idef0")).toBe("");
    });
    it("normalizes trailing slashes and backslashes", () => {
        expect(computeProjectName("src/idef0/", "src/idef0/a/b/")).toBe("a.b");
        expect(computeProjectName("src\\idef0", "src\\idef0\\a\\b")).toBe(
            "a.b"
        );
    });
});

describe("assembleProject: fixture coffee/brewing", () => {
    it("builds project with A0, A-0, name 'coffee.brewing'", () => {
        const { project, assemblerErrors } = loadFixtureProject(
            "assembler",
            "coffee/brewing"
        );
        expect(assemblerErrors).toEqual([]);
        expect(project.name).toBe("coffee.brewing");
        expect(project.activities.has("A0")).toBe(true);
        expect(project.context).not.toBeNull();
        expect(project.context?.tunnels.size).toBe(1);
    });
});

describe("assembleProject: fixture hr/recruitment with one child decomposition", () => {
    it("wires parent ↔ child between A0 and A1", () => {
        const { project } = loadFixtureProject("assembler", "hr/recruitment");
        expect(project.name).toBe("hr.recruitment");
        const a1 = project.activities.get("A1")!;
        expect(a1.parent?.id).toBe("A0");
        expect(a1.blockInParent?.id).toBe("A1");
    });
});

describe("assembleProject: structural error fixtures", () => {
    it("duplicate_id project — assembler reports the duplicate", () => {
        const { assemblerErrors } = loadFixtureProject(
            "assembler",
            "duplicate_id/foo"
        );
        expect(
            assemblerErrors.some((e) => /Duplicate activity ID/.test(e.message))
        ).toBe(true);
    });
    it("multiple_context project — assembler reports the duplicate context", () => {
        const { assemblerErrors } = loadFixtureProject(
            "assembler",
            "multiple_context/foo"
        );
        expect(
            assemblerErrors.some((e) => /Multiple A-0/.test(e.message))
        ).toBe(true);
    });
});
