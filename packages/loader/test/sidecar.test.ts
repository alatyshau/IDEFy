import { describe, expect, it } from "vitest";
import {
    idef0PathForSidecar,
    isSidecarPath,
    sidecarPathFor,
} from "../src/sidecar.js";

describe("sidecar resolver", () => {
    it("sidecarPathFor appends .ascii", () => {
        expect(sidecarPathFor("/ws/src/idef0/foo/A0.idef0")).toBe(
            "/ws/src/idef0/foo/A0.idef0.ascii"
        );
        expect(sidecarPathFor("a/b/c.idef0")).toBe("a/b/c.idef0.ascii");
    });

    it("isSidecarPath recognizes the .idef0.ascii suffix", () => {
        expect(isSidecarPath("a/b/c.idef0.ascii")).toBe(true);
        expect(isSidecarPath("a/b/c.idef0")).toBe(false);
        expect(isSidecarPath("a/b/c.txt")).toBe(false);
        expect(isSidecarPath("a/b/c.ascii")).toBe(false);
    });

    it("idef0PathForSidecar inverts sidecarPathFor", () => {
        expect(idef0PathForSidecar("a/b/A0.idef0.ascii")).toBe("a/b/A0.idef0");
        expect(idef0PathForSidecar("a/b/A0.idef0")).toBeNull();
        expect(idef0PathForSidecar("a/b/foo.ascii")).toBeNull();
    });

    it("round-trip: sidecarPathFor → idef0PathForSidecar === original", () => {
        const original = "/ws/src/idef0/coffee/brewing/A1.cosmetic.idef0";
        expect(idef0PathForSidecar(sidecarPathFor(original))).toBe(original);
    });
});
