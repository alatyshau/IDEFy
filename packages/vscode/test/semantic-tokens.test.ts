import { describe, expect, it } from "vitest";
import { scanArrowIds } from "../src/providers/arrow-scan.js";

describe("scanArrowIds", () => {
    it("finds boundary arrows by role prefix, position=standalone", () => {
        const text = "I1 \"src\"\nO1 \"out\"\nC1 \"ctrl\"\nM1 \"mech\"";
        const hits = scanArrowIds(text);
        expect(hits.map((h) => `${h.role}/${h.position}`)).toEqual([
            "I/standalone",
            "O/standalone",
            "C/standalone",
            "M/standalone",
        ]);
    });

    it("emits outer letter, [ and ] with outer role for I[X11] / C[T1]", () => {
        const text = "I[X11], C[T1]";
        const hits = scanArrowIds(text).map(
            (h) => `${h.role}/${h.position}@${h.offset}:${h.length}`,
        );
        expect(hits).toEqual([
            "I/outer@0:1",      // outer I
            "I/outer@1:1",      // [
            "X/inner@2:3",      // X11
            "I/outer@5:1",      // ]
            "C/outer@8:1",      // outer C
            "C/outer@9:1",      // [
            "T/inner@10:2",     // T1
            "C/outer@12:1",     // ]
        ]);
    });

    it("emits outer full-id X11 + brackets with X role for X11[O1] / X12[T1]", () => {
        const text = "X11[O1], X12[T1]";
        const hits = scanArrowIds(text).map(
            (h) => `${h.role}/${h.position}@${h.offset}:${h.length}`,
        );
        expect(hits).toEqual([
            "X/outer@0:3",      // X11
            "X/outer@3:1",      // [
            "O/inner@4:2",      // O1
            "X/outer@6:1",      // ]
            "X/outer@9:3",      // X12
            "X/outer@12:1",     // [
            "T/inner@13:2",     // T1
            "X/outer@15:1",     // ]
        ]);
    });

    it("skips identifiers inside string literals", () => {
        const text = `activity A0 "I1 doesn't matter here" { I1 "Real" }`;
        const hits = scanArrowIds(text);
        expect(hits).toHaveLength(1);
        expect(hits[0]!.role).toBe("I");
    });

    it("skips identifiers inside # line comments", () => {
        const text = "# I1, O1, C1 only in comment\nM1 \"real\"";
        const hits = scanArrowIds(text);
        expect(hits).toHaveLength(1);
        expect(hits[0]!.role).toBe("M");
    });

    it("handles escaped quotes inside strings correctly", () => {
        const text = `activity A0 "with \\"I1\\" inside" { O1 "out" }`;
        const hits = scanArrowIds(text);
        expect(hits).toHaveLength(1);
        expect(hits[0]!.role).toBe("O");
    });

    it("does not match activity ids (A0/A1/A-0)", () => {
        const text = "activity A0 \"x\" { A1 \"y\" : I1 -> X11 }";
        const hits = scanArrowIds(text);
        const roles = hits.map((h) => h.role);
        expect(roles).toEqual(["I", "X"]);
    });

    it("records correct length for multi-char ids", () => {
        const text = "X123 \"foo\"";
        const hits = scanArrowIds(text);
        expect(hits).toEqual([
            { offset: 0, length: 4, role: "X", position: "standalone" },
        ]);
    });

    it("matches lowercase alphabetic suffix IDs (Ia, Ca2, X1a, Tb)", () => {
        const text = "Ia \"in\"\nCa2 \"c\"\nA1 \"x\" : Ia, Ca2 -> X1a, Tb";
        const hits = scanArrowIds(text);
        const slices = hits.map(
            (h) => `${text.slice(h.offset, h.offset + h.length)}/${h.role}`,
        );
        expect(slices).toEqual([
            "Ia/I",
            "Ca2/C",
            "Ia/I",
            "Ca2/C",
            "X1a/X",
            "Tb/T",
        ]);
    });

    it("matches lowercase outer + inner in bracket forms (I[X1a], C[T1])", () => {
        const text = "I[X1a], C[T1]";
        const hits = scanArrowIds(text).map((h) =>
            `${h.role}/${h.position}@${h.offset}:${h.length}`,
        );
        expect(hits).toEqual([
            "I/outer@0:1",
            "I/outer@1:1",
            "X/inner@2:3",
            "I/outer@5:1",
            "C/outer@8:1",
            "C/outer@9:1",
            "T/inner@10:2",
            "C/outer@12:1",
        ]);
    });
});
