// Semantic-token provider for `idef0`.
//
// Spec (COMPONENT.md §Semantic tokens) framed this as «walk the AST from
// `@idefy/core`». We deviate by scanning the source lexically (see
// arrow-scan.ts) for two reasons:
//
//   1. Robustness — files with parse errors still get coloured.
//   2. Sub-token positions — refs like `I[X11]` carry one composite location on
//      the AST node; reconstructing inner-vs-outer ranges needs a source scan
//      anyway. The DSL guarantees every arrow ID is unambiguously roled by its
//      first letter, so a lexical scan gives the same answer as an AST walk
//      on valid input and a better answer on invalid input.

import * as vscode from "vscode";
import { scanArrowIds } from "./arrow-scan.js";

const TOKEN_TYPE = "idef0Arrow";
const MODIFIERS = ["input", "output", "control", "mechanism", "internal", "tunnel"] as const;

export const semanticTokensLegend = new vscode.SemanticTokensLegend(
    [TOKEN_TYPE],
    [...MODIFIERS],
);

const ROLE_TO_MODIFIER_INDEX: Readonly<Record<string, number>> = {
    I: 0,
    O: 1,
    C: 2,
    M: 3,
    X: 4,
    T: 5,
};

export class IdefArrowSemanticTokensProvider
    implements vscode.DocumentSemanticTokensProvider
{
    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
    ): vscode.SemanticTokens {
        const builder = new vscode.SemanticTokensBuilder(semanticTokensLegend);
        const text = document.getText();
        for (const hit of scanArrowIds(text)) {
            const modifierIndex = ROLE_TO_MODIFIER_INDEX[hit.role];
            if (modifierIndex === undefined) continue;
            const pos = document.positionAt(hit.offset);
            builder.push(
                pos.line,
                pos.character,
                hit.length,
                0,
                1 << modifierIndex,
            );
        }
        return builder.build();
    }
}
