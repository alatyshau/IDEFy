// Test-side helper for loading fixture files. Used by every test file in this
// package. Fixtures live under packages/core/test/fixtures/ in a structure that
// mirrors a real IDEF0 workspace (src/idef0/<project>/A0.*.idef0) so that
// scanRoot / projectRoot semantics match production usage.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleProject } from "../src/assembler/assemble.js";
import { parse } from "../src/parser/parse.js";
import type {
    Diagnostic,
    IdefProject,
    ParsedFile,
} from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(__dirname, "fixtures");

export function fixturePath(...segments: string[]): string {
    return path.join(FIXTURES_DIR, ...segments);
}

export function readFixture(...segments: string[]): string {
    return fs.readFileSync(fixturePath(...segments), "utf8");
}

export function parseFixtureFile(...segments: string[]): {
    text: string;
    ast: ParsedFile["ast"];
    errors: readonly Diagnostic[];
    filePath: string;
} {
    const filePath = fixturePath(...segments);
    const text = fs.readFileSync(filePath, "utf8");
    const basename = path.basename(filePath);
    const { ast, errors } = parse(text, { filePath, basename });
    return { text, ast, errors, filePath };
}

// Read all .idef0 files under `dir` recursively into ParsedFile objects.
export function readParsedFiles(dir: string): ParsedFile[] {
    const files: ParsedFile[] = [];
    walk(dir, files);
    return files;
}

function walk(dir: string, files: ParsedFile[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, files);
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".idef0")) {
            const text = fs.readFileSync(full, "utf8");
            const { ast, errors } = parse(text, {
                filePath: full,
                basename: entry.name,
            });
            files.push({ path: full, ast, parseErrors: errors });
        }
    }
}

// Load an entire IDEF0 project from a fixture component
// (e.g. component='validator', projectPath='valid_full/foo' →
// fixtures/validator/src/idef0/valid_full/foo).
export function loadFixtureProject(
    component: string,
    projectPath: string
): {
    project: IdefProject;
    parsedFiles: readonly ParsedFile[];
    scanRoot: string;
    projectRoot: string;
    assemblerErrors: readonly Diagnostic[];
} {
    const scanRoot = path.join(FIXTURES_DIR, component, "src", "idef0");
    const projectRoot = path.join(scanRoot, projectPath);
    const files = readParsedFiles(projectRoot);
    const { project, errors } = assembleProject(files, scanRoot, projectRoot);
    if (!project) {
        throw new Error(
            `loadFixtureProject(${component}, ${projectPath}) returned project=null`
        );
    }
    return {
        project,
        parsedFiles: files,
        scanRoot,
        projectRoot,
        assemblerErrors: errors,
    };
}
