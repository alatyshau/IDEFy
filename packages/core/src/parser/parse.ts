import type {
    ActivityAST,
    ActivityId,
    ArrowId,
    BlockDivider,
    BoundaryArrow,
    Comment,
    ConsumedArrowRef,
    ContextAST,
    Diagnostic,
    FileAST,
    FileId,
    FunctionalBlock,
    ParseOptions,
    ParseResult,
    ProducedArrowRef,
    RootReference,
    SourceLocation,
    SourcePosition,
    StringLiteral,
    TunnelDecl,
} from "../types.js";
import {
    extractFileId,
    isWellFormedActivityId,
    isWellFormedArrowId,
    isWellFormedArrowIdInRoles,
    roleOf,
} from "../ids.js";
import type { ArrowRole } from "../types.js";
import { CharStream } from "./char-stream.js";

const BOUNDARY_ROLES: ReadonlySet<ArrowRole> = new Set(["I", "O", "C", "M"]);
const TUNNEL_ROLES: ReadonlySet<ArrowRole> = new Set(["T"]);
// In inherit-ID model, activity boundary may also include tunnel entries
// (flat T*, per spec/01-dsl.md tunnel-in-boundary rule).
const ACTIVITY_BOUNDARY_TUNNEL_ROLES: ReadonlySet<ArrowRole> = new Set(["T"]);
// Boundary bracket-form outer roles (I[X*]/C[X*]/M[X*] consumed, O[X*] produced).
const BOUNDARY_BRACKET_CONSUMED_ROLES: ReadonlySet<ArrowRole> = new Set([
    "I",
    "C",
    "M",
]);
const BOUNDARY_BRACKET_PRODUCED_ROLES: ReadonlySet<ArrowRole> = new Set(["O"]);
// Inner of boundary bracket forms is always X (own-described X at ancestor).
const BOUNDARY_BRACKET_INNER_ROLES: ReadonlySet<ArrowRole> = new Set(["X"]);
const CONSUMED_PARENT_ROLES: ReadonlySet<ArrowRole> = new Set(["I", "C", "M"]);
const CONSUMED_SIBLING_OUTER_ROLES: ReadonlySet<ArrowRole> = new Set([
    "I",
    "C",
    "M",
]);
const CONSUMED_SIBLING_INNER_ROLES: ReadonlySet<ArrowRole> = new Set(["X", "T"]);
const PRODUCED_NEW_ROLES: ReadonlySet<ArrowRole> = new Set(["X"]);
const PRODUCED_OUTER_ROLES: ReadonlySet<ArrowRole> = new Set(["X"]);
const PRODUCED_BRACKET_ROLES: ReadonlySet<ArrowRole> = new Set(["O", "T", "X"]);

// Source-text reconstruction of a BoundaryArrow id for diagnostic messages.
// (BoundaryArrow is a discriminated union — different variants carry different
// id fields, see types.ts.)
// Distributive Omit (defined again here so the helper is available before
// the rawItem types below — TypeScript hoists type aliases but the reader
// shouldn't need to scroll for the definition).
type DistOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

type BoundaryArrowForDisplay = DistOmit<
    BoundaryArrow,
    "leadingBlankLine" | "commentsAbove" | "commentsBelow"
>;

function boundaryArrowDisplay(arrow: BoundaryArrowForDisplay): string {
    switch (arrow.kind) {
        case "flat":
            return arrow.id;
        case "sibling-x-consumed":
            return `${arrow.role}[${arrow.sourceId}]`;
        case "parent-x-out":
            return `O[${arrow.sourceId}]`;
        case "tunnel":
            return arrow.id;
    }
}

type ContainerKind = "activity" | "context";

// Sentinel item types collected during body parsing.
interface RawComment {
    readonly kind: "comment";
    readonly comment: Comment;
    readonly startLine: number;
    readonly endLine: number;
}
type BoundaryArrowRaw = BoundaryArrowForDisplay;

interface RawBoundary {
    readonly kind: "boundary";
    readonly arrow: BoundaryArrowRaw;
    readonly startLine: number;
    readonly endLine: number;
}
interface RawBlock {
    readonly kind: "block";
    readonly block: Omit<
        FunctionalBlock,
        "leadingBlankLine" | "commentsAbove" | "commentsBelow"
    >;
    readonly startLine: number;
    readonly endLine: number;
}
interface RawTunnel {
    readonly kind: "tunnel";
    readonly tunnel: Omit<
        TunnelDecl,
        "leadingBlankLine" | "commentsAbove" | "commentsBelow"
    >;
    readonly startLine: number;
    readonly endLine: number;
}
interface RawRootRef {
    readonly kind: "rootRef";
    readonly rootRef: Omit<
        RootReference,
        "leadingBlankLine" | "commentsAbove" | "commentsBelow"
    >;
    readonly startLine: number;
    readonly endLine: number;
}

type RawItem = RawComment | RawBoundary | RawBlock | RawTunnel | RawRootRef;

// Start-of-declaration detection. A new declaration begins when the first
// non-whitespace character of a line matches a container-specific literal.
// See spec/01-dsl.md, section «Границы деклараций».
function isAtStartOfDecl(stream: CharStream, container: ContainerKind): boolean {
    const c = stream.peek();
    if (c === null) return false;
    if (container === "activity") {
        // I/O/C/M/T (boundary) and A (functional decomposition) are
        // start-literals. T at start in activity body marks a tunnel echo in
        // boundary (inherit-ID model, see spec/01-dsl.md). X never appears at
        // top-level.
        //
        // Suffix alphabet is `[1-9a-z]` per spec/01-dsl.md; the heuristic also
        // accepts `0` (for the `A0` root form, when it appears) and uppercase
        // letters so that misspellings like `AA` still get recognised as
        // declaration starts — the validator then emits rule-8 with a precise
        // location instead of letting the line collapse into a continuation.
        if (
            c === "I" ||
            c === "O" ||
            c === "C" ||
            c === "M" ||
            c === "T" ||
            c === "A"
        ) {
            const c2 = stream.peekAhead(1);
            return c2 !== null && /[A-Za-z0-9-]/.test(c2);
        }
        return false;
    }
    // context body: T* tunnel or `...A<id>` rootref.
    if (c === "T") {
        const c2 = stream.peekAhead(1);
        return c2 !== null && /[A-Za-z0-9]/.test(c2);
    }
    if (c === ".") {
        return stream.peekAhead(1) === ".";
    }
    return false;
}

// A declaration is "ended" at the start of the next declaration line, at a
// comment line, at `}`, or at EOF.
function isAtEndOfDecl(stream: CharStream, container: ContainerKind): boolean {
    const c = stream.peek();
    if (c === null) return true;
    if (c === "}") return true;
    if (c === "#") return true;
    return isAtStartOfDecl(stream, container);
}

