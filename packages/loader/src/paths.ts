// POSIX-form path utilities used internally by the loader. We don't use
// `node:path` directly because the loader is platform-agnostic — VS Code FS
// adapter normalizes platform separators before paths reach the loader.
//
// **URI awareness.** A path may be a plain POSIX path (`/foo/bar`) или
// a full URI (`vscode-remote://wsl/home/foo/A0.idef0`, `file:///x/y`,
// `vscode-vfs://github/user/repo/x`). Все операции прозрачно сохраняют
// `<scheme>://<authority>` префикс — нормализуется/делится/соединяется
// только path-часть (от первого `/` после authority). Это нужно чтобы
// FS adapter мог опционально передавать loader'у opaque-URI-строки без
// потери identity на путевых операциях.

interface UriSplit {
    readonly prefix: string; // either "" or "<scheme>://<authority>"
    readonly pathPart: string; // path portion, may be empty or start with "/"
}

// Detect a URI prefix `<scheme>://<authority>`. The scheme is a valid RFC
// 3986 token, authority may be empty (e.g., `file://` followed by `/`).
const URI_PREFIX_RE = /^([a-z][a-z0-9+.\-]*:\/\/[^/]*)(.*)$/i;

function splitUri(p: string): UriSplit {
    const m = URI_PREFIX_RE.exec(p);
    if (m === null) return { prefix: "", pathPart: p };
    return { prefix: m[1]!, pathPart: m[2] ?? "" };
}

// Normalize a path to its canonical POSIX form. Steps:
//   1. Convert backslashes → forward slashes (path part only).
//   2. Collapse multiple consecutive slashes.
//   3. Resolve `.` and `..` segments.
//   4. Strip trailing slash (except for the bare `/` root).
//
// For absolute paths, `..` at the root is silently discarded (matches
// `path.posix.normalize` and shell behavior). For relative paths, excess `..`
// segments are preserved at the start. URI prefix passes through untouched.
export function normalize(p: string): string {
    if (p.length === 0) return "";
    const { prefix, pathPart } = splitUri(p);
    // A URI's path portion is always treated as absolute (the URI host owns
    // the root), even when the part after `//<authority>` is empty.
    const slashed = pathPart.replace(/\\/g, "/");
    const isAbsolute = prefix !== "" ? true : slashed.startsWith("/");
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
    if (isAbsolute) return prefix + "/" + body;
    return prefix + body;
}

export function dirname(p: string): string {
    const norm = normalize(p);
    const { prefix, pathPart } = splitUri(norm);
    if (pathPart === "/" || pathPart === "") return norm;
    const idx = pathPart.lastIndexOf("/");
    if (idx < 0) return prefix; // pathPart had no slash (e.g. plain relative)
    if (idx === 0) return prefix + "/"; // parent is the URI root
    return prefix + pathPart.substring(0, idx);
}

export function basename(p: string): string {
    const norm = normalize(p);
    const { pathPart } = splitUri(norm);
    if (pathPart === "/" || pathPart === "") return "";
    const idx = pathPart.lastIndexOf("/");
    return idx < 0 ? pathPart : pathPart.substring(idx + 1);
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
// absolute paths). Both `/a/b/c` and `a/b/c` yield ['a', 'b', 'c']. URI
// prefix is stripped from segments — they are pure path tokens.
export function segments(p: string): string[] {
    const { pathPart } = splitUri(normalize(p));
    return pathPart.split("/").filter((s) => s.length > 0);
}

// Returns true if `child` is `parent` or a descendant. Both args are normalized
// (including `.`/`..` resolution); this remains a string-based check (no FS access).
// Across different URI scheme/authority pairs always returns false (even if
// path portions match) — they're addresses on different file systems.
export function isDescendant(parent: string, child: string): boolean {
    const p = normalize(parent);
    const c = normalize(child);
    if (p === c) return true;
    return c.startsWith(p + "/");
}
