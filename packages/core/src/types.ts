// Все типы публичного контракта `@idefy/core` живут здесь.
// Источник истины — packages/core/spec/DATA_MODEL.md и COMPONENT.md.

// ─── Source locations ─────────────────────────────────────────────────────────

export interface SourcePosition {
    readonly line: number;
    readonly column: number;
}

export interface SourceRange {
    readonly start: SourcePosition;
    readonly end: SourcePosition;
}

export interface SourceLocation {
    readonly file: string;
    readonly range: SourceRange;
}

// ─── Identifiers ──────────────────────────────────────────────────────────────

export type ActivityId = string;
export type ContextId = "A-0";
export type FileId = ActivityId | ContextId;
export type ArrowId = string;
export type ArrowRole = "I" | "O" | "C" | "M" | "X" | "T";

// ─── String literals ──────────────────────────────────────────────────────────

export interface StringLiteral {
    readonly value: string;
    readonly location: SourceLocation;
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export interface Comment {
    readonly text: string;
    /**
     * Was there a blank line in the source immediately above this comment?
     * Per spec/02-formatting.md, the formatter preserves up to one blank line
     * around standalone (full-line) comments. Set by parser during sticky
     * classification; consumed by formatter when emitting the comment.
     */
    readonly leadingBlankLine?: boolean;
    readonly location: SourceLocation;
}

// ─── Boundary arrow (activity header) ─────────────────────────────────────────
//
// Per spec/01-dsl.md (inherit-ID model), boundary section can contain four
// variants. Discriminated union — pattern-match on `kind`. See DATA_MODEL.md.

export interface BoundaryArrowFlat {
    readonly kind: "flat";
    readonly role: "I" | "O" | "C" | "M";
    readonly id: ArrowId; // I1, O1, C1, M1
    readonly description: StringLiteral;
    readonly leadingBlankLine: boolean;
    readonly commentsAbove: readonly Comment[];
    readonly commentsBelow: readonly Comment[];
    readonly inlineComment?: Comment;
    readonly location: SourceLocation;
}

export interface BoundaryArrowSiblingXConsumed {
    readonly kind: "sibling-x-consumed";
    readonly role: "I" | "C" | "M";
    readonly sourceId: ArrowId; // X11 in I[X11], C[X11], M[X11]
    readonly description: StringLiteral;
    readonly leadingBlankLine: boolean;
    readonly commentsAbove: readonly Comment[];
    readonly commentsBelow: readonly Comment[];
    readonly inlineComment?: Comment;
    readonly location: SourceLocation;
}

export interface BoundaryArrowParentXOut {
    readonly kind: "parent-x-out";
    readonly sourceId: ArrowId; // X11 in O[X11]
    readonly description: StringLiteral;
    readonly leadingBlankLine: boolean;
    readonly commentsAbove: readonly Comment[];
    readonly commentsBelow: readonly Comment[];
    readonly inlineComment?: Comment;
    readonly location: SourceLocation;
}

export interface BoundaryArrowTunnel {
    readonly kind: "tunnel";
    readonly id: ArrowId; // T1 — flat, no role prefix
    readonly description: StringLiteral;
    readonly leadingBlankLine: boolean;
    readonly commentsAbove: readonly Comment[];
    readonly commentsBelow: readonly Comment[];
    readonly inlineComment?: Comment;
    readonly location: SourceLocation;
}

export type BoundaryArrow =
    | BoundaryArrowFlat
    | BoundaryArrowSiblingXConsumed
    | BoundaryArrowParentXOut
    | BoundaryArrowTunnel;

// ─── Tunnel declaration (context header) ──────────────────────────────────────

export interface TunnelDecl {
    readonly id: ArrowId;
    readonly description: StringLiteral;
    readonly leadingBlankLine: boolean;
    readonly commentsAbove: readonly Comment[];
    readonly commentsBelow: readonly Comment[];
    readonly inlineComment?: Comment;
    readonly location: SourceLocation;
}

// ─── Root reference in context file ───────────────────────────────────────────

export interface RootReference {
    readonly targetId: ActivityId;
    readonly leadingBlankLine: boolean;
    readonly commentsAbove: readonly Comment[];
    readonly commentsBelow: readonly Comment[];
    readonly inlineComment?: Comment;
    readonly location: SourceLocation;
}

// ─── Functional block arrow refs ──────────────────────────────────────────────

export interface ConsumedArrowParent {
    readonly kind: "parent";
    readonly role: ArrowRole; // I | C | M (роль идентифицируется по префиксу id)
    readonly id: ArrowId; // I1, C1, M1, ...
    readonly location: SourceLocation;
}

export interface ConsumedArrowSibling {
    readonly kind: "sibling";
    readonly role: ArrowRole; // I | C | M — роль, в которой блок потребляет стрелку
    readonly sourceId: ArrowId; // X11, T1, ...
    readonly location: SourceLocation;
}

export type ConsumedArrowRef = ConsumedArrowParent | ConsumedArrowSibling;

export interface ProducedArrowNew {
    readonly kind: "new";
    readonly id: ArrowId; // X11, X12, ...
    readonly description: StringLiteral;
    readonly location: SourceLocation;
}

export interface ProducedArrowBoundaryOut {
    readonly kind: "boundary-out";
    readonly id: ArrowId; // X11
    readonly mappedTo: ArrowId; // O1
    readonly label?: StringLiteral; // optional plug label, required at join (rule 21)
    readonly location: SourceLocation;
}

export interface ProducedArrowTunnelOut {
    readonly kind: "tunnel-out";
    readonly id: ArrowId; // X11
    readonly mappedTo: ArrowId; // T1
    readonly label?: StringLiteral; // optional plug label, required at join (rule 21)
    readonly location: SourceLocation;
}

export interface ProducedArrowParentXMapped {
    readonly kind: "parent-x-mapped";
    readonly id: ArrowId; // X11 — local at this level
    readonly mappedTo: ArrowId; // X22 — own-described X at parent level
    readonly label?: StringLiteral; // optional plug label, required at join (rule 21)
    readonly location: SourceLocation;
}

export type ProducedArrowRef =
    | ProducedArrowNew
    | ProducedArrowBoundaryOut
    | ProducedArrowTunnelOut
    | ProducedArrowParentXMapped;

// ─── Functional block ─────────────────────────────────────────────────────────

export interface FunctionalBlock {
    readonly id: ActivityId;
    readonly name: StringLiteral;
    readonly consumed: readonly ConsumedArrowRef[];
    readonly produced: readonly ProducedArrowRef[];
    readonly leadingBlankLine: boolean;
    readonly commentsAbove: readonly Comment[];
    readonly commentsBelow: readonly Comment[];
    readonly inlineComment?: Comment;
    readonly location: SourceLocation;
}

// ─── AST roots ────────────────────────────────────────────────────────────────

/**
 * Block-divider: a full-line comment with a trailing blank line that splits
 * a section (boundary or decomposition) into user-blocks. The formatter
 * sorts items globally within a section and chooses a partition across
 * user-blocks that minimises total redistribution distance.
 *
 * `afterIndex` is the 0-based input-order position in the flat array of the
 * section's anchors (`boundary` or `blocks`); the divider is logically
 * placed after the item at that index. `afterIndex = -1` means "before the
 * first anchor". `afterIndex = length-1` means "after the last anchor".
 */
export interface BlockDivider {
    readonly comment: Comment;
    readonly afterIndex: number;
}

export interface ActivityAST {
    readonly kind: "activity";
    readonly id: ActivityId;
    readonly name: StringLiteral;
    readonly boundary: readonly BoundaryArrow[];
    readonly blocks: readonly FunctionalBlock[];
    /** Dividers inside the boundary section, ordered by input position. */
    readonly boundaryDividers?: readonly BlockDivider[];
    /** Dividers inside the decomposition section. */
    readonly blocksDividers?: readonly BlockDivider[];
    /** Floating comments between sections / at body tail (preserved as-is). */
    readonly floatingComments: readonly Comment[];
    readonly location: SourceLocation;
    readonly filenameId?: FileId;
}

export interface ContextAST {
    readonly kind: "context";
    readonly id: ContextId;
    readonly name: StringLiteral;
    readonly tunnels: readonly TunnelDecl[];
    /** Dividers inside the tunnel list (same semantics as boundaryDividers). */
    readonly tunnelsDividers?: readonly BlockDivider[];
    readonly rootRef: RootReference | null;
    readonly floatingComments: readonly Comment[];
    readonly location: SourceLocation;
    readonly filenameId?: FileId;
}

export type FileAST = ActivityAST | ContextAST;

// ─── Diagnostics ──────────────────────────────────────────────────────────────

export type DiagnosticSeverity = "error" | "warning" | "info";
export type DiagnosticSource = "parser" | "assembler" | "validator";

export interface RelatedInfo {
    readonly file: string;
    readonly range: SourceRange;
    readonly message: string;
}

export interface Diagnostic {
    readonly severity: DiagnosticSeverity;
    readonly source: DiagnosticSource;
    readonly range: SourceRange;
    readonly file: string;
    readonly message: string;
    readonly ruleId?: string;
    readonly relatedInformation?: readonly RelatedInfo[];
}

// ─── Parser API ──────────────────────────────────────────────────────────────

export interface ParseOptions {
    readonly filePath?: string;
    readonly basename?: string;
}

export interface ParseResult {
    readonly ast: FileAST | null;
    readonly errors: readonly Diagnostic[];
}

export interface ParsedFile {
    readonly path: string;
    readonly ast: FileAST | null;
    readonly parseErrors: readonly Diagnostic[];
}

// ─── Project model ────────────────────────────────────────────────────────────

export interface ProjectFile {
    readonly path: string;
    readonly ast: FileAST | null;
    readonly parseErrors: readonly Diagnostic[];
}

export interface ActivityNode {
    readonly id: ActivityId;
    readonly file: ProjectFile;
    readonly parent: ActivityNode | null;
    readonly children: ReadonlyMap<ActivityId, ActivityNode>;
    readonly blockInParent: FunctionalBlock | null;
}

export interface ContextNode {
    readonly file: ProjectFile;
    readonly tunnels: ReadonlyMap<ArrowId, TunnelDecl>;
    readonly rootRef: RootReference | null;
}

export interface IdefProject {
    readonly name: string;
    readonly scanRoot: string;
    readonly projectRoot: string;
    readonly files: ReadonlyMap<string, ProjectFile>;
    readonly activities: ReadonlyMap<ActivityId, ActivityNode>;
    readonly context: ContextNode | null;
    readonly diagnostics: readonly Diagnostic[];
}

export interface AssembleResult {
    readonly project: IdefProject | null;
    readonly errors: readonly Diagnostic[];
}

// ─── Formatter API ───────────────────────────────────────────────────────────

export interface FormatOptions {
    readonly maxLineWidth: number;
}

// ─── Renderer API ────────────────────────────────────────────────────────────

export type RendererId = string;

export interface RenderResult {
    readonly sidecars: ReadonlyMap<string, string>;
    readonly diagnostics: readonly Diagnostic[];
}

export interface Renderer {
    readonly id: RendererId;
    render(project: IdefProject): RenderResult;
}

export interface RendererRegistry {
    register(renderer: Renderer): void;
    get(id: RendererId): Renderer | null;
    listAvailable(): readonly RendererId[];
}

// ─── Nested project markers (rule 15 surface) ────────────────────────────────
//
// Loader discovers nested A0.*.idef0 markers (one project's marker living
// inside another project's tree) and surfaces them as structural data without
// classifying them as Diagnostics. Core wraps the markers into rule-15
// diagnostics via `diagnosticsForNestedProjects(markers)`.
//
// The shape mirrors `@idefy/loader.NestedProjectMarker` so callers can pass
// the loader's output directly. This keeps the cross-package contract by
// structure rather than by import dependency.

export interface NestedProjectMarker {
    readonly outerProjectRoot: string;
    readonly innerProjectRoot: string;
    readonly innerMarkerPath: string;
}

// ─── Invariant violations ────────────────────────────────────────────────────

export class InvariantViolation extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvariantViolation";
    }
}
