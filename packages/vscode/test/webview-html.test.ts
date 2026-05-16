import { describe, expect, it } from "vitest";
import {
    buildAsciiViewerHtml,
    generateNonce,
} from "../src/sidecar/webview-html.js";

describe("buildAsciiViewerHtml", () => {
    const opts = {
        cspSource: "vscode-resource:",
        nonce: "abc123",
        initialContent: "ASCII",
        initialTokens: [] as const,
    };

    it("emits a CSP meta tag with default-src 'none' and the given nonce", () => {
        const html = buildAsciiViewerHtml(opts);
        expect(html).toContain(`<meta http-equiv="Content-Security-Policy"`);
        expect(html).toContain("default-src 'none'");
        expect(html).toContain("script-src 'nonce-abc123'");
        expect(html).toContain(`style-src ${opts.cspSource} 'unsafe-inline'`);
        expect(html).toContain(`img-src ${opts.cspSource} data:`);
    });

    it("never uses innerHTML or unsafe sinks", () => {
        const html = buildAsciiViewerHtml(opts);
        expect(html).not.toContain("innerHTML");
        expect(html).not.toContain("document.write");
        expect(html).not.toMatch(/\beval\b/);
        expect(html).not.toMatch(/new\s+Function/);
    });

    it("escapes `</` in injected content so it cannot break out of the inline <script>", () => {
        const html = buildAsciiViewerHtml({
            ...opts,
            initialContent: `<script>bad()</script>`,
        });
        // Literal `</script>` from user content must never appear — HTML tokenisation
        // would terminate the inline script on it regardless of JS string quoting.
        expect(html).not.toContain("bad()</script>");
        // The escaped form is what reaches the JS string literal. `<\/` is a no-op
        // for JS string parsing but invisible to HTML's script-end tokeniser.
        expect(html).toContain('"<script>bad()<\\/script>"');
    });

    it("emits exactly one <script>...</script> block (no premature termination)", () => {
        const html = buildAsciiViewerHtml({
            ...opts,
            initialContent: `payload with </script> inside`,
        });
        const openCount = (html.match(/<script\b/g) ?? []).length;
        const closeCount = (html.match(/<\/script>/g) ?? []).length;
        expect(openCount).toBe(1);
        expect(closeCount).toBe(1);
    });

    it("includes both Copy as Text and Copy as PNG toolbar buttons", () => {
        const html = buildAsciiViewerHtml(opts);
        expect(html).toContain("btn-copy-text");
        expect(html).toContain("btn-copy-png");
    });

    it("ships role-X CSS rules for all six arrow roles + activity", () => {
        const html = buildAsciiViewerHtml(opts);
        for (const role of ["I", "O", "C", "M", "X", "T", "A"]) {
            expect(html).toContain(`.role-${role}`);
        }
    });

    it("posts copy-png-* messages via the PNG button click handler", () => {
        const html = buildAsciiViewerHtml(opts);
        expect(html).toContain("copy-png-ok");
        expect(html).toContain("copy-png-fallback");
        expect(html).toContain("copy-png-failed");
    });

    it("renders initialError instead of content when present", () => {
        const html = buildAsciiViewerHtml({
            ...opts,
            initialContent: "ignored",
            initialError: "Read failed: permission denied",
        });
        expect(html).toContain("Read failed: permission denied");
        // The viewer JS branches on __initialError length — both setters exist.
        expect(html).toContain("setError");
        expect(html).toContain("setContent");
    });

    it("listens for `refresh` and `error` messages, not `set-content`", () => {
        const html = buildAsciiViewerHtml(opts);
        expect(html).toContain("msg.kind === 'refresh'");
        expect(html).toContain("msg.kind === 'error'");
        expect(html).not.toContain("set-content");
    });

    it("renders tokens via JSON-encoded array, not interpolation, into the inline script", () => {
        const html = buildAsciiViewerHtml({
            ...opts,
            initialTokens: [
                { offset: 2, length: 2, role: "I" },
                { offset: 5, length: 3, role: "X" },
            ],
        });
        // The literal JSON array string is embedded for the script to parse.
        expect(html).toContain(
            JSON.stringify(
                JSON.stringify([
                    { offset: 2, length: 2, role: "I" },
                    { offset: 5, length: 3, role: "X" },
                ]),
            ),
        );
        // No raw `<role-I>` tag is generated server-side — spans are built
        // by the WebView script through createElement + textContent.
        expect(html).not.toContain("<span class=\"role-I\">");
    });
});

describe("generateNonce", () => {
    it("produces 32-char alphanumeric strings", () => {
        const n = generateNonce();
        expect(n).toMatch(/^[A-Za-z0-9]{32}$/);
    });

    it("produces different values across calls", () => {
        const seen = new Set<string>();
        for (let i = 0; i < 20; i++) seen.add(generateNonce());
        expect(seen.size).toBeGreaterThan(15);
    });
});