export function parse(text: string, options: ParseOptions = {}): ParseResult {
    const filePath = options.filePath ?? "";
    const stream = new CharStream(text, filePath);
    const errors: Diagnostic[] = [];
    const filenameId: FileId | undefined = options.basename
        ? (extractFileId(options.basename) as FileId)
        : undefined;

    const preHeaderFloating: Comment[] = [];
    consumeWhitespaceAndComments(stream, preHeaderFloating);

    if (stream.isAtEnd()) {
        return { ast: null, errors };
    }

    const headerStart = stream.position;
    const keyword = readWord(stream);
    if (keyword === null) {
        addError(
            errors,
            stream.locationOfCurrent(),
            "Expected 'activity' or 'context' at top level"
        );
        return { ast: null, errors };
    }
    if (keyword.value !== "activity" && keyword.value !== "context") {
        addError(
            errors,
            keyword.location,
            `Expected 'activity' or 'context' at top level, found '${keyword.value}'`
        );
        return { ast: null, errors };
    }

    const ast =
        keyword.value === "activity"
            ? parseActivity(stream, headerStart, preHeaderFloating, filenameId, errors)
            : parseContext(stream, headerStart, preHeaderFloating, filenameId, errors);
    return { ast, errors };
}

function validateArrowAt(
    id: string,
    allowedRoles: ReadonlySet<ArrowRole>,
    location: SourceLocation,
    errors: Diagnostic[],
    positionLabel: string
): void {
    if (!isWellFormedArrowIdInRoles(id, allowedRoles)) {
        const isStructural = !isWellFormedArrowId(id);
        const reason = isStructural
            ? "id must match <role-letter><suffix using 1..9, a..z>"
            : `role '${id.charAt(0)}' is not allowed here`;
        const rolesStr = [...allowedRoles].join("/");
        // Per spec/04-validator.md rule 8: structurally invalid arrow IDs are
        // an error-grade violation and are owned by rule 8. Even though the
        // diagnostic is emitted from parser-time, it carries the rule-8
        // attribution so consumers can group/filter consistently with the
        // case-violation warnings that the validator emits.
        addError(
            errors,
            location,
            `${positionLabel}: arrow id '${id}' invalid (${reason}; expected ${rolesStr}*)`,
            isStructural ? "validator.rule-8" : undefined,
        );
    }
}

// ─── Top-level: activity ─────────────────────────────────────────────────────

function parseActivity(
    stream: CharStream,
    headerStart: SourcePosition,
    preHeaderFloating: Comment[],
    filenameId: FileId | undefined,
    errors: Diagnostic[]
): ActivityAST | null {
    // Per spec/01-dsl.md «Continuation lines (строки, не начинающиеся со
    // start-литерала) — продолжение предыдущей декларации». Этот же принцип
    // применим к шапке: между ключевым словом, id, name-литералом и `{`
    // переносы строк допустимы наравне с пробелами/табами.
    consumeWhitespaceMultilineForDecl(stream);
    const idTok = readWord(stream);
    if (idTok === null) {
        addError(
            errors,
            stream.locationOfCurrent(),
            "Expected activity ID after 'activity'"
        );
        return null;
    }
    consumeWhitespaceMultilineForDecl(stream);
    const nameLit = parseStringLiteralRequired(stream, errors);
    if (nameLit === null) return null;

    consumeWhitespaceAndComments(stream, preHeaderFloating);
    if (!consumeChar(stream, "{")) {
        addError(
            errors,
            stream.locationOfCurrent(),
            "Expected '{' to open activity body"
        );
        return null;
    }

    const items = parseBody(stream, errors, "activity");
    const closingPos = consumeClosingBrace(stream, errors);

    // Stop analysing the file past the closing `}`: spec 01-dsl.md.
    // We don't consume further content.

    const floating: Comment[] = [...preHeaderFloating];
    const {
        blocks,
        boundary,
        boundaryDividers,
        blocksDividers,
        floatingFromBody,
    } = classifyActivityItems(items, errors);
    floating.push(...floatingFromBody);

    const location: SourceLocation = {
        file: stream.filePath,
        range: { start: headerStart, end: closingPos },
    };
    return {
        kind: "activity",
        id: idTok.value,
        name: nameLit,
        boundary,
        blocks,
        ...(boundaryDividers.length > 0 ? { boundaryDividers } : {}),
        ...(blocksDividers.length > 0 ? { blocksDividers } : {}),
        floatingComments: floating,
        location,
        ...(filenameId !== undefined ? { filenameId } : {}),
    };
}

// ─── Top-level: context ──────────────────────────────────────────────────────

function parseContext(
    stream: CharStream,
    headerStart: SourcePosition,
    preHeaderFloating: Comment[],
    filenameId: FileId | undefined,
    errors: Diagnostic[]
): ContextAST | null {
    // Multi-line header (см. parseActivity для обоснования).
    consumeWhitespaceMultilineForDecl(stream);
    const idTok = readWord(stream);
    if (idTok === null) {
        addError(
            errors,
            stream.locationOfCurrent(),
            "Expected context ID after 'context'"
        );
        return null;
    }
    if (idTok.value !== "A-0") {
        addError(
            errors,
            idTok.location,
            `Context ID must be 'A-0', found '${idTok.value}'`
        );
    }
    consumeWhitespaceMultilineForDecl(stream);
    const nameLit = parseStringLiteralRequired(stream, errors);
    if (nameLit === null) return null;

    consumeWhitespaceAndComments(stream, preHeaderFloating);
    if (!consumeChar(stream, "{")) {
        addError(
            errors,
            stream.locationOfCurrent(),
            "Expected '{' to open context body"
        );
        return null;
    }

    const items = parseBody(stream, errors, "context");
    const closingPos = consumeClosingBrace(stream, errors);

    const floating: Comment[] = [...preHeaderFloating];
    const {
        tunnels,
        tunnelsDividers,
        rootRef,
        floatingFromBody,
    } = classifyContextItems(items, errors);
    floating.push(...floatingFromBody);

    const location: SourceLocation = {
        file: stream.filePath,
        range: { start: headerStart, end: closingPos },
    };
    return {
        kind: "context",
        id: "A-0",
        name: nameLit,
        tunnels,
        ...(tunnelsDividers.length > 0 ? { tunnelsDividers } : {}),
        rootRef,
        floatingComments: floating,
        location,
        ...(filenameId !== undefined ? { filenameId } : {}),
    };
}

// ─── Body: shared between activity & context ─────────────────────────────────

function parseBody(
    stream: CharStream,
    errors: Diagnostic[],
    containerKind: ContainerKind
): RawItem[] {
    const items: RawItem[] = [];
    while (!stream.isAtEnd()) {
        consumeInlineWhitespace(stream);
        const c = stream.peek();
        if (c === null) break;
        if (c === "}") break;
        if (c === "\n" || c === "\r") {
            stream.next();
            continue;
        }
        if (c === "#") {
            const item = parseCommentItem(stream);
            items.push(item);
            continue;
        }
        if (c === ".") {
            const item = parseRootRefItem(stream, errors, containerKind);
            if (item) items.push(item);
            else syncToEol(stream);
            continue;
        }
        // Try to parse declaration starting with an identifier.
        const declItem = parseDeclarationItem(stream, errors, containerKind);
        if (declItem) items.push(declItem);
        else syncToEol(stream);
    }
    return items;
}

function consumeClosingBrace(
    stream: CharStream,
    errors: Diagnostic[]
): SourcePosition {
    consumeInlineWhitespace(stream);
    if (stream.peek() === "}") {
        stream.next();
        return stream.position;
    }
    addError(
        errors,
        stream.locationOfCurrent(),
        "Expected '}' to close body"
    );
    return stream.position;
}

