import type {
    ActivityAST,
    ActivityId,
    ActivityNode,
    BoundaryArrow,
    Diagnostic,
    IdefProject,
    NestedProjectMarker,
    ProducedArrowRef,
    ProjectFile,
    SourceRange,
    StringLiteral,
} from "../types.js";
import {
    isActivityId,
    isValidArrowId,
    isWellFormedActivityId,
    isWellFormedArrowId,
    parentActivityId,
} from "../ids.js";

const ZERO_RANGE: SourceRange = {
    start: { line: 1, column: 1 },
    end: { line: 1, column: 1 },
};

export function validate(project: IdefProject): Diagnostic[] {
    const diags: Diagnostic[] = [];

    diags.push(...checkProjectStructure(project));
    diags.push(...checkPerFileRules(project));
    diags.push(...checkDuplicateIds(project));
    diags.push(...checkInterfaceConsistency(project));
    diags.push(...checkSectionOrder(project));
    diags.push(...checkDescriptionIdentity(project));
    diags.push(...checkTunnelInBoundary(project));
    diags.push(...checkPlugLabels(project));
    diags.push(...checkXONomenclature(project));

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
    //
    // Важно: проверяем RAW сегменты (то, что между `/` в path), а не имя
    // проекта после collapse-в-Java-нотацию через `.`. Иначе папка с
    // точкой в имени (`as.is`) после collapse расщепляется regex'ом на
    // два «валидных» сегмента и пропускается. Точка в имени папки на
    // пути до projectRoot — это error rule 13.
    const rawSegments = rawProjectSegments(project.scanRoot, project.projectRoot);
    if (rawSegments === null) {
        // projectRoot не лежит под scanRoot — этот случай уже покрывается
        // другими правилами; пропускаем без diagnostic, чтобы не дублировать.
    } else if (rawSegments.length === 0) {
        diags.push({
            severity: "error",
            source: "validator",
            ruleId: "validator.rule-14",
            range: ZERO_RANGE,
            file: project.projectRoot,
            message:
                "Project must be at least one folder deep under the scan root (A0.*.idef0 directly in src/idef0/ is not allowed)",
        });
    } else {
        const invalid = rawSegments.find(
            (s) => !VALID_PROJECT_SEGMENT_RE.test(s),
        );
        if (invalid !== undefined) {
            diags.push({
                severity: "error",
                source: "validator",
                ruleId: "validator.rule-13",
                range: ZERO_RANGE,
                file: project.projectRoot,
                message: `Invalid project path: folder segment '${invalid}' must match [a-z][a-z0-9_]* (no dots, dashes, or uppercase)`,
            });
        }
    }

    return diags;
}

// Returns the list of folder segments between scanRoot and projectRoot,
// **before** collapsing them to Java-package notation. Empty list = projectRoot
// equals scanRoot. `null` = projectRoot doesn't lie inside scanRoot.
function rawProjectSegments(
    scanRoot: string,
    projectRoot: string,
): readonly string[] | null {
    const root = scanRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const proj = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    if (proj === root) return [];
    if (!proj.startsWith(root + "/")) return null;
    return proj
        .substring(root.length + 1)
        .split("/")
        .filter((s) => s.length > 0);
}

