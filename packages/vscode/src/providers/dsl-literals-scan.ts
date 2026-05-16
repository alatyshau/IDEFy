// Single-pass scanner for DSL literals, keywords and punctuation.
//
// Replaces the older `punctuation-scan.ts` and supplements the ID scanners
// (arrow-scan.ts, activity-scan.ts) with everything else the decorator needs
// to colour: strings, `#` comments, `activity` / `context` keywords, braces
// `{` `}`, the list operators `:` / `->`, and commas.
//
// One linear pass guarantees consistent string/comment skipping across all
// these kinds and avoids three separate scanners doing the same work.

export type LiteralKind =
    | "string"
    | "comment"
    | "keyword"
    | "brace"
    | "operator"
    | "comma";

export interface LiteralRegion {
    readonly kind: LiteralKind;
    readonly offset: number;
    readonly length: number;
}

const KEYWORDS = new Set(["activity", "context"]);

export function scanLiterals(text: string): LiteralRegion[] {
    const out: LiteralRegion[] = [];
    const n = text.length;
    let i = 0;

    while (i < n) {
        const ch = text.charAt(i);

        if (ch === '"') {
            const start = i;
            i = skipString(text, i);
            out.push({ kind: "string", offset: start, length: i - start });
            continue;
        }

        if (ch === "#") {
            const start = i;
            i = skipLineComment(text, i);
            out.push({ kind: "comment", offset: start, length: i - start });
            continue;
        }

        if (ch === "{" || ch === "}") {
            out.push({ kind: "brace", offset: i, length: 1 });
            i++;
            continue;
        }

        if (ch === ":") {
            out.push({ kind: "operator", offset: i, length: 1 });
            i++;
            continue;
        }

        if (ch === "-" && i + 1 < n && text.charAt(i + 1) === ">") {
            out.push({ kind: "operator", offset: i, length: 2 });
            i += 2;
            continue;
        }

        if (ch === ",") {
            out.push({ kind: "comma", offset: i, length: 1 });
            i++;
            continue;
        }

        if ((ch === "a" || ch === "c") && isWordStart(text, i)) {
            const end = scanIdentifier(text, i);
            const word = text.slice(i, end);
            if (KEYWORDS.has(word)) {
                out.push({ kind: "keyword", offset: i, length: end - i });
                i = end;
                continue;
            }
            i = end > i ? end : i + 1;
            continue;
        }

        i++;
    }

    return out;
}

export function scanCommas(text: string): LiteralRegion[] {
    return scanLiterals(text).filter((r) => r.kind === "comma");
}

function scanIdentifier(text: string, from: number): number {
    let j = from;
    const n = text.length;
    while (j < n) {
        const c = text.charCodeAt(j);
        const isWord =
            (c >= 65 && c <= 90) ||
            (c >= 97 && c <= 122) ||
            (c >= 48 && c <= 57) ||
            c === 95;
        if (!isWord) break;
        j++;
    }
    return j;
}

function isWordStart(text: string, i: number): boolean {
    if (i === 0) return true;
    const c = text.charCodeAt(i - 1);
    const isWord =
        (c >= 65 && c <= 90) ||
        (c >= 97 && c <= 122) ||
        (c >= 48 && c <= 57) ||
        c === 95;
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
