import type {
    ActivityId,
    ActivityNode,
    ArrowId,
    AssembleResult,
    ContextNode,
    Diagnostic,
    FunctionalBlock,
    IdefProject,
    ParsedFile,
    ProjectFile,
    TunnelDecl,
} from "../types.js";
import { parentActivityId } from "../ids.js";

interface NodeBuilder {
    id: ActivityId;
    file: ProjectFile;
    parent: NodeBuilder | null;
    children: Map<ActivityId, NodeBuilder>;
    blockInParent: FunctionalBlock | null;
}

export function assembleProject(
    files: readonly ParsedFile[],
    scanRoot: string,
    projectRoot: string
): AssembleResult {
    const errors: Diagnostic[] = [];
    const projectFiles = new Map<string, ProjectFile>();
    const activityBuilders = new Map<ActivityId, NodeBuilder>();
    let contextNode: ContextNode | null = null;

    const projectName = computeProjectName(scanRoot, projectRoot);

    for (const file of files) {
        const pf: ProjectFile = {
            path: file.path,
            ast: file.ast,
            parseErrors: file.parseErrors,
        };
        projectFiles.set(file.path, pf);
        const ast = file.ast;
        if (!ast) continue;
        if (ast.kind === "context") {
            if (contextNode === null) {
                const tunnels = new Map<ArrowId, TunnelDecl>();
                for (const t of ast.tunnels) tunnels.set(t.id, t);
                contextNode = {
                    file: pf,
                    tunnels,
                    rootRef: ast.rootRef,
                };
            } else {
                errors.push({
                    severity: "error",
                    source: "assembler",
                    range: ast.location.range,
                    file: file.path,
                    message: `Multiple A-0 context files in project '${projectName}'`,
                });
            }
            continue;
        }
        const existing = activityBuilders.get(ast.id);
        if (existing) {
            errors.push({
                severity: "error",
                source: "assembler",
                range: ast.location.range,
                file: file.path,
                message: `Duplicate activity ID '${ast.id}' in project '${projectName}' (also defined in '${existing.file.path}')`,
            });
            continue;
        }
        activityBuilders.set(ast.id, {
            id: ast.id,
            file: pf,
            parent: null,
            children: new Map(),
            blockInParent: null,
        });
    }

    // Wire parent ↔ child by id derivation.
    for (const builder of activityBuilders.values()) {
        const pid = parentActivityId(builder.id);
        if (pid === null) continue;
        const parent = activityBuilders.get(pid);
        if (parent) {
            builder.parent = parent;
            parent.children.set(builder.id, builder);
            const parentAst = parent.file.ast;
            if (parentAst && parentAst.kind === "activity") {
                builder.blockInParent =
                    parentAst.blocks.find((b) => b.id === builder.id) ?? null;
            }
        }
    }

    const activities = new Map<ActivityId, ActivityNode>();
    for (const builder of activityBuilders.values()) {
        // TypeScript can't express this recursive readonly graph cleanly; the cast is safe
        // because mutations stop here (builders are no longer used after assembly).
        activities.set(builder.id, builder as unknown as ActivityNode);
    }

    if (files.length === 0) {
        return { project: null, errors };
    }

    const project: IdefProject = {
        name: projectName,
        scanRoot,
        projectRoot,
        files: projectFiles,
        activities,
        context: contextNode,
        diagnostics: errors,
    };
    return { project, errors };
}

function normalizeSlashes(s: string): string {
    return s.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function computeProjectName(scanRoot: string, projectRoot: string): string {
    const root = normalizeSlashes(scanRoot);
    const proj = normalizeSlashes(projectRoot);
    let rel: string;
    if (proj === root) {
        rel = "";
    } else if (proj.startsWith(root + "/")) {
        rel = proj.substring(root.length + 1);
    } else {
        // Fallback — projectRoot doesn't begin with scanRoot; return whole projectRoot
        // path-joined-with-dots. Validator will flag rule 13/14 via path checks.
        rel = proj;
    }
    return rel
        .split("/")
        .filter((s) => s.length > 0)
        .join(".");
}
