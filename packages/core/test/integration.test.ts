// Интеграционный тест: прогоняет showcase-проект через всю цепочку инструментов
// (parser → assembler → validator → formatter → renderer). На каждом запуске:
//
// 1. Читает `packages/samples/src/idef0/showcase/pizzeria/raw/` — source-of-truth.
// 2. Чистит `packages/samples/src/idef0/showcase/pizzeria/formatted/` (если есть).
// 3. Форматирует каждый файл raw и пишет в formatted/.
// 4. Перепарсивает и валидирует formatted/ — должен быть валиден так же, как raw.
// 5. Round-trip stability: format(parse(format(raw))) === format(raw).
//
// formatted/ под .gitignore — это автогенерированный артефакт, не source-of-truth.
// Открыв обе папки рядом, можно глазами увидеть «до» и «после» форматирования.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { assembleProject } from "../src/assembler/assemble.js";
import { format } from "../src/formatter/format.js";
import { parse } from "../src/parser/parse.js";
import { asciiRenderer } from "../src/renderers/ascii.js";
import { validate } from "../src/validator/validate.js";
import type { ParsedFile } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SAMPLES_SCAN_ROOT = path.join(
    __dirname,
    "..",
    "..",
    "samples",
    "src",
    "idef0",
);

const PIZZERIA_ROOT = path.join(
    SAMPLES_SCAN_ROOT,
    "showcase",
    "pizzeria",
);
const RAW_ROOT = path.join(PIZZERIA_ROOT, "raw");
const FORMATTED_ROOT = path.join(PIZZERIA_ROOT, "formatted");

const FORMAT_OPTIONS = { maxLineWidth: 120 } as const;

function listIdef0Files(root: string): string[] {
    const out: string[] = [];
    function walk(dir: string): void {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && entry.name.endsWith(".idef0")) {
                out.push(full);
            }
        }
    }
    walk(root);
    return out;
}

function loadProject(root: string): {
    files: ParsedFile[];
    project: ReturnType<typeof assembleProject>["project"];
    assemblerErrors: ReturnType<typeof assembleProject>["errors"];
} {
    const files: ParsedFile[] = [];
    for (const full of listIdef0Files(root)) {
        const text = fs.readFileSync(full, "utf8");
        const basename = path.basename(full);
        const { ast, errors } = parse(text, { filePath: full, basename });
        files.push({ path: full, ast, parseErrors: errors });
    }
    const { project, errors } = assembleProject(
        files,
        SAMPLES_SCAN_ROOT,
        root,
    );
    return { files, project, assemblerErrors: errors };
}

function rmrf(dir: string): void {
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
}

describe("integration: showcase/pizzeria — raw → format → formatted (E2E)", () => {
    it("raw project parses, assembles, and validates cleanly", () => {
        const { files, project, assemblerErrors } = loadProject(RAW_ROOT);

        // Parser: each file produces an AST with no parse errors.
        expect(files.length).toBeGreaterThan(0);
        for (const f of files) {
            expect(f.ast, `parse failed for ${f.path}`).not.toBeNull();
            expect(
                f.parseErrors,
                `parse errors in ${f.path}: ${f.parseErrors
                    .map((e) => e.message)
                    .join("; ")}`,
            ).toEqual([]);
        }

        // Assembler: project assembled with no errors.
        expect(project).not.toBeNull();
        expect(assemblerErrors).toEqual([]);

        if (!project) throw new Error("project is null");

        // Validator: no error-severity diagnostics. (Warnings allowed.)
        const diags = validate(project);
        const errors = diags.filter((d) => d.severity === "error");
        if (errors.length > 0) {
            console.log(
                "raw validate errors:\n" +
                    errors
                        .map((d) => `  ${d.ruleId}: ${d.message}`)
                        .join("\n"),
            );
        }
        expect(errors).toEqual([]);

        // Renderer: produces a sidecar per activity file.
        const rendered = asciiRenderer.render(project);
        expect(rendered.sidecars.size).toBeGreaterThan(0);
        for (const f of files) {
            const isContext = f.ast?.kind === "context";
            if (isContext) continue;
            expect(
                rendered.sidecars.has(f.path),
                `no sidecar for ${f.path}`,
            ).toBe(true);
        }
    });

    it("formatter rewrites raw → formatted/ and stays idempotent under round-trip", () => {
        // Clean the formatted output directory so every run is reproducible.
        rmrf(FORMATTED_ROOT);

        const { files } = loadProject(RAW_ROOT);
        for (const f of files) {
            if (!f.ast) throw new Error(`raw file failed to parse: ${f.path}`);
            const formattedText = format(f.ast, FORMAT_OPTIONS);

            // Mirror the relative path from raw/ into formatted/.
            const rel = path.relative(RAW_ROOT, f.path);
            const outPath = path.join(FORMATTED_ROOT, rel);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, formattedText, "utf8");

            // Round-trip stability: parse the formatter's output and format
            // again — the second pass must produce byte-identical text.
            const basename = path.basename(outPath);
            const reparsed = parse(formattedText, {
                filePath: outPath,
                basename,
            });
            expect(
                reparsed.errors,
                `reparse failed for ${outPath}: ${reparsed.errors
                    .map((e) => e.message)
                    .join("; ")}`,
            ).toEqual([]);
            if (!reparsed.ast) throw new Error("reparse returned null AST");
            const formattedTwice = format(reparsed.ast, FORMAT_OPTIONS);
            expect(formattedTwice).toBe(formattedText);
        }
    });

    it("formatted project parses, assembles, and validates as cleanly as raw", () => {
        // Depends on the previous test having written files into formatted/.
        // Vitest runs `it` blocks sequentially within a describe by default —
        // safe ordering here.
        const { files, project, assemblerErrors } = loadProject(FORMATTED_ROOT);

        expect(files.length).toBeGreaterThan(0);
        for (const f of files) {
            expect(f.ast, `parse failed for ${f.path}`).not.toBeNull();
            expect(f.parseErrors).toEqual([]);
        }

        expect(project).not.toBeNull();
        expect(assemblerErrors).toEqual([]);

        if (!project) throw new Error("project is null");

        const diags = validate(project);
        const errors = diags.filter((d) => d.severity === "error");
        if (errors.length > 0) {
            console.log(
                "formatted validate errors:\n" +
                    errors
                        .map((d) => `  ${d.ruleId}: ${d.message}`)
                        .join("\n"),
            );
        }
        expect(errors).toEqual([]);
    });
});
