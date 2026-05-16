import { describe, expect, it } from "vitest";
import { computeAsciiTokens } from "../src/sidecar/ascii-tokens.js";

describe("computeAsciiTokens", () => {
    it("emits arrow + activity tokens sorted by offset", () => {
        const text = "# IDEFy ASCII placeholder for A1 \"name\"\n  I: I1 I2\n  X: X11\n  children: A11 A12";
        const tokens = computeAsciiTokens(text);
        // Tokens come back in source order.
        const offsets = tokens.map((t) => t.offset);
        const sorted = [...offsets].sort((a, b) => a - b);
        expect(offsets).toEqual(sorted);
        // Roles present: A (activity ids in header + children), I, X.
        const roles = new Set(tokens.map((t) => t.role));
        expect(roles).toContain("A");
        expect(roles).toContain("I");
        expect(roles).toContain("X");
    });

    it("does not tokenise IDs inside string literals", () => {
        const text = `# header with "I1, X11" inside quotes\n  I: I2`;
        const tokens = computeAsciiTokens(text);
        const slices = tokens.map((t) => text.slice(t.offset, t.offset + t.length));
        expect(slices).toEqual(["I2"]);
    });

    it("classifies role A for `...A0` root reference", () => {
        const text = "context A-0 \"x\" { ...A0 }";
        const tokens = computeAsciiTokens(text);
        const roles = tokens.map((t) => t.role);
        // Both A-0 and ...A0 are role A; nothing else here.
        expect(roles.every((r) => r === "A")).toBe(true);
        expect(tokens.length).toBe(2);
    });

    it("returns empty array for content without DSL IDs", () => {
        expect(computeAsciiTokens("just plain prose")).toEqual([]);
    });
});
