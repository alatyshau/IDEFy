import { describe, expect, it } from "vitest";
import { parseFixtureFile } from "./fixtures.js";
import { parse as parseText } from "../src/parser/parse.js";

describe("parser: valid fixtures parse without errors", () => {
    it("coffee A0 — canonical activity example", () => {
        const { ast, errors } = parseFixtureFile(
            "parser/valid/A0.coffee.idef0"
        );
        expect(errors).toEqual([]);
        expect(ast?.kind).toBe("activity");
        if (ast?.kind !== "activity") throw new Error("expected activity");
        expect(ast.id).toBe("A0");
        expect(ast.boundary).toHaveLength(10);
        expect(ast.blocks).toHaveLength(3);
        expect(ast.filenameId).toBe("A0");
    });

    it("coffee A-0 — canonical context example", () => {
        const { ast, errors } = parseFixtureFile(
            "parser/valid/A-0.coffee.idef0"
        );
        expect(errors).toEqual([]);
        expect(ast?.kind).toBe("context");
        if (ast?.kind !== "context") throw new Error("expected context");
        expect(ast.tunnels).toHaveLength(2);
        expect(ast.rootRef?.targetId).toBe("A0");
        expect(ast.filenameId).toBe("A-0");
    });

    it("multiline block — newlines after ',' and '->' as whitespace", () => {
        const { ast, errors } = parseFixtureFile(
            "parser/valid/multiline-block.idef0"
        );
        expect(errors).toEqual([]);
        if (ast?.kind !== "activity") throw new Error("expected activity");
        expect(ast.blocks).toHaveLength(1);
        const b = ast.blocks[0]!;
        expect(b.consumed).toHaveLength(3);
        expect(b.produced).toHaveLength(3);
    });

    it("sticky-comments fixture: parser attaches comments to blocks per spec rule", () => {
        const { ast, errors } = parseFixtureFile(
            "parser/valid/sticky-comments.idef0"
        );
        expect(errors).toEqual([]);
        if (ast?.kind !== "activity") throw new Error("expected activity");
        const byId = new Map(ast.blocks.map((b) => [b.id, b]));
        // A1 has "above-A1 sticks" — adjacent comment, no blank below ⇒ true sticky.
        expect(byId.get("A1")?.commentsAbove.map((c) => c.text)).toEqual([
            "above-A1 sticks (no blank between)",
        ]);
        // "below-A2 sticks" in the fixture sits between A2 and a blank line.
        // Per the updated divider rule (blank-line-below ⇒ divider), this
        // comment is a block divider, NOT A2.commentsBelow.
        expect(byId.get("A2")?.commentsBelow).toEqual([]);
        expect(
            ast.blocksDividers?.some(
                (d) => d.comment.text === "below-A2 sticks (no blank between)",
            ),
        ).toBe(true);
    });

    it("ignores trailer after closing brace per spec 01-dsl.md", () => {
        const { ast, errors } = parseFixtureFile(
            "parser/valid/trailer-after-brace.idef0"
        );
        expect(errors).toEqual([]);
        expect(ast?.kind).toBe("activity");
    });
});

describe("parser: error fixtures emit container-mismatch diagnostics", () => {
    it("accepts T* in activity body as boundary tunnel entry (inherit-ID model)", () => {
        // Per spec/01-dsl.md, T* in activity boundary is a flat tunnel echo
        // (rule 20 tunnel-in-boundary). Parser must NOT flag this as an error.
        const { ast, errors } = parseFixtureFile(
            "parser/errors/tunnel-in-activity.idef0"
        );
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("expected activity");
        const tunnelBoundary = ast.boundary.find(
            (b) => b.kind === "tunnel" && b.id === "T1"
        );
        expect(tunnelBoundary).toBeDefined();
    });
    it("flags root reference inside activity body", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/rootref-in-activity.idef0"
        );
        expect(
            errors.some((e) =>
                /Root reference .* not allowed inside 'activity'/.test(e.message)
            )
        ).toBe(true);
    });
    it("flags boundary arrow inside context body", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/boundary-in-context.idef0"
        );
        expect(
            errors.some((e) =>
                /Boundary arrow .* not allowed inside 'context A-0'/.test(
                    e.message
                )
            )
        ).toBe(true);
    });
    it("flags functional block inside context body", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/block-in-context.idef0"
        );
        expect(
            errors.some((e) =>
                /Functional block .* not allowed inside 'context A-0'/.test(
                    e.message
                )
            )
        ).toBe(true);
    });
});

