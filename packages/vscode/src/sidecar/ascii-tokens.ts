// Host-side tokeniser for ASCII sidecar content.
//
// The DSL scanners (`arrow-scan.ts`, `activity-scan.ts`) live in extension
// host code; the WebView is a sandboxed browser context. To colour ASCII
// sidecars by role inside the viewer and the PNG export, we run the same
// lexical scan in the host and ship a `(offset, length, role)[]` payload
// to the WebView. WebView then walks the text + tokens to build colored
// DOM spans and to render the canvas with per-segment fillStyle.
//
// Roles use the DSL role letters plus `A` for activity identifiers, matching
// the palette in `IdefyDecorator` (see UI.md §Цветовая палитра DSL).

import { scanActivityIds } from "../providers/activity-scan.js";
import { scanArrowIds } from "../providers/arrow-scan.js";

export type AsciiTokenRole = "I" | "O" | "C" | "M" | "X" | "T" | "A";

export interface AsciiToken {
    readonly offset: number;
    readonly length: number;
    readonly role: AsciiTokenRole;
}

export function computeAsciiTokens(text: string): AsciiToken[] {
    const out: AsciiToken[] = [];
    for (const hit of scanArrowIds(text)) {
        if (hit.role === "I" || hit.role === "O" || hit.role === "C" ||
            hit.role === "M" || hit.role === "X" || hit.role === "T") {
            out.push({ offset: hit.offset, length: hit.length, role: hit.role });
        }
    }
    for (const hit of scanActivityIds(text)) {
        out.push({ offset: hit.offset, length: hit.length, role: "A" });
    }
    out.sort((a, b) => a.offset - b.offset);
    return out;
}
