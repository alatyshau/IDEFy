import type { FsAdapter } from "./types.js";
import { dirname, normalize, segments } from "./paths.js";

// Lazy walk-up from `filePath` looking for the nearest ancestor whose last two
// path segments are `src/idef0`. Candidates are verified via `fs.exists()` —
// purely lexical matches against non-existent paths return null.
//
// `filePath` may itself BE the scan-root directory; we check it first, then
// walk up its dirname. For file inputs the check on `filePath` itself
// short-circuits to false (the file's basename is not "idef0") and we proceed
// with the walk from `dirname(filePath)`.
export async function findScanRoot(
    filePath: string,
    fs: FsAdapter
): Promise<string | null> {
    const norm = normalize(filePath);
    if (norm.length === 0) return null;

    if (looksLikeScanRoot(norm) && (await fs.exists(norm))) {
        return norm;
    }

    let dir = dirname(norm);
    while (dir.length > 0 && dir !== "/") {
        if (looksLikeScanRoot(dir) && (await fs.exists(dir))) {
            return dir;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function looksLikeScanRoot(p: string): boolean {
    const segs = segments(p);
    return (
        segs.length >= 2 &&
        segs[segs.length - 1] === "idef0" &&
        segs[segs.length - 2] === "src"
    );
}