describe("parser: sticky comments on boundary arrows", () => {
    // REGRESSION: комменты внутри boundary section ранее уходили в
    // floatingComments и затем дропались форматтером. По spec/02-formatting.md
    // правило прилипания применяется к КАЖДОМУ anchor-узлу — это включает и
    // boundary arrows, не только functional blocks и tunnels. Без этого
    // комменты, описывающие отдельные стрелки границы, теряются при первом
    // же форматировании файла.

    it("comment immediately above a boundary arrow becomes its commentsAbove", () => {
        const text = `activity A0 "root" {
    I1 "in"
    # describes O1
    O1 "out"

    A1 "child" : I1 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const o1 = ast.boundary.find(
            (b) => b.kind === "flat" && b.id === "O1",
        );
        if (!o1 || o1.kind !== "flat") throw new Error("O1 missing");
        expect(o1.commentsAbove.map((c) => c.text)).toEqual(["describes O1"]);
    });

    it("comment immediately below an arrow but with blank line below becomes a divider, not commentsBelow", () => {
        // Per the updated rule: a comment with a blank line BELOW it is a
        // block divider. The blank-above (or lack thereof) doesn't matter —
        // formatter will inject one. So `O1 "out" / # note / blank / A1`
        // pushes `# note` to boundaryDividers, not to O1.commentsBelow.
        const text = `activity A0 "root" {
    I1 "in"
    O1 "out"
    # trailing note on O1

    A1 "child" : I1 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const o1 = ast.boundary.find(
            (b) => b.kind === "flat" && b.id === "O1",
        );
        if (!o1 || o1.kind !== "flat") throw new Error("O1 missing");
        expect(o1.commentsBelow).toEqual([]);
        expect(ast.boundaryDividers).toHaveLength(1);
        expect(ast.boundaryDividers![0]!.comment.text).toBe(
            "trailing note on O1",
        );
    });

    it("inline comment after boundary arrow goes to `inlineComment` (not `commentsBelow`)", () => {
        // Inline comments live on the SAME source line as the arrow's last
        // token. They are kept separately from the standalone-line
        // commentsBelow so that the formatter can preserve the inline shape:
        //   `M2 "label" # inline note`
        // rather than re-emitting the comment on a fresh line below.
        const text = `activity A0 "root" {
    I1 "in"
    M2 "mech" # inline note on M2
    O1 "out"

    A1 "child" : I1, M2 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const m2 = ast.boundary.find(
            (b) => b.kind === "flat" && b.id === "M2",
        );
        if (!m2 || m2.kind !== "flat") throw new Error("M2 missing");
        expect(m2.inlineComment?.text).toBe("inline note on M2");
        // Сохраняем инвариант: inline comment не дублируется в commentsBelow.
        expect(m2.commentsBelow).toEqual([]);
    });

    it("inline comment does NOT bleed into next anchor's commentsAbove", () => {
        // Bug: `M2 "..." # comment` in raw pizzeria fixture caused the inline
        // comment to be misattributed as the NEXT anchor's commentsAbove
        // (i.e., it visually jumped down past the next arrow). Sticky logic
        // only checked "items between anchors" and assigned them to the
        // following anchor without considering same-line proximity.
        const text = `activity A0 "root" {
    I1 "in"
    M2 "mech" # inline note on M2
    I2 "second in"
    O1 "out"

    A1 "child" : I1, I2, M2 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const m2 = ast.boundary.find(
            (b) => b.kind === "flat" && b.id === "M2",
        );
        const i2 = ast.boundary.find(
            (b) => b.kind === "flat" && b.id === "I2",
        );
        if (!m2 || m2.kind !== "flat") throw new Error("M2 missing");
        if (!i2 || i2.kind !== "flat") throw new Error("I2 missing");
        expect(m2.inlineComment?.text).toBe("inline note on M2");
        expect(i2.commentsAbove).toEqual([]);
    });

    it("inline comment after a functional block's produced list goes to its inlineComment", () => {
        // Same shape for blocks: `A2 ... -> X21# inline` — inline `#` after
        // the block's last token attaches as inlineComment, not as
        // commentsBelow / next anchor's commentsAbove.
        const text = `activity A0 "root" {
    I1 "in"
    O1 "out"
    O2 "out2"

    A1 "first"  : I1 -> X11 "inner" # inline on A1
    A2 "second" : I1 -> X21[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const a1 = ast.blocks.find((b) => b.id === "A1");
        const a2 = ast.blocks.find((b) => b.id === "A2");
        if (!a1 || !a2) throw new Error("blocks missing");
        expect(a1.inlineComment?.text).toBe("inline on A1");
        expect(a1.commentsBelow).toEqual([]);
        expect(a2.commentsAbove).toEqual([]);
    });

    it("blank line above a sticky comment is captured as leadingBlankLine on that comment", () => {
        // User-visible spec: «Если перед или после полнострочного комментария
        // есть пустая строка, эти строки надо сохранять, но не больше одной».
        // Comments preserve their up-to-one-blank-line padding in the format
        // output. The flag lives on the Comment node itself so the formatter
        // can emit the blank without needing to re-derive layout from line
        // numbers (which are unreliable after sorting).
        const text = `activity A0 "root" {
    I1 "in"

    # blank above
    O1 "out"

    A1 "child" : I1 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const o1 = ast.boundary.find(
            (b) => b.kind === "flat" && b.id === "O1",
        );
        if (!o1 || o1.kind !== "flat") throw new Error("O1 missing");
        expect(o1.commentsAbove).toHaveLength(1);
        expect(o1.commentsAbove[0]!.leadingBlankLine).toBe(true);
    });

    it("comment adjacent to anchor (no blank line above) has leadingBlankLine=false", () => {
        const text = `activity A0 "root" {
    I1 "in"
    # no-blank above
    O1 "out"

    A1 "child" : I1 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const o1 = ast.boundary.find(
            (b) => b.kind === "flat" && b.id === "O1",
        );
        if (!o1 || o1.kind !== "flat") throw new Error("O1 missing");
        expect(o1.commentsAbove[0]!.leadingBlankLine).toBe(false);
    });

    it("blank line below the last comment of an anchor's commentsBelow is captured as leadingBlankLine on the FOLLOWING anchor's commentsAbove", () => {
        // The "blank after the comment" symmetrically equals "blank before
        // the next sticky-relevant thing". We capture it as a flag on the
        // next comment / anchor — single source of truth.
        const text = `activity A0 "root" {
    I1 "in"
    # below I1

    O1 "out"

    A1 "child" : I1 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const o1 = ast.boundary.find(
            (b) => b.kind === "flat" && b.id === "O1",
        );
        if (!o1 || o1.kind !== "flat") throw new Error("O1 missing");
        // Comment "# below I1" hangs as commentsBelow of I1 (no blank between
        // I1 and comment). Blank between that comment and O1 ⇒ O1 starts a
        // new group with leadingBlankLine=true (anchor-level metadata).
        expect(o1.leadingBlankLine).toBe(true);
    });

    it("comments separated from arrows by blank line above AND below land in boundaryDividers", () => {
        // After the block-divider rework, a comment isolated from anchors by
        // blank lines on both sides is a "block divider" — it splits the
        // section into user-blocks. It lives in `boundaryDividers`, NOT in
        // `commentsAbove`/`commentsBelow` of any anchor, and NOT in
        // `floatingComments`.
        const text = `activity A0 "root" {
    I1 "in"

    # detached from I1 (blank line above)

    O1 "out"

    A1 "child" : I1 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const i1 = ast.boundary.find(
            (b) => b.kind === "flat" && b.id === "I1",
        );
        const o1 = ast.boundary.find(
            (b) => b.kind === "flat" && b.id === "O1",
        );
        if (!i1 || i1.kind !== "flat" || !o1 || o1.kind !== "flat") {
            throw new Error("arrows missing");
        }
        expect(i1.commentsBelow).toEqual([]);
        expect(o1.commentsAbove).toEqual([]);
        expect(ast.boundaryDividers).toHaveLength(1);
        expect(ast.boundaryDividers![0]!.comment.text).toBe(
            "detached from I1 (blank line above)",
        );
    });
});

describe("parser: block-divider comments", () => {
    // A block divider is a full-line comment with a blank line after it.
    // Per spec, dividers split the section (boundary or decomposition) into
    // user-blocks. Formatter sorts globally and chooses a partition that
    // minimizes total redistribution distance.

    it("identifies a boundary divider as `boundaryDividers` with afterIndex", () => {
        const text = `activity A0 "x" {
    I1 "in"
    O1 "out"

    # divider

    M2 "mech"
    I2 "in2"

    A1 "child" : I1, I2, M2 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        expect(ast.boundaryDividers).toHaveLength(1);
        // Divider sits after the 2nd entry of input-order boundary (I1, O1).
        expect(ast.boundaryDividers![0]!.afterIndex).toBe(1);
        expect(ast.boundaryDividers![0]!.comment.text).toBe("divider");
    });

    it("comment with blank line BELOW (but NOT above) is still a divider", () => {
        // User-visible rule: divider = comment with trailing blank line.
        // Leading blank is irrelevant — if it's missing in the source, the
        // formatter adds one. Parser-side just records the comment as a
        // divider; formatter handles the blank-above injection.
        const text = `activity A0 "x" {
    I1 "in"
    # divider

    M1 "mech"
    O1 "out"

    A1 "child" : I1, M1 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        expect(ast.boundaryDividers).toHaveLength(1);
        expect(ast.boundaryDividers![0]!.comment.text).toBe("divider");
        // Importantly: I1 must NOT have the comment as commentsBelow.
        const i1 = ast.boundary.find(
            (b) => b.kind === "flat" && b.id === "I1",
        );
        if (!i1 || i1.kind !== "flat") throw new Error("I1 missing");
        expect(i1.commentsBelow).toEqual([]);
    });

    it("identifies a blocks divider", () => {
        const text = `activity A0 "x" {
    I1 "in"
    O1 "out"

    A2 "second" : I1 -> X21[O1]

    # divides

    A1 "first" : I1 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        expect(ast.blocksDividers).toHaveLength(1);
        expect(ast.blocksDividers![0]!.afterIndex).toBe(0); // after A2 (input order)
        expect(ast.blocksDividers![0]!.comment.text).toBe("divides");
    });
});

describe("parser: sticky comments on context root reference `...A0`", () => {
    // Spec/02-formatting.md правило прилипания комментариев применяется ко
    // **всем anchor-узлам** контекста: tunnels И root reference. Adjacent
    // комменты (без пустой строки между ними и anchor'ом) обязаны быть
    // в `commentsAbove`/`commentsBelow` соответствующего AST-узла —
    // только тогда форматтер их сохранит при сортировке/пересборке. Если
    // комменты падают в floating, они теряются (per spec body-floating
    // dropped).

    it("comments above `...A0` are captured as rootRef.commentsAbove", () => {
        const text = `context A-0 "ctx" {
    T1 "tunnel"

    # describe-root above
    # second line
    ...A0
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A-0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "context") throw new Error("expected context");
        expect(ast.rootRef).not.toBeNull();
        expect(ast.rootRef!.commentsAbove.map((c) => c.text)).toEqual([
            "describe-root above",
            "second line",
        ]);
    });

    it("comments below `...A0` are captured as rootRef.commentsBelow", () => {
        const text = `context A-0 "ctx" {
    T1 "tunnel"

    ...A0
    # describe-root below
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A-0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "context") throw new Error("expected context");
        expect(ast.rootRef).not.toBeNull();
        expect(ast.rootRef!.commentsBelow.map((c) => c.text)).toEqual([
            "describe-root below",
        ]);
    });
});

describe("parser: multi-line continuation (spec/01-dsl.md «Continuation lines»)", () => {
    // Spec: «Continuation lines (строки, не начинающиеся со start-литерала) —
    // продолжение предыдущей декларации». Парсер обязан поддерживать переносы
    // строк между токенами шапки и между id↔name внутри boundary-деклараций.

    it("activity header tokens may be split across multiple lines", () => {
        const text = `activity
A0
"Pizza on a conveyor"
{
    I1 "in"
    O1 "out"

    A1 "child" : I1 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("expected activity");
        expect(ast.id).toBe("A0");
        expect(ast.name.value).toBe("Pizza on a conveyor");
        expect(ast.boundary).toHaveLength(2);
        expect(ast.blocks).toHaveLength(1);
    });

    it("context header tokens may be split across multiple lines", () => {
        const text = `context
A-0
"Pizza context"
{
    T1 "noise"

    ...A0
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A-0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "context") throw new Error("expected context");
        expect(ast.id).toBe("A-0");
        expect(ast.name.value).toBe("Pizza context");
    });

    it("boundary decl: id and description on separate lines (with blank in between)", () => {
        const text = `activity A0 "root" {
    I1

    "input desc"
    O1
    "output desc"

    A1 "child" : I1 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("expected activity");
        const flat = ast.boundary.filter((b) => b.kind === "flat");
        const i1 = flat.find((b) => b.kind === "flat" && b.id === "I1");
        const o1 = flat.find((b) => b.kind === "flat" && b.id === "O1");
        if (!i1 || i1.kind !== "flat") throw new Error("I1 missing");
        if (!o1 || o1.kind !== "flat") throw new Error("O1 missing");
        expect(i1.description.value).toBe("input desc");
        expect(o1.description.value).toBe("output desc");
    });

    it("functional block: id and name on different lines, multi-line consumed/produced", () => {
        const text = `activity A0 "root" {
    I1 "in"
    O1 "out"
    O2 "out2"

    A1
        "child"
        :
            I1
        ->
            X11[O1]
            ,
            X12[O2]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("expected activity");
        expect(ast.blocks).toHaveLength(1);
        const b = ast.blocks[0]!;
        expect(b.id).toBe("A1");
        expect(b.name.value).toBe("child");
        expect(b.consumed).toHaveLength(1);
        expect(b.produced).toHaveLength(2);
    });

    it("REGRESSION: declaration endLine reflects literal close, not lookahead position", () => {
        // Когда parseDeclarationItem делает lookahead `:` через
        // consumeWhitespaceMultilineForDecl, он съедает переносы строк и
        // продвигает stream.position.line на следующую декларацию. Если
        // endLine браться из stream.position после lookahead — две соседние
        // декларации, разделённые пустой строкой, сольются в одну группу
        // sticky-comments, и комментарии между ними прилипнут к следующему
        // блоку. Правильное поведение: коммент после T1 (без blank-line
        // gap) — sticky к T1 как commentsBelow; коммент перед A1 — отдельная
        // группа (blank line gap) и в commentsAbove первого блока его быть
        // не должно.
        const text = `activity A0 "root" {
    I1 "in"
    O1 "out"
    T1 "t"
    # belongs to T1 (no blank line)

    A1 "child" : I1, C[T1] -> X11[O1]
}

`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("expected activity");
        // Коммент через blank-line gap не должен прилипнуть к A1.
        expect(ast.blocks).toHaveLength(1);
        expect(ast.blocks[0]!.commentsAbove).toHaveLength(0);
        // По обновлённому правилу divider'а: коммент с blank line СНИЗУ — это
        // block-divider, не sticky-below. Уходит в boundaryDividers, не в
        // T1.commentsBelow. (Тест ловит то самое regression из прошлой
        // итерации: parser больше не путает endLine T1 с строкой A1.)
        const t1 = ast.boundary.find(
            (b) => b.kind === "tunnel" && b.id === "T1",
        );
        if (!t1 || t1.kind !== "tunnel") throw new Error("T1 missing");
        expect(t1.commentsBelow).toEqual([]);
        expect(ast.boundaryDividers).toHaveLength(1);
        expect(ast.boundaryDividers![0]!.comment.text).toBe(
            "belongs to T1 (no blank line)",
        );
    });
});

describe("parser: comment inside a declaration terminates it (spec/01-dsl.md)", () => {
    // Spec 01-dsl.md, раздел «Границы деклараций»:
    //   «Комментарии внутри декларации запрещены — `# ...` всегда терминирует
    //    текущую декларацию».
    //
    // Это load-bearing инвариант для всей грамматики: парсер использует `#` как
    // одну из границ декларации (наравне с EOF, `}`, и start-литералом
    // следующей строки). Без этого правила прилипание комментариев и
    // multi-line объявления стали бы неоднозначными.

    it("`#` on its own line between an id and its description aborts the boundary decl", () => {
        const { ast, errors } = parseFixtureFile(
            "parser/errors/comment-inside-declaration.idef0",
        );
        // 1) Парсер обязан зафиксировать как минимум одну ошибку — это
        //    структурно невалидный ввод (декларация I1 не получила description).
        expect(errors.length).toBeGreaterThan(0);
        // 2) Конкретная диагностика про missing description должна указывать
        //    на строку с `#`-комментарием — именно там декларация I1 обрывается.
        expect(
            errors.some((e) =>
                /Expected string literal/i.test(e.message),
            ),
        ).toBe(true);
        // 3) Trailing string literal `"label ..."` на отдельной строке должен
        //    быть отвергнут как неподходящий start-of-declaration token (literal
        //    не является start-литералом ни в одном контейнере).
        expect(
            errors.some((e) =>
                /Expected declaration starting with an identifier/i.test(
                    e.message,
                ),
            ),
        ).toBe(true);
        // 4) Несмотря на ошибки, парсер не падает и восстанавливается до
        //    следующей валидной декларации (panic-mode recovery) — блок A1
        //    обязан быть распознан полностью.
        if (!ast || ast.kind !== "activity") throw new Error("expected activity");
        expect(ast.blocks.map((b) => b.id)).toEqual(["A1"]);
    });

    it("inline `#` mid-line is part of the previous token? — NO: it always starts a comment when at the start of a (logical) line in the body", () => {
        // Эту тонкость подсвечиваем отдельным тестом: `#` лексер ловит только
        // когда видит его как первый non-whitespace токен строки тела. Inline
        // в середине ввода (например, в строковом литерале) — это просто
        // обычный символ. Если же `#` идёт сразу после переноса строки
        // внутри multiline-блока, он терминирует декларацию.
        const text = `activity A0 "root" {
    I1 "a # in a string"

    A1 "child" : I1 -> X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        expect(ast.boundary).toHaveLength(1);
        const b = ast.boundary[0]!;
        if (b.kind !== "flat") throw new Error("expected flat");
        expect(b.description.value).toBe("a # in a string");
    });

    it("`#` after `->` between consumed and produced terminates the block declaration", () => {
        // Это вариант той же инвариантности на уровне функционального блока:
        // `# ...` после `->` обрывает блок, и produced list считается пустым —
        // что обязано породить грамматическую ошибку «must produce at least
        // one arrow».
        const text = `activity A0 "root" {
    I1 "in"
    O1 "out"

    A1 "child" : I1 ->
        # mid-decl comment kills the block
        X11[O1]
}
`;
        const { errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors.length).toBeGreaterThan(0);
        expect(
            errors.some((e) => /produce at least one arrow/i.test(e.message)),
        ).toBe(true);
    });
});

describe("parser: lexer treatment of '-' (only after leading 'A')", () => {
    // Контракт лексера: `-` — word char ТОЛЬКО на позиции 1 после ведущего `A`
    // (литерал контекстного id `A-0`). В любой другой позиции `-` завершает
    // токен. Это нужно чтобы грамматические разделители вроде `->` корректно
    // отделялись от arrow id без обязательного пробела.

    it("M1->X21 without surrounding spaces splits into 'M1' and '->'", () => {
        // Если `-` был бы word char всегда, readWord проглотила бы `M1-` и
        // парсер ошибочно бы посчитал, что consumed-список продолжается.
        const text = `activity A0 "root" {
    I1 "in"
    O1 "out"

    A1 "child" :I1,M1->X11[O1]
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors.filter((e) => /Expected/.test(e.message))).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const block = ast.blocks[0]!;
        expect(block.consumed.map((c) => (c.kind === "parent" ? c.id : c.sourceId))).toEqual(
            ["I1", "M1"],
        );
        expect(block.produced).toHaveLength(1);
        const p = block.produced[0]!;
        if (p.kind !== "boundary-out") throw new Error("expected boundary-out");
        expect(p.id).toBe("X11");
        expect(p.mappedTo).toBe("O1");
    });

    it("'A-0' context id reads as a single token through readWord", () => {
        const text = `context A-0 "ctx" {
    T1 "tunnel"

    ...A0
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A-0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "context") throw new Error("context");
        expect(ast.id).toBe("A-0");
    });

    it("'M-1' in boundary stops readWord at '-' (no leading 'A')", () => {
        // Лексер должен прочитать только `M` и остановиться на `-`. Любая
        // диагностика, которая последует от парсера/валидатора, не должна
        // упоминать `M-1` целиком — `-` к id не приклеивается.
        const text = `activity A0 "root" {
    M-1 "mech"
}
`;
        const { errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        // Главный инвариант: дефис никогда не оказался частью какого-либо id.
        expect(errors.some((e) => /M-1/.test(e.message))).toBe(false);
        // И при этом грамматическая ошибка обязана быть зафиксирована —
        // невозможно молча проглотить такой ввод.
        expect(errors.length).toBeGreaterThan(0);
    });

    it("'-' at start of declaration position is not a word char (returns null)", () => {
        // Тривиальная подстраховка: токен не может начинаться с `-`. Если бы
        // лексер допускал — мы бы строили AST для бессмыслицы.
        const text = `activity A0 "root" {
    -1 "weird"
}
`;
        const { errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        // Парсер должен сообщить о невозможности начать декларацию.
        expect(errors.length).toBeGreaterThan(0);
    });

    it("'A-' (no suffix after dash) parses as token 'A-' and gets validation error downstream", () => {
        // Лексер обязан принять `A-` (правило: `-` после ведущего `A`).
        // Что суффикса нет — это уровень парсера/валидатора. Здесь проверяем,
        // что лексер не глотает соседний токен.
        const text = `context A- "ctx" {
}
`;
        const { errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A-0.idef0",
        });
        // Context id != "A-0" → должна быть соответствующая диагностика парсера.
        expect(
            errors.some((e) => /'A-'/.test(e.message) || /A-0/.test(e.message)),
        ).toBe(true);
    });
});

describe("parser: produced plug labels (rule 21 surface)", () => {
    // Inline parser checks for the optional plug label after [...] in produced
    // refs. Per spec/01-dsl.md, all three bracket forms (X[O*], X[T*], X[X*])
    // accept an optional string literal as a label. The label is what rule 21
    // checks for structural correctness (forbidden at single plug, required &
    // unique at join). The parser must accept all four shapes — with/without
    // label across all three bracket variants.
    const SRC = (produced: string) => `activity A0 "root" {
    I1 "in"
    O1 "out"
    O2 "out2"
    T1 "tn"

    A1 "child" : I1 -> ${produced}
}
`;

    it("X[O*] with label produces boundary-out with label field", () => {
        const text = SRC('X11[O1] "audio"');
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const p = ast.blocks[0]!.produced[0]!;
        if (p.kind !== "boundary-out") throw new Error("expected boundary-out");
        expect(p.label?.value).toBe("audio");
    });

    it("X[O*] without label has undefined label", () => {
        const text = SRC("X11[O1]");
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const p = ast.blocks[0]!.produced[0]!;
        if (p.kind !== "boundary-out") throw new Error("expected boundary-out");
        expect(p.label).toBeUndefined();
    });

    it("X[T*] with label produces tunnel-out with label field", () => {
        const text = SRC('X11[T1] "alpha"');
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const p = ast.blocks[0]!.produced[0]!;
        if (p.kind !== "tunnel-out") throw new Error("expected tunnel-out");
        expect(p.label?.value).toBe("alpha");
    });

    it("X[X*] with label produces parent-x-mapped with label field", () => {
        const text = `activity A0 "root" {
    I1 "in"
    O[X22] "src"

    A1 "child" : I1 -> X11[X22] "left"
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const p = ast.blocks[0]!.produced[0]!;
        if (p.kind !== "parent-x-mapped") throw new Error("expected parent-x-mapped");
        expect(p.label?.value).toBe("left");
    });

    it("multiple labelled plugs separated by comma parse independently", () => {
        const text = `activity A0 "root" {
    I1 "in"
    O1 "out"

    A1 "a" : I1 -> X11[O1] "audio"
    A2 "b" : I1 -> X21[O1] "video"
}
`;
        const { ast, errors } = parseText(text, {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        const p0 = ast.blocks[0]!.produced[0]!;
        const p1 = ast.blocks[1]!.produced[0]!;
        if (p0.kind !== "boundary-out" || p1.kind !== "boundary-out") {
            throw new Error("expected boundary-out");
        }
        expect(p0.label?.value).toBe("audio");
        expect(p1.label?.value).toBe("video");
    });
});

describe("parser: string literal handling (spec/01-dsl.md «Строковые литералы»)", () => {
    it("parses `\\\"` and `\\\\` escapes inside string literals", () => {
        const { ast, errors } = parseFixtureFile(
            "parser/valid/string-escapes.idef0",
        );
        expect(errors).toEqual([]);
        if (!ast || ast.kind !== "activity") throw new Error("activity");
        // Activity name carries both escape kinds.
        expect(ast.name.value).toBe('with "quote" and \\ backslash');
        const byKind = ast.boundary.filter((b) => b.kind === "flat");
        const i1 = byKind.find((b) => b.kind === "flat" && b.id === "I1");
        const o1 = byKind.find((b) => b.kind === "flat" && b.id === "O1");
        if (!i1 || i1.kind !== "flat") throw new Error("I1 missing");
        if (!o1 || o1.kind !== "flat") throw new Error("O1 missing");
        expect(i1.description.value).toBe('input with "quoted" word');
        expect(o1.description.value).toBe("C:\\Path\\To\\Thing");
    });

    it("flags newline inside string literal as an error", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/newline-in-string.idef0",
        );
        expect(
            errors.some((e) =>
                /Unexpected newline inside string literal/i.test(e.message),
            ),
        ).toBe(true);
    });

    it("flags an unterminated string literal at EOF", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/unterminated-string.idef0",
        );
        // Парсер обязан явно отрапортовать «Unterminated string literal».
        // (При обрыве на конце строки также может прилететь дополнительная
        // диагностика — это не страшно, главное — наличие сигнала.)
        expect(
            errors.some((e) => /Unterminated string literal/i.test(e.message))
                || errors.some((e) =>
                    /Unexpected newline inside string literal/i.test(e.message),
                ),
        ).toBe(true);
    });
});

describe("parser: header braces (spec/01-dsl.md «Базовая структура файла»)", () => {
    it("flags missing `{` after the activity header", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/missing-open-brace.idef0",
        );
        expect(
            errors.some((e) => /Expected '\{' to open activity body/i.test(e.message)),
        ).toBe(true);
    });

    it("flags missing `}` at the end of the body", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/missing-close-brace.idef0",
        );
        expect(
            errors.some((e) => /Expected '\}' to close body/i.test(e.message)),
        ).toBe(true);
    });
});