// ─── Declaration parsers ─────────────────────────────────────────────────────

function parseDeclarationItem(
    stream: CharStream,
    errors: Diagnostic[],
    container: ContainerKind
): RawItem | null {
    const startLine = stream.position.line;
    const idTok = readWord(stream);
    if (!idTok) {
        addError(
            errors,
            stream.locationOfCurrent(),
            "Expected declaration starting with an identifier"
        );
        return null;
    }

    // Check for boundary bracket-form: <outer-role>[<sourceId>] "description"
    // (valid in activity boundary section per spec/01-dsl.md inherit-ID model:
    // I[X*]/C[X*]/M[X*] for sibling-X-consumed, O[X*] for parent-X-out).
    //
    // Per spec/01-dsl.md continuation rule, multi-line whitespace is allowed
    // between the id, the optional `[...]` group, and the description literal —
    // anything that isn't a start-of-decl token may follow.
    let bracketInner: { value: string; location: SourceLocation } | null = null;
    consumeWhitespaceMultilineForDecl(stream);
    if (stream.peek() === "[") {
        stream.next();
        const inner = readWord(stream);
        if (!inner) {
            addError(
                errors,
                stream.locationOfCurrent(),
                "Expected arrow id inside '[...]'"
            );
            return null;
        }
        if (!consumeChar(stream, "]")) {
            addError(
                errors,
                stream.locationOfCurrent(),
                "Expected ']' after arrow id"
            );
            return null;
        }
        bracketInner = inner;
        consumeWhitespaceMultilineForDecl(stream);
    }

    const nameLit = parseStringLiteralRequired(stream, errors);
    if (!nameLit) return null;

    // Фиксируем endLine ИМЕННО на месте закрытия литерала. Дальше нам нужно
    // подсмотреть `:` (functional block) через multi-line whitespace, и эта
    // consumeWhitespaceMultilineForDecl сдвигает stream.position.line вперёд
    // вплоть до следующего start-литерала. Если бы мы брали endLine из
    // stream.position после lookahead, declarations типа `T2 "..."` начали бы
    // «занимать» строки до следующей декларации, что ломает splitGroups (gap
    // между группами становится 0, комментарии прилипают не к тем блокам).
    const literalEndLine = nameLit.location.range.end.line;

    // After name, look at the next non-whitespace character. ONLY `:` makes this
    // a functional block declaration (which has consumed/produced lists). Anything
    // else — including any token, start-of-decl of the next line, `}`, `#`, EOF —
    // closes this declaration as a boundary arrow or tunnel decl. The parseBody
    // loop will then handle whatever follows.
    consumeWhitespaceMultilineForDecl(stream);
    if (stream.peek() === ":") {
        stream.next();
        if (bracketInner !== null) {
            addError(
                errors,
                idTok.location,
                "Functional block id cannot use bracket form '<role>[<id>]'"
            );
            return null;
        }
        if (!isWellFormedActivityId(idTok.value)) {
            addError(
                errors,
                idTok.location,
                `Functional block id '${idTok.value}' is not a structurally valid activity id (expected A0 or A<suffix>; suffix must not contain '0' or non-alphanumerics)`
            );
        }
        return parseFunctionalBlockRest(
            stream,
            idTok,
            nameLit,
            startLine,
            errors,
            container
        );
    }
    const endLine = literalEndLine;

    // Bracket-form boundary entry.
    if (bracketInner !== null) {
        if (container !== "activity") {
            addError(
                errors,
                idTok.location,
                "Bracket-form arrow is not allowed in context body"
            );
            return null;
        }
        // Outer letter must be a single role I/C/M (sibling-X-consumed) or O
        // (parent-X-out). Inner must be X*.
        let outerRole: ArrowRole;
        try {
            outerRole = roleOf(idTok.value);
        } catch {
            addError(
                errors,
                idTok.location,
                `Invalid boundary bracket-form outer role '${idTok.value}' (expected I/C/M/O)`
            );
            return null;
        }
        if (idTok.value.length !== 1) {
            addError(
                errors,
                idTok.location,
                `Boundary bracket-form outer must be a single role letter, got '${idTok.value}'`
            );
        }
        validateArrowAt(
            bracketInner.value,
            BOUNDARY_BRACKET_INNER_ROLES,
            bracketInner.location,
            errors,
            "Boundary bracket inner"
        );
        if (BOUNDARY_BRACKET_CONSUMED_ROLES.has(outerRole)) {
            return {
                kind: "boundary",
                arrow: {
                    kind: "sibling-x-consumed",
                    role: outerRole as "I" | "C" | "M",
                    sourceId: bracketInner.value,
                    description: nameLit,
                    location: combineLocation(idTok.location, stream.position),
                },
                startLine,
                endLine,
            };
        }
        if (BOUNDARY_BRACKET_PRODUCED_ROLES.has(outerRole)) {
            return {
                kind: "boundary",
                arrow: {
                    kind: "parent-x-out",
                    sourceId: bracketInner.value,
                    description: nameLit,
                    location: combineLocation(idTok.location, stream.position),
                },
                startLine,
                endLine,
            };
        }
        addError(
            errors,
            idTok.location,
            `Boundary bracket-form outer role must be I/C/M/O, got '${outerRole}'`
        );
        return null;
    }

    // Flat form. T* in context body → tunnel decl; T* in activity body →
    // BoundaryArrowTunnel (echo per spec/01-dsl.md tunnel-in-boundary).
    if (idTok.value.startsWith("T")) {
        validateArrowAt(
            idTok.value,
            TUNNEL_ROLES,
            idTok.location,
            errors,
            "Tunnel declaration"
        );
        if (container === "activity") {
            return {
                kind: "boundary",
                arrow: {
                    kind: "tunnel",
                    id: idTok.value,
                    description: nameLit,
                    location: combineLocation(idTok.location, stream.position),
                },
                startLine,
                endLine,
            };
        }
        return {
            kind: "tunnel",
            tunnel: {
                id: idTok.value,
                description: nameLit,
                location: combineLocation(idTok.location, stream.position),
            },
            startLine,
            endLine,
        };
    }
    // Flat I*/O*/C*/M* boundary in activity body.
    validateArrowAt(
        idTok.value,
        BOUNDARY_ROLES,
        idTok.location,
        errors,
        "Boundary arrow"
    );
    let flatRole: ArrowRole;
    try {
        flatRole = roleOf(idTok.value);
    } catch {
        addError(
            errors,
            idTok.location,
            `Invalid boundary arrow id '${idTok.value}'`
        );
        return null;
    }
    return {
        kind: "boundary",
        arrow: {
            kind: "flat",
            role: flatRole as "I" | "O" | "C" | "M",
            id: idTok.value,
            description: nameLit,
            location: combineLocation(idTok.location, stream.position),
        },
        startLine,
        endLine,
    };
}

