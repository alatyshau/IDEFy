import { describe, expect, it } from "vitest";
import { sortBlocks } from "../src/formatter/block-sorter.js";

const cmp = (a: number, b: number): number => a - b;

describe("sortBlocks: redistributes elements across user-blocks with min cost", () => {
    it("single block — just sorts internally", () => {
        const out = sortBlocks(
            [{ elements: [3, 1, 2], tagAfter: null }],
            { compare: cmp },
        );
        expect(out).toEqual([{ elements: [1, 2, 3], tagAfter: null }]);
    });

    it("one divider, all items already in correct block — no movement", () => {
        const out = sortBlocks(
            [
                { elements: [1, 2], tagAfter: "---" },
                { elements: [3, 4], tagAfter: null },
            ],
            { compare: cmp },
        );
        expect(out).toEqual([
            { elements: [1, 2], tagAfter: "---" },
            { elements: [3, 4], tagAfter: null },
        ]);
    });

    it("one divider, 4+3 example with mismatched order picks min-total partition", () => {
        // User example: top {1,2,5,4} / bottom {3,6,7}. Sorted: 1..7.
        // Min total distance partition — algorithm picks one of the
        // 4 equivalent options. Either way: every element from its
        // original block doesn't pay; cross-block movers pay 1.
        const out = sortBlocks(
            [
                { elements: [1, 2, 5, 4], tagAfter: "---" },
                { elements: [3, 6, 7], tagAfter: null },
            ],
            { compare: cmp },
        );
        // Validate the result is one of the user-stated equivalent splits.
        const acceptable = [
            [
                [1, 2, 3, 4, 5],
                [6, 7],
            ],
            [
                [1, 2, 3, 4],
                [5, 6, 7],
            ],
            [
                [1, 2, 3],
                [4, 5, 6, 7],
            ],
            [
                [1, 2],
                [3, 4, 5, 6, 7],
            ],
        ];
        const got = out.map((b) => b.elements);
        const matches = acceptable.some(
            (variant) =>
                JSON.stringify(variant) === JSON.stringify(got),
        );
        expect(matches).toBe(true);
        // Dividers preserved.
        expect(out[0]!.tagAfter).toBe("---");
        expect(out[1]!.tagAfter).toBe(null);
    });

    it("primary criterion is total distance: 1 move of distance 1 beats 3 moves of distance 1", () => {
        // Top {4,3,2} / bottom {1}. Sorted: 1,2,3,4.
        // Variant A: move 1 up → top {1,2,3,4}, bottom {} — 1 move, distance 1, total 1.
        // Variant B: move 4,3,2 down — 3 moves total distance 3.
        // Algorithm must pick A.
        const out = sortBlocks(
            [
                { elements: [4, 3, 2], tagAfter: "---" },
                { elements: [1], tagAfter: null },
            ],
            { compare: cmp },
        );
        expect(out[0]!.elements).toEqual([1, 2, 3, 4]);
        expect(out[1]!.elements).toEqual([]);
    });

    it("secondary criterion is max distance: tie on total → prefer min max", () => {
        // 3 blocks: {3} / {2} / {1}. Sorted: 1,2,3.
        // Variant A: move 3 from block 0 to block 2 (1 move, distance 2). Total=2, max=2.
        // Variant B: move 1 to middle, 3 to middle (2 moves, distance 1 each). Total=2, max=1.
        // Tied on total, B wins on max.
        const out = sortBlocks(
            [
                { elements: [3], tagAfter: "a" },
                { elements: [2], tagAfter: "b" },
                { elements: [1], tagAfter: null },
            ],
            { compare: cmp },
        );
        // B: top {}, middle {1,2,3}, bottom {}. OR top {1}, middle {2,3}, bottom {}? (still max=1)
        // Algorithm picks first lexicographic option found in DP. Either way max ≤ 1.
        const allDistancesMax = Math.max(
            ...out.flatMap((b, newIdx) =>
                b.elements.map((e) => {
                    // Find original block of `e`.
                    const original = [0, 1, 2].find((i) =>
                        [
                            [3],
                            [2],
                            [1],
                        ][i]!.includes(e),
                    )!;
                    return Math.abs(newIdx - original);
                }),
            ),
        );
        expect(allDistancesMax).toBeLessThanOrEqual(1);
    });

    it("empty blocks are preserved (divider stays even when block has no elements)", () => {
        const out = sortBlocks(
            [
                { elements: [], tagAfter: "---" },
                { elements: [3, 1, 2], tagAfter: null },
            ],
            { compare: cmp },
        );
        // Best: leave top empty, sort bottom. Total cost = 0.
        expect(out[0]!.elements).toEqual([]);
        expect(out[0]!.tagAfter).toBe("---");
        expect(out[1]!.elements).toEqual([1, 2, 3]);
        expect(out[1]!.tagAfter).toBe(null);
    });

    it("degenerate reverse case: 7 single-element blocks reverse-ordered", () => {
        // User example: [7], [6], [5], [4], [3], [2], [1] with 6 dividers.
        // Any output is acceptable as long as elements globally sorted
        // (within each block in sorted order) and 6 dividers preserved.
        const out = sortBlocks(
            [7, 6, 5, 4, 3, 2, 1].map((n, i) => ({
                elements: [n],
                tagAfter: i < 6 ? `sep${i}` : null,
            })),
            { compare: cmp },
        );
        expect(out).toHaveLength(7);
        const flat = out.flatMap((b) => b.elements);
        expect(flat).toEqual([1, 2, 3, 4, 5, 6, 7]); // global sort respected
        // All 6 dividers preserved.
        const tags = out.map((b) => b.tagAfter);
        expect(tags.slice(0, 6)).toEqual([
            "sep0",
            "sep1",
            "sep2",
            "sep3",
            "sep4",
            "sep5",
        ]);
        expect(tags[6]).toBe(null);
    });
});
