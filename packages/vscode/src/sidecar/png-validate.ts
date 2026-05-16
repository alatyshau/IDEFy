// Validate-then-decode pipeline for PNG payloads coming from the WebView
// fallback path (`copy-png-fallback`). The WebView sends base64 — а doverять
// ему нельзя: всё в WebView — workspace-controlled и attacker-controlled
// surface (см. UI.md «WebView security»). Гарантии перед записью байтов
// в FS:
//
//   1. Длина base64-строки **до** декодирования не превышает грубую верхнюю
//      оценку для разрешённого размера декодированного PNG. Это защита от
//      попытки allocate'нуть многогигабайтный буфер при decode.
//   2. После decode длина байтов не превышает hard cap.
//   3. Первые 8 байт — каноническая PNG signature `89 50 4E 47 0D 0A 1A 0A`.
//      Без этого мы бы писали любой base64 в произвольный файл на диске
//      пользователя.

export const PNG_SIGNATURE: readonly number[] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
];

export type PngValidationReason =
    | "too-large-base64"
    | "too-large-decoded"
    | "not-png";

export type PngValidationResult =
    | { readonly ok: true; readonly bytes: Uint8Array }
    | { readonly ok: false; readonly reason: PngValidationReason };

export function isPngSignature(bytes: Uint8Array): boolean {
    if (bytes.byteLength < PNG_SIGNATURE.length) return false;
    for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
        if (bytes[i] !== PNG_SIGNATURE[i]) return false;
    }
    return true;
}

export function maxBase64LenFor(maxBytes: number): number {
    // base64 encodes 3 bytes as 4 chars, padded to multiples of 4. The upper
    // bound for `maxBytes` input bytes is `4 * ceil(maxBytes / 3)`. Add a
    // small cushion (8) for any extra padding/whitespace.
    return Math.ceil(maxBytes / 3) * 4 + 8;
}

export function validateAndDecodePng(
    b64: string,
    maxBytes: number,
): PngValidationResult {
    if (b64.length > maxBase64LenFor(maxBytes)) {
        return { ok: false, reason: "too-large-base64" };
    }
    const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
    if (bytes.byteLength > maxBytes) {
        return { ok: false, reason: "too-large-decoded" };
    }
    if (!isPngSignature(bytes)) {
        return { ok: false, reason: "not-png" };
    }
    return { ok: true, bytes };
}
