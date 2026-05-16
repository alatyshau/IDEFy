export type {
    DirectoryEntry,
    DiscoveryResult,
    FsAdapter,
    ProjectDescriptor,
} from "./types.js";

export { findScanRoot } from "./scan-root.js";
export { discoverProjects, listProjectFiles } from "./project-discovery.js";
export {
    sidecarPathFor,
    isSidecarPath,
    idef0PathForSidecar,
} from "./sidecar.js";
export { isOrphan } from "./orphan.js";
export { createNodeFsAdapter } from "./node-fs-adapter.js";
