// One-shot `.gitignore` patcher invoked at activation.
//
// For each workspace folder, ensures `*.idef0.ascii` is listed in
// `<folder>/.gitignore`. Decision logic lives in `gitignore.ts`; this file
// only handles the FS I/O and per-folder iteration.

import * as vscode from "vscode";
import type { FsAdapter } from "@idefy/loader";
import { planGitignoreUpdate } from "./gitignore.js";
import { uriToPath } from "./fs/adapter.js";

export async function ensureGitignoreCoverage(
    fs: FsAdapter,
    output: vscode.OutputChannel,
): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    await Promise.all(
        folders.map((folder) => ensureForFolder(folder, fs, output)),
    );
}

async function ensureForFolder(
    folder: vscode.WorkspaceFolder,
    fs: FsAdapter,
    output: vscode.OutputChannel,
): Promise<void> {
    const gitignorePath = uriToPath(folder.uri) + "/.gitignore";
    let existing: string | null = null;
    try {
        existing = (await fs.exists(gitignorePath))
            ? await fs.readFile(gitignorePath)
            : null;
    } catch (err) {
        output.appendLine(
            `Failed to read ${gitignorePath}: ${formatError(err)}`,
        );
        return;
    }

    const update = planGitignoreUpdate(existing);
    if (update === null) return;

    try {
        await fs.writeFile(gitignorePath, update.content);
        output.appendLine(
            `${update.action === "create" ? "Created" : "Updated"} ${gitignorePath}`,
        );
    } catch (err) {
        output.appendLine(
            `Failed to write ${gitignorePath}: ${formatError(err)}`,
        );
    }
}

function formatError(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
}
