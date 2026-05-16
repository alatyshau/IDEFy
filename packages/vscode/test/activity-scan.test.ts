import { describe, expect, it } from "vitest";
import { scanActivityIds } from "../src/providers/activity-scan.js";

describe("scanActivityIds", () => {
    it("finds A0 / A1 / A11 / A1A in a typical activity body", () => {
        const text = "activity A1 \"name\" {\n A11 \"x\" : I1 -> X11\n}";
        const hits = scanActivityIds(text).map(
            (h) => `${text.slice(h.offset, h.offset + h.length)}@${h.offset}`,
        );
        expect(hits).toEqual(["A1@9", "A11@22"]);
    });

    it("finds A-0 in a context header", () => {
        const text = "context A-0 \"ctx\" {\n T1 \"x\"\n}";
        const hits = scanActivityIds(text).map(
            (h) => text.slice(h.offset, h.offset + h.length),
        );
        expect(hits).toEqual(["A-0"]);
    });

    it("finds ...A0 root reference", () => {
        const text = "context A-0 \"x\" { ...A0 }";
        const hits = scanActivityIds(text).map(
            (h) => text.slice(h.offset, h.offset + h.length),
        );
        expect(hits).toEqual(["A-0", "...A0"]);
    });

    it("skips A-looking substrings inside strings", () => {
        const text = `activity A0 "this A1 is text" { }`;
        const hits = scanActivityIds(text).map(
            (h) => text.slice(h.offset, h.offset + h.length),
        );
        expect(hits).toEqual(["A0"]);
    });

    it("skips A-looking substrings inside comments", () => {
        const text = "# A1, A2 are notes\nactivity A0 \"x\" {}";
        const hits = scanActivityIds(text).map(
            (h) => text.slice(h.offset, h.offset + h.length),
        );
        expect(hits).toEqual(["A0"]);
    });

    it("does not match arrow IDs (I1, X11, T1)", () => {
        const text = "I1 \"a\"\nO1 \"b\"\nA1 \"c\" : I1 -> X11";
        const hits = scanActivityIds(text).map(
            (h) => text.slice(h.offset, h.offset + h.length),
        );
        expect(hits).toEqual(["A1"]);
    });

    it("accepts lowercase alphabetic activity suffixes (Aa, A1a, A1b1)", () => {
        const text = "activity A1a \"x\" {\n  I1 \"in\"\n  Aa \"child\" : I1\n  A1b1 \"deeper\" : I1\n}";
        const slices = scanActivityIds(text).map((h) =>
            text.slice(h.offset, h.offset + h.length),
        );
        expect(slices).toEqual(["A1a", "Aa", "A1b1"]);
    });
});
