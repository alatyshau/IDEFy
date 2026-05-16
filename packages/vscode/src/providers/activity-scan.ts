// Pure scanner for activity-id occurrences in IDEF0 DSL source text.
//
// Activity IDs in the DSL (see spec/01-dsl.md):
//   - `A0`            — root activity
//   - `A1` … `Az`     — direct children (suffix from `1..9, a..z`; `0` is
//                       reserved for the root)
//   - `A11`, `A1a`, … — recursively deeper levels
//   - `A-0`           — the special context ID
//   - `...A0`         — root reference inside an `A-0` context file
//
// The regex is lenient — it also matches uppercase letters in the suffix so
// a partially-typed `AA` still gets coloured during live editing; the
// validator separately rejects the invalid form with rule-8.
//
// Strings and `#` comments are skipped, matching the arrow-id scanner.

export interface ActivityIdHit {
    readonly offset: number;
    readonly length: number;
}

const ACTIVITY_REF_RE = /\.{3}A(?:0|[1-9A-Za-z]+)\b|\bA-0\b|\bA(?:0|[1-9A-Za-z]+)\b/g;

export function scanActivityIds(text: string): ActivityIdHit[] {
    const hits: ActivityIdHit[] = [];
    const skipRanges = collectSkipRanges(text);
    let skipIdx = 0;

    ACTIVITY_REF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ACTIVITY_REF_RE.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        while (skipIdx < skipRanges.length && skipRanges[skipIdx]!.end <= start) {
            skipIdx++;
        }
        if (skipIdx < skipRanges.length && skipRanges[skipIdx]!.start < end) {
            continue;
        }
        hits.push({ offset: start, length: match[0].length });
    }
    return hits;
}

interface SkipRange {
    readonly start: number;
    readonly end: number;
}

function collectSkipRanges(text: string): SkipRange[] {
    const ranges: SkipRange[] = [];
    let i = 0;
    const n = text.length;
    while (i < n) {
        const ch = text.charAt(i);
        if (ch === '"') {
            const start = i;
            i++;
            while (i < n) {
                const c = text.charAt(i);
                if (c === "\\" && i + 1 < n) {
                    i += 2;
                    continue;
                }
                if (c === '"') {
                    i++;
                    break;
                }
                if (c === "\n") break;
                i++;
            }
            ranges.push({ start, end: i });
        } else if (ch === "#") {
            const start = i;
            while (i < n && text.charAt(i) !== "\n") i++;
            ranges.push({ start, end: i });
        } else {
            i++;
        }
    }
    return ranges;
}
