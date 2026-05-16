import type { ProjectDescriptor } from "./types.js";
import { isDescendant, normalize } from "./paths.js";

// True iff `idef0Path` lies under `scanRoot` but is not contained in any of the
// supplied projects' roots. Pure path-string logic, no FS access.
export function isOrphan(
    idef0Path: string,
    scanRoot: string,
    projects: readonly ProjectDescriptor[]
): boolean {
    const path = normalize(idef0Path);
    if (!isDescendant(normalize(scanRoot), path)) return false;
    for (const p of projects) {
        if (isDescendant(normalize(p.projectRoot), path)) return false;
    }
    return true;
}