function parseFunctionalBlockRest(
    stream: CharStream,
    idTok: { value: string; location: SourceLocation },
    nameLit: StringLiteral,
    startLine: number,
    errors: Diagnostic[],
    container: ContainerKind
): RawBlock | null {
    // Parse consumed list until '->', then produced list until end-of-decl.
    const consumed: ConsumedArrowRef[] = [];
    consumeWhitespaceMultilineForDecl(stream);

    // Consumed list — may be empty (immediate '->').
    if (peekDoubleArrow(stream)) {
        // No consumed
    } else {
        while (true) {
            consumeWhitespaceMultilineForDecl(stream);
            const ref = parseConsumedRef(stream, errors);
            if (ref) consumed.push(ref);
            else {
                syncToEol(stream);
                return null;
            }
            consumeWhitespaceMultilineForDecl(stream);
            if (peekDoubleArrow(stream)) break;
            if (isAtEndOfDecl(stream, container)) {
                addError(
                    errors,
                    stream.locationOfCurrent(),
                    "Expected '->' between consumed and produced (declaration ends prematurely)"
                );
                return null;
            }
            if (!consumeChar(stream, ",")) {
                addError(
                    errors,
                    stream.locationOfCurrent(),
                    "Expected ',' or '->' in consumed list"
                );
                syncToEol(stream);
                return null;
            }
        }
    }
    if (!consumeDoubleArrow(stream)) {
        addError(
            errors,
            stream.locationOfCurrent(),
            "Expected '->' between consumed and produced"
        );
        syncToEol(stream);
        return null;
    }

    consumeWhitespaceMultilineForDecl(stream);
    // Last source line known to belong to this block's syntactic body. Updated
    // after each successful produced ref / consumed-list comma; used as
    // `endLine` so that trailing whitespace/comment lookahead doesn't make the
    // block look longer than it actually is (breaks inline-comment sticky
    // logic in classifyActivityItems).
    let lastMeaningfulLine = stream.position.line;
    const produced: ProducedArrowRef[] = [];
    // Pre-check: distinguish "no produced at all" from "produced list begins
    // with something we can attempt to parse". `}` / EOF / `#` (mid-decl
    // comment terminator per spec/01-dsl.md) all mean the block has produced
    // nothing — that's a clear "must produce at least one arrow" error and
    // bailing here gives the precise diagnostic. We DON'T bail on
    // start-of-decl literals (`A*` / `I*` / `O*` / ...): those may be a typo'd
    // produced item with a wrong role (e.g. `-> O1 "..."`), and
    // parseProducedRef emits a more specific role-mismatch diagnostic. So the
    // pre-check explicitly excludes start-of-decl tokens.
    const c2 = stream.peek();
    if (c2 === null || c2 === "}" || c2 === "#") {
        addError(
            errors,
            stream.locationOfCurrent(),
            "Functional block must produce at least one arrow"
        );
    } else {
        while (true) {
            consumeWhitespaceMultilineForDecl(stream);
            const ref = parseProducedRef(stream, errors);
            if (ref) produced.push(ref);
            else {
                syncToEol(stream);
                return null;
            }
            // Снимок позиции СРАЗУ после parseProducedRef — это реальная
            // граница последнего значимого токена блока. Следующий
            // consumeWhitespaceMultilineForDecl может продвинуть
            // stream.position.line вперёд (например, на строку
            // комментария-терминатора), и если бы endLine брали оттуда —
            // inline-комментарий ниже потерял бы привязку к этому блоку.
            lastMeaningfulLine = stream.position.line;
            consumeWhitespaceMultilineForDecl(stream);
            if (isAtEndOfDecl(stream, container)) break;
            if (!consumeChar(stream, ",")) {
                addError(
                    errors,
                    stream.locationOfCurrent(),
                    "Expected ',' or end-of-declaration in produced list"
                );
                syncToEol(stream);
                return null;
            }
            // `,` тоже двигает позицию — обновляем границу.
            lastMeaningfulLine = stream.position.line;
        }
    }
    const endLine = lastMeaningfulLine;
    return {
        kind: "block",
        block: {
            id: idTok.value,
            name: nameLit,
            consumed,
            produced,
            location: combineLocation(idTok.location, stream.position),
        },
        startLine,
        endLine,
    };
}

function parseConsumedRef(
    stream: CharStream,
    errors: Diagnostic[]
): ConsumedArrowRef | null {
    const startPos = stream.position;
    const word = readWord(stream);
    if (!word) {
        // try bracket form like '[X11]' shouldn't be without role prefix
        addError(
            errors,
            stream.locationOfCurrent(),
            "Expected consumed arrow reference"
        );
        return null;
    }
    // Cases:
    //   I1, C1, M1, X11 (X11 here would be unusual but legal as raw) — parent-style
    //   I[X11], C[T1] — sibling-style
    const c = stream.peek();
    if (c === "[") {
        // sibling form: <outer-role>[<sourceId>]
        stream.next();
        const inner = readWord(stream);
        if (!inner) {
            addError(
                errors,
                stream.locationOfCurrent(),
                "Expected arrow id inside '[...]'"
            );
            return null;
        }
        if (!consumeChar(stream, "]")) {
            addError(
                errors,
                stream.locationOfCurrent(),
                "Expected ']' after arrow id"
            );
            return null;
        }
        // Outer must be a single role letter from {I, C, M}; word.value here is the
        // whole prefix and may include suffix chars (e.g., 'IX' if a user typo'd).
        let role: ArrowRole;
        if (
            word.value.length === 1 &&
            CONSUMED_SIBLING_OUTER_ROLES.has(word.value as ArrowRole)
        ) {
            role = word.value as ArrowRole;
        } else {
            try {
                role = roleOf(word.value);
            } catch {
                addError(
                    errors,
                    word.location,
                    `Invalid consumed-arrow role prefix '${word.value}' (expected I/C/M)`
                );
                return null;
            }
            if (!CONSUMED_SIBLING_OUTER_ROLES.has(role)) {
                addError(
                    errors,
                    word.location,
                    `Consumed sibling outer role must be I/C/M, got '${role}'`
                );
            }
        }
        validateArrowAt(
            inner.value,
            CONSUMED_SIBLING_INNER_ROLES,
            inner.location,
            errors,
            "Consumed sibling source"
        );
        return {
            kind: "sibling",
            role,
            sourceId: inner.value,
            location: combineLocation(
                { file: stream.filePath, range: { start: startPos, end: startPos } },
                stream.position
            ),
        };
    }
    // parent form: full arrow id (I*, C*, M*) used by reference to the parent boundary.
    let role: ArrowRole;
    try {
        role = roleOf(word.value);
    } catch {
        addError(
            errors,
            word.location,
            `Invalid consumed-arrow id '${word.value}'`
        );
        return null;
    }
    validateArrowAt(
        word.value,
        CONSUMED_PARENT_ROLES,
        word.location,
        errors,
        "Consumed parent arrow"
    );
    return {
        kind: "parent",
        role,
        id: word.value,
        location: word.location,
    };
}

