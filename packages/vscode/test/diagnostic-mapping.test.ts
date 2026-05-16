import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@idefy/core";
import {
    convertRange,
    groupByUri,
    mapDiagnostic,
} from "../src/diagnostics/mapping.js";

const diag: Diagnostic = {
    severity: "error",
    source: "validator",
    file: "/ws/src/idef0/proj/A0.idef0",
    range: {
        start: { line: 5, column: 3 },
        end: { line: 5, column: 12 },
    },
    message: "Boundary arrow X1 not declared.",
    ruleId: "validator.rule-10",
};

describe("convertRange", () => {
    it("converts 1-based core range to 0-based plain range", () => {
        const r = convertRange(diag.range);
        expect(r).toEqual({
            start: { line: 4, character: 2 },
            end: { line: 4, character: 11 },
        });
    });

    it("clamps to 0 instead of producing negatives", () => {
        const r = convertRange({
            start: { line: 0, column: 0 },
            end: { line: 0, column: 0 },
        });
        expect(r).toEqual({
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        });
    });
});

describe("mapDiagnostic", () => {
    it("maps a full diagnostic with ruleId and source IDEFy", () => {
        const out = mapDiagnostic(diag);
        expect(out.uri).toBe(diag.file);
        expect(out.message).toBe(diag.message);
        expect(out.severity).toBe("error");
        expect(out.code).toBe("validator.rule-10");
        expect(out.source).toBe("IDEFy");
        expect(out.range.start).toEqual({ line: 4, character: 2 });
    });

    it("omits code when ruleId is absent", () => {
        const noRule = { ...diag, ruleId: undefined };
        const out = mapDiagnostic(noRule);
        expect(out.code).toBeUndefined();
    });

    it("maps relatedInformation when present", () => {
        const withRelated: Diagnostic = {
            ...diag,
            relatedInformation: [
                {
                    file: "/ws/src/idef0/proj/A-0.idef0",
                    range: {
                        start: { line: 2, column: 5 },
                        end: { line: 2, column: 10 },
                    },
                    message: "Declared here.",
                },
            ],
        };
        const out = mapDiagnostic(withRelated);
        expect(out.relatedInformation).toEqual([
            {
                uri: "/ws/src/idef0/proj/A-0.idef0",
                range: {
                    start: { line: 1, character: 4 },
                    end: { line: 1, character: 9 },
                },
                message: "Declared here.",
            },
        ]);
    });
});

describe("groupByUri", () => {
    it("groups diagnostics by URI preserving order within buckets", () => {
        const d1 = mapDiagnostic(diag);
        const d2 = mapDiagnostic({ ...diag, message: "Second" });
        const d3 = mapDiagnostic({ ...diag, file: "/other", message: "Third" });
        const grouped = groupByUri([d1, d2, d3]);
        expect(grouped.size).toBe(2);
        expect(grouped.get(diag.file)?.map((d) => d.message)).toEqual([
            "Boundary arrow X1 not declared.",
            "Second",
        ]);
        expect(grouped.get("/other")?.map((d) => d.message)).toEqual(["Third"]);
    });

    it("returns empty map for empty input", () => {
        expect(groupByUri([]).size).toBe(0);
    });
});
