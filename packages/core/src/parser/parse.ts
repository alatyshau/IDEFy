import type {
    ActivityAST,
    ActivityId,
    ArrowId,
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
    isActivityId,
    isValidArrowId,
    isValidArrowIdInRoles,
    roleOf,
} from "../ids.js";
import type { ArrowRole } from "../types.js";
import { CharStream } from "./char-stream.js";

const BOUNDARY_ROLES: ReadonlySet<ArrowRole> = new Set(["I", "O", "C", "M"]);
const TUNNEL_ROLES: ReadonlySet<ArrowRole> = new Set(["T"]);
const CONSUMED_PARENT_ROLES: ReadonlySet<ArrowRole> = new Set(["I", "C", "M"]);
const CONSUMED_SIBLING_OUTER_ROLES: ReadonlySet<ArrowRole> = new Set([
    "I",
    "C",
    "M",
]);
const CONSUMED_SIBLING_INNER_ROLES: ReadonlySet<ArrowRole> = new Set(["X", "T"]);
const PRODUCED_NEW_ROLES: ReadonlySet<ArrowRole> = new Set(["X"]);
const PRODUCED_OUTER_ROLES: ReadonlySet<ArrowRole> = new Set(["X"]);
const PRODUCED_BRACKET_ROLES: ReadonlySet<ArrowRole> = new Set(["O", "T"]);

type ContainerKind = "activity" | "context";

