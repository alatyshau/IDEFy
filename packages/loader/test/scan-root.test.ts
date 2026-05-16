import { describe, expect, it } from "vitest";
import { findScanRoot } from "../src/scan-root.js";
import { createInMemoryFs } from "./fixtures.js";

// findScanRoot uses fs.exists() to verify candidates — paths that lexically
// match `<...>/src/idef0` but don't exist on the (in-memory) FS return null.
// Each test seeds an FS with the required structure.

describe("findScanRoot — lazy walk-up to <...>/src/idef0", () => {
    it("finds the nearest src/idef0 ancestor for a deeply nested file", async () => {
        const fs = createInMemoryFs({
            "/workspace/myproj/src/idef0/coffee/brewing/A1.idef0": "",
        });
        const root = await findScanRoot(
            "/workspace/myproj/src/idef0/coffee/brewing/A1.idef0",
            fs
        );
        expect(root).toBe("/workspace/myproj/src/idef0");
    });

    it("works for files directly inside src/idef0", async () => {
        const fs = createInMemoryFs({
            "/workspace/src/idef0/A0.idef0": "",
        });
        const root = await findScanRoot("/workspace/src/idef0/A0.idef0", fs);
        expect(root).toBe("/workspace/src/idef0");
    });

    it("accepts the scan-root directory itself as input (not only descendants)", async () => {
        // Invariant from spec: findScanRoot returns the .../src/idef0 directory.
        // If the caller passes that directory directly (e.g. from a workspace
        // configuration), we should return it — not null.
        const fs = createInMemoryFs({
            "/workspace/src/idef0/coffee/A0.idef0": "",
        });
        const root = await findScanRoot("/workspace/src/idef0", fs);
        expect(root).toBe("/workspace/src/idef0");
    });

    it("returns null when path lexically matches but src/idef0 does not exist on FS", async () => {
        // No files seeded → /just/src/idef0 doesn't exist → null.
        const fs = createInMemoryFs({});
        expect(
            await findScanRoot("/just/src/idef0/lone.idef0", fs)
        ).toBeNull();
    });

    it("returns null when no src/idef0 ancestor exists in the path", async () => {
        const fs = createInMemoryFs({
            "/just/some/file.idef0": "",
        });
        expect(await findScanRoot("/just/some/file.idef0", fs)).toBeNull();
        expect(await findScanRoot("file.idef0", fs)).toBeNull();
    });

    it("does not match standalone `idef0` segments without `src` parent", async () => {
        const fs = createInMemoryFs({
            "/ws/idef0/A0.idef0": "",
        });
        // path contains 'idef0' segment but its parent is not 'src' → no match
        expect(await findScanRoot("/ws/idef0/A0.idef0", fs)).toBeNull();
    });

    it("multi-root awareness: each call is independent of others", async () => {
        const fs = createInMemoryFs({
            "/root-a/src/idef0/x/A0.idef0": "",
            "/root-b/src/idef0/y/A0.idef0": "",
        });
        const a = await findScanRoot("/root-a/src/idef0/x/A0.idef0", fs);
        const b = await findScanRoot("/root-b/src/idef0/y/A0.idef0", fs);
        expect(a).toBe("/root-a/src/idef0");
        expect(b).toBe("/root-b/src/idef0");
    });

    it("resolves `..` segments in the input before walking", async () => {
        const fs = createInMemoryFs({
            "/ws/src/idef0/coffee/A0.idef0": "",
        });
        // Input has `..` segment; after normalize → /ws/src/idef0/coffee/A0.idef0
        const root = await findScanRoot(
            "/ws/src/idef0/coffee/sub/../A0.idef0",
            fs
        );
        expect(root).toBe("/ws/src/idef0");
    });
});
