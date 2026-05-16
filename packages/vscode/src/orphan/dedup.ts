// Pure-logic dedup for case-1 orphan notifications.
//
// Per packages/vscode/spec/UI.md §Orphan UX:
//   "vscode.window.showInformationMessage с per-file дедупликацией
//    (один раз на сессию для конкретного URI)."
//
// The set is in-memory and intentionally not persisted — a reload counts as a
// new session, which matches the spec's "за сессию повторно не показываем".

export class OrphanNotificationDedup {
    private readonly shown = new Set<string>();

    shouldShow(uri: string): boolean {
        if (this.shown.has(uri)) return false;
        this.shown.add(uri);
        return true;
    }

    forget(uri: string): void {
        this.shown.delete(uri);
    }

    reset(): void {
        this.shown.clear();
    }
}
