import { describe, expect, it } from "vitest";
import { planGitignoreUpdate } from "../src/gitignore.js";

describe("planGitignoreUpdate", () => {
    it("creates a new file when none exists", () => {
        const upd = planGitignoreUpdate(null);
        expect(upd).toEqual({ action: "create", content: "*.idef0.ascii\n" });
    });

    it("appends with separating newline when file lacks trailing newline", () => {
        const upd = planGitignoreUpdate("node_modules");
        expect(upd).toEqual({
            action: "append",
            content: "node_modules\n*.idef0.ascii\n",
        });
    });

    it("appends without extra newline when file already ends with one", () => {
        const upd = planGitignoreUpdate("node_modules\n");
        expect(upd).toEqual({
            action: "append",
            content: "node_modules\n*.idef0.ascii\n",
        });
    });

    it("returns null when canonical entry already present", () => {
        expect(planGitignoreUpdate("*.idef0.ascii\n")).toBeNull();
    });

    it("recognises `**/*.idef0.ascii` as already covering", () => {
        expect(planGitignoreUpdate("**/*.idef0.ascii\n")).toBeNull();
    });

    it("recognises the broader `*.ascii` as already covering", () => {
        expect(planGitignoreUpdate("*.ascii\n")).toBeNull();
    });

    it("recognises `**/*.ascii` as already covering", () => {
        expect(planGitignoreUpdate("**/*.ascii\n")).toBeNull();
    });

    it("ignores commented-out canonical entries", () => {
        const upd = planGitignoreUpdate("# *.idef0.ascii\n");
        expect(upd?.action).toBe("append");
    });

    it("ignores `!*.idef0.ascii` negations", () => {
        const upd = planGitignoreUpdate("!*.idef0.ascii\n");
        expect(upd?.action).toBe("append");
    });

    it("does not treat directory pattern as covering", () => {
        const upd = planGitignoreUpdate("idef0.ascii/\n");
        expect(upd?.action).toBe("append");
    });

    it("creates with content ending in single newline", () => {
        const upd = planGitignoreUpdate(null);
        expect(upd?.content.endsWith("\n")).toBe(true);
        expect(upd?.content.endsWith("\n\n")).toBe(false);
    });
});
