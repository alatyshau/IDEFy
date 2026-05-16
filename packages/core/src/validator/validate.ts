import type {
    ActivityAST,
    ActivityId,
    ActivityNode,
    Diagnostic,
    IdefProject,
    NestedProjectMarker,
    ProjectFile,
    SourceRange,
} from "../types.js";
import { computeProjectName } from "../assembler/assemble.js";
import { isActivityId, parentActivityId } from "../ids.js";

const ZERO_RANGE: SourceRange = {
    start: { line: 1, column: 1 },
    end: { line: 1, column: 1 },
};

const VALID_PROJECT_NAME_RE =
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;

export function validate(project: IdefProject): Diagnostic[] {
    const diags: Diagnostic[] = [];

    diags.push(...checkProjectStructure(project));
    diags.push(...checkPerFileRules(project));
    diags.push(...checkDuplicateIds(project));
    diags.push(...checkInterfaceConsistency(project));
    diags.push(...checkSectionOrder(project));

    return diags;
}

export function validateOrphans(
    orphanFilePaths: readonly string[]
): Diagnostic[] {
    return orphanFilePaths.map((path) => ({
        severity: "error" as const,
        source: "validator" as const,
        ruleId: "validator.rule-16",
        range: ZERO_RANGE,
        file: path,
        message:
            "`.idef0` file under `src/idef0/` but outside any project root",
    }));
}

// Rule 15 — semantic half. Structural half lives in @idefy/loader, which
// emits NestedProjectMarker[] from FS discovery. This function wraps each
// marker into a Diagnostic — keeps loader free of diagnostic semantics and
// core free of FS dependency.
export function diagnosticsForNestedProjects(
    markers: readonly NestedProjectMarker[]
): Diagnostic[] {
    return markers.map((m) => ({
        severity: "error" as const,
        source: "validator" as const,
        ruleId: "validator.rule-15",
        range: ZERO_RANGE,
        file: m.innerMarkerPath,
        message: `Nested project: A0.*.idef0 at '${m.innerProjectRoot}' lies inside project rooted at '${m.outerProjectRoot}'`,
    }));
}

// ─── Rule 11, 12, 13, 14 ──────────────────────────────────────────────────────

function checkProjectStructure(project: IdefProject): Diagnostic[] {
    const diags: Diagnostic[] = [];

    // Rule 11: Project marker A0 must exist.
    if (!project.activities.has("A0")) {
        diags.push({
            severity: "error",
            source: "validator",
            ruleId: "validator.rule-11",
            range: ZERO_RANGE,
            file: project.projectRoot,
            message: `Project '${project.name}' is missing required A0.*.idef0 root activity file`,
        });
    }

    // Rule 12: Context file (A-0) must exist directly in project root.
    // Per spec/04-validator.md: missing — error, A-0 in non-root location — error,
    // multiple A-0 files — error. Iterate all files because assembler keeps only
    // the first as project.context and reports the rest as raw assembler errors.
    const contextFiles = [...project.files.values()].filter(
        (f) => f.ast?.kind === "context"
    );
    if (contextFiles.length === 0) {
        diags.push({
            severity: "error",
            source: "validator",
            ruleId: "validator.rule-12",
            range: ZERO_RANGE,
            file: project.projectRoot,
            message: `Project '${project.name}' is missing required A-0.*.idef0 context file`,
        });
    } else {
        let rootContextSeen = false;
        for (const cf of contextFiles) {
            const inRoot = isFileDirectlyInRoot(
                project.projectRoot,
                cf.path
            );
            if (!inRoot) {
                diags.push({
                    severity: "error",
                    source: "validator",
                    ruleId: "validator.rule-12",
                    range: cf.ast?.location.range ?? ZERO_RANGE,
                    file: cf.path,
                    message:
                        "Context file A-0.*.idef0 must live directly in the project root, not in a subdirectory",
                });
            } else if (rootContextSeen) {
                diags.push({
                    severity: "error",
                    source: "validator",
                    ruleId: "validator.rule-12",
                    range: cf.ast?.location.range ?? ZERO_RANGE,
                    file: cf.path,
                    message: `Duplicate A-0.*.idef0 context file in project root of '${project.name}'`,
                });
            } else {
                rootContextSeen = true;
            }
        }
    }

    // Rule 13: Project path components must be valid Java-style identifiers.
    // Rule 14: At least one folder deep under scan root.
    const recomputed = computeProjectName(project.scanRoot, project.projectRoot);
    if (recomputed === "") {
        diags.push({
            severity: "error",
            source: "validator",
            ruleId: "validator.rule-14",
            range: ZERO_RANGE,
            file: project.projectRoot,
            message:
                "Project must be at least one folder deep under the scan root (A0.*.idef0 directly in src/idef0/ is not allowed)",
        });
    } else if (!VALID_PROJECT_NAME_RE.test(recomputed)) {
        diags.push({
            severity: "error",
            source: "validator",
            ruleId: "validator.rule-13",
            range: ZERO_RANGE,
            file: project.projectRoot,
            message: `Invalid project path: components must match [a-z][a-z0-9_]* (got project name '${recomputed}')`,
        });
    }

    return diags;
}

