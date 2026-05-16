// Sidecar resolver: `.idef0` ↔ `.idef0.ascii`. Это **runtime** source of
// truth для suffix — любой код, которому нужно понять «это sidecar», должен
// идти через `isSidecarPath` / `sidecarPathFor` / `idef0PathForSidecar`,
// либо использовать `SIDECAR_SUFFIX` / `IDEF0_SUFFIX` константы.
//
// **Audited mirrors** — три статических места дублируют литерал
// `.idef0.ascii`, потому что архитектура не позволяет вычислять их в
// runtime:
//   - `packages/vscode/package.json` (`contributes.languages.extensions`
//     и `contributes.customEditors.selector.filenamePattern`) — VS Code
//     ест static JSON, до того как загрузится наш код.
//   - `packages/vscode/src/sidecar/*.ts` — для UX-логики (имя файла, диалоги
//     сохранения). Должны импортировать `SIDECAR_SUFFIX` из этого модуля,
//     не дублировать литерал.
// Любое расхождение между этими местами — баг; CI должен ловить через
// link-test на одинаковое значение.

export const SIDECAR_SUFFIX = ".idef0.ascii";
export const IDEF0_SUFFIX = ".idef0";

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
