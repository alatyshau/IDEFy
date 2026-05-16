import type { SourceLocation, SourcePosition, SourceRange } from "../types.js";

// Character stream с трекингом 1-based line/column по codepoint'ам.
// Используем codepoint count, не UTF-16 code unit count.
export class CharStream {
    private readonly text: string;
    private readonly file: string;
    private idx = 0; // UTF-16 indexing into `text`
    private line = 1;
    private col = 1;

    constructor(text: string, file: string) {
        this.text = text;
        this.file = file;
    }

    get filePath(): string {
        return this.file;
    }

    get position(): SourcePosition {
        return { line: this.line, column: this.col };
    }

    isAtEnd(): boolean {
        return this.idx >= this.text.length;
    }

    // Peek at the codepoint at current position (returns string of length 1 or 2 in UTF-16).
    peek(): string | null {
        return this.peekCodepointAt(this.idx);
    }

    peekAhead(skipChars: number): string | null {
        // skipChars — number of codepoints to skip ahead.
        let i = this.idx;
        for (let n = 0; n < skipChars; n += 1) {
            if (i >= this.text.length) return null;
            const code = this.text.codePointAt(i);
            if (code === undefined) return null;
            i += code > 0xffff ? 2 : 1;
        }
        return this.peekCodepointAt(i);
    }

    private peekCodepointAt(i: number): string | null {
        if (i >= this.text.length) return null;
        const code = this.text.codePointAt(i);
        if (code === undefined) return null;
        return String.fromCodePoint(code);
    }

    // Read and advance one codepoint. Updates line/column.
    next(): string | null {
        if (this.idx >= this.text.length) return null;
        const code = this.text.codePointAt(this.idx);
        if (code === undefined) return null;
        const char = String.fromCodePoint(code);
        this.idx += code > 0xffff ? 2 : 1;
        if (char === "\n") {
            this.line += 1;
            this.col = 1;
        } else if (char === "\r") {
            // CRLF: don't advance line here; the following \n will.
            // Lone \r treated as line break.
            const peeked = this.peekCodepointAt(this.idx);
            if (peeked !== "\n") {
                this.line += 1;
                this.col = 1;
            }
        } else {
            this.col += 1;
        }
        return char;
    }

    // Returns SourceLocation from `start` to current position (end is exclusive).
    locationFrom(start: SourcePosition): SourceLocation {
        const range: SourceRange = { start, end: this.position };
        return { file: this.file, range };
    }

    // Returns a source location spanning a single position (start == end).
    locationAt(pos: SourcePosition): SourceLocation {
        return { file: this.file, range: { start: pos, end: pos } };
    }

    // Returns a source location spanning the next single codepoint from current position.
    locationOfCurrent(): SourceLocation {
        const start = this.position;
        // compute end without advancing
        const code = this.text.codePointAt(this.idx);
        if (code === undefined) {
            return this.locationAt(start);
        }
        const endCol = start.column + 1;
        const end: SourcePosition = { line: start.line, column: endCol };
        return { file: this.file, range: { start, end } };
    }
}
