import type {
    ActivityAST,
    ArrowId,
    Diagnostic,
    IdefProject,
    Renderer,
    RenderResult,
} from "../types.js";
import { compareActivityIds, compareArrowKeys } from "../ids.js";

// MVP-заглушка ASCII-рендерера (см. packages/core/spec/RENDERERS.md).
//
// Реальный layout-алгоритм откладывается до Phase 3. До тех пор рендерер
// выдаёт «sidecar-сводку» с настоящими DSL-идентификаторами:
//
//   # IDEFy ASCII placeholder for A1 "Помол зерна"
//     I: I1
//     C: C1
//     M: M1 M2
//     O: O1
//     X: X11
//     children: A11 A12
//
// Это не настоящая ASCII-диаграмма, а минимальный материал для UI-пайплайна:
// @idefy/vscode сканирует текст, оборачивает каждый ID в colored span и так
// проверяется вся цепочка ролевой раскраски — включая PNG-экспорт. Когда
// реальный рендерер появится, контракт `Renderer` не меняется.
export const asciiRenderer: Renderer = {
    id: "ascii",
    render(project: IdefProject): RenderResult {
        const sidecars = new Map<string, string>();
        const diagnostics: Diagnostic[] = [];
        const contextPath = project.context?.file.path;
        for (const [path, file] of project.files) {
            if (path === contextPath) continue;
            if (file.ast === null) continue;
            if (file.ast.kind !== "activity") continue;
            sidecars.set(path, renderActivityPlaceholder(file.ast));
        }
        return { sidecars, diagnostics };
    },
};

function renderActivityPlaceholder(ast: ActivityAST): string {
    const I = new Set<ArrowId>();
    const O = new Set<ArrowId>();
    const C = new Set<ArrowId>();
    const M = new Set<ArrowId>();
    const X = new Set<ArrowId>();
    const T = new Set<ArrowId>();
    const children = new Set<string>();

    for (const b of ast.boundary) {
        addArrow(b.id, { I, O, C, M, X, T });
    }
    for (const block of ast.blocks) {
        children.add(block.id);
        for (const c of block.consumed) {
            if (c.kind === "parent") {
                addArrow(c.id, { I, O, C, M, X, T });
            } else {
                addArrow(c.sourceId, { I, O, C, M, X, T });
            }
        }
        for (const p of block.produced) {
            X.add(p.id);
            if (p.kind === "boundary-out") O.add(p.mappedTo);
            else if (p.kind === "tunnel-out") T.add(p.mappedTo);
        }
    }

    const lines: string[] = [];
    lines.push(`# IDEFy ASCII placeholder for ${ast.id} "${ast.name.value}"`);
    pushRoleLine(lines, "I", I);
    pushRoleLine(lines, "C", C);
    pushRoleLine(lines, "M", M);
    pushRoleLine(lines, "O", O);
    pushRoleLine(lines, "X", X);
    pushRoleLine(lines, "T", T);
    if (children.size > 0) {
        const sorted = [...children].sort(compareActivityIds);
        lines.push(`  children: ${sorted.join(" ")}`);
    }
    return lines.join("\n") + "\n";
}

function addArrow(
    id: ArrowId,
    bins: {
        I: Set<ArrowId>;
        O: Set<ArrowId>;
        C: Set<ArrowId>;
        M: Set<ArrowId>;
        X: Set<ArrowId>;
        T: Set<ArrowId>;
    },
): void {
    const role = id.charAt(0);
    const bin = bins[role as keyof typeof bins];
    if (bin !== undefined) bin.add(id);
}

function pushRoleLine(
    lines: string[],
    label: string,
    ids: Set<ArrowId>,
): void {
    if (ids.size === 0) return;
    const sorted = [...ids].sort(compareArrowKeys);
    lines.push(`  ${label}: ${sorted.join(" ")}`);
}
