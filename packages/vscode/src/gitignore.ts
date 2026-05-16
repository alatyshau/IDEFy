// Pure-logic patcher for `.gitignore` files. Decides whether the workspace
// folder's `.gitignore` already covers `*.idef0.ascii` sidecars; if not,
// returns the new content to write. Wire-up to vscode.workspace.fs lives
// in the activation code; this module is FS-agnostic so it stays testable.
//
// See packages/vscode/spec/COMPONENT.md §Gitignore auto-entry.

const TARGET_EXTENSION = "idef0.ascii";
const CANONICAL_ENTRY = `*.${TARGET_EXTENSION}`;

export interface GitignoreUpdate {
    readonly action: "create" | "append";
    readonly content: string;
}

export function planGitignoreUpdate(
    existingContent: string | null,
): GitignoreUpdate | null {
    if (existingContent === null) {
        return {
            action: "create",
            content: CANONICAL_ENTRY + "\n",
        };
    }
    if (gitignoreCovers(existingContent, TARGET_EXTENSION)) {
        return null;
    }
    const needsNewline = existingContent.length > 0 && !existingContent.endsWith("\n");
    return {
        action: "append",
        content: existingContent + (needsNewline ? "\n" : "") + CANONICAL_ENTRY + "\n",
    };
}

function gitignoreCovers(content: string, targetExtension: string): boolean {
    for (const raw of content.split(/\r?\n/)) {
        const line = stripComment(raw).trim();
        if (line.length === 0) continue;
        if (lineMatchesExtension(line, targetExtension)) return true;
    }
    return false;
}

function stripComment(line: string): string {
    const hash = line.indexOf("#");
    return hash >= 0 ? line.slice(0, hash) : line;
}

function lineMatchesExtension(line: string, ext: string): boolean {
    let pattern = line;
    if (pattern.startsWith("!")) return false;
    if (pattern.endsWith("/")) return false;
    if (pattern.startsWith("/")) pattern = pattern.slice(1);
    if (pattern.startsWith("**/")) pattern = pattern.slice(3);

    if (pattern.startsWith("*.")) {
        const patternExt = pattern.slice(2);
        if (ext === patternExt) return true;
        if (ext.endsWith("." + patternExt)) return true;
    }

    return false;
}