// Sentinel item types collected during body parsing.
interface RawComment {
    readonly kind: "comment";
    readonly comment: Comment;
    readonly startLine: number;
    readonly endLine: number;
}
interface RawBoundary {
    readonly kind: "boundary";
    readonly arrow: BoundaryArrow;
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
    readonly rootRef: RootReference;
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
        // I/O/C/M (boundary) and A (functional decomposition) are start-literals.
        // X and T at line-start are NOT start-of-decl — X never appears as
        // top-level; T is wrong-container (parser treats it as continuation, the
        // separate parseDeclarationItem dispatch catches misplaced tunnel).
        if (c === "I" || c === "O" || c === "C" || c === "M" || c === "A") {
            const c2 = stream.peekAhead(1);
            return c2 !== null && /[A-Z0-9-]/.test(c2);
        }
        return false;
    }
    // context body: T* tunnel or `...A<id>` rootref.
    if (c === "T") {
        const c2 = stream.peekAhead(1);
        return c2 !== null && /[A-Z0-9]/.test(c2);
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
    if (!isValidArrowIdInRoles(id, allowedRoles)) {
        const reason = isValidArrowId(id)
            ? `role '${id.charAt(0)}' is not allowed here`
            : "id must match <role-letter><uppercase alphanumeric suffix>";
        const rolesStr = [...allowedRoles].join("/");
        addError(
            errors,
            location,
            `${positionLabel}: arrow id '${id}' invalid (${reason}; expected ${rolesStr}*)`
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
    consumeInlineWhitespace(stream);
    const idTok = readWord(stream);
    if (idTok === null) {
        addError(
            errors,
            stream.locationOfCurrent(),
            "Expected activity ID after 'activity'"
        );
        return null;
    }
    consumeInlineWhitespace(stream);
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
    const { blocks, boundary, floatingFromBody } = classifyActivityItems(
        items,
        errors
    );
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
    consumeInlineWhitespace(stream);
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
    consumeInlineWhitespace(stream);
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
    const { tunnels, rootRef, floatingFromBody } = classifyContextItems(
        items,
        errors
    );
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
    consumeInlineWhitespace(stream);
    const nameLit = parseStringLiteralRequired(stream, errors);
    if (!nameLit) return null;

    // After name, look at the next non-whitespace character. ONLY `:` makes this
    // a functional block declaration (which has consumed/produced lists). Anything
    // else — including any token, start-of-decl of the next line, `}`, `#`, EOF —
    // closes this declaration as a boundary arrow or tunnel decl. The parseBody
    // loop will then handle whatever follows.
    consumeWhitespaceMultilineForDecl(stream);
    if (stream.peek() === ":") {
        stream.next();
        if (!isActivityId(idTok.value)) {
            addError(
                errors,
                idTok.location,
                `Functional block id '${idTok.value}' is not a valid activity id (expected A0 or A<suffix> where suffix uses 1..9, A..Z)`
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
    // Boundary arrow or tunnel decl — pick by role letter.
    const endLine = stream.position.line;
    if (idTok.value.startsWith("T")) {
        validateArrowAt(
            idTok.value,
            TUNNEL_ROLES,
            idTok.location,
            errors,
            "Tunnel declaration"
        );
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
    validateArrowAt(
        idTok.value,
        BOUNDARY_ROLES,
        idTok.location,
        errors,
        "Boundary arrow"
    );
    return {
        kind: "boundary",
        arrow: {
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
    const produced: ProducedArrowRef[] = [];
    // Pre-check ONLY for the unambiguous "no produced at all" cases (`}` /
    // end-of-body / EOF). For `start-of-decl` we don't bail early — that token
    // may actually be a user-intended produced item with a wrong role (e.g.,
    // `-> O1 "..."`), and parseProducedRef emits a more specific diagnostic
    // about the role being invalid for the produced position.
    const c2 = stream.peek();
    if (c2 === null || c2 === "}") {
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
        }
    }
    const endLine = stream.position.line;
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
        if (innerRole === "O") {
            return {
                kind: "boundary-out",
                id: idTok.value,
                mappedTo: inner.value,
                location: combineLocation(
                    { file: stream.filePath, range: { start: startPos, end: startPos } },
                    stream.position
                ),
            };
        }
        if (innerRole === "T") {
            return {
                kind: "tunnel-out",
                id: idTok.value,
                mappedTo: inner.value,
                location: combineLocation(
                    { file: stream.filePath, range: { start: startPos, end: startPos } },
                    stream.position
                ),
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

function readWord(
    stream: CharStream
): { value: string; location: SourceLocation } | null {
    consumeInlineWhitespace(stream);
    const start = stream.position;
    let buf = "";
    while (!stream.isAtEnd()) {
        const c = stream.peek();
        if (c === null) break;
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
    return /[A-Za-z0-9_\-]/.test(c);
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
    message: string
): void {
    errors.push({
        severity: "error",
        source: "parser",
        range: location.range,
        file: location.file,
        message,
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
    floatingFromBody: Comment[];
}

interface ContextBodyResult {
    tunnels: TunnelDecl[];
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

function classifyActivityItems(
    items: RawItem[],
    errors: Diagnostic[]
): ActivityBodyResult {
    const boundary: BoundaryArrow[] = [];
    const blocks: FunctionalBlock[] = [];
    const floating: Comment[] = [];

    const { groups } = splitGroups(items);
    for (const group of groups) {
        // Collect indices of anchors (blocks). Boundary arrows aren't sticky anchors
        // but they're still anchors that "separate" comments — comments adjacent to
        // boundary arrows or in groups with no block become floating.
        const blockIndices: number[] = [];
        for (let i = 0; i < group.items.length; i += 1) {
            const it = group.items[i]!;
            if (it.kind === "block") blockIndices.push(i);
        }
        if (blockIndices.length === 0) {
            for (const it of group.items) {
                if (it.kind === "comment") floating.push(it.comment);
                else if (it.kind === "boundary") boundary.push(it.arrow);
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

        // Process: for each block at index `bi`, gather:
        //   commentsAbove from items[startSlice...bi-1] where startSlice is
        //     either start of group OR (prev block index + 1).
        //   commentsBelow only for LAST block in group: items[lastBi+1...end].
        //   leadingBlankLine of FIRST block in group = group.leadingBlank; others = false.
        //
        // Non-comment, non-block items inside slice (e.g., boundary, rootRef) — push as floating.

        let cursor = 0; // current item index in group
        for (let bIdx = 0; bIdx < blockIndices.length; bIdx += 1) {
            const blockIndex = blockIndices[bIdx]!;
            const before = group.items.slice(cursor, blockIndex);
            const commentsAbove: Comment[] = [];
            for (const it of before) {
                if (it.kind === "comment") commentsAbove.push(it.comment);
                else if (it.kind === "boundary") boundary.push(it.arrow);
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
            const blockItem = group.items[blockIndex]! as RawBlock;
            const isLastBlock = bIdx === blockIndices.length - 1;
            const commentsBelow: Comment[] = [];
            if (isLastBlock) {
                const after = group.items.slice(blockIndex + 1);
                for (const it of after) {
                    if (it.kind === "comment") commentsBelow.push(it.comment);
                    else if (it.kind === "boundary") boundary.push(it.arrow);
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
            }
            blocks.push({
                ...blockItem.block,
                leadingBlankLine: bIdx === 0 ? group.leadingBlank : false,
                commentsAbove,
                commentsBelow,
            });
            cursor = blockIndex + 1;
        }
    }
    return { boundary, blocks, floatingFromBody: floating };
}

function classifyContextItems(
    items: RawItem[],
    errors: Diagnostic[]
): ContextBodyResult {
    const tunnels: TunnelDecl[] = [];
    let rootRef: RootReference | null = null;
    const floating: Comment[] = [];

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
                        `Boundary arrow '${it.arrow.id}' is not allowed inside 'context A-0' body — boundary arrows live in the activity file`
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
        let cursor = 0;
        for (let ai = 0; ai < anchorIndices.length; ai += 1) {
            const anchorIndex = anchorIndices[ai]!;
            const before = group.items.slice(cursor, anchorIndex);
            const commentsAbove: Comment[] = [];
            for (const it of before) {
                if (it.kind === "comment") commentsAbove.push(it.comment);
                else if (it.kind === "boundary") {
                    addError(
                        errors,
                        it.arrow.location,
                        `Boundary arrow '${it.arrow.id}' is not allowed inside 'context A-0' body`
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
                    if (it.kind === "comment") commentsBelow.push(it.comment);
                    else if (it.kind === "boundary") {
                        addError(
                            errors,
                            it.arrow.location,
                            `Boundary arrow '${it.arrow.id}' is not allowed inside 'context A-0' body`
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
                if (rootRef === null) rootRef = anchorItem.rootRef;
                // Stray comments around rootRef: attach as floating if not first/last anchor.
                for (const c of commentsAbove) floating.push(c);
                for (const c of commentsBelow) floating.push(c);
            }
            cursor = anchorIndex + 1;
        }
    }
    return { tunnels, rootRef, floatingFromBody: floating };
}

// Silence unused exports.
export type { ArrowId };
