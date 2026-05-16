// Visual decorator for IDEF0 DSL tokens.
//
// Applies deterministic colours and font styles on top of TextMate /
// semantic-token rendering so the visual hierarchy reads consistently across
// any active theme. Colours and styles are baked into the extension (not
// theme-dependent), matching the contract in packages/vscode/spec/UI.md
// §Цветовая палитра DSL.
//
// Palette (final values are in COLORS below):
//   - Activity family (red): `activity`/`context` keywords, A-IDs, `{` `}`,
//     `:`, `->`. A-IDs additionally bold.
//   - Arrow roles: I→blue, O→green, C→yellow, M→purple, X→gray, T→orange.
//     All arrow ID literals are bold by default; only the inner ID inside
//     `[...]` is italic instead (it gets its own role colour from the inner
//     letter). Outer letter + `[` `]` of a bracket form inherit the outer
//     role colour and stay bold like any other arrow ID.
//   - Strings and `#` comments → muted, so user content recedes vs the DSL.
//   - `,` → muted (`descriptionForeground`), keeps lists readable but quiet.

import * as vscode from "vscode";
import { scanArrowIds } from "./arrow-scan.js";
import { scanActivityIds } from "./activity-scan.js";
import { scanLiterals } from "./dsl-literals-scan.js";

interface ColorPair {
    readonly light: string;
    readonly dark: string;
}

const COLORS = {
    activity: { light: "#A31515", dark: "#F44747" },
    input: { light: "#0000FF", dark: "#569CD6" },
    output: { light: "#267F99", dark: "#4EC9B0" },
    control: { light: "#795E26", dark: "#DCDCAA" },
    mechanism: { light: "#AF00DB", dark: "#C586C0" },
    internal: { light: "#808080", dark: "#9D9D9D" },
    tunnel: { light: "#A0522D", dark: "#CE9178" },
    string: { light: "#A0A0A0", dark: "#8B8B8B" },
    comment: { light: "#999999", dark: "#6E6E6E" },
} as const satisfies Record<string, ColorPair>;

export class IdefyDecorator implements vscode.Disposable {
    private readonly bold: vscode.TextEditorDecorationType;
    private readonly italic: vscode.TextEditorDecorationType;
    private readonly mutedComma: vscode.TextEditorDecorationType;
    private readonly activityColor: vscode.TextEditorDecorationType;
    private readonly stringColor: vscode.TextEditorDecorationType;
    private readonly commentColor: vscode.TextEditorDecorationType;
    private readonly arrowColors: Record<string, vscode.TextEditorDecorationType>;
    private readonly disposables: vscode.Disposable[] = [];

    constructor() {
        this.bold = create({ fontWeight: "bold" });
        this.italic = create({ fontStyle: "italic" });
        this.mutedComma = create({
            color: new vscode.ThemeColor("descriptionForeground"),
        });
        this.activityColor = createColor(COLORS.activity);
        this.stringColor = createColor(COLORS.string);
        this.commentColor = createColor(COLORS.comment);
        this.arrowColors = {
            I: createColor(COLORS.input),
            O: createColor(COLORS.output),
            C: createColor(COLORS.control),
            M: createColor(COLORS.mechanism),
            X: createColor(COLORS.internal),
            T: createColor(COLORS.tunnel),
        };
        this.disposables.push(
            this.bold,
            this.italic,
            this.mutedComma,
            this.activityColor,
            this.stringColor,
            this.commentColor,
            ...Object.values(this.arrowColors),
        );
    }

    refresh(editor: vscode.TextEditor): void {
        const buckets = this.makeEmptyBuckets();
        if (editor.document.languageId !== "idef0") {
            this.applyBuckets(editor, buckets);
            return;
        }
        const text = editor.document.getText();

        for (const hit of scanArrowIds(text)) {
            const range = rangeOf(editor.document, hit.offset, hit.length);
            const arrowBucket = buckets.arrow[hit.role];
            if (arrowBucket !== undefined) arrowBucket.push(range);
            if (hit.position === "inner") buckets.italic.push(range);
            else buckets.bold.push(range);
        }
        for (const hit of scanActivityIds(text)) {
            const range = rangeOf(editor.document, hit.offset, hit.length);
            buckets.activity.push(range);
            buckets.bold.push(range);
        }
        for (const lit of scanLiterals(text)) {
            const range = rangeOf(editor.document, lit.offset, lit.length);
            switch (lit.kind) {
                case "string":
                    buckets.string.push(range);
                    break;
                case "comment":
                    buckets.comment.push(range);
                    break;
                case "keyword":
                case "brace":
                case "operator":
                    buckets.activity.push(range);
                    break;
                case "comma":
                    buckets.comma.push(range);
                    break;
            }
        }

        this.applyBuckets(editor, buckets);
    }

    refreshAllVisible(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            this.refresh(editor);
        }
    }

    dispose(): void {
        for (const d of this.disposables) d.dispose();
    }

    private makeEmptyBuckets(): Buckets {
        return {
            bold: [],
            italic: [],
            activity: [],
            string: [],
            comment: [],
            comma: [],
            arrow: { I: [], O: [], C: [], M: [], X: [], T: [] },
        };
    }

    private applyBuckets(editor: vscode.TextEditor, b: Buckets): void {
        editor.setDecorations(this.bold, b.bold);
        editor.setDecorations(this.italic, b.italic);
        editor.setDecorations(this.activityColor, b.activity);
        editor.setDecorations(this.stringColor, b.string);
        editor.setDecorations(this.commentColor, b.comment);
        editor.setDecorations(this.mutedComma, b.comma);
        for (const role of Object.keys(this.arrowColors)) {
            const dec = this.arrowColors[role]!;
            const ranges = b.arrow[role] ?? [];
            editor.setDecorations(dec, ranges);
        }
    }
}

interface Buckets {
    bold: vscode.Range[];
    italic: vscode.Range[];
    activity: vscode.Range[];
    string: vscode.Range[];
    comment: vscode.Range[];
    comma: vscode.Range[];
    arrow: Record<string, vscode.Range[]>;
}

function create(opts: vscode.DecorationRenderOptions): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType(opts);
}

function createColor(pair: ColorPair): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        light: { color: pair.light },
        dark: { color: pair.dark },
    });
}

function rangeOf(
    doc: vscode.TextDocument,
    offset: number,
    length: number,
): vscode.Range {
    return new vscode.Range(
        doc.positionAt(offset),
        doc.positionAt(offset + length),
    );
}