function parseProducedRef(
    stream: CharStream,
    errors: Diagnostic[]
): ProducedArrowRef | null {
    const startPos = stream.position;
    const idTok = readWord(stream);
    if (!idTok) {
        addError(
            errors,
            stream.locationOfCurrent(),
            "Expected produced arrow id"
        );
        return null;
    }
    consumeInlineWhitespace(stream);
    const c = stream.peek();
    if (c === "[") {
        stream.next();
        const inner = readWord(stream);
        if (!inner) {
            addError(
                errors,
                stream.locationOfCurrent(),
                "Expected arrow id inside '[...]'"
            );
            return null;
        }
        if (!consumeChar(stream, "]")) {
            addError(
                errors,
                stream.locationOfCurrent(),
                "Expected ']' after arrow id"
            );
            return null;
        }
        // Outer (idTok) must be X*; inner must be O* or T*.
        validateArrowAt(
            idTok.value,
            PRODUCED_OUTER_ROLES,
            idTok.location,
            errors,
            "Produced arrow"
        );
        validateArrowAt(
            inner.value,
            PRODUCED_BRACKET_ROLES,
            inner.location,
            errors,
            "Produced bracketed target"
        );
        let innerRole;
        try {
            innerRole = roleOf(inner.value);
        } catch {
            return null;
        }
        // Optional plug label: `X[O]` may be followed by `"label"` on the
        // SAME line. We deliberately use inline-only whitespace for the
        // lookup — multi-line whitespace would silently advance `stream`
        // past a trailing blank line and inflate the block's endLine,
        // breaking sticky-comment detection downstream. Label spanning
        // multiple lines is grammatically meaningless anyway (per
        // spec/04-validator.md rule 21, labels are short identifiers).
        let label: StringLiteral | undefined;
        consumeInlineWhitespace(stream);
        if (stream.peek() === '"') {
            const lit = parseStringLiteralRequired(stream, errors);
            if (lit) label = lit;
        }
        const endLoc = combineLocation(
            { file: stream.filePath, range: { start: startPos, end: startPos } },
            stream.position
        );
        if (innerRole === "O") {
            return {
                kind: "boundary-out",
                id: idTok.value,
                mappedTo: inner.value,
                ...(label !== undefined ? { label } : {}),
                location: endLoc,
            };
        }
        if (innerRole === "T") {
            return {
                kind: "tunnel-out",
                id: idTok.value,
                mappedTo: inner.value,
                ...(label !== undefined ? { label } : {}),
                location: endLoc,
            };
        }
        if (innerRole === "X") {
            return {
                kind: "parent-x-mapped",
                id: idTok.value,
                mappedTo: inner.value,
                ...(label !== undefined ? { label } : {}),
                location: endLoc,
            };
        }
        return null;
    }
    if (c === '"') {
        const desc = parseStringLiteralRequired(stream, errors);
        if (!desc) return null;
        validateArrowAt(
            idTok.value,
            PRODUCED_NEW_ROLES,
            idTok.location,
            errors,
            "Produced new arrow"
        );
        return {
            kind: "new",
            id: idTok.value,
            description: desc,
            location: combineLocation(
                { file: stream.filePath, range: { start: startPos, end: startPos } },
                stream.position
            ),
        };
    }
    addError(
        errors,
        stream.locationOfCurrent(),
        `Expected '"description"' or '[targetId]' after produced arrow id '${idTok.value}'`
    );
    return null;
}

function parseRootRefItem(
    stream: CharStream,
    errors: Diagnostic[],
    container: ContainerKind
): RawRootRef | null {
    const startPos = stream.position;
    const startLine = startPos.line;
    // Expect "...A<id>" at start of line (no trailing terminator).
    if (
        stream.peek() !== "." ||
        stream.peekAhead(1) !== "." ||
        stream.peekAhead(2) !== "."
    ) {
        addError(
            errors,
            stream.locationOfCurrent(),
            "Expected '...A0' root reference"
        );
        syncToEol(stream);
        return null;
    }
    stream.next();
    stream.next();
    stream.next();
    const idTok = readWord(stream);
    if (!idTok) {
        addError(
            errors,
            stream.locationOfCurrent(),
            "Expected activity ID after '...'"
        );
        syncToEol(stream);
        return null;
    }
    consumeWhitespaceMultilineForDecl(stream);
    if (!isAtEndOfDecl(stream, container)) {
        addError(
            errors,
            stream.locationOfCurrent(),
            `Unexpected token after root reference '...${idTok.value}'`
        );
        syncToEol(stream);
        return null;
    }
    return {
        kind: "rootRef",
        rootRef: {
            targetId: idTok.value as ActivityId,
            location: combineLocation(
                { file: stream.filePath, range: { start: startPos, end: startPos } },
                stream.position
            ),
        },
        startLine,
        endLine: stream.position.line,
    };
}

// ─── Comments ────────────────────────────────────────────────────────────────

function parseCommentItem(stream: CharStream): RawComment {
    const start = stream.position;
    const startLine = start.line;
    // consume '#'
    stream.next();
    // optional single space after '#'
    if (stream.peek() === " ") stream.next();
    const buffer: string[] = [];
    while (!stream.isAtEnd()) {
        const c = stream.peek();
        if (c === null || c === "\n" || c === "\r") break;
        buffer.push(c);
        stream.next();
    }
    const endPos = stream.position;
    const text = buffer.join("");
    const location: SourceLocation = {
        file: stream.filePath,
        range: { start, end: endPos },
    };
    return {
        kind: "comment",
        comment: { text, location },
        startLine,
        endLine: endPos.line,
    };
}

// ─── Strings ─────────────────────────────────────────────────────────────────

function parseStringLiteralRequired(
    stream: CharStream,
    errors: Diagnostic[]
): StringLiteral | null {
    consumeInlineWhitespace(stream);
    if (stream.peek() !== '"') {
        addError(
            errors,
            stream.locationOfCurrent(),
            'Expected string literal in double quotes'
        );
        return null;
    }
    const start = stream.position;
    stream.next(); // opening "
    const buf: string[] = [];
    while (!stream.isAtEnd()) {
        const c = stream.peek();
        if (c === null) break;
        if (c === "\\") {
            // Per spec/01-dsl.md, the only escapes inside a string literal are \" and \\.
            // Other backslash-prefixed chars stay literal (the backslash is preserved).
            stream.next();
            const esc = stream.peek();
            if (esc === null) {
                buf.push("\\");
                break;
            }
            if (esc === '"' || esc === "\\") {
                stream.next();
                buf.push(esc);
            } else {
                buf.push("\\");
            }
            continue;
        }
        if (c === '"') {
            stream.next();
            const end = stream.position;
            return {
                value: buf.join(""),
                location: {
                    file: stream.filePath,
                    range: { start, end },
                },
            };
        }
        if (c === "\n" || c === "\r") {
            addError(
                errors,
                stream.locationOfCurrent(),
                "Unexpected newline inside string literal"
            );
            const end = stream.position;
            return {
                value: buf.join(""),
                location: {
                    file: stream.filePath,
                    range: { start, end },
                },
            };
        }
        buf.push(c);
        stream.next();
    }
    addError(
        errors,
        stream.locationOfCurrent(),
        "Unterminated string literal"
    );
    return {
        value: buf.join(""),
        location: {
            file: stream.filePath,
            range: { start, end: stream.position },
        },
    };
}

// ─── Word / identifier ───────────────────────────────────────────────────────

