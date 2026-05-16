import { describe, expect, it } from "vitest";
import { KeyedDebouncer, type DebounceScheduler } from "../src/debounce.js";

function makeFakeScheduler() {
    let nextId = 1;
    const pending = new Map<number, () => void>();
    const scheduler: DebounceScheduler = {
        setTimeout(handler) {
            const id = nextId++;
            pending.set(id, handler);
            return id;
        },
        clearTimeout(handle) {
            pending.delete(handle as number);
        },
    };
    return {
        scheduler,
        fireAll() {
            const handlers = Array.from(pending.values());
            pending.clear();
            for (const h of handlers) h();
        },
        size() {
            return pending.size;
        },
    };
}

describe("KeyedDebouncer", () => {
    it("fires the latest action for a key", () => {
        const fake = makeFakeScheduler();
        const debouncer = new KeyedDebouncer<string>(500, fake.scheduler);
        let callCount = 0;
        let last = "";

        debouncer.schedule("k", () => {
            callCount++;
            last = "first";
        });
        debouncer.schedule("k", () => {
            callCount++;
            last = "second";
        });
        debouncer.schedule("k", () => {
            callCount++;
            last = "third";
        });
        expect(fake.size()).toBe(1);

        fake.fireAll();
        expect(callCount).toBe(1);
        expect(last).toBe("third");
    });

    it("keeps timers per key independent", () => {
        const fake = makeFakeScheduler();
        const debouncer = new KeyedDebouncer<string>(500, fake.scheduler);
        const fired: string[] = [];

        debouncer.schedule("a", () => {
            fired.push("a");
        });
        debouncer.schedule("b", () => {
            fired.push("b");
        });
        expect(fake.size()).toBe(2);

        fake.fireAll();
        expect(fired.sort()).toEqual(["a", "b"]);
    });

    it("cancel(key) prevents the pending action", () => {
        const fake = makeFakeScheduler();
        const debouncer = new KeyedDebouncer<string>(500, fake.scheduler);
        let fired = false;

        debouncer.schedule("k", () => {
            fired = true;
        });
        debouncer.cancel("k");
        fake.fireAll();
        expect(fired).toBe(false);
    });

    it("cancelAll clears every pending timer", () => {
        const fake = makeFakeScheduler();
        const debouncer = new KeyedDebouncer<string>(500, fake.scheduler);
        debouncer.schedule("a", () => {});
        debouncer.schedule("b", () => {});
        debouncer.schedule("c", () => {});
        expect(fake.size()).toBe(3);

        debouncer.cancelAll();
        expect(fake.size()).toBe(0);
    });
});
