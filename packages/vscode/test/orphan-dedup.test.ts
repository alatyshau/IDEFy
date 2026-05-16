import { describe, expect, it } from "vitest";
import { OrphanNotificationDedup } from "../src/orphan/dedup.js";

describe("OrphanNotificationDedup", () => {
    it("returns true the first time and false thereafter", () => {
        const d = new OrphanNotificationDedup();
        expect(d.shouldShow("file:///a.idef0")).toBe(true);
        expect(d.shouldShow("file:///a.idef0")).toBe(false);
        expect(d.shouldShow("file:///a.idef0")).toBe(false);
    });

    it("tracks each URI independently", () => {
        const d = new OrphanNotificationDedup();
        expect(d.shouldShow("file:///a")).toBe(true);
        expect(d.shouldShow("file:///b")).toBe(true);
        expect(d.shouldShow("file:///a")).toBe(false);
        expect(d.shouldShow("file:///b")).toBe(false);
    });

    it("forget(uri) re-enables a single URI", () => {
        const d = new OrphanNotificationDedup();
        d.shouldShow("file:///a");
        d.forget("file:///a");
        expect(d.shouldShow("file:///a")).toBe(true);
    });

    it("reset clears all", () => {
        const d = new OrphanNotificationDedup();
        d.shouldShow("file:///a");
        d.shouldShow("file:///b");
        d.reset();
        expect(d.shouldShow("file:///a")).toBe(true);
        expect(d.shouldShow("file:///b")).toBe(true);
    });
});