// ─── Rules 7, 8, 10, 17 ──────────────────────────────────────────────────────

function checkPerFileRules(project: IdefProject): Diagnostic[] {
    const diags: Diagnostic[] = [];

    for (const file of project.files.values()) {
        const ast = file.ast;
        if (!ast) continue;

        // Rule 10: filename id matches header id.
        if (ast.filenameId !== undefined && ast.filenameId !== ast.id) {
            diags.push({
                severity: "error",
                source: "validator",
                ruleId: "validator.rule-10",
                range: ast.location.range,
                file: file.path,
                message: `Filename ID '${ast.filenameId}' does not match header ID '${ast.id}'`,
            });
        }

        if (ast.kind === "context") continue;

        // Rule 8: activity id format.
        if (!isActivityId(ast.id)) {
            diags.push({
                severity: "error",
                source: "validator",
                ruleId: "validator.rule-8",
                range: ast.location.range,
                file: file.path,
                message: `Invalid activity ID format: '${ast.id}'`,
            });
        }

        // Rule 8 for block IDs and Rule 17 for block count.
        for (const b of ast.blocks) {
            if (!isActivityId(b.id)) {
                diags.push({
                    severity: "error",
                    source: "validator",
                    ruleId: "validator.rule-8",
                    range: b.location.range,
                    file: file.path,
                    message: `Invalid functional block ID format: '${b.id}'`,
                });
            }
        }

        const n = ast.blocks.length;
        if (n > 35) {
            diags.push({
                severity: "error",
                source: "validator",
                ruleId: "validator.rule-17",
                range: ast.location.range,
                file: file.path,
                message: `Activity '${ast.id}' has ${n} functional blocks; allowed suffix alphabet (1..9, A..Z) gives a hard limit of 35`,
            });
        } else if (n >= 10) {
            diags.push({
                severity: "warning",
                source: "validator",
                ruleId: "validator.rule-17",
                range: ast.location.range,
                file: file.path,
                message: `Activity '${ast.id}' has ${n} functional blocks; IDEF0 recommends at most 9 per decomposition`,
            });
        }

        // Rule 7: root must be A0. Fire for every activity that has a valid id,
        // is not A0, but whose derived parent id is NOT in the project — i.e.,
        // this activity is rootless because of broken hierarchy at *its* level
        // rather than because of a missing intermediate ancestor. The
        // parentActivityId filter prevents cascade-noise: if A1 is missing but
        // A11 is present, rule 7 fires on A1 only — A11 fails because A1 is
        // missing (not because A11 is rootless), and that's not a rule-7 issue.
        if (
            ast.id !== "A0" &&
            isActivityId(ast.id) &&
            !project.activities.get(ast.id)?.parent &&
            project.activities.has("A0")
        ) {
            const derivedParent = parentActivityId(ast.id);
            if (derivedParent === null || !project.activities.has(derivedParent)) {
                diags.push({
                    severity: "error",
                    source: "validator",
                    ruleId: "validator.rule-7",
                    range: ast.location.range,
                    file: file.path,
                    message: `Activity '${ast.id}' has no parent in the project; only 'A0' may be rootless`,
                });
            }
        }
    }
    return diags;
}

// ─── Rule 9 ──────────────────────────────────────────────────────────────────

function checkDuplicateIds(project: IdefProject): Diagnostic[] {
    const diags: Diagnostic[] = [];
    const seen = new Map<ActivityId, ProjectFile>();
    for (const file of project.files.values()) {
        const ast = file.ast;
        if (!ast || ast.kind !== "activity") continue;
        const prev = seen.get(ast.id);
        if (prev) {
            diags.push({
                severity: "error",
                source: "validator",
                ruleId: "validator.rule-9",
                range: ast.location.range,
                file: file.path,
                message: `Duplicate activity ID '${ast.id}': also defined in '${prev.path}'`,
            });
        } else {
            seen.set(ast.id, file);
        }
    }
    return diags;
}

// ─── Rule 4: interface consistency ───────────────────────────────────────────

function checkInterfaceConsistency(project: IdefProject): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const node of project.activities.values()) {
        if (!node.parent) continue;
        const childAst = node.file.ast;
        if (!childAst || childAst.kind !== "activity") continue;

        if (!node.blockInParent) {
            diags.push({
                severity: "error",
                source: "validator",
                ruleId: "validator.rule-4",
                range: childAst.location.range,
                file: node.file.path,
                message: `Activity '${node.id}' has a decomposition file but is not declared as a functional block in parent '${node.parent.id}'`,
            });
            continue;
        }
        diags.push(...compareInterfaces(childAst, node));
    }
    return diags;
}

