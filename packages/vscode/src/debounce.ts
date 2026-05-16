// Pure-logic debouncer: each key has its own pending timer. Re-arming a key
// cancels its previous timer and schedules a new one. The scheduler is
// injectable so tests can drive time synchronously.
//
// Used by the live-validation pipeline to debounce per-document onDidChange
// events at 500 ms (see packages/vscode/spec/COMPONENT.md §Live-валидация).

export interface DebounceScheduler {
    setTimeout(handler: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
}

export const realTimerScheduler: DebounceScheduler = {
    setTimeout: (handler, delay) => setTimeout(handler, delay),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class KeyedDebouncer<K> {
    private readonly pending = new Map<K, unknown>();

    constructor(
        private readonly delayMs: number,
        private readonly scheduler: DebounceScheduler = realTimerScheduler,
    ) {}

    schedule(key: K, action: () => void | Promise<void>): void {
        const existing = this.pending.get(key);
        if (existing !== undefined) {
            this.scheduler.clearTimeout(existing);
        }
        const handle = this.scheduler.setTimeout(() => {
            this.pending.delete(key);
            void action();
        }, this.delayMs);
        this.pending.set(key, handle);
    }

    cancel(key: K): void {
        const existing = this.pending.get(key);
        if (existing !== undefined) {
            this.scheduler.clearTimeout(existing);
            this.pending.delete(key);
        }
    }

    cancelAll(): void {
        for (const handle of this.pending.values()) {
            this.scheduler.clearTimeout(handle);
        }
        this.pending.clear();
    }
}
