// Public types of @idefy/loader.
//
// All paths are opaque strings (POSIX-form `/` separator internally). The
// FsAdapter normalizes platform-specific separators before passing through.
// See packages/loader/spec/COMPONENT.md.

export interface DirectoryEntry {
    readonly name: string;
    readonly kind: "file" | "directory";
}

export interface FsAdapter {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    deleteFile(path: string): Promise<void>;
    renameFile(from: string, to: string): Promise<void>;
    listDirectory(path: string): Promise<readonly DirectoryEntry[]>;
    exists(path: string): Promise<boolean>;
    /**
     * Adapter-owned check for "path does not exist" — every FS adapter throws
     * not-found in its own dialect (Node `ENOENT`, VS Code `FileNotFound`,
     * remote FS proxies with custom codes). Loader consults this method to
     * decide whether to translate the error to a no-op (`null`/empty result)
     * or propagate. If not provided, loader falls back to its built-in
     * Node-style ENOENT heuristic.
     */
    isNotFound?(err: unknown): boolean;
}

export interface ProjectDescriptor {
    readonly name: string;
    readonly scanRoot: string;
    readonly projectRoot: string;
    readonly files: readonly string[];
}

// Structural conflict surfaced by discovery: a project's `A0.*.idef0` marker
// lies inside another project's tree. Loader only reports the structural data;
// it does NOT classify this as a Diagnostic (loader stays out of semantics).
// Caller (validator or UI) wraps these markers into rule-15 diagnostics.
export interface NestedProjectMarker {
    /** Outer project's root (the project that contains the nested marker). */
    readonly outerProjectRoot: string;
    /** Inner project's root (the directory holding the nested A0.*.idef0). */
    readonly innerProjectRoot: string;
    /** Full path to the nested A0.*.idef0 file itself. */
    readonly innerMarkerPath: string;
}

export interface DiscoveryResult {
    readonly projects: readonly ProjectDescriptor[];
    readonly orphans: readonly string[];
    /**
     * Pairs of (outer, inner) project roots where the inner project's root is
     * a strict descendant of the outer's. Loader surfaces this structural
     * conflict so callers (validator or UI) can construct rule-15 diagnostics.
     * Empty when no nested markers exist.
     */
    readonly nestedProjects: readonly NestedProjectMarker[];
}