const VALID_PROJECT_SEGMENT_RE = /^[a-z][a-z0-9_]*$/;

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

        // Rule 8: activity id format. Two grades per spec/04-validator.md §8:
        //   - structural violation (not well-formed) → error
        //   - case violation (well-formed but suffix has uppercase letters) → warning
        diags.push(...activityIdDiagnostics(ast.id, ast.location.range, file.path, false));

        // Rule 8 for block IDs.
        for (const b of ast.blocks) {
            diags.push(
                ...activityIdDiagnostics(b.id, b.location.range, file.path, true),
            );
        }

        // Rule 8 for arrow IDs — boundary header + produced/consumed refs.
        diags.push(...arrowIdDiagnosticsForActivity(ast, file.path));

        const n = ast.blocks.length;
        if (n > 35) {
            diags.push({
                severity: "error",
                source: "validator",
                ruleId: "validator.rule-17",
                range: ast.location.range,
                file: file.path,
                message: `Activity '${ast.id}' has ${n} functional blocks; allowed suffix alphabet (1..9, a..z) gives a hard limit of 35`,
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
            isWellFormedActivityId(ast.id) &&
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

// Boundary "slot" — a normalized representation of one boundary entry used
// for rule-4 set comparison. Two entries are equal iff their slot strings match.
// Examples: "flat:I:I1", "sx:C:X22", "px:X11", "tun:T1".
function boundarySlot(a: BoundaryArrow): string {
    switch (a.kind) {
        case "flat":
            return `flat:${a.role}:${a.id}`;
        case "sibling-x-consumed":
            return `sx:${a.role}:${a.sourceId}`;
        case "parent-x-out":
            return `px:${a.sourceId}`;
        case "tunnel":
            return `tun:${a.id}`;
    }
}

function boundarySlotDisplay(slot: string): string {
    const [kind, ...rest] = slot.split(":");
    switch (kind) {
        case "flat":
            return rest[1] ?? "";
        case "sx":
            return `${rest[0]}[${rest[1]}]`;
        case "px":
            return `O[${rest[0]}]`;
        case "tun":
            return rest[0] ?? "";
        default:
            return slot;
    }
}

function compareInterfaces(
    childAst: ActivityAST,
    node: ActivityNode
): Diagnostic[] {
    const diags: Diagnostic[] = [];
    if (!node.blockInParent) return diags;

    // Compute expected boundary slots from parent's block declaration. The
    // rule: child boundary = parent's consumed ∪ parent's produced (modulo
    // tunnels, which follow rule 20 separately).
    const expected = new Set<string>();
    for (const c of node.blockInParent.consumed) {
        if (c.kind === "parent") {
            // I1/C1/M1 → flat boundary entry
            if (c.role === "I" || c.role === "C" || c.role === "M") {
                expected.add(`flat:${c.role}:${c.id}`);
            }
        } else {
            // sibling: I[X22]/C[T1] etc. The role is the outer letter; the
            // inner is X-* (sibling-X) or T-* (tunnel). Sibling-X → bracket
            // boundary form. Tunnel → flat T boundary entry (per rule 20).
            const innerRole = c.sourceId.charAt(0);
            if (innerRole === "T") {
                expected.add(`tun:${c.sourceId}`);
            } else {
                // assume X (or any other → still bracket form)
                expected.add(`sx:${c.role}:${c.sourceId}`);
            }
        }
    }
    for (const p of node.blockInParent.produced) {
        switch (p.kind) {
            case "new":
                // X11 "..." at parent → O[X11] at child boundary
                expected.add(`px:${p.id}`);
                break;
            case "boundary-out":
                // X11[O1] → flat O1 at child boundary
                expected.add(`flat:O:${p.mappedTo}`);
                break;
            case "tunnel-out":
                // X11[T1] → flat T1 at child boundary
                expected.add(`tun:${p.mappedTo}`);
                break;
            case "parent-x-mapped":
                // X11[X22] → O[X22] at child boundary
                expected.add(`px:${p.mappedTo}`);
                break;
        }
    }

    const actual = new Set<string>();
    for (const a of childAst.boundary) {
        actual.add(boundarySlot(a));
    }

    for (const slot of expected) {
        if (!actual.has(slot)) {
            diags.push({
                severity: "error",
                source: "validator",
                ruleId: "validator.rule-4",
                range: childAst.location.range,
                file: node.file.path,
                message: `Activity '${node.id}': boundary is missing entry '${boundarySlotDisplay(slot)}' (declared by parent '${node.parent?.id ?? "?"}' in functional block declaration)`,
            });
        }
    }
    for (const slot of actual) {
        // Tunnels in the actual set that are NOT in expected may still be
        // legitimate per rule 20 (tunnel used inside this activity's own
        // decomposition). Rule 20 checks those separately. Skip tunnel
        // entries here to avoid false positives.
        if (slot.startsWith("tun:")) continue;
        if (!expected.has(slot)) {
            diags.push({
                severity: "error",
                source: "validator",
                ruleId: "validator.rule-4",
                range: childAst.location.range,
                file: node.file.path,
                message: `Activity '${node.id}': boundary declares entry '${boundarySlotDisplay(slot)}' but parent '${node.parent?.id ?? "?"}' does not reference it in its functional block`,
            });
        }
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
                    message: `Section order violation: boundary arrow '${boundaryDisplayForDiag(arr)}' appears after a functional block — boundary section must precede decomposition section`,
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

// ─── Rule 8 helpers ──────────────────────────────────────────────────────────

function activityIdDiagnostics(
    id: string,
    range: SourceRange,
    file: string,
    isFunctionalBlock: boolean,
): Diagnostic[] {
    const noun = isFunctionalBlock ? "functional block ID" : "activity ID";
    if (!isWellFormedActivityId(id)) {
        return [{
            severity: "error",
            source: "validator",
            ruleId: "validator.rule-8",
            range,
            file,
            message: `Invalid ${noun} format: '${id}' (expected A0 or A<suffix>; suffix must use 1..9, a..z and must not contain '0')`,
        }];
    }
    if (!isActivityId(id)) {
        return [{
            severity: "warning",
            source: "validator",
            ruleId: "validator.rule-8",
            range,
            file,
            message: `${capitalize(noun)} '${id}' uses uppercase letters in the suffix; canonical form is lowercase (e.g., '${id.charAt(0)}${id.slice(1).toLowerCase()}')`,
        }];
    }
    return [];
}

function boundaryDisplayForDiag(a: BoundaryArrow): string {
    switch (a.kind) {
        case "flat":
            return a.id;
        case "sibling-x-consumed":
            return `${a.role}[${a.sourceId}]`;
        case "parent-x-out":
            return `O[${a.sourceId}]`;
        case "tunnel":
            return a.id;
    }
}

function arrowIdDiagnosticsForActivity(
    ast: ActivityAST,
    file: string,
): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const b of ast.boundary) {
        const ids: string[] = [];
        switch (b.kind) {
            case "flat":
                ids.push(b.id);
                break;
            case "sibling-x-consumed":
            case "parent-x-out":
                ids.push(b.sourceId);
                break;
            case "tunnel":
                ids.push(b.id);
                break;
        }
        for (const id of ids) {
            diags.push(...arrowIdDiagnostics(id, b.location.range, file, "boundary arrow"));
        }
    }
    for (const block of ast.blocks) {
        for (const c of block.consumed) {
            const id = c.kind === "parent" ? c.id : c.sourceId;
            diags.push(...arrowIdDiagnostics(id, c.location.range, file, "consumed arrow"));
        }
        for (const p of block.produced) {
            diags.push(...arrowIdDiagnostics(p.id, p.location.range, file, "produced arrow"));
            if (
                p.kind === "boundary-out" ||
                p.kind === "tunnel-out" ||
                p.kind === "parent-x-mapped"
            ) {
                diags.push(...arrowIdDiagnostics(p.mappedTo, p.location.range, file, "boundary mapping"));
            }
        }
    }
    return diags;
}

function arrowIdDiagnostics(
    id: string,
    range: SourceRange,
    file: string,
    role: string,
): Diagnostic[] {
    if (!isWellFormedArrowId(id)) {
        // Structurally-invalid arrow IDs are already flagged by parser-side
        // diagnostics with precise context; rule-8 only emits a warning-grade
        // diagnostic for the case-violation tier.
        return [];
    }
    if (!isValidArrowId(id)) {
        return [{
            severity: "warning",
            source: "validator",
            ruleId: "validator.rule-8",
            range,
            file,
            message: `${capitalize(role)} '${id}' uses uppercase letters in the suffix; canonical form is lowercase (e.g., '${id.charAt(0)}${id.slice(1).toLowerCase()}')`,
        }];
    }
    return [];
}

function capitalize(s: string): string {
    return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Rule 19: description-identity ───────────────────────────────────────────

function findOwnerDescription(
    arr: BoundaryArrow,
    node: ActivityNode,
    project: IdefProject
): StringLiteral | null {
    switch (arr.kind) {
        case "flat": {
            // O-flat in child boundary: при join плаг этого ребёнка к O несёт
            // label — это и есть owner. Иначе — socket description (ancestor's
            // flat O). I/C/M — всегда socket description предка (нет plug-side).
            if (arr.role === "O" && node.blockInParent) {
                const plug = node.blockInParent.produced.find(
                    (p) => p.kind === "boundary-out" && p.mappedTo === arr.id,
                );
                if (plug && plug.kind === "boundary-out" && plug.label) {
                    return plug.label;
                }
            }
            // Walk up parent chain; owner = ancestor with same flat boundary entry.
            let ancestor = node.parent;
            while (ancestor !== null) {
                const aast = ancestor.file.ast;
                if (aast && aast.kind === "activity") {
                    for (const a of aast.boundary) {
                        if (
                            a.kind === "flat" &&
                            a.id === arr.id &&
                            a.role === arr.role
                        ) {
                            return a.description;
                        }
                    }
                }
                ancestor = ancestor.parent;
            }
            return null;
        }
        case "sibling-x-consumed":
        case "parent-x-out": {
            // O[X*] in child boundary: при join плаг этого ребёнка к X несёт
            // label — это и есть owner. Иначе — own-described X у предка.
            if (arr.kind === "parent-x-out" && node.blockInParent) {
                const plug = node.blockInParent.produced.find(
                    (p) =>
                        p.kind === "parent-x-mapped" &&
                        p.mappedTo === arr.sourceId,
                );
                if (plug && plug.kind === "parent-x-mapped" && plug.label) {
                    return plug.label;
                }
            }
            // Owner: ancestor's block where `<sourceId> "..."` is own-described.
            let ancestor = node.parent;
            while (ancestor !== null) {
                const aast = ancestor.file.ast;
                if (aast && aast.kind === "activity") {
                    for (const block of aast.blocks) {
                        for (const p of block.produced) {
                            if (p.kind === "new" && p.id === arr.sourceId) {
                                return p.description;
                            }
                        }
                    }
                }
                ancestor = ancestor.parent;
            }
            return null;
        }
        case "tunnel": {
            // T in child boundary: при join плаг этого ребёнка к T несёт label
            // — это и есть owner. Иначе — declaration в A-0.
            if (node.blockInParent) {
                const plug = node.blockInParent.produced.find(
                    (p) => p.kind === "tunnel-out" && p.mappedTo === arr.id,
                );
                if (plug && plug.kind === "tunnel-out" && plug.label) {
                    return plug.label;
                }
            }
            if (project.context) {
                const decl = project.context.tunnels.get(arr.id);
                if (decl) return decl.description;
            }
            return null;
        }
    }
}

function checkDescriptionIdentity(project: IdefProject): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const node of project.activities.values()) {
        const ast = node.file.ast;
        if (!ast || ast.kind !== "activity") continue;

        for (const arr of ast.boundary) {
            // A0's own flat entries ARE the owner — nothing to verify against.
            if (node.id === "A0" && arr.kind === "flat") continue;
            const ownerDesc = findOwnerDescription(arr, node, project);
            if (ownerDesc === null) continue; // no owner found — other rules handle structural fault
            if (arr.description.value !== ownerDesc.value) {
                diags.push({
                    severity: "error",
                    source: "validator",
                    ruleId: "validator.rule-19",
                    range: arr.description.location.range,
                    file: node.file.path,
                    message: `Description '${arr.description.value}' for boundary entry '${boundaryDisplayForDiag(arr)}' does not match owner-level description '${ownerDesc.value}'`,
                });
            }
        }

        // Activity header name vs parent block declaration name.
        if (node.blockInParent) {
            if (ast.name.value !== node.blockInParent.name.value) {
                diags.push({
                    severity: "error",
                    source: "validator",
                    ruleId: "validator.rule-19",
                    range: ast.name.location.range,
                    file: node.file.path,
                    message: `Activity header name '${ast.name.value}' does not match parent block declaration name '${node.blockInParent.name.value}'`,
                });
            }
        }
    }
    return diags;
}

// ─── Rule 20: tunnel-in-boundary ─────────────────────────────────────────────

function collectTunnelsUsedInside(
    node: ActivityNode,
    recursive: boolean,
): Set<string> {
    const used = new Set<string>();
    const visit = (n: ActivityNode): void => {
        const ast = n.file.ast;
        if (ast && ast.kind === "activity") {
            for (const block of ast.blocks) {
                for (const c of block.consumed) {
                    if (c.kind === "sibling" && c.sourceId.startsWith("T")) {
                        used.add(c.sourceId);
                    }
                }
                for (const p of block.produced) {
                    if (p.kind === "tunnel-out") used.add(p.mappedTo);
                }
            }
        }
        if (recursive) {
            for (const child of n.children.values()) visit(child);
        }
    };
    const root = node.file.ast;
    if (root && root.kind === "activity") {
        for (const block of root.blocks) {
            for (const c of block.consumed) {
                if (c.kind === "sibling" && c.sourceId.startsWith("T")) {
                    used.add(c.sourceId);
                }
            }
            for (const p of block.produced) {
                if (p.kind === "tunnel-out") used.add(p.mappedTo);
            }
        }
    }
    if (recursive) {
        for (const child of node.children.values()) visit(child);
    }
    return used;
}

function checkTunnelInBoundary(project: IdefProject): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const node of project.activities.values()) {
        const ast = node.file.ast;
        if (!ast || ast.kind !== "activity") continue;

        const usedHereOrBelow = collectTunnelsUsedInside(node, true);
        const declared = new Set<string>();
        for (const arr of ast.boundary) {
            if (arr.kind === "tunnel") declared.add(arr.id);
        }

        for (const tid of usedHereOrBelow) {
            if (!declared.has(tid)) {
                diags.push({
                    severity: "error",
                    source: "validator",
                    ruleId: "validator.rule-20",
                    range: ast.location.range,
                    file: node.file.path,
                    message: `Tunnel '${tid}' is used inside activity '${node.id}' (here or deeper) but not declared in its boundary — add '${tid} "<description>"' to boundary`,
                });
            }
        }
        for (const tid of declared) {
            if (!usedHereOrBelow.has(tid)) {
                diags.push({
                    severity: "warning",
                    source: "validator",
                    ruleId: "validator.rule-20",
                    range: ast.location.range,
                    file: node.file.path,
                    message: `Tunnel '${tid}' declared in boundary of '${node.id}' but never used inside its decomposition`,
                });
            }
        }
    }
    return diags;
}

