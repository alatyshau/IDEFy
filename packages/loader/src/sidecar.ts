// Sidecar resolver: `.idef0` ↔ `.idef0.ascii`. The `.idef0.ascii` extension is
// hardcoded here — this is the single source of truth for the suffix.

const SIDECAR_SUFFIX = ".idef0.ascii";
const IDEF0_SUFFIX = ".idef0";

export function sidecarPathFor(idef0Path: string): string {
    return idef0Path + ".ascii";
}

export function isSidecarPath(path: string): boolean {
    return path.endsWith(SIDECAR_SUFFIX);
}

export function idef0PathForSidecar(sidecarPath: string): string | null {
    if (!sidecarPath.endsWith(SIDECAR_SUFFIX)) return null;
    return sidecarPath.substring(
        0,
        sidecarPath.length - SIDECAR_SUFFIX.length
    ) + IDEF0_SUFFIX;
}