// readWord — лексер уровень. Собирает identifier-токен по char-class.
//
// Дефис `-` — спец-кейс. Он не входит в обычный word-char класс, чтобы не
// рвать грамматические разделители вроде `->`. Единственное место в DSL,
// где `-` встречается внутри идентификатора, — литерал контекстного id
// `A-0`. Соответственно `-` допустим **только** на позиции 1, и только
// если первый прочитанный символ — `A`. В любой другой позиции `-`
// завершает токен.
//
// Это структурное правило (а не lookahead-патч): любые `-`-начатые
// разделители в будущем работают без правок лексера. Валидация того, что
// после `A-` идёт именно `0` (т.е. полный токен — это `A-0`, а не `A-1` /
// `A-foo`), — задача парсера/валидатора, не лексера.
function readWord(
    stream: CharStream
): { value: string; location: SourceLocation } | null {
    consumeInlineWhitespace(stream);
    const start = stream.position;
    let buf = "";
    while (!stream.isAtEnd()) {
        const c = stream.peek();
        if (c === null) break;
        if (c === "-") {
            // `-` принимается ровно на позиции 1 после ведущего `A`.
            if (buf === "A") {
                buf += c;
                stream.next();
                continue;
            }
            break;
        }
        if (isWordChar(c)) {
            buf += c;
            stream.next();
        } else break;
    }
    if (buf.length === 0) return null;
    const end = stream.position;
    return {
        value: buf,
        location: { file: stream.filePath, range: { start, end } },
    };
}

function isWordChar(c: string): boolean {
    return /[A-Za-z0-9_]/.test(c);
}

// ─── Whitespace and comment skipping (pre/post header) ───────────────────────

// At top level — collect floating comments (before/after header).
function consumeWhitespaceAndComments(
    stream: CharStream,
    floatingSink: Comment[]
): void {
    while (!stream.isAtEnd()) {
        const c = stream.peek();
        if (c === null) break;
        if (c === " " || c === "\t" || c === "\n" || c === "\r") {
            stream.next();
            continue;
        }
        if (c === "#") {
            const item = parseCommentItem(stream);
            floatingSink.push(item.comment);
            continue;
        }
        break;
    }
}

function consumeInlineWhitespace(stream: CharStream): void {
    while (!stream.isAtEnd()) {
        const c = stream.peek();
        if (c === " " || c === "\t") stream.next();
        else break;
    }
}

// For multi-line declaration parsing: newlines after ',' and '->' (and similar
// continuation points) are whitespace. `#` is NOT consumed here — a comment in
// the middle of a declaration is illegal per spec/01-dsl.md and terminates the
// declaration so parseBody can pick the comment up as a standalone item.
function consumeWhitespaceMultilineForDecl(stream: CharStream): void {
    while (!stream.isAtEnd()) {
        const c = stream.peek();
        if (c === " " || c === "\t" || c === "\n" || c === "\r") {
            stream.next();
            continue;
        }
        break;
    }
}

function consumeChar(stream: CharStream, target: string): boolean {
    consumeInlineWhitespace(stream);
    if (stream.peek() === target) {
        stream.next();
        return true;
    }
    return false;
}

function peekDoubleArrow(stream: CharStream): boolean {
    consumeInlineWhitespace(stream);
    return stream.peek() === "-" && stream.peekAhead(1) === ">";
}

function consumeDoubleArrow(stream: CharStream): boolean {
    consumeInlineWhitespace(stream);
    if (stream.peek() === "-" && stream.peekAhead(1) === ">") {
        stream.next();
        stream.next();
        return true;
    }
    return false;
}

// ─── Panic-mode recovery ─────────────────────────────────────────────────────

// Skip forward to the end of the current line. The parseBody loop will then
// re-evaluate from the start of the next line — if it begins with a start-of-decl
// literal, a new declaration begins; otherwise, the loop emits another error.
function syncToEol(stream: CharStream): void {
    while (!stream.isAtEnd()) {
        const c = stream.peek();
        if (c === null) return;
        if (c === "}") return;
        if (c === "\n" || c === "\r") {
            stream.next();
            return;
        }
        stream.next();
    }
}

// ─── Diagnostic helpers ──────────────────────────────────────────────────────

function addError(
    errors: Diagnostic[],
    location: SourceLocation,
    message: string,
    ruleId?: string,
): void {
    errors.push({
        severity: "error",
        source: "parser",
        range: location.range,
        file: location.file,
        message,
        ...(ruleId !== undefined ? { ruleId } : {}),
    });
}

function combineLocation(
    startLoc: SourceLocation,
    end: SourcePosition
): SourceLocation {
    return {
        file: startLoc.file,
        range: { start: startLoc.range.start, end },
    };
}

// ─── Comment classification (post-parse pass) ────────────────────────────────

type Group =
    | {
          kind: "blockGroup";
          items: RawItem[];
          leadingBlank: boolean;
      }
    | {
          kind: "boundaryGroup";
          items: RawItem[];
      };

interface ActivityBodyResult {
    boundary: BoundaryArrow[];
    blocks: FunctionalBlock[];
    boundaryDividers: BlockDivider[];
    blocksDividers: BlockDivider[];
    floatingFromBody: Comment[];
}

interface ContextBodyResult {
    tunnels: TunnelDecl[];
    tunnelsDividers: BlockDivider[];
    rootRef: RootReference | null;
    floatingFromBody: Comment[];
}

// Split items into groups by blank lines.
function splitGroups(items: RawItem[]): {
    groups: { items: RawItem[]; leadingBlank: boolean }[];
} {
    const groups: { items: RawItem[]; leadingBlank: boolean }[] = [];
    if (items.length === 0) return { groups };
    let current: RawItem[] = [];
    let prevEndLine = items[0]!.startLine;
    let isFirst = true;
    let leadingBlankForNext = false;
    for (let i = 0; i < items.length; i += 1) {
        const item = items[i]!;
        if (isFirst) {
            current.push(item);
            prevEndLine = item.endLine;
            isFirst = false;
            continue;
        }
        const gap = item.startLine - prevEndLine; // 1 = adjacent; >=2 = blank between
        if (gap >= 2) {
            groups.push({ items: current, leadingBlank: leadingBlankForNext });
            current = [item];
            leadingBlankForNext = true;
        } else {
            current.push(item);
        }
        prevEndLine = item.endLine;
    }
    if (current.length > 0) {
        groups.push({ items: current, leadingBlank: leadingBlankForNext });
    }
    return { groups };
}

// A comment is a "block divider" iff a blank line follows it in source.
// Detection: gap to the NEXT item's startLine is >= 2 (gap of 1 means
// adjacent line; >=2 means at least one blank line between). Comments at the
// end of the body don't have a "next item" to test against — they remain
// sticky/floating (probably trailing notes, not dividers).
//
// **Inline exception.** Comments that begin on the SAME source line as the
// previous non-comment item (e.g., `X "name" # inline note`) are inline
// trivia attached to that anchor — NOT dividers, even if a blank line
// follows on the next source row. This keeps round-trip stable: the
// formatter re-emits inline comments on the same physical line, and the
// re-parser must recognise them as inline again.
function isDividerComment(
    items: readonly RawItem[],
    index: number,
): boolean {
    const it = items[index]!;
    if (it.kind !== "comment") return false;
    // Find the previous non-comment item (skip over chains of comments).
    let prev: RawItem | undefined;
    for (let i = index - 1; i >= 0; i -= 1) {
        const candidate = items[i]!;
        if (candidate.kind !== "comment") {
            prev = candidate;
            break;
        }
    }
    if (prev !== undefined && prev.endLine === it.startLine) {
        return false; // inline trivia, not a divider
    }
    const next = items[index + 1];
    if (next === undefined) return false;
    return next.startLine - it.endLine >= 2;
}

