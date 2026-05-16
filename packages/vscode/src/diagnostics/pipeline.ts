// Live-validation pipeline.
//
// Orchestrates the steps from packages/vscode/spec/COMPONENT.md §Live-валидация:
//   parse → findScanRoot → discoverProjects → assembleProject → validate →
//   validateOrphans → publish diagnostics → update context keys.
//
// Debouncing is per-document at 500ms (see also debounce.ts). Caching is
// per-file ParsedFile keyed by URI string, invalidated on document/file change.
//
// Diagnostic publication is scoped by "validation context" so that revalidating
// scan root B does not erase diagnostics that were published for scan root A —
// each context owns its own set of URIs and only clears its own.

import * as vscode from "vscode";
import {
    assembleProject,
    diagnosticsForNestedProjects,
    parse,
    validate,
    validateOrphans,
    type Diagnostic,
    type ParsedFile,
} from "@idefy/core";
import type { FsAdapter, ProjectDescriptor } from "@idefy/loader";
import {
    discoverProjects,
    findScanRoot,
    isOrphan,
} from "@idefy/loader";
import { KeyedDebouncer } from "../debounce.js";
import { mapDiagnostic, groupByUri } from "./mapping.js";
import { pathToUri, uriToPath } from "../fs/adapter.js";
import { OrphanNotificationDedup } from "../orphan/dedup.js";

const DEBOUNCE_MS = 500;

export type ValidationContext =
    | { readonly kind: "scan-root"; readonly path: string }
    | { readonly kind: "single-doc"; readonly uri: string };

export interface DocumentClassification {
    readonly kind:
        | "in-project"
        | "orphan-no-scanroot"
        | "orphan-no-project"
        | "non-idef0";
    readonly project?: ProjectDescriptor;
    readonly scanRoot?: string;
}

export class ValidationPipeline implements vscode.Disposable {
    private readonly debouncer = new KeyedDebouncer<string>(DEBOUNCE_MS);
    private readonly parsedCache = new Map<string, ParsedFile>();
    private readonly diagnostics: vscode.DiagnosticCollection;
    private readonly orphanDedup = new OrphanNotificationDedup();
    private readonly publishedByContext = new Map<string, Set<string>>();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly fs: FsAdapter,
        private readonly output: vscode.OutputChannel,
    ) {
        this.diagnostics =
            vscode.languages.createDiagnosticCollection("idefy");
        this.disposables.push(this.diagnostics);
    }

    scheduleRevalidate(document: vscode.TextDocument): void {
        if (document.languageId !== "idef0") return;
        const key = document.uri.toString();
        this.debouncer.schedule(key, async () => {
            await this.revalidate(document).catch((err) => {
                this.output.appendLine(
                    `validation failed for ${key}: ${formatError(err)}`,
                );
            });
        });
    }

    async revalidate(
        document: vscode.TextDocument,
    ): Promise<DocumentClassification> {
        const text = document.getText();
        const classification = await this.classify(document);
        await this.publishFor(document, text, classification);
        await this.updateContextKeys(document, classification);
        return classification;
    }

    async classify(document: vscode.TextDocument): Promise<DocumentClassification> {
        const docPath = uriToPath(document.uri);
        const scanRoot = await findScanRoot(docPath, this.fs);
        if (scanRoot === null) {
            this.maybeShowOrphanNotification(document);
            return { kind: "orphan-no-scanroot" };
        }
        const result = await discoverProjects(scanRoot, this.fs);
        const owning = result.projects.find((p) =>
            p.files.some((f) => f === docPath),
        );
        if (owning !== undefined) {
            return { kind: "in-project", project: owning, scanRoot };
        }
        if (isOrphan(docPath, scanRoot, result.projects)) {
            return { kind: "orphan-no-project", scanRoot };
        }
        return { kind: "non-idef0" };
    }

    private async publishFor(
        document: vscode.TextDocument,
        text: string,
        c: DocumentClassification,
    ): Promise<void> {
        if (c.kind === "orphan-no-scanroot" || c.kind === "non-idef0") {
            this.publishToContext(
                { kind: "single-doc", uri: document.uri.toString() },
                [],
            );
            return;
        }

        if (c.kind === "orphan-no-project") {
            const scanRoot = c.scanRoot!;
            const discovery = await discoverProjects(scanRoot, this.fs);
            const orphanDiags = validateOrphans(discovery.orphans);
            this.publishToContext(
                { kind: "scan-root", path: scanRoot },
                orphanDiags,
            );
            return;
        }

        const project = c.project!;
        const scanRoot = c.scanRoot!;
        const discovery = await discoverProjects(scanRoot, this.fs);
        const parsedFiles = await this.collectParsedFiles(
            project,
            document,
            text,
        );

        const allDiagnostics: Diagnostic[] = [];
        for (const pf of parsedFiles) {
            allDiagnostics.push(...pf.parseErrors);
        }

        const assembled = assembleProject(
            parsedFiles,
            scanRoot,
            project.projectRoot,
        );
        allDiagnostics.push(...assembled.errors);

        if (assembled.project !== null) {
            allDiagnostics.push(...validate(assembled.project));
        }

        allDiagnostics.push(
            ...diagnosticsForNestedProjects(discovery.nestedProjects),
        );

        allDiagnostics.push(...validateOrphans(discovery.orphans));

        this.publishToContext(
            { kind: "scan-root", path: scanRoot },
            allDiagnostics,
        );
    }

    private async collectParsedFiles(
        project: ProjectDescriptor,
        liveDocument: vscode.TextDocument,
        liveText: string,
    ): Promise<ParsedFile[]> {
        const liveKey = liveDocument.uri.toString();
        const livePath = uriToPath(liveDocument.uri);
        const parsed: ParsedFile[] = [];

        for (const filePath of project.files) {
            if (filePath === livePath) {
                const live = parse(liveText, {
                    filePath: livePath,
                    basename: basenameOf(filePath),
                });
                const pf: ParsedFile = {
                    path: livePath,
                    ast: live.ast,
                    parseErrors: live.errors,
                };
                this.parsedCache.set(liveKey, pf);
                parsed.push(pf);
                continue;
            }

            const cacheKey = pathToUri(filePath).toString();
            const cached = this.parsedCache.get(cacheKey);
            if (cached !== undefined) {
                parsed.push(cached);
                continue;
            }
            const content = await this.fs.readFile(filePath);
            const r = parse(content, {
                filePath,
                basename: basenameOf(filePath),
            });
            const pf: ParsedFile = {
                path: filePath,
                ast: r.ast,
                parseErrors: r.errors,
            };
            this.parsedCache.set(cacheKey, pf);
            parsed.push(pf);
        }
        return parsed;
    }

    // Publishes the given diagnostics under the given validation context and
    // clears only URIs previously owned by that context which are not in this
    // batch. URIs owned by other contexts are untouched.
    private publishToContext(
        ctx: ValidationContext,
        diagnostics: readonly Diagnostic[],
    ): void {
        const ctxKey = contextKeyOf(ctx);
        const plain = diagnostics.map(mapDiagnostic);
        const grouped = groupByUri(plain);

        const prevOwned = this.publishedByContext.get(ctxKey) ?? new Set<string>();
        for (const uri of prevOwned) {
            if (!grouped.has(uri)) {
                this.diagnostics.delete(pathToUri(uri));
            }
        }

        const newOwned = new Set<string>();
        for (const [uriPath, items] of grouped) {
            const vsItems = items.map(toVscodeDiagnostic);
            this.diagnostics.set(pathToUri(uriPath), vsItems);
            newOwned.add(uriPath);
        }
        this.publishedByContext.set(ctxKey, newOwned);
    }

    private async updateContextKeys(
        document: vscode.TextDocument,
        c: DocumentClassification,
    ): Promise<void> {
        const active = vscode.window.activeTextEditor;
        if (active === undefined || active.document !== document) return;
        await applyContextKeysForClassification(c);
    }

    // Public, synchronous reset — called from extension.ts on editor change so
    // menu and keybinding state doesn't lag behind the 500 ms debounce.
    async resetContextKeysForEditor(
        editor: vscode.TextEditor | undefined,
    ): Promise<void> {
        if (editor === undefined || editor.document.languageId !== "idef0") {
            await applyContextKeysForClassification({ kind: "non-idef0" });
        }
    }

    private maybeShowOrphanNotification(document: vscode.TextDocument): void {
        const key = document.uri.toString();
        if (!this.orphanDedup.shouldShow(key)) return;
        void vscode.window.showInformationMessage(
            "File outside any `src/idef0/` directory. Move under `src/idef0/<package>/` to enable IDEFy validation and formatting.",
        );
    }

    invalidateFile(uri: vscode.Uri): void {
        this.parsedCache.delete(uri.toString());
    }

    invalidateAll(): void {
        this.parsedCache.clear();
    }

    dispose(): void {
        this.debouncer.cancelAll();
        for (const d of this.disposables) d.dispose();
    }
}