// ─── Rule 21: plug labels at join ────────────────────────────────────────────

type BracketProduced = Extract<
    ProducedArrowRef,
    { kind: "boundary-out" | "tunnel-out" | "parent-x-mapped" }
>;

function isBracketProduced(p: ProducedArrowRef): p is BracketProduced {
    return (
        p.kind === "boundary-out" ||
        p.kind === "tunnel-out" ||
        p.kind === "parent-x-mapped"
    );
}

function socketKindLabel(kind: BracketProduced["kind"]): string {
    switch (kind) {
        case "boundary-out":
            return "O";
        case "tunnel-out":
            return "T";
        case "parent-x-mapped":
            return "X";
    }
}

function checkPlugLabels(project: IdefProject): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const node of project.activities.values()) {
        const ast = node.file.ast;
        if (!ast || ast.kind !== "activity") continue;

        // Group plugs in this activity's decomposition by the socket they target.
        // Key = `${kind}:${mappedTo}` — e.g., "boundary-out:O1" or "tunnel-out:T2".
        const groups = new Map<string, BracketProduced[]>();
        for (const block of ast.blocks) {
            for (const p of block.produced) {
                if (!isBracketProduced(p)) continue;
                const key = `${p.kind}:${p.mappedTo}`;
                let list = groups.get(key);
                if (!list) {
                    list = [];
                    groups.set(key, list);
                }
                list.push(p);
            }
        }

        for (const list of groups.values()) {
            if (list.length === 1) {
                // Single plug — label forbidden.
                const plug = list[0]!;
                if (plug.label !== undefined) {
                    const socketDisplay = `${socketKindLabel(plug.kind)}-сокет '${plug.mappedTo}'`;
                    diags.push({
                        severity: "error",
                        source: "validator",
                        ruleId: "validator.rule-21",
                        range: plug.label.location.range,
                        file: node.file.path,
                        message: `Plug '${plug.id}[${plug.mappedTo}]' is the only plug at ${socketDisplay} in activity '${node.id}'; label is forbidden when there is no join (description is inherited from the socket)`,
                    });
                }
                continue;
            }
            // Join: each plug must have a unique label.
            const seenLabels = new Map<string, BracketProduced>();
            for (const plug of list) {
                if (plug.label === undefined) {
                    const socketDisplay = `${socketKindLabel(plug.kind)}-сокет '${plug.mappedTo}'`;
                    diags.push({
                        severity: "error",
                        source: "validator",
                        ruleId: "validator.rule-21",
                        range: plug.location.range,
                        file: node.file.path,
                        message: `Plug '${plug.id}[${plug.mappedTo}]' must have a label — there are ${list.length} plugs at ${socketDisplay} in activity '${node.id}' (join)`,
                    });
                    continue;
                }
                const lbl = plug.label.value;
                const prev = seenLabels.get(lbl);
                if (prev) {
                    diags.push({
                        severity: "error",
                        source: "validator",
                        ruleId: "validator.rule-21",
                        range: plug.label.location.range,
                        file: node.file.path,
                        message: `Plug label '${lbl}' is duplicated at ${socketKindLabel(plug.kind)}-сокет '${plug.mappedTo}' (also used by plug '${prev.id}[${prev.mappedTo}]'); labels at a join must be unique`,
                    });
                } else {
                    seenLabels.set(lbl, plug);
                }
            }
        }
    }
    return diags;
}