describe("parser: empty/header-less inputs return null AST without throwing", () => {
    it("empty string yields ast=null and no errors", () => {
        const { ast, errors } = parseText("", {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(ast).toBeNull();
        expect(errors).toEqual([]);
    });

    it("whitespace-only input yields ast=null and no errors", () => {
        const { ast, errors } = parseText("\n\n   \n", {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(ast).toBeNull();
        expect(errors).toEqual([]);
    });

    it("non-keyword opener yields a descriptive error and ast=null", () => {
        const { ast, errors } = parseText("foo bar baz", {
            filePath: "synthetic",
            basename: "A0.idef0",
        });
        expect(ast).toBeNull();
        expect(
            errors.some((e) =>
                /Expected 'activity' or 'context' at top level/i.test(e.message),
            ),
        ).toBe(true);
    });
});

describe("parser: error fixtures enforce arrow grammar", () => {
    it("rejects X* arrow in boundary section", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/bad-boundary-role.idef0"
        );
        expect(
            errors.some((e) =>
                /Boundary arrow:.*arrow id 'X9' invalid/.test(e.message)
            )
        ).toBe(true);
    });
    it("rejects O* as produced new id (produced new must be X*)", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/bad-produced-new.idef0"
        );
        expect(
            errors.some((e) =>
                /Produced new arrow:.*arrow id 'O1' invalid/.test(e.message)
            )
        ).toBe(true);
    });
    it("rejects O* as consumed parent (must be I/C/M)", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/bad-consumed-parent.idef0"
        );
        expect(
            errors.some((e) =>
                /Consumed parent arrow:.*arrow id 'O1' invalid/.test(e.message)
            )
        ).toBe(true);
    });
    it("rejects O* as sibling source (must be X*/T*)", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/bad-sibling-source.idef0"
        );
        expect(
            errors.some((e) =>
                /Consumed sibling source:.*arrow id 'O1' invalid/.test(e.message)
            )
        ).toBe(true);
    });
    it("rejects underscore in arrow id", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/underscore-id.idef0"
        );
        expect(
            errors.some(
                (e) =>
                    /arrow id 'I_1' invalid/.test(e.message) &&
                    /1\.\.9, a\.\.z/.test(e.message),
            ),
        ).toBe(true);
    });
    it("structural arrow-id violation carries `validator.rule-8` ruleId", () => {
        // REGRESSION: parser flagged structural arrow-id violations (`I_1`,
        // `I0`, etc.) without a `ruleId`, while spec/04-validator.md rule 8
        // explicitly covers arrow IDs. Owners of the structural check are
        // documented as rule-8; diagnostics must reflect that.
        const { errors } = parseFixtureFile(
            "parser/errors/underscore-id.idef0",
        );
        expect(
            errors.some(
                (e) =>
                    /arrow id 'I_1' invalid/.test(e.message) &&
                    e.ruleId === "validator.rule-8",
            ),
        ).toBe(true);
    });
    it("flags activity id with 0 in suffix (e.g., A10)", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/bad-activity-suffix.idef0"
        );
        expect(
            errors.some((e) =>
                /Functional block id 'A10' is not a structurally valid activity id/.test(
                    e.message
                )
            )
        ).toBe(true);
    });
});

