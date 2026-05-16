import type {
    ActivityAST,
    ActivityId,
    BoundaryArrow,
    Comment,
    ConsumedArrowRef,
    ContextAST,
    FileAST,
    FormatOptions,
    FunctionalBlock,
    ProducedArrowRef,
    TunnelDecl,
} from "../types.js";
import { InvariantViolation } from "../types.js";
import { compareActivityIds, compareArrowKeys } from "../ids.js";

const INDENT = "    "; // 4 spaces — one indent step
// Per spec/02-formatting.md, boundary group order is I → C → M → O → T.
const BOUNDARY_ROLE_ORDER: ReadonlyArray<"I" | "C" | "M" | "O"> = [
    "I",
    "C",
    "M",
    "O",
];

// Sort key for boundary arrow within its role group. Used to put flat IDs
// before bracket-form IDs (digits before '[' per spec/02-formatting.md
// "Сортировка стрелок внутри групп").
function boundarySortKey(a: BoundaryArrow): string {
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

function boundaryGroup(a: BoundaryArrow): "I" | "C" | "M" | "O" | "T" {
    switch (a.kind) {
        case "flat":
            return a.role;
        case "sibling-x-consumed":
            return a.role;
        case "parent-x-out":
            return "O";
        case "tunnel":
            return "T";
    }
}

function renderBoundaryArrow(a: BoundaryArrow): string {
    const head = boundarySortKey(a);
    return `${head} ${quoteString(a.description.value)}`;
}

type BlockMode = "mode1" | "mode2" | "mode3";

interface PreRendered {
    readonly block: FunctionalBlock;
    readonly prefix: string;
    readonly consumedByRole: {
        readonly I: string;
        readonly C: string;
        readonly M: string;
    };
    readonly produced: string;
    readonly ownDescribedCount: number;
}

interface Widths {
    readonly maxPrefix: number;
    readonly maxI: number;
    readonly maxC: number;
    readonly maxM: number;
}

export function format(ast: FileAST, options: FormatOptions): string {
    return ast.kind === "activity"
        ? formatActivity(ast, options)
        : formatContext(ast, options);
}

// ─── Activity formatting ─────────────────────────────────────────────────────

function formatActivity(ast: ActivityAST, options: FormatOptions): string {
    const lines: string[] = [];

    appendPreHeaderComments(lines, ast);
    lines.push(`activity ${ast.id} ${quoteString(ast.name.value)} {`);

    // Boundary arrows: sorted by group (I → C → M → O → T) then by sort key
    // within group (flat before bracket).
    const boundary = sortBoundary(ast.boundary);
    for (const b of boundary) {
        lines.push(`${INDENT}${renderBoundaryArrow(b)}`);
    }

    if (boundary.length > 0 && ast.blocks.length > 0) {
        lines.push("");
    }

    const sortedBlocks = [...ast.blocks].sort((a, b) =>
        compareActivityIds(a.id, b.id)
    );
    if (sortedBlocks.length === 0) {
        lines.push(`}`);
        return lines.join("\n") + "\n";
    }

    const pre = sortedBlocks.map(preRenderBlock);
    const modes = classifyBlockModes(pre, options.maxLineWidth);
    const mode1 = pre.filter((p) => modes.get(p.block.id) === "mode1");
    const widths = computeWidths(mode1);

    let prevMode: BlockMode | null = null;
    for (const p of pre) {
        const mode = modes.get(p.block.id);
        if (!mode) {
            throw new InvariantViolation(
                `formatter: no mode classified for block '${p.block.id}'`
            );
        }
        if (prevMode !== null) {
            const needBlank = mode !== "mode1" || prevMode !== "mode1";
            if (needBlank) lines.push("");
        }
        appendComments(lines, p.block.commentsAbove);
        if (mode === "mode1") {
            lines.push(renderMode1(p, widths));
        } else if (mode === "mode2") {
            lines.push(...renderMode2(p, options.maxLineWidth));
        } else {
            lines.push(...renderMode3(p, options.maxLineWidth));
        }
        appendComments(lines, p.block.commentsBelow);
        prevMode = mode;
    }

    lines.push("}");
    return lines.join("\n") + "\n";
}

function appendComments(
    lines: string[],
    comments: readonly Comment[]
): void {
    for (const c of comments) {
        lines.push(`${INDENT}# ${c.text}`);
    }
}

function appendPreHeaderComments(
    lines: string[],
    ast: ActivityAST | ContextAST
): void {
    const preHeader = ast.floatingComments.filter(
        (c) => c.location.range.start.line < ast.location.range.start.line
    );
    for (const c of preHeader) {
        lines.push(`# ${c.text}`);
    }
    if (preHeader.length > 0) {
        lines.push("");
    }
}

// ─── Context formatting ─────────────────────────────────────────────────────

function formatContext(ast: ContextAST, options: FormatOptions): string {
    void options;
    const lines: string[] = [];
    appendPreHeaderComments(lines, ast);
    lines.push(`context A-0 ${quoteString(ast.name.value)} {`);

    const sortedTunnels = [...ast.tunnels].sort((a, b) =>
        compareArrowKeys(a.id, b.id)
    );
    for (const t of sortedTunnels) {
        appendComments(lines, t.commentsAbove);
        lines.push(
            `${INDENT}${t.id} ${quoteString(t.description.value)}`
        );
        appendComments(lines, t.commentsBelow);
    }

    if (ast.rootRef) {
        if (sortedTunnels.length > 0) lines.push("");
        appendComments(lines, ast.rootRef.commentsAbove);
        lines.push(`${INDENT}...${ast.rootRef.targetId}`);
        appendComments(lines, ast.rootRef.commentsBelow);
    }

    lines.push("}");
    return lines.join("\n") + "\n";
}

// ─── Boundary sorting ────────────────────────────────────────────────────────

function sortBoundary(
    arrows: readonly BoundaryArrow[]
): readonly BoundaryArrow[] {
    const grouped: Record<"I" | "C" | "M" | "O" | "T", BoundaryArrow[]> = {
        I: [],
        C: [],
        M: [],
        O: [],
        T: [],
    };
    for (const a of arrows) {
        grouped[boundaryGroup(a)].push(a);
    }
    for (const r of [...BOUNDARY_ROLE_ORDER, "T"] as const) {
        grouped[r].sort((x, y) =>
            compareArrowKeys(boundarySortKey(x), boundarySortKey(y))
        );
    }
    return [
        ...grouped.I,
        ...grouped.C,
        ...grouped.M,
        ...grouped.O,
        ...grouped.T,
    ];
}

// ─── Pre-rendering blocks ────────────────────────────────────────────────────

function preRenderBlock(block: FunctionalBlock): PreRendered {
    const prefix = `${block.id} ${quoteString(block.name.value)}`;
    const I = renderConsumedGroup(block.consumed, "I");
    const C = renderConsumedGroup(block.consumed, "C");
    const M = renderConsumedGroup(block.consumed, "M");
    const sortedProduced = [...block.produced].sort((a, b) =>
        compareArrowKeys(a.id, b.id)
    );
    const produced = sortedProduced.map(renderProducedRef).join(", ");
    // Mode 3 trigger: > 1 produced item carries its own text literal — that is,
    // own-described `X11 "..."` OR any bracket-form with a plug label `X11[O1] "..."`
    // (per spec/02-formatting.md «Produced-формы с label»).
    const ownDescribedCount = block.produced.filter(
        (p) => p.kind === "new" || p.label !== undefined
    ).length;
    return {
        block,
        prefix,
        consumedByRole: { I, C, M },
        produced,
        ownDescribedCount,
    };
}

function renderConsumedGroup(
    consumed: readonly ConsumedArrowRef[],
    role: "I" | "C" | "M"
): string {
    const items = consumed.filter((c) => c.role === role);
    items.sort((a, b) => compareArrowKeys(consumedKey(a), consumedKey(b)));
    return items.map(renderConsumedRef).join(", ");
}

function consumedKey(c: ConsumedArrowRef): string {
    return c.kind === "parent" ? c.id : `${c.role}[${c.sourceId}]`;
}

function renderConsumedRef(c: ConsumedArrowRef): string {
    return c.kind === "parent" ? c.id : `${c.role}[${c.sourceId}]`;
}

function renderProducedRef(p: ProducedArrowRef): string {
    if (p.kind === "new") return `${p.id} ${quoteString(p.description.value)}`;
    const head = `${p.id}[${p.mappedTo}]`;
    return p.label !== undefined
        ? `${head} ${quoteString(p.label.value)}`
        : head;
}

// ─── Mode classification ─────────────────────────────────────────────────────

function classifyBlockModes(
    pre: readonly PreRendered[],
    maxLineWidth: number
): Map<ActivityId, BlockMode> {
    const modes = new Map<ActivityId, BlockMode>();
    for (const p of pre) {
        modes.set(p.block.id, p.ownDescribedCount > 1 ? "mode3" : "mode1");
    }
    let changed = true;
    while (changed) {
        changed = false;
        const mode1 = pre.filter((p) => modes.get(p.block.id) === "mode1");
        if (mode1.length === 0) break;
        const widths = computeWidths(mode1);
        for (const p of mode1) {
            const line = renderMode1(p, widths);
            if (line.length > maxLineWidth) {
                modes.set(p.block.id, "mode2");
                changed = true;
            }
        }
    }
    return modes;
}

function computeWidths(mode1: readonly PreRendered[]): Widths {
    let maxPrefix = 0;
    let maxI = 0;
    let maxC = 0;
    let maxM = 0;
    for (const p of mode1) {
        if (p.prefix.length > maxPrefix) maxPrefix = p.prefix.length;
        if (p.consumedByRole.I.length > maxI) maxI = p.consumedByRole.I.length;
        if (p.consumedByRole.C.length > maxC) maxC = p.consumedByRole.C.length;
        if (p.consumedByRole.M.length > maxM) maxM = p.consumedByRole.M.length;
    }
    return { maxPrefix, maxI, maxC, maxM };
}

// ─── Mode 1 rendering ────────────────────────────────────────────────────────

function renderMode1(p: PreRendered, widths: Widths): string {
    // Pad prefix to maxPrefix + 4 (one indent step of breathing room, matches spec example).
    const prefixPadded = p.prefix.padEnd(widths.maxPrefix + 4, " ");
    const consumedCols = renderConsumedColumns(p.consumedByRole, widths);
    return `${INDENT}${prefixPadded}: ${consumedCols} -> ${p.produced}`;
}

function renderConsumedColumns(
    by: { I: string; C: string; M: string },
    widths: Widths
): string {
    // Render only columns that some Mode 1 block actually uses (max > 0). The
    // *last* active column gets no trailing comma — otherwise the formatter
    // would emit "I1, -> ..." which parser rejects.
    const cols: { text: string; max: number }[] = [];
    if (widths.maxI > 0) cols.push({ text: by.I, max: widths.maxI });
    if (widths.maxC > 0) cols.push({ text: by.C, max: widths.maxC });
    if (widths.maxM > 0) cols.push({ text: by.M, max: widths.maxM });
    if (cols.length === 0) return "";
    let out = "";
    for (let i = 0; i < cols.length; i += 1) {
        const c = cols[i]!;
        const isLast = i === cols.length - 1;
        out += isLast
            ? renderColumnLast(c.text, c.max)
            : renderColumn(c.text, c.max);
    }
    return out;
}

function renderColumn(text: string, maxWidth: number): string {
    const totalWidth = maxWidth + 2; // "<text>, "
    if (text.length === 0) {
        return " ".repeat(totalWidth);
    }
    return (text + ",").padEnd(totalWidth, " ");
}

function renderColumnLast(text: string, maxWidth: number): string {
    if (text.length === 0) {
        return " ".repeat(maxWidth);
    }
    return text.padEnd(maxWidth, " ");
}

// ─── Mode 2 rendering ────────────────────────────────────────────────────────

function renderMode2(p: PreRendered, maxLineWidth: number): string[] {
    const lines: string[] = [];
    const indent2 = INDENT + INDENT;
    const indent3 = INDENT + INDENT + INDENT;

    lines.push(`${INDENT}${p.prefix}`);
    pushConsumedMode23(lines, p, indent2, indent3, maxLineWidth);
    lines.push(`${indent2}-> ${p.produced}`);
    return lines;
}

// ─── Mode 3 rendering ────────────────────────────────────────────────────────

function renderMode3(p: PreRendered, maxLineWidth: number): string[] {
    const lines: string[] = [];
    const indent2 = INDENT + INDENT;
    const indent3 = INDENT + INDENT + INDENT;

    lines.push(`${INDENT}${p.prefix}`);
    pushConsumedMode23(lines, p, indent2, indent3, maxLineWidth);
    lines.push(`${indent2}->`);

    const sortedProduced = [...p.block.produced].sort((a, b) =>
        compareArrowKeys(a.id, b.id)
    );
    for (let i = 0; i < sortedProduced.length; i += 1) {
        const ref = sortedProduced[i]!;
        const last = i === sortedProduced.length - 1;
        lines.push(`${indent3}${renderProducedRef(ref)}${last ? "" : ","}`);
    }
    return lines;
}

// ─── Mode 2/3 shared: consumed line(s), with sub-mode Б ────────────────────

function pushConsumedMode23(
    lines: string[],
    p: PreRendered,
    indent2: string,
    indent3: string,
    maxLineWidth: number
): void {
    const groups: string[] = [];
    if (p.consumedByRole.I) groups.push(p.consumedByRole.I);
    if (p.consumedByRole.C) groups.push(p.consumedByRole.C);
    if (p.consumedByRole.M) groups.push(p.consumedByRole.M);
    const singleLine = `${indent2}: ${groups.join(", ")}`;
    if (singleLine.length <= maxLineWidth || groups.length === 0) {
        lines.push(singleLine);
        return;
    }
    // Sub-mode Б — colon on its own line, then each group on its own line.
    // Triggered solely by line length, including the single-group case (spec
    // 02-formatting.md says no further split is attempted INSIDE a too-long
    // group — that's YAGNI — but the group still goes on its own line).
    lines.push(`${indent2}:`);
    for (let i = 0; i < groups.length; i += 1) {
        const suffix = i < groups.length - 1 ? "," : "";
        lines.push(`${indent3}${groups[i]}${suffix}`);
    }
}

// ─── String quoting ──────────────────────────────────────────────────────────

function quoteString(s: string): string {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ─── Helpers re-export for tests (none) ──────────────────────────────────────

export type { TunnelDecl };
