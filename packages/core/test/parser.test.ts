import { describe, expect, it } from "vitest";
import { parseFixtureFile } from "./fixtures.js";

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
        expect(byId.get("A1")?.commentsAbove.map((c) => c.text)).toEqual([
            "above-A1 sticks (no blank between)",
        ]);
        expect(byId.get("A2")?.commentsBelow.map((c) => c.text)).toEqual([
            "below-A2 sticks (no blank between)",
        ]);
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
    it("flags tunnel decl inside activity body", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/tunnel-in-activity.idef0"
        );
        expect(
            errors.some((e) =>
                /Tunnel declaration .* not allowed inside 'activity'/.test(
                    e.message
                )
            )
        ).toBe(true);
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
            errors.some((e) =>
                /arrow id 'I_1' invalid.*uppercase alphanumeric suffix/.test(
                    e.message
                )
            )
        ).toBe(true);
    });
    it("flags activity id with 0 in suffix (e.g., A10)", () => {
        const { errors } = parseFixtureFile(
            "parser/errors/bad-activity-suffix.idef0"
        );
        expect(
            errors.some((e) =>
                /Functional block id 'A10' is not a valid activity id/.test(
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
        produced: block.produced.map((p) =>
            p.kind === "new"
                ? `new:${p.id}:${p.description.value}`
                : p.kind === "boundary-out"
                  ? `bo:${p.id}=>${p.mappedTo}`
                  : `to:${p.id}=>${p.mappedTo}`
        ),
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