function classifyActivityItems(
    items: RawItem[],
    errors: Diagnostic[]
): ActivityBodyResult {
    const boundary: BoundaryArrow[] = [];
    const blocks: FunctionalBlock[] = [];
    const floating: Comment[] = [];

    // Pre-scan: identify block-divider comments before sticky-classification
    // so they don't get attached as commentsAbove/commentsBelow of anchors.
    // A comment is a divider iff a blank line follows it in source (gap to
    // next item's startLine >= 2). Trailing blank ABOVE the comment is not
    // required — the formatter will inject one if missing.
    const dividerComments = new Set<RawItem>();
    for (let i = 0; i < items.length; i += 1) {
        if (isDividerComment(items, i)) dividerComments.add(items[i]!);
    }

    const { groups } = splitGroups(items);
    for (const group of groups) {
        // Anchors = boundary arrows OR functional blocks. Comments stick to the
        // nearest anchor within the same blank-separated group (per spec/02-
        // formatting.md «Комментарии при сортировке блоков»). Items between
        // anchors: comments above the next anchor go to its commentsAbove;
        // comments after the LAST anchor go to its commentsBelow.
        const anchorIndices: number[] = [];
        for (let i = 0; i < group.items.length; i += 1) {
            const it = group.items[i]!;
            if (it.kind === "block" || it.kind === "boundary") {
                anchorIndices.push(i);
            }
        }

        // No anchors in group — all items are comments or misplaced
        // tunnel/rootRef. Comments → floating, tunnel/rootRef → error.
        if (anchorIndices.length === 0) {
            for (const it of group.items) {
                if (it.kind === "comment") floating.push(it.comment);
                else if (it.kind === "tunnel") {
                    addError(
                        errors,
                        it.tunnel.location,
                        `Tunnel declaration '${it.tunnel.id}' is not allowed inside 'activity' body — tunnels live in the context A-0 file`
                    );
                } else if (it.kind === "rootRef") {
                    addError(
                        errors,
                        it.rootRef.location,
                        "Root reference '...A0;' is not allowed inside 'activity' body — it lives in the context A-0 file"
                    );
                }
            }
            continue;
        }

        // Linear pass through the group. For each comment:
        //   - If a previous anchor exists AND comment's startLine equals that
        //     anchor's endLine (i.e., the comment is INLINE on the same source
        //     line as the previous anchor) — comment becomes that anchor's
        //     commentsBelow. This catches `M2 "label" # note` and equivalent.
        //   - Otherwise the comment is queued as a pending "above" pile,
        //     attached to the next anchor's commentsAbove.
        // At end of group: any remaining pending pile attaches to the LAST
        // anchor's commentsBelow (trailing block-of-comments under it).
        //
        // Each anchor is then emitted with its own collected sticky lists.
        interface PendingAnchor {
            readonly aIdx: number;
            readonly anchorIndex: number;
            readonly commentsAbove: Comment[];
            readonly commentsBelow: Comment[];
            inlineComment?: Comment;
        }
        const pendingAnchors: PendingAnchor[] = anchorIndices.map(
            (anchorIndex, aIdx) => ({
                aIdx,
                anchorIndex,
                commentsAbove: [],
                commentsBelow: [],
            }),
        );

        let pendingAbove: Comment[] = [];
        let lastAnchor: PendingAnchor | null = null;
        let nextAnchorPos = 0;
        // Track the previous item's endLine to detect blank-line gaps in
        // front of comments. The very first item in a group inherits
        // `group.leadingBlank` (set by splitGroups) — that's where the
        // blank-line-above-the-group came from.
        let prevEndLine = -1;
        let isFirstInGroup = true;

        for (let i = 0; i < group.items.length; i += 1) {
            const it = group.items[i]!;
            const hadBlankAbove = isFirstInGroup
                ? group.leadingBlank
                : prevEndLine >= 0 && it.startLine - prevEndLine >= 2;
            isFirstInGroup = false;
            if (it.kind === "block" || it.kind === "boundary") {
                const anchor = pendingAnchors[nextAnchorPos]!;
                anchor.commentsAbove.push(...pendingAbove);
                pendingAbove = [];
                lastAnchor = anchor;
                nextAnchorPos += 1;
                prevEndLine = it.endLine;
                continue;
            }
            if (it.kind === "comment") {
                // Divider comments bypass sticky-attribution entirely —
                // they're collected into `floating` and reclassified by the
                // postprocess loop into boundaryDividers / blocksDividers.
                if (dividerComments.has(it)) {
                    floating.push(it.comment);
                    prevEndLine = it.endLine;
                    continue;
                }
                const lastEndLine =
                    lastAnchor !== null
                        ? group.items[lastAnchor.anchorIndex]!.endLine
                        : -1;
                const taggedComment: Comment = {
                    ...it.comment,
                    leadingBlankLine: hadBlankAbove,
                };
                if (
                    lastAnchor !== null &&
                    it.comment.location.range.start.line === lastEndLine
                ) {
                    // Inline comment on the same source line as the previous
                    // anchor's last token. Lives in a dedicated `inlineComment`
                    // slot so the formatter can re-emit it inline (`X "name" # note`)
                    // rather than dropping it to the next line as commentsBelow.
                    // Only the first inline comment is captured; subsequent
                    // ones on the same line are pathological (parser emits one
                    // comment per `#`-prefixed segment), so we keep the first
                    // and silently coalesce — pathological input is not a
                    // round-trip target.
                    if (lastAnchor.inlineComment === undefined) {
                        lastAnchor.inlineComment = taggedComment;
                    } else {
                        pendingAbove.push(taggedComment);
                    }
                } else {
                    pendingAbove.push(taggedComment);
                }
                prevEndLine = it.endLine;
                continue;
            }
            if (it.kind === "tunnel") {
                addError(
                    errors,
                    it.tunnel.location,
                    `Tunnel declaration '${it.tunnel.id}' is not allowed inside 'activity' body — tunnels live in the context A-0 file`
                );
            } else if (it.kind === "rootRef") {
                addError(
                    errors,
                    it.rootRef.location,
                    "Root reference '...A0;' is not allowed inside 'activity' body — it lives in the context A-0 file"
                );
            }
        }
        // Trailing pending pile → commentsBelow of the last anchor.
        if (lastAnchor !== null) {
            lastAnchor.commentsBelow.push(...pendingAbove);
        } else {
            // No anchors in group reached — items already handled above by
            // the `anchorIndices.length === 0` branch. Defensive no-op.
            for (const c of pendingAbove) floating.push(c);
        }

        for (const pending of pendingAnchors) {
            const isFirstAnchor = pending.aIdx === 0;
            const anchorItem = group.items[pending.anchorIndex]!;
            if (anchorItem.kind === "block") {
                blocks.push({
                    ...anchorItem.block,
                    leadingBlankLine: isFirstAnchor ? group.leadingBlank : false,
                    commentsAbove: pending.commentsAbove,
                    commentsBelow: pending.commentsBelow,
                    ...(pending.inlineComment !== undefined
                        ? { inlineComment: pending.inlineComment }
                        : {}),
                });
            } else if (anchorItem.kind === "boundary") {
                boundary.push({
                    ...anchorItem.arrow,
                    leadingBlankLine: isFirstAnchor ? group.leadingBlank : false,
                    commentsAbove: pending.commentsAbove,
                    commentsBelow: pending.commentsBelow,
                    ...(pending.inlineComment !== undefined
                        ? { inlineComment: pending.inlineComment }
                        : {}),
                } as BoundaryArrow);
            }
        }
    }
    // Split body-floating comments into boundary-dividers, blocks-dividers,
    // and remaining floating tail. A floating comment IS a "block divider" by
    // definition: it's already separated from neighbouring anchors by at
    // least one blank line (otherwise classify would have stuck it). Section
    // (boundary vs blocks) is determined by source-line position relative to
    // the first functional block. `afterIndex` is the input-order position
    // of the immediately preceding section anchor.
    const firstBlockLine =
        blocks.length > 0
            ? Math.min(
                  ...blocks.map((b) => b.location.range.start.line),
              )
            : Number.POSITIVE_INFINITY;
    const boundaryDividers: BlockDivider[] = [];
    const blocksDividers: BlockDivider[] = [];
    const trulyFloating: Comment[] = [];
    for (const c of floating) {
        const line = c.location.range.start.line;
        if (line < firstBlockLine) {
            const preceding = boundary.filter(
                (b) => b.location.range.start.line < line,
            ).length;
            boundaryDividers.push({ comment: c, afterIndex: preceding - 1 });
        } else if (blocks.length > 0) {
            const preceding = blocks.filter(
                (b) => b.location.range.start.line < line,
            ).length;
            blocksDividers.push({ comment: c, afterIndex: preceding - 1 });
        } else {
            // No blocks; comment lives strictly inside body but with no anchor
            // ever following — treat as tail floating.
            trulyFloating.push(c);
        }
    }

    return {
        boundary,
        blocks,
        boundaryDividers,
        blocksDividers,
        floatingFromBody: trulyFloating,
    };
}

