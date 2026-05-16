import { describe, expect, it } from "vitest";
import {
    isActivityId,
    isValidArrowId,
    isWellFormedActivityId,
    isWellFormedArrowId,
} from "../src/ids.js";
import {
    diagnosticsForNestedProjects,
    validate,
    validateOrphans,
} from "../src/validator/validate.js";
import { loadFixtureProject } from "./fixtures.js";

describe("ids predicates: canonical (strict) vs well-formed (lenient)", () => {
    it("isActivityId is strict: rejects uppercase letters in suffix", () => {
        expect(isActivityId("Aa")).toBe(true);
        expect(isActivityId("AA")).toBe(false);
        expect(isActivityId("A1a")).toBe(true);
        expect(isActivityId("A1A")).toBe(false);
    });
    it("isWellFormedActivityId is lenient: accepts uppercase suffix letters", () => {
        expect(isWellFormedActivityId("Aa")).toBe(true);
        expect(isWellFormedActivityId("AA")).toBe(true);
        expect(isWellFormedActivityId("A1A")).toBe(true);
        expect(isWellFormedActivityId("AABC")).toBe(true);
    });
    it("isWellFormedActivityId still rejects structural violations (0 in suffix, bad chars, lc prefix)", () => {
        expect(isWellFormedActivityId("A10")).toBe(false);
        expect(isWellFormedActivityId("A1z0")).toBe(false);
        expect(isWellFormedActivityId("A_1")).toBe(false);
        expect(isWellFormedActivityId("a1")).toBe(false);
        expect(isWellFormedActivityId("B0")).toBe(false);
    });
    it("isValidArrowId is strict: rejects uppercase letters in suffix", () => {
        expect(isValidArrowId("Ia")).toBe(true);
        expect(isValidArrowId("IA")).toBe(false);
        expect(isValidArrowId("X1a")).toBe(true);
        expect(isValidArrowId("X1A")).toBe(false);
        expect(isValidArrowId("Iabc")).toBe(true);
        expect(isValidArrowId("IABC")).toBe(false);
    });
    it("isWellFormedArrowId is lenient: accepts uppercase suffix letters", () => {
        expect(isWellFormedArrowId("IA")).toBe(true);
        expect(isWellFormedArrowId("IABC")).toBe(true);
        expect(isWellFormedArrowId("X1A")).toBe(true);
    });
    it("isWellFormedArrowId still rejects structural violations (0 in suffix, bad chars, lc prefix)", () => {
        expect(isWellFormedArrowId("I10")).toBe(false);
        expect(isWellFormedArrowId("I0")).toBe(false);
        expect(isWellFormedArrowId("I_1")).toBe(false);
        expect(isWellFormedArrowId("i1")).toBe(false);
        // Prefix must be one of I/O/C/M/X/T — `Z1` rejected.
        expect(isWellFormedArrowId("Z1")).toBe(false);
    });
});

describe("isActivityId: regex enforces suffix alphabet [1-9a-z]", () => {
    it("accepts A0 root and standard descendants", () => {
        expect(isActivityId("A0")).toBe(true);
        expect(isActivityId("A1")).toBe(true);
        expect(isActivityId("A9")).toBe(true);
        expect(isActivityId("Aa")).toBe(true);
        expect(isActivityId("Az")).toBe(true);
        expect(isActivityId("A11")).toBe(true);
        expect(isActivityId("A1z")).toBe(true);
        expect(isActivityId("A1a1")).toBe(true);
    });
    it("rejects 0 inside suffix (reserved for root)", () => {
        expect(isActivityId("A10")).toBe(false);
        expect(isActivityId("A20")).toBe(false);
        expect(isActivityId("A1z0")).toBe(false);
    });
    it("rejects uppercase letters in suffix (lowercase only)", () => {
        expect(isActivityId("AA")).toBe(false);
        expect(isActivityId("AZ")).toBe(false);
        expect(isActivityId("A1Z")).toBe(false);
        expect(isActivityId("A1A1")).toBe(false);
    });
    it("rejects non-A prefixes, lowercase prefix, special chars", () => {
        expect(isActivityId("B0")).toBe(false);
        expect(isActivityId("a0")).toBe(false);
        expect(isActivityId("A-1")).toBe(false);
    });
});

describe("validator: valid project has no diagnostics from rules under test", () => {
    it("valid_full/foo passes all per-project rules", () => {
        const { project } = loadFixtureProject("validator", "valid_full/foo");
        const diags = validate(project);
        // Allow rule-4 informational; we explicitly want no errors from per-project rules.
        const errors = diags.filter((d) => d.severity === "error");
        expect(errors).toEqual([]);
    });
});

