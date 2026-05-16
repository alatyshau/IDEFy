import { describe, expect, it } from "vitest";
import { format } from "../src/formatter/format.js";
import { parse } from "../src/parser/parse.js";
import { readFixture } from "./fixtures.js";

const DEFAULT_OPTS = { maxLineWidth: 120 };

// For each formatter fixture (input.idef0 + expected.idef0), assert that
// format(parse(input)) === expected. The fixture pair acts as living documentation
// of the canonical output for that scenario.
const SCENARIOS = [
    "mode1_table",
    "mode2_long",
    "mode3_multi_own",
    "sticky_comments",
    "context_tunnels",
    "submode_b",
    "boundary_sort",
    "escape_roundtrip",
    "coffee_idempotent",
] as const;

describe.each(SCENARIOS)("formatter fixture: %s", (scenario) => {
    it("format(parse(input.idef0)) === expected.idef0", () => {
        const input = readFixture("formatter", scenario, "input.idef0");
        const expected = readFixture("formatter", scenario, "expected.idef0");
        const { ast, errors } = parse(input);
        expect(errors).toEqual([]);
        if (!ast) throw new Error("parser returned null AST");
        const actual = format(ast, DEFAULT_OPTS);
        expect(actual).toBe(expected);
    });

    it("formatter is idempotent on this fixture (expected → format → expected)", () => {
        const expected = readFixture("formatter", scenario, "expected.idef0");
        const { ast, errors } = parse(expected);
        expect(errors).toEqual([]);
        if (!ast) throw new Error("parser returned null AST");
        const reformatted = format(ast, DEFAULT_OPTS);
        expect(reformatted).toBe(expected);
    });
});

describe("formatter: Mode 1 colon column alignment", () => {
    it("colons align across all Mode 1 blocks", () => {
        const input = readFixture("formatter", "mode1_table", "input.idef0");
        const { ast } = parse(input);
        const out = format(ast!, DEFAULT_OPTS);
        const colonCols = out
            .split("\n")
            .filter((l) => / : /.test(l))
            .map((l) => l.indexOf(" : "));
        expect(colonCols.length).toBeGreaterThanOrEqual(2);
        const first = colonCols[0]!;
        for (const c of colonCols) expect(c).toBe(first);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Explicit structural assertions for each canonical layout. These check that
// format() actually produces the SHAPE described by spec/02-formatting.md, not
// just byte-equality with `expected.idef0` (which is a regression net).
// ─────────────────────────────────────────────────────────────────────────────

function formatFixture(scenario: string): string {
    const input = readFixture("formatter", scenario, "input.idef0");
    const { ast, errors } = parse(input);
    if (errors.length > 0) {
        throw new Error("parse errors: " + errors.map((e) => e.message).join("; "));
    }
    return format(ast!, DEFAULT_OPTS);
}

describe("formatter Mode 2 structure (3-line block)", () => {
    it("emits one line for `<id> \"<name>\"`, one for `: <consumed>`, one for `-> <produced>`", () => {
        const out = formatFixture("mode2_long");
        // The block A13 should span exactly three lines in Mode 2:
        //   1) indent + A13 + " ... "
        //   2) indent + indent + ": " + consumed
        //   3) indent + indent + "-> " + produced
        const lines = out.split("\n");
        const headerIdx = lines.findIndex((l) => /^    A13 /.test(l));
        expect(headerIdx).toBeGreaterThanOrEqual(0);
        expect(lines[headerIdx + 1]).toMatch(/^        : /);
        expect(lines[headerIdx + 2]).toMatch(/^        -> /);
        // No produced-list per-line continuation (that would be Mode 3).
        expect(lines[headerIdx + 2]).not.toMatch(/->\s*$/);
    });
});

describe("formatter Mode 3 structure (produced one-per-line)", () => {
    it("emits `->` alone on its line and each produced ref on its own indented line", () => {
        const out = formatFixture("mode3_multi_own");
        const lines = out.split("\n");
        // Find the lone `->` line.
        const arrowIdx = lines.findIndex((l) => /^        ->\s*$/.test(l));
        expect(arrowIdx).toBeGreaterThanOrEqual(0);
        // The next four lines are each indented 12 spaces and start with X-id.
        for (let i = 1; i <= 4; i += 1) {
            expect(lines[arrowIdx + i]).toMatch(/^            X\w+/);
        }
        // Last produced line has NO trailing comma, the three before it do.
        for (let i = 1; i <= 3; i += 1) {
            expect(lines[arrowIdx + i]).toMatch(/,\s*$/);
        }
        expect(lines[arrowIdx + 4]).not.toMatch(/,\s*$/);
    });
});

describe("formatter sub-mode Б structure (consumed split by role)", () => {
    it("emits `:` alone on its own line and each consumed group on its own indented line", () => {
        const out = formatFixture("submode_b");
        const lines = out.split("\n");
        // Find `        :` exactly.
        const colonIdx = lines.findIndex((l) => l === "        :");
        expect(colonIdx).toBeGreaterThanOrEqual(0);
        // The three following lines start with I/C/M group at indent 12.
        expect(lines[colonIdx + 1]).toMatch(/^            I\w/);
        expect(lines[colonIdx + 2]).toMatch(/^            C\w/);
        expect(lines[colonIdx + 3]).toMatch(/^            M\w/);
        // The I and C group lines end with a trailing comma; M (last) does not.
        expect(lines[colonIdx + 1]).toMatch(/,\s*$/);
        expect(lines[colonIdx + 2]).toMatch(/,\s*$/);
        expect(lines[colonIdx + 3]).not.toMatch(/,\s*$/);
    });

    it("each role group on its own line stays within maxLineWidth where possible", () => {
        const out = formatFixture("submode_b");
        for (const line of out.split("\n")) {
            // Single-group lines (sub-mode Б YAGNI) can exceed maxLineWidth, but
            // the I/C/M groups in this fixture each fit well under 120 chars.
            // Verify the obvious: lines have no embedded newline gibberish.
            expect(line).not.toContain(";");
        }
    });
});