type ICOM = "I" | "O" | "C" | "M";

function compareInterfaces(
    childAst: ActivityAST,
    node: ActivityNode
): Diagnostic[] {
    const diags: Diagnostic[] = [];
    if (!node.blockInParent) return diags;
    const childByRole: Record<ICOM, Set<string>> = {
        I: new Set(),
        O: new Set(),
        C: new Set(),
        M: new Set(),
    };
    for (const arr of childAst.boundary) {
        const r = arr.id.charAt(0);
        if (r === "I" || r === "O" || r === "C" || r === "M") {
            childByRole[r].add(arr.id);
        }
    }
    const parentExpected: Record<ICOM, Set<string>> = {
        I: new Set(),
        O: new Set(),
        C: new Set(),
        M: new Set(),
    };
    for (const c of node.blockInParent.consumed) {
        if (c.kind === "parent") {
            const r = c.role;
            if (r === "I" || r === "C" || r === "M") {
                parentExpected[r].add(c.id);
            }
        }
    }
    for (const p of node.blockInParent.produced) {
        if (p.kind === "boundary-out") {
            parentExpected.O.add(p.mappedTo);
        }
    }
    for (const role of ["I", "O", "C", "M"] as const) {
        const expected = parentExpected[role];
        const actual = childByRole[role];
        for (const id of expected) {
            if (!actual.has(id)) {
                diags.push({
                    severity: "error",
                    source: "validator",
                    ruleId: "validator.rule-4",
                    range: childAst.location.range,
                    file: node.file.path,
                    message: `Activity '${node.id}': boundary is missing ${role}-arrow '${id}' (used by parent '${node.parent?.id ?? "?"}' in functional block declaration)`,
                });
            }
        }
        for (const id of actual) {
            if (!expected.has(id)) {
                diags.push({
                    severity: "error",
                    source: "validator",
                    ruleId: "validator.rule-4",
                    range: childAst.location.range,
                    file: node.file.path,
                    message: `Activity '${node.id}': boundary declares ${role}-arrow '${id}' but parent '${node.parent?.id ?? "?"}' does not reference it in its functional block`,
                });
            }
        }
    }

    // Cardinality check (per spec/04-validator.md rule 4): each own-described
    // produced arrow at the parent (`X "..."`) must correspond to an output at
    // the child boundary. We can't match individual ids (parent X-ids live in
    // parent's namespace, not child's), but we can ensure cardinalities are
    // compatible — the child must have AT LEAST as many O-arrows as the parent
    // has own-described X outputs + boundary-out X[O] mappings. The boundary-out
    // mappings were already accounted for; remaining O slack must absorb the
    // own-described X count. Description match is `[TODO]` for post-MVP.
    const ownDescribedCount = node.blockInParent.produced.filter(
        (p) => p.kind === "new"
    ).length;
    const childOCount = childByRole.O.size;
    const parentBoundaryOutCount = parentExpected.O.size;
    if (childOCount < parentBoundaryOutCount + ownDescribedCount) {
        diags.push({
            severity: "error",
            source: "validator",
            ruleId: "validator.rule-4",
            range: childAst.location.range,
            file: node.file.path,
            message: `Activity '${node.id}': parent '${node.parent?.id ?? "?"}' produces ${
                parentBoundaryOutCount + ownDescribedCount
            } output arrow(s) (${parentBoundaryOutCount} bound to parent O + ${ownDescribedCount} new X "..."), but child boundary declares only ${childOCount} O-arrow(s)`,
        });
    }
    return diags;
}

// ─── Rule 18: section order in activity body ─────────────────────────────────

function checkSectionOrder(project: IdefProject): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const file of project.files.values()) {
        const ast = file.ast;
        if (!ast || ast.kind !== "activity") continue;
        if (ast.boundary.length === 0 || ast.blocks.length === 0) continue;
        // Find the first functional block line. Any boundary arrow that
        // appears at or after that line is a section-order violation.
        let firstBlockLine = Number.POSITIVE_INFINITY;
        for (const b of ast.blocks) {
            const l = b.location.range.start.line;
            if (l < firstBlockLine) firstBlockLine = l;
        }
        for (const arr of ast.boundary) {
            const l = arr.location.range.start.line;
            if (l > firstBlockLine) {
                diags.push({
                    severity: "error",
                    source: "validator",
                    ruleId: "validator.rule-18",
                    range: arr.location.range,
                    file: file.path,
                    message: `Section order violation: boundary arrow '${arr.id}' appears after a functional block — boundary section must precede decomposition section`,
                });
            }
        }
    }
    return diags;
}

// ─── Path helpers ────────────────────────────────────────────────────────────

function isFileDirectlyInRoot(projectRoot: string, filePath: string): boolean {
    const root = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const path = filePath.replace(/\\/g, "/");
    if (!path.startsWith(root + "/")) return false;
    const rel = path.substring(root.length + 1);
    return !rel.includes("/");
}
