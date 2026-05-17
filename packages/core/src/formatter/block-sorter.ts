// Generic block-aware sorter.
//
// Use case: a section of declarations is split by user-placed «block-divider
// comments» into N user-blocks. The formatter must sort all declarations
// globally but preserve N blocks (with the same dividers as tags). When
// global sort puts a declaration in a different block than the original,
// the partition (sizes of each block) is chosen to minimise redistribution.
//
// Cost model:
//   - Each declaration that ends up in a different block than its original
//     pays a distance cost = |new_block_index - original_block_index|.
//   - PRIMARY criterion: minimise the SUM of all distances.
//   - SECONDARY criterion: minimise the MAX single distance.
//
// The block-divider comments themselves (carried as `tag: T` between blocks)
// pass through verbatim — only declarations move.

export interface BlockInput<E, T> {
    /** Declarations in this user-block, in input order. */
    readonly elements: readonly E[];
    /** Divider sitting AFTER this block (null for the last block). */
    readonly tagAfter: T | null;
}

export interface BlockOutput<E, T> {
    readonly elements: readonly E[];
    readonly tagAfter: T | null;
}

export interface SortBlocksOptions<E> {
    /** Standard sort comparator over individual elements. */
    readonly compare: (a: E, b: E) => number;
}

/**
 * Sort declarations globally across a sequence of blocks while preserving
 * the number of blocks and the dividers between them. Returns a new
 * sequence of blocks with the same `tagAfter` tags but elements
 * redistributed per the cost-minimising partition.
 */
export function sortBlocks<E, T>(
    blocks: readonly BlockInput<E, T>[],
    options: SortBlocksOptions<E>,
): BlockOutput<E, T>[] {
    if (blocks.length === 0) return [];
    const blockCount = blocks.length;

    // Collect (element, originalBlockIndex) pairs preserving input order.
    interface Tagged {
        readonly element: E;
        readonly originalBlock: number;
    }
    const tagged: Tagged[] = [];
    blocks.forEach((b, idx) => {
        for (const e of b.elements) tagged.push({ element: e, originalBlock: idx });
    });
    const N = tagged.length;
    if (N === 0) {
        // All blocks empty; just return the same tag sequence.
        return blocks.map((b) => ({ elements: [], tagAfter: b.tagAfter }));
    }

    // Stable-sort by user comparator. Tagged is reordered to "sorted target
    // order"; positions in this array map 1:1 to output positions.
    tagged.sort((a, b) => options.compare(a.element, b.element));

    // DP: choose K-1 split points to partition `tagged` into K blocks.
    // State: dp[i][j] = {totalCost, maxDistance, splitChoice} =
    //   best result placing tagged[0..i-1] into blocks 0..j-1 (j blocks used).
    // Transition: dp[i][j] = min over s of dp[s][j-1] + cost(tagged[s..i-1] in block j-1).
    // i in 0..N, j in 0..K. (j blocks consume i elements; remaining N-i go into
    // remaining K-j blocks.)
    interface DpCell {
        readonly total: number;
        readonly max: number;
        readonly prevSplit: number;
    }
    const INF: DpCell = { total: Infinity, max: Infinity, prevSplit: -1 };
    const dp: DpCell[][] = Array.from({ length: N + 1 }, () =>
        Array(blockCount + 1).fill(INF),
    );
    dp[0]![0] = { total: 0, max: 0, prevSplit: -1 };

    for (let j = 1; j <= blockCount; j += 1) {
        for (let i = 0; i <= N; i += 1) {
            // Items tagged[s..i-1] go into block (j-1).
            for (let s = 0; s <= i; s += 1) {
                const prev = dp[s]![j - 1]!;
                if (!isFinite(prev.total)) continue;
                let segmentTotal = 0;
                let segmentMax = 0;
                for (let k = s; k < i; k += 1) {
                    const dist = Math.abs(tagged[k]!.originalBlock - (j - 1));
                    segmentTotal += dist;
                    if (dist > segmentMax) segmentMax = dist;
                }
                const candidate: DpCell = {
                    total: prev.total + segmentTotal,
                    max: Math.max(prev.max, segmentMax),
                    prevSplit: s,
                };
                const current = dp[i]![j]!;
                if (lessCost(candidate, current)) {
                    dp[i]![j] = candidate;
                }
            }
        }
    }

    // Backtrack splits.
    const splits: number[] = new Array(blockCount + 1);
    splits[blockCount] = N;
    let cursor = dp[N]![blockCount]!;
    for (let j = blockCount; j >= 1; j -= 1) {
        splits[j - 1] = cursor.prevSplit;
        if (j - 1 > 0) cursor = dp[cursor.prevSplit]![j - 1]!;
    }

    const out: BlockOutput<E, T>[] = [];
    for (let j = 0; j < blockCount; j += 1) {
        const start = splits[j]!;
        const end = splits[j + 1]!;
        const elems = tagged.slice(start, end).map((t) => t.element);
        out.push({ elements: elems, tagAfter: blocks[j]!.tagAfter });
    }
    return out;
}

// Lexicographic (total, max) ordering: smaller total wins; tie → smaller max.
function lessCost(
    a: { total: number; max: number },
    b: { total: number; max: number },
): boolean {
    if (a.total < b.total) return true;
    if (a.total > b.total) return false;
    return a.max < b.max;
}