// ─── Rule 22: X↔O nomenclature ───────────────────────────────────────────────

function indexToSuffixChar(idx: number): string | null {
    // 1..9 → "1".."9"; 10..35 → "a".."z"
    if (idx >= 1 && idx <= 9) return String(idx);
    if (idx >= 10 && idx <= 35) {
        return String.fromCharCode("a".charCodeAt(0) + (idx - 10));
    }
    return null;
}

function expectedPlugId(blockId: string, outputIdx: number): string | null {
    if (!blockId.startsWith("A") || blockId.length < 2) return null;
    const idSuffix = blockId.slice(1);
    const idxChar = indexToSuffixChar(outputIdx);
    if (idxChar === null) return null;
    return `X${idSuffix}${idxChar}`;
}

function checkXONomenclature(project: IdefProject): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const node of project.activities.values()) {
        const ast = node.file.ast;
        if (!ast || ast.kind !== "activity") continue;
        for (const block of ast.blocks) {
            if (!isWellFormedActivityId(block.id) || block.id === "A0") continue;
            for (let i = 0; i < block.produced.length; i += 1) {
                const p = block.produced[i]!;
                const expected = expectedPlugId(block.id, i + 1);
                if (expected === null) continue;
                if (p.id !== expected) {
                    diags.push({
                        severity: "error",
                        source: "validator",
                        ruleId: "validator.rule-22",
                        range: p.location.range,
                        file: node.file.path,
                        message: `Plug id '${p.id}' does not follow X↔O nomenclature for block '${block.id}' produced[${i + 1}] — expected '${expected}'`,
                    });
                }
            }
        }
    }
    return diags;
}
