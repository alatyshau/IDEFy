import { describe, expect, it, vi } from "vitest";
import { generateNonce } from "../src/sidecar/webview-html.js";

describe("generateNonce: CSP nonce contract", () => {
    it("returns a non-empty string of expected length and charset", () => {
        const nonce = generateNonce();
        expect(nonce.length).toBeGreaterThanOrEqual(16);
        expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("two calls produce different values (basic non-determinism)", () => {
        const a = generateNonce();
        const b = generateNonce();
        expect(a).not.toBe(b);
    });

    it("does NOT use Math.random (must be cryptographically strong)", () => {
        // REGRESSION: previous implementation used `Math.random()` which is
        // not suitable for security tokens. CSP nonces must come from a CSPRNG
        // (node:crypto.randomBytes / Web Crypto API).
        const spy = vi.spyOn(Math, "random");
        try {
            const nonce = generateNonce();
            expect(nonce.length).toBeGreaterThan(0);
            expect(spy).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });
});
