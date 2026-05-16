// Pure mapping from `@idefy/core` Diagnostic to a plain data shape that the
// extension host then converts to `vscode.Diagnostic`. Keeping the transform
// vscode-free lets us unit-test the 1-based → 0-based range conversion and
// severity mapping without standing up a VS Code host.
//
// See packages/vscode/spec/UI.md §Diagnostics for the contract.

import type { Diagnostic, DiagnosticSeverity, RelatedInfo, SourceRange } from "@idefy/core";

export interface PlainPosition {
    readonly line: number;
    readonly character: number;
}

export interface PlainRange {
    readonly start: PlainPosition;
    readonly end: PlainPosition;
}

export interface PlainRelatedInfo {
    readonly uri: string;
    readonly range: PlainRange;
    readonly message: string;
}

export interface PlainDiagnostic {
    readonly uri: string;
    readonly range: PlainRange;
    readonly message: string;
    readonly severity: DiagnosticSeverity;
    readonly source: "IDEFy";
    readonly code?: string;
    readonly relatedInformation?: readonly PlainRelatedInfo[];
}

export function mapDiagnostic(diag: Diagnostic): PlainDiagnostic {
    const result: {
        uri: string;
        range: PlainRange;
        message: string;
        severity: DiagnosticSeverity;
        source: "IDEFy";
        code?: string;
        relatedInformation?: readonly PlainRelatedInfo[];
    } = {
        uri: diag.file,
        range: convertRange(diag.range),
        message: diag.message,
        severity: diag.severity,
        source: "IDEFy",
    };
    if (diag.ruleId !== undefined) {
        result.code = diag.ruleId;
    }
    if (diag.relatedInformation !== undefined) {
        result.relatedInformation = diag.relatedInformation.map(mapRelatedInfo);
    }
    return result;
}

export function convertRange(range: SourceRange): PlainRange {
    return {
        start: {
            line: Math.max(0, range.start.line - 1),
            character: Math.max(0, range.start.column - 1),
        },
        end: {
            line: Math.max(0, range.end.line - 1),
            character: Math.max(0, range.end.column - 1),
        },
    };
}

function mapRelatedInfo(info: RelatedInfo): PlainRelatedInfo {
    return {
        uri: info.file,
        range: convertRange(info.range),
        message: info.message,
    };
}

export function groupByUri(
    diags: readonly PlainDiagnostic[],
): ReadonlyMap<string, PlainDiagnostic[]> {
    const grouped = new Map<string, PlainDiagnostic[]>();
    for (const d of diags) {
        const bucket = grouped.get(d.uri);
        if (bucket === undefined) {
            grouped.set(d.uri, [d]);
        } else {
            bucket.push(d);
        }
    }
    return grouped;
}
