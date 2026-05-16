import { describe, expect, it } from "vitest";
import { isOrphan } from "../src/orphan.js";
import type { ProjectDescriptor } from "../src/types.js";

const project: ProjectDescriptor = {
    name: "coffee.brewing",
    scanRoot: "/ws/src/idef0",
    projectRoot: "/ws/src/idef0/coffee/brewing",
    files: ["/ws/src/idef0/coffee/brewing/A0.idef0"],
};

describe("isOrphan", () => {
    it("returns true for .idef0 file under scanRoot but outside any project", async () => {
        expect(
            isOrphan("/ws/src/idef0/stray.idef0", "/ws/src/idef0", [project])
        ).toBe(true);
    });

    it("returns false for .idef0 file inside a project", async () => {
        expect(
            isOrphan(
                "/ws/src/idef0/coffee/brewing/A0.idef0",
                "/ws/src/idef0",
                [project]
            )
        ).toBe(false);
    });

    it("returns false for .idef0 file outside scanRoot", async () => {
        expect(
            isOrphan("/elsewhere/foo.idef0", "/ws/src/idef0", [project])
        ).toBe(false);
    });

    it("works with empty projects list", async () => {
        expect(
            isOrphan("/ws/src/idef0/anything.idef0", "/ws/src/idef0", [])
        ).toBe(true);
    });
});
