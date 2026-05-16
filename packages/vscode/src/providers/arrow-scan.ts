// Pure scanner for arrow-id occurrences in IDEF0 DSL source text.
//
// Each hit carries:
//   - `role`     — the colour-driving prefix letter (`I`, `O`, `C`, `M`, `X`, `T`)
//   - `position` — whether this token sits as the outer carrier of a bracket
//                  form (`I[X11]`), as the inner ID (`X11` inside `[…]`), or
//                  as a standalone ID outside any bracket form.
//
// Brackets themselves (`[`, `]`) are emitted as outer-position hits so they
// inherit the outer role's colour and font style. The scanner advances
// linearly and never double-emits; hits are returned in source order, as VS
// Code's SemanticTokensBuilder requires strictly increasing positions.

const ARROW_LETTERS = new Set(["I", "O", "C", "M", "X", "T"]);

export type ArrowIdPosition = "outer" | "inner" | "standalone";

export interface ArrowIdHit {
    readonly offset: number;
    readonly length: number;
    readonly role: string;
    readonly position: ArrowIdPosition;
}

export function scanArrowIds(text: string): ArrowIdHit[] {
    const hits: ArrowIdHit[] = [];
    const n = text.length;
    let i = 0;

    while (i < n) {
        const ch = text.charAt(i);

        if (ch === '"') {
            i = skipString(text, i);
            continue;
        }
        if (ch === "#") {
            i = skipLineComment(text, i);
            continue;
        }
        if (!isArrowLetter(ch) || !isWordStart(text, i)) {
            i++;
            continue;
        }

        const idEnd = scanIdSuffix(text, i + 1);
        const idLen = idEnd - i;

        if (idEnd < n && text.charAt(idEnd) === "[") {
            const next = emitBracketForm(text, i, idEnd, hits);
            if (next !== null) {
                i = next;
                continue;
            }
            // Malformed bracket form — back off and let the linear scan retry
            // from the next character.
            i = idEnd + 1;
            continue;
        }

        if (idLen >= 2) {
            hits.push({ offset: i, length: idLen, role: ch, position: "standalone" });
            i = idEnd;
            continue;
        }

        i++;
    }

    return hits;
}

// Returns the offset just past `]` on success, or null to signal that the
// bracket form couldn't be parsed.
function emitBracketForm(
    text: string,
    outerStart: number,
    outerEnd: number,
    hits: ArrowIdHit[],
): number | null {
    const outerRole = text.charAt(outerStart);
    const innerStart = outerEnd + 1;
    if (innerStart >= text.length) return null;

    const innerLetter = text.charAt(innerStart);
    if (!isArrowLetter(innerLetter)) return null;

    const innerEnd = scanIdSuffix(text, innerStart + 1);
    const innerLen = innerEnd - innerStart;
    if (innerLen < 2) return null;
    if (innerEnd >= text.length || text.charAt(innerEnd) !== "]") return null;

    hits.push({
        offset: outerStart,
        length: outerEnd - outerStart,
        role: outerRole,
        position: "outer",
    });
    hits.push({ offset: outerEnd, length: 1, role: outerRole, position: "outer" });
    hits.push({
        offset: innerStart,
        length: innerLen,
        role: innerLetter,
        position: "inner",
    });
    hits.push({ offset: innerEnd, length: 1, role: outerRole, position: "outer" });
    return innerEnd + 1;
}

// Suffix per spec/01-dsl.md is `[1-9a-z]`, but the scanner is lenient — it
// also accepts uppercase letters and `0` so a partially-typed `IA` / `A10`
// still gets coloured during live editing; the validator separately rejects
// the invalid form with rule-8.
function scanIdSuffix(text: string, from: number): number {
    let j = from;
    const n = text.length;
    while (j < n) {
        const c = text.charCodeAt(j);
        if (c >= 65 && c <= 90) { j++; continue; }   // A-Z
        if (c >= 97 && c <= 122) { j++; continue; }  // a-z
        if (c >= 48 && c <= 57) { j++; continue; }   // 0-9
        break;
    }
    return j;
}

function isArrowLetter(c: string): boolean {
    return ARROW_LETTERS.has(c);
}

function isWordStart(text: string, i: number): boolean {
    if (i === 0) return true;
    const prev = text.charCodeAt(i - 1);
    const isWord =
        (prev >= 65 && prev <= 90) ||
        (prev >= 97 && prev <= 122) ||
        (prev >= 48 && prev <= 57) ||
        prev === 95;
    return !isWord;
}

function skipString(text: string, start: number): number {
    const n = text.length;
    let i = start + 1;
    while (i < n) {
        const c = text.charAt(i);
        if (c === "\\" && i + 1 < n) {
            i += 2;
            continue;
        }
        if (c === '"') return i + 1;
        if (c === "\n") return i;
        i++;
    }
    return i;
}

function skipLineComment(text: string, start: number): number {
    let i = start;
    const n = text.length;
    while (i < n && text.charAt(i) !== "\n") i++;
    return i;
}
