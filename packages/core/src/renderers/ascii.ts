import type {
    Diagnostic,
    IdefProject,
    Renderer,
    RenderResult,
} from "../types.js";

// Заглушка ASCII-рендерера (см. packages/core/spec/RENDERERS.md).
// Для каждого .idef0 файла кроме A-0 возвращает строку "ASCII\n".
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
            sidecars.set(path, "ASCII\n");
        }
        return { sidecars, diagnostics };
    },
};
