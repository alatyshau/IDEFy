import type {
    DirectoryEntry,
    DiscoveryResult,
    FsAdapter,
    NestedProjectMarker,
    ProjectDescriptor,
} from "./types.js";
import { basename, dirname, isDescendant, join, normalize } from "./paths.js";
import { IDEF0_SUFFIX, SIDECAR_SUFFIX } from "./sidecar.js";

// Recognize an A0.*.idef0 marker file by name. Per spec/01-dsl.md filename
// convention: ID is everything up to the first dot; rest before `.idef0` is
// optional cosmetic. So we split by '.' and check that the first segment is
// exactly 'A0' and the last is 'idef0'.
function isA0MarkerFilename(name: string): boolean {
    if (!name.endsWith(IDEF0_SUFFIX)) return false;
    const firstDot = name.indexOf(".");
    if (firstDot < 0) return false;
    return name.substring(0, firstDot) === "A0";
}

function isIdef0Filename(name: string): boolean {
    // `.idef0.ascii` sidecars are not idef0 source files.
    if (name.endsWith(SIDECAR_SUFFIX)) return false;
    return name.endsWith(IDEF0_SUFFIX);
}

// Per packages/loader/spec/COMPONENT.md Errors section: missing path → empty
// result (no propagation); permission/catastrophic → propagate as Error.
function isNotFoundError(err: unknown): boolean {
    return (
        !!err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: unknown }).code === "ENOENT"
    );
}

// Recursively collect all `.idef0` source files under `root`. Returns POSIX-form
// full paths (with `root` as prefix), sorted lexicographically for determinism.
export async function listProjectFiles(
    projectRoot: string,
    fs: FsAdapter
): Promise<string[]> {
    const collected: string[] = [];
    await walkIdef0(normalize(projectRoot), fs, collected);
    collected.sort();
    return collected;
}

async function walkIdef0(
    dir: string,
    fs: FsAdapter,
    out: string[]
): Promise<void> {
    let entries: readonly DirectoryEntry[];
    try {
        entries = await fs.listDirectory(dir);
    } catch (err: unknown) {
        // Missing directory → empty result. Permission/catastrophic →
        // propagate per spec, so the UI layer can surface it.
        if (isNotFoundError(err)) return;
        throw err;
    }
    for (const e of entries) {
        const full = join(dir, e.name);
        if (e.kind === "directory") {
            await walkIdef0(full, fs, out);
        } else if (e.kind === "file" && isIdef0Filename(e.name)) {
            out.push(full);
        }
    }
}

// Compute project name per spec/03-layout.md: scanRoot → projectRoot suffix
// with `/` replaced by `.`. Empty when projectRoot === scanRoot (rule 14 case).
function computeProjectName(scanRoot: string, projectRoot: string): string {
    const root = normalize(scanRoot);
    const proj = normalize(projectRoot);
    if (proj === root) return "";
    if (!proj.startsWith(root + "/")) return proj;
    return proj
        .substring(root.length + 1)
        .split("/")
        .filter((s) => s.length > 0)
        .join(".");
}

// Pair off (outer, inner) projects where the inner project's root is a strict
// descendant of the outer's. This is the structural surface of rule 15 (nested
// projects). Loader emits the data; caller wraps as Diagnostic.
function detectNestedProjects(
    projects: readonly ProjectDescriptor[]
): NestedProjectMarker[] {
    const out: NestedProjectMarker[] = [];
    for (const inner of projects) {
        for (const outer of projects) {
            if (outer === inner) continue;
            if (outer.projectRoot === inner.projectRoot) continue;
            if (isDescendant(outer.projectRoot, inner.projectRoot)) {
                // The nested marker file is whichever A0 lives directly in inner.projectRoot.
                const innerMarker =
                    inner.files.find(
                        (f) =>
                            dirname(f) === inner.projectRoot &&
                            isA0MarkerFilename(basename(f))
                    ) ?? "";
                out.push({
                    outerProjectRoot: outer.projectRoot,
                    innerProjectRoot: inner.projectRoot,
                    innerMarkerPath: innerMarker,
                });
            }
        }
    }
    return out;
}

export async function discoverProjects(
    scanRoot: string,
    fs: FsAdapter
): Promise<DiscoveryResult> {
    const root = normalize(scanRoot);
    const allFiles: string[] = [];
    await walkIdef0(root, fs, allFiles);
    allFiles.sort();

    // Identify A0 markers — one project per marker.
    const markerPaths: string[] = [];
    for (const f of allFiles) {
        if (isA0MarkerFilename(basename(f))) markerPaths.push(f);
    }

    // For each marker, projectRoot is its containing directory. Files of the
    // project are all `.idef0` files under that directory.
    //
    // Nested A0 markers are NOT filtered out — each yields its own
    // ProjectDescriptor, and the structural conflict is reported via
    // nestedProjects so caller can construct rule-15 diagnostics.
    const projects: ProjectDescriptor[] = [];
    for (const marker of markerPaths) {
        const projectRoot = dirname(marker);
        const files = allFiles.filter((f) => isDescendant(projectRoot, f));
        projects.push({
            name: computeProjectName(root, projectRoot),
            scanRoot: root,
            projectRoot,
            files,
        });
    }

    // Orphans: .idef0 files not under any project's root. A0 markers themselves
    // are always covered by their own project, so they're never orphans.
    const orphans: string[] = [];
    for (const f of allFiles) {
        const inProject = projects.some((p) => isDescendant(p.projectRoot, f));
        if (!inProject) orphans.push(f);
    }

    const nestedProjects = detectNestedProjects(projects);

    return { projects, orphans, nestedProjects };
}