describe("validator: rule 7 — non-A0 rootless", () => {
    it("rule7_orphan: A11 with no A1 fires rule 7 on A11 only (cascade filter)", () => {
        const { project } = loadFixtureProject("validator", "rule7_orphan/foo");
        const rule7 = validate(project).filter(
            (d) => d.ruleId === "validator.rule-7"
        );
        expect(rule7.length).toBe(1);
        expect(rule7[0]!.message).toMatch(/A11/);
    });
});

describe("validator: rule 10 — filename ID matches header", () => {
    it("filename_mismatch fixture fires rule 10", () => {
        const { project } = loadFixtureProject(
            "validator",
            "filename_mismatch/foo"
        );
        const diags = validate(project);
        expect(diags.some((d) => d.ruleId === "validator.rule-10")).toBe(true);
    });
});

describe("validator: rule 11 — missing A0", () => {
    it("missing_a0 fixture fires rule 11", () => {
        const { project } = loadFixtureProject("validator", "missing_a0/foo");
        const diags = validate(project);
        expect(diags.some((d) => d.ruleId === "validator.rule-11")).toBe(true);
    });
});

describe("validator: rule 12 — context file presence and location", () => {
    it("missing_context fixture fires rule 12", () => {
        const { project } = loadFixtureProject(
            "validator",
            "missing_context/foo"
        );
        const diags = validate(project);
        expect(diags.some((d) => d.ruleId === "validator.rule-12")).toBe(true);
    });
    it("misplaced_context — A-0 in subdir fires rule 12", () => {
        const { project } = loadFixtureProject(
            "validator",
            "misplaced_context/foo"
        );
        const rule12 = validate(project).filter(
            (d) => d.ruleId === "validator.rule-12"
        );
        expect(
            rule12.some((d) =>
                /must live directly in the project root/.test(d.message)
            )
        ).toBe(true);
    });
    it("duplicate_context — second A-0 in root fires rule 12", () => {
        const { project } = loadFixtureProject(
            "validator",
            "duplicate_context/foo"
        );
        const rule12 = validate(project).filter(
            (d) => d.ruleId === "validator.rule-12"
        );
        expect(rule12.some((d) => /Duplicate A-0/.test(d.message))).toBe(true);
    });
});

describe("validator: rule 13/14 — project path structure", () => {
    it("invalid_path/Foo fires rule 13 (uppercase folder)", () => {
        const { project } = loadFixtureProject(
            "validator",
            "invalid_path/Foo/bar"
        );
        const diags = validate(project);
        expect(diags.some((d) => d.ruleId === "validator.rule-13")).toBe(true);
    });
    it("min_depth — A0 directly under src/idef0 fires rule 14", () => {
        const { project } = loadFixtureProject("validator", "");
        const diags = validate(project);
        expect(diags.some((d) => d.ruleId === "validator.rule-14")).toBe(true);
    });
});

describe("validator: rule 8 — case violations are warnings, structural are errors", () => {
    it("uppercase-suffix activity/arrow IDs produce rule-8 WARNINGS (not errors)", () => {
        const { project } = loadFixtureProject(
            "validator",
            "rule8_case_warning/foo"
        );
        const rule8 = validate(project).filter(
            (d) => d.ruleId === "validator.rule-8"
        );
        expect(rule8.length).toBeGreaterThan(0);
        // Every rule-8 diag must be a warning (no error severity).
        expect(rule8.every((d) => d.severity === "warning")).toBe(true);
        // Specific IDs must be flagged with canonical-form hint.
        const messages = rule8.map((d) => d.message).join("\n");
        expect(messages).toMatch(/IABC.*Iabc/);
        expect(messages).toMatch(/AABC.*Aabc/);
        expect(messages).toMatch(/XABC.*Xabc/);
    });
    it("canonical IDs in the same fixture do NOT produce rule-8 diagnostics", () => {
        const { project } = loadFixtureProject(
            "validator",
            "rule8_case_warning/foo"
        );
        const rule8Messages = validate(project)
            .filter((d) => d.ruleId === "validator.rule-8")
            .map((d) => d.message)
            .join("\n");
        // A1, I1, O1, X11 are canonical — should not appear in rule-8 messages
        // EXCEPT as "expected canonical form" hints. We assert that they don't
        // appear as the offending ID by checking the leading quoted-ID pattern.
        expect(rule8Messages).not.toMatch(/'A1'/);
        expect(rule8Messages).not.toMatch(/'I1'/);
        expect(rule8Messages).not.toMatch(/'O1'/);
        expect(rule8Messages).not.toMatch(/'X11'/);
    });
    it("case-only fixture produces zero rule-8 ERRORS (only warnings)", () => {
        const { project } = loadFixtureProject(
            "validator",
            "rule8_case_warning/foo"
        );
        const rule8Errors = validate(project).filter(
            (d) => d.ruleId === "validator.rule-8" && d.severity === "error"
        );
        expect(rule8Errors).toEqual([]);
    });
    it("structurally invalid id (A10, 0 in suffix) produces rule-8 ERROR", () => {
        const { project } = loadFixtureProject(
            "validator",
            "rule8_structural/foo"
        );
        const rule8 = validate(project).filter(
            (d) => d.ruleId === "validator.rule-8"
        );
        const errors = rule8.filter((d) => d.severity === "error");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some((d) => /A10/.test(d.message))).toBe(true);
    });
});

