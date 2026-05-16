import { describe, expect, it } from "vitest";
import {
    PNG_SIGNATURE,
    isPngSignature,
    maxBase64LenFor,
    validateAndDecodePng,
} from "../src/sidecar/png-validate.js";

function makeBase64(bytes: number[]): string {
    return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}

describe("png-validate: signature detection", () => {
    it("accepts canonical 8-byte PNG header", () => {
        expect(
            isPngSignature(Uint8Array.from([...PNG_SIGNATURE, 0x00, 0x00])),
        ).toBe(true);
    });

    it("rejects buffer shorter than signature length", () => {
        expect(isPngSignature(Uint8Array.from([0x89, 0x50]))).toBe(false);
    });

    it("rejects buffer with wrong magic bytes", () => {
        expect(
            isPngSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])),
        ).toBe(false);
    });
});

describe("png-validate: validateAndDecodePng", () => {
    const MAX = 1024;

    it("accepts a valid small PNG payload", () => {
        const b64 = makeBase64([...PNG_SIGNATURE, 0x00, 0x00, 0x00]);
        const result = validateAndDecodePng(b64, MAX);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.bytes.byteLength).toBe(PNG_SIGNATURE.length + 3);
        }
    });

    it("rejects payload that exceeds base64 cap BEFORE decoding", () => {
        // Allocate a base64 string much larger than maxBase64LenFor(MAX).
        // The size check must trip before any decoding/buffer allocation.
        const huge = "A".repeat(maxBase64LenFor(MAX) + 10);
        const result = validateAndDecodePng(huge, MAX);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("too-large-base64");
    });

    it("rejects payload whose decoded length exceeds the cap", () => {
        // Use a small MAX so we can craft a base64 that fits the base64 cap
        // (maxBase64LenFor) but after decode exceeds MAX. Pick MAX=8 — base64
        // cap is `ceil(8/3)*4 + 8 = 12+8 = 20`. A 16-char base64 decodes to
        // 12 bytes, exceeds MAX=8.
        const smallMax = 8;
        const b64 = "A".repeat(16); // 16 chars → 12 decoded bytes
        const result = validateAndDecodePng(b64, smallMax);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("too-large-decoded");
    });

    it("rejects payload whose bytes don't start with PNG signature", () => {
        const b64 = makeBase64([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
        const result = validateAndDecodePng(b64, MAX);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("not-png");
    });
});