function classifyContextItems(
    items: RawItem[],
    errors: Diagnostic[]
): ContextBodyResult {
    const tunnels: TunnelDecl[] = [];
    let rootRef: RootReference | null = null;
    const floating: Comment[] = [];

    // Pre-scan: identify block-divider comments (same rule as activity body
    // — comment with blank line below) so they bypass sticky-attribution.
    const dividerComments = new Set<RawItem>();
    for (let i = 0; i < items.length; i += 1) {
        if (isDividerComment(items, i)) dividerComments.add(items[i]!);
    }

    const { groups } = splitGroups(items);
    for (const group of groups) {
        // anchors = tunnels OR rootRef
        const anchorIndices: number[] = [];
        for (let i = 0; i < group.items.length; i += 1) {
            const it = group.items[i]!;
            if (it.kind === "tunnel" || it.kind === "rootRef") {
                anchorIndices.push(i);
            }
        }
        if (anchorIndices.length === 0) {
            for (const it of group.items) {
                if (it.kind === "comment") floating.push(it.comment);
                else if (it.kind === "boundary") {
                    addError(
                        errors,
                        it.arrow.location,
                        `Boundary arrow '${boundaryArrowDisplay(it.arrow)}' is not allowed inside 'context A-0' body — boundary arrows live in the activity file`
                    );
                } else if (it.kind === "block") {
                    addError(
                        errors,
                        it.block.location,
                        `Functional block '${it.block.id}' is not allowed inside 'context A-0' body — blocks live in activity files`
                    );
                }
            }
            continue;
        }
        // Filter out divider comments from this group — they go directly to
        // `floating` and are reclassified into `tunnelsDividers` by the
        // postprocess loop below.
        for (const it of group.items) {
            if (it.kind === "comment" && dividerComments.has(it)) {
                floating.push(it.comment);
            }
        }
        let cursor = 0;
        for (let ai = 0; ai < anchorIndices.length; ai += 1) {
            const anchorIndex = anchorIndices[ai]!;
            const before = group.items.slice(cursor, anchorIndex);
            const commentsAbove: Comment[] = [];
            for (const it of before) {
                if (it.kind === "comment") {
                    if (dividerComments.has(it)) {
                        floating.push(it.comment);
                    } else {
                        commentsAbove.push(it.comment);
                    }
                } else if (it.kind === "boundary") {
                    addError(
                        errors,
                        it.arrow.location,
                        `Boundary arrow '${boundaryArrowDisplay(it.arrow)}' is not allowed inside 'context A-0' body`
                    );
                } else if (it.kind === "block") {
                    addError(
                        errors,
                        it.block.location,
                        `Functional block '${it.block.id}' is not allowed inside 'context A-0' body`
                    );
                }
            }
            const anchorItem = group.items[anchorIndex]!;
            const isLast = ai === anchorIndices.length - 1;
            const commentsBelow: Comment[] = [];
            if (isLast) {
                const after = group.items.slice(anchorIndex + 1);
                for (const it of after) {
                    if (it.kind === "comment") {
                        if (dividerComments.has(it)) {
                            floating.push(it.comment);
                        } else {
                            commentsBelow.push(it.comment);
                        }
                    } else if (it.kind === "boundary") {
                        addError(
                            errors,
                            it.arrow.location,
                            `Boundary arrow '${boundaryArrowDisplay(it.arrow)}' is not allowed inside 'context A-0' body`
                        );
                    } else if (it.kind === "block") {
                        addError(
                            errors,
                            it.block.location,
                            `Functional block '${it.block.id}' is not allowed inside 'context A-0' body`
                        );
                    }
                }
            }
            if (anchorItem.kind === "tunnel") {
                tunnels.push({
                    ...anchorItem.tunnel,
                    leadingBlankLine: ai === 0 ? group.leadingBlank : false,
                    commentsAbove,
                    commentsBelow,
                });
            } else if (anchorItem.kind === "rootRef") {
                if (rootRef === null) {
                    rootRef = {
                        ...anchorItem.rootRef,
                        leadingBlankLine: ai === 0 ? group.leadingBlank : false,
                        commentsAbove,
                        commentsBelow,
                    };
                } else {
                    // Duplicate rootRef declarations — secondary occurrences keep
                    // their sticky comments only on the duplicate (which won't be
                    // emitted), so push them to floating to avoid silent loss.
                    for (const c of commentsAbove) floating.push(c);
                    for (const c of commentsBelow) floating.push(c);
                }
            }
            cursor = anchorIndex + 1;
        }
    }

    // Postprocess: distribute floating divider-comments into tunnelsDividers
    // with afterIndex based on input-order position relative to tunnels.
    const tunnelsDividers: BlockDivider[] = [];
    const trulyFloating: Comment[] = [];
    for (const c of floating) {
        const line = c.location.range.start.line;
        const preceding = tunnels.filter(
            (t) => t.location.range.start.line < line,
        ).length;
        if (tunnels.length === 0) {
            trulyFloating.push(c);
        } else {
            tunnelsDividers.push({ comment: c, afterIndex: preceding - 1 });
        }
    }

    return {
        tunnels,
        tunnelsDividers,
        rootRef,
        floatingFromBody: trulyFloating,
    };
}

// Silence unused exports.
export type { ArrowId };
