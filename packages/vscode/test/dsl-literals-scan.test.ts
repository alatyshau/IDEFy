import { describe, expect, it } from "vitest";
import { scanCommas, scanLiterals } from "../src/providers/dsl-literals-scan.js";

function pluck(
    text: string,
    kind: string,
): string[] {
    return scanLiterals(text)
        .filter((r) => r.kind === kind)
        .map((r) => text.slice(r.offset, r.offset + r.length));
}

describe("scanLiterals", () => {
    it("finds keyword tokens activity / context", () => {
        const text = "activity A0 \"x\" {\n}\ncontext A-0 \"y\" {\n}";
        expect(pluck(text, "keyword")).toEqual(["activity", "context"]);
    });

    it("finds braces", () => {
        const text = "activity A0 \"x\" { }";
        expect(pluck(text, "brace")).toEqual(["{", "}"]);
    });

    it("finds : and -> as operators", () => {
        const text = "A1 \"name\" : I1 -> X11";
        expect(pluck(text, "operator")).toEqual([":", "->"]);
    });

    it("finds commas", () => {
        const text = "A1 \"x\" : I1, C1, M1 -> X11, X12";
        expect(pluck(text, "comma")).toEqual([",", ",", ","]);
    });

    it("finds whole string regions including the quotes", () => {
        const text = `activity A0 "Hello, world" { }`;
        expect(pluck(text, "string")).toEqual([`"Hello, world"`]);
    });

    it("finds # comments to end of line", () => {
        const text = "# header\nactivity A0 \"x\" {} # trailer\n";
        expect(pluck(text, "comment")).toEqual(["# header", "# trailer"]);
    });

    it("does not emit punctuation inside strings", () => {
        const text = `I1 "this has : and -> and {}"`;
        const literals = scanLiterals(text);
        const kinds = literals.map((r) => r.kind);
        expect(kinds).toEqual(["string"]);
    });

    it("does not emit punctuation inside comments", () => {
        const text = "# {} : -> ,\nI1 \"x\"";
        const literals = scanLiterals(text);
        expect(literals.map((r) => r.kind)).toEqual(["comment", "string"]);
    });

    it("treats `activity` as a keyword only at a word boundary", () => {
        const text = "myactivity A0 \"x\"";
        expect(pluck(text, "keyword")).toEqual([]);
    });

    it("does not treat trailing `->` of `>->` chain as operator twice", () => {
        const text = "I1 -> X11";
        expect(pluck(text, "operator")).toEqual(["->"]);
    });
});

describe("scanCommas", () => {
    it("is a thin wrapper that returns only comma regions", () => {
        const text = "I1, C1 \"x, y\" -> X11";
        const commas = scanCommas(text);
        expect(commas).toEqual([{ kind: "comma", offset: 2, length: 1 }]);
    });
});