function contextKeyOf(ctx: ValidationContext): string {
    return ctx.kind === "scan-root"
        ? `root:${ctx.path}`
        : `doc:${ctx.uri}`;
}

async function applyContextKeysForClassification(
    c: DocumentClassification,
): Promise<void> {
    const inProject =
        c.kind === "in-project" && c.project!.projectRoot !== c.scanRoot;
    const inInvalidProject =
        c.kind === "in-project" && c.project!.projectRoot === c.scanRoot;
    const isOrphanCase =
        c.kind === "orphan-no-scanroot" || c.kind === "orphan-no-project";

    await Promise.all([
        vscode.commands.executeCommand("setContext", "idefy.inProject", inProject),
        vscode.commands.executeCommand("setContext", "idefy.isOrphan", isOrphanCase),
        vscode.commands.executeCommand(
            "setContext",
            "idefy.inInvalidProject",
            inInvalidProject,
        ),
    ]);
}

function basenameOf(p: string): string {
    const slash = p.lastIndexOf("/");
    return slash < 0 ? p : p.slice(slash + 1);
}

function toVscodeDiagnostic(d: ReturnType<typeof mapDiagnostic>): vscode.Diagnostic {
    const range = new vscode.Range(
        d.range.start.line,
        d.range.start.character,
        d.range.end.line,
        d.range.end.character,
    );
    const severity =
        d.severity === "error"
            ? vscode.DiagnosticSeverity.Error
            : d.severity === "warning"
              ? vscode.DiagnosticSeverity.Warning
              : vscode.DiagnosticSeverity.Information;
    const out = new vscode.Diagnostic(range, d.message, severity);
    out.source = d.source;
    if (d.code !== undefined) out.code = d.code;
    if (d.relatedInformation !== undefined) {
        out.relatedInformation = d.relatedInformation.map(
            (r) =>
                new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(
                        pathToUri(r.uri),
                        new vscode.Range(
                            r.range.start.line,
                            r.range.start.character,
                            r.range.end.line,
                            r.range.end.character,
                        ),
                    ),
                    r.message,
                ),
        );
    }
    return out;
}

function formatError(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
}