describe("parser: panic-mode recovery", () => {
    it("never throws on malformed input and accumulates diagnostics", () => {
        expect(() => parseFixtureFile("parser/errors/malformed.idef0")).not.toThrow();
        const { errors } = parseFixtureFile("parser/errors/malformed.idef0");
        expect(errors.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Parser invariance under whitespace layout.
//
// Per spec/01-dsl.md, newlines and indentation INSIDE a declaration (between
// `:`, `->`, `,`) are whitespace. The same logical declaration written as a
// single line (Mode 1), or split across multiple lines (Mode 2, Mode 3,
// sub-mode Б), or with weird-but-valid whitespace must produce a semantically
// identical AST — only `location` ranges differ.
//
// The blockSignature helper extracts the layout-independent content of a
// FunctionalBlock; all five invariance fixtures must yield the same signature.
// ─────────────────────────────────────────────────────────────────────────────

interface BlockSignature {
    id: string;
    name: string;
    consumed: string[];
    produced: string[];
}

function blockSignature(block: {
    id: string;
    name: { value: string };
    consumed: readonly (
        | { kind: "parent"; role: string; id: string }
        | { kind: "sibling"; role: string; sourceId: string }
    )[];
    produced: readonly (
        | { kind: "new"; id: string; description: { value: string } }
        | { kind: "boundary-out"; id: string; mappedTo: string }
        | { kind: "tunnel-out"; id: string; mappedTo: string }
        | { kind: "parent-x-mapped"; id: string; mappedTo: string }
    )[];
}): BlockSignature {
    return {
        id: block.id,
        name: block.name.value,
        consumed: block.consumed.map((c) =>
            c.kind === "parent"
                ? `${c.role}:${c.id}`
                : `${c.role}[${c.sourceId}]`
        ),
        produced: block.produced.map((p) => {
            switch (p.kind) {
                case "new":
                    return `new:${p.id}:${p.description.value}`;
                case "boundary-out":
                    return `bo:${p.id}=>${p.mappedTo}`;
                case "tunnel-out":
                    return `to:${p.id}=>${p.mappedTo}`;
                case "parent-x-mapped":
                    return `pxm:${p.id}=>${p.mappedTo}`;
            }
        }),
    };
}

function firstBlockSignatureFor(fixturePath: string): BlockSignature {
    const { ast, errors } = parseFixtureFile(fixturePath);
    if (errors.length > 0) {
        throw new Error(
            `parse errors in ${fixturePath}: ` +
                errors.map((e) => e.message).join("; ")
        );
    }
    if (!ast || ast.kind !== "activity") {
        throw new Error(`expected activity AST in ${fixturePath}`);
    }
    const block = ast.blocks[0];
    if (!block) {
        throw new Error(`no functional block in ${fixturePath}`);
    }
    return blockSignature(block);
}

describe("parser: whitespace layout does not change AST content", () => {
    const CANONICAL = "parser/invariance/canonical-mode1.idef0";
    const VARIANTS = [
        "parser/invariance/mode2-layout.idef0",
        "parser/invariance/mode3-layout.idef0",
        "parser/invariance/submode-b-layout.idef0",
        "parser/invariance/weird-layout.idef0",
    ];

    it.each(VARIANTS)(
        "%s parses to the same block signature as the canonical Mode 1 layout",
        (variant) => {
            const canonical = firstBlockSignatureFor(CANONICAL);
            const actual = firstBlockSignatureFor(variant);
            expect(actual).toEqual(canonical);
        }
    );

    it("all five layouts produce zero parse errors", () => {
        for (const fixture of [CANONICAL, ...VARIANTS]) {
            const { errors } = parseFixtureFile(fixture);
            expect(errors).toEqual([]);
        }
    });

    it("canonical signature has the exact expected content (sanity)", () => {
        const sig = firstBlockSignatureFor(CANONICAL);
        expect(sig).toEqual({
            id: "A1",
            name: "decomp",
            consumed: ["I:I1", "C:C1", "M:M1"],
            produced: [
                "bo:X11=>O1",
                "new:X12:first internal",
                "new:X13:second internal",
            ],
        });
    });
});
