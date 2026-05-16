// POSIX-form path utilities used internally by the loader. We don't use
// `node:path` directly because the loader is platform-agnostic — VS Code FS
// adapter normalizes platform separators before paths reach the loader.

// Normalize a path to its canonical POSIX form. Steps:
//   1. Convert backslashes → forward slashes.
//   2. Collapse multiple consecutive slashes.
//   3. Resolve `.` and `..` segments.
//   4. Strip trailing slash (except for the bare `/` root).
//
// For absolute paths, `..` at the root is silently discarded (matches
// `path.posix.normalize` and shell behavior). For relative paths, excess `..`
// segments are preserved at the start.
export function normalize(p: string): string {
    if (p.length === 0) return "";
    const slashed = p.replace(/\\/g, "/");
    const isAbsolute = slashed.startsWith("/");
    const rawSegments = slashed.split("/");
    const out: string[] = [];
    for (const seg of rawSegments) {
        if (seg === "" || seg === ".") continue;
        if (seg === "..") {
            const top = out.length > 0 ? out[out.length - 1] : undefined;
            if (out.length > 0 && top !== "..") {
                out.pop();
            } else if (!isAbsolute) {
                out.push("..");
            }
            // absolute path: `..` at root is dropped
            continue;
        }
        out.push(seg);
    }
    const body = out.join("/");
    if (isAbsolute) return "/" + body;
    return body;
}

export function dirname(p: string): string {
    const norm = normalize(p);
    if (norm === "/" || norm === "") return norm;
    const idx = norm.lastIndexOf("/");
    if (idx < 0) return "";
    if (idx === 0) return "/";
    return norm.substring(0, idx);
}

export function basename(p: string): string {
    const norm = normalize(p);
    if (norm === "/" || norm === "") return "";
    const idx = norm.lastIndexOf("/");
    return idx < 0 ? norm : norm.substring(idx + 1);
}

export function join(...parts: string[]): string {
    const filtered = parts.filter((p) => p.length > 0);
    if (filtered.length === 0) return "";
    // Preserve absolute root from the first part; remove redundant separators
    // between joined parts; let normalize() resolve `.` and `..`.
    const head = filtered[0]!.replace(/\\/g, "/");
    const tail = filtered
        .slice(1)
        .map((p) => p.replace(/\\/g, "/").replace(/^\/+/, ""))
        .filter((p) => p.length > 0);
    const concatenated = [head, ...tail].join("/");
    return normalize(concatenated);
}

// Returns ordered segments of the path (excluding leading empty segment for
// absolute paths). Both `/a/b/c` and `a/b/c` yield ['a', 'b', 'c'].
export function segments(p: string): string[] {
    return normalize(p)
        .split("/")
        .filter((s) => s.length > 0);
}

// Returns true if `child` is `parent` or a descendant. Both args are normalized
// (including `.`/`..` resolution); this remains a string-based check (no FS access).
export function isDescendant(parent: string, child: string): boolean {
    const p = normalize(parent);
    const c = normalize(child);
    if (p === c) return true;
    return c.startsWith(p + "/");
}