describe("validator: rule 17 — block count", () => {
    it("too_many_blocks fires rule 17 warning (12 > 9)", () => {
        const { project } = loadFixtureProject(
            "validator",
            "too_many_blocks/foo"
        );
        const rule17 = validate(project).filter(
            (d) => d.ruleId === "validator.rule-17"
        );
        expect(rule17.some((d) => d.severity === "warning")).toBe(true);
    });
});

describe("validator: rule 18 — section order in activity body", () => {
    it("rule18_section_order: boundary arrow after first functional block fires rule 18", () => {
        const { project } = loadFixtureProject(
            "validator",
            "rule18_section_order/foo"
        );
        const rule18 = validate(project).filter(
            (d) => d.ruleId === "validator.rule-18"
        );
        expect(rule18.length).toBeGreaterThan(0);
        expect(rule18[0]!.message).toMatch(/boundary|section/i);
    });
    it("valid_full project: no rule-18 diagnostics", () => {
        const { project } = loadFixtureProject("validator", "valid_full/foo");
        const rule18 = validate(project).filter(
            (d) => d.ruleId === "validator.rule-18"
        );
        expect(rule18).toEqual([]);
    });
});

describe("validator: rule 4 — interface consistency between parent and child", () => {
    it("rule4_missing_arrow fires rule 4 for C1 missing in child", () => {
        const { project } = loadFixtureProject(
            "validator",
            "rule4_missing_arrow/foo"
        );
        const rule4 = validate(project).filter(
            (d) => d.ruleId === "validator.rule-4"
        );
        expect(rule4.some((d) => /C-arrow 'C1'/.test(d.message))).toBe(true);
    });
    it("rule4_cardinality fires rule 4 for output cardinality mismatch", () => {
        const { project } = loadFixtureProject(
            "validator",
            "rule4_cardinality/foo"
        );
        const rule4 = validate(project).filter(
            (d) => d.ruleId === "validator.rule-4"
        );
        expect(
            rule4.some((d) => /produces 2 output arrow/.test(d.message))
        ).toBe(true);
    });
});

describe("diagnosticsForNestedProjects: rule 15 (semantic half)", () => {
    it("wraps each NestedProjectMarker as a rule-15 Diagnostic", () => {
        const diags = diagnosticsForNestedProjects([
            {
                outerProjectRoot: "/ws/src/idef0/outer",
                innerProjectRoot: "/ws/src/idef0/outer/sub",
                innerMarkerPath: "/ws/src/idef0/outer/sub/A0.idef0",
            },
        ]);
        expect(diags).toHaveLength(1);
        const d = diags[0]!;
        expect(d.severity).toBe("error");
        expect(d.source).toBe("validator");
        expect(d.ruleId).toBe("validator.rule-15");
        expect(d.file).toBe("/ws/src/idef0/outer/sub/A0.idef0");
        expect(d.message).toContain("/ws/src/idef0/outer/sub");
        expect(d.message).toContain("/ws/src/idef0/outer");
    });

    it("empty input → empty output", () => {
        expect(diagnosticsForNestedProjects([])).toEqual([]);
    });
});

describe("validateOrphans: rule 16", () => {
    it("emits rule-16 diagnostic per orphan path", () => {
        const diags = validateOrphans([
            "src/idef0/lone.idef0",
            "src/idef0/other.idef0",
        ]);
        expect(diags).toHaveLength(2);
        for (const d of diags) {
            expect(d.ruleId).toBe("validator.rule-16");
            expect(d.severity).toBe("error");
        }
    });
});
