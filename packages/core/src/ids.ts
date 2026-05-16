import type { ArrowId, ArrowRole, ActivityId, FileId } from "./types.js";

export const ARROW_ROLES: readonly ArrowRole[] = ["I", "O", "C", "M", "X", "T"];

const ROLE_SET = new Set<string>(ARROW_ROLES);

export function roleOf(id: ArrowId): ArrowRole {
    const head = id.charAt(0);
    if (!ROLE_SET.has(head)) {
        throw new Error(`Invalid arrow id, unknown role prefix: ${id}`);
    }
    return head as ArrowRole;
}

// Активность: 'A0' (корень) или 'A' + суффикс из [1-9A-Z]+.
// Цифра 0 в суффиксе запрещена per spec/01-dsl.md (алфавит суффиксов 1..9, A..Z;
// «0» зарезервирован за корнем). Так что A10, A20, A1Z0 — НЕ валидные id.
const ACTIVITY_ID_RE = /^A(?:0|[1-9A-Z]+)$/;

// Arrow id: <role-letter><uppercase + digit suffix>. spec/01-dsl.md явно требует
// «алфавитно-цифровая комбинация» — в нашем DSL это uppercase + digits, в соответствии
// со всеми примерами спеки (см. spec/01-dsl.md, раздел «Стрелки»).
const ARROW_ID_RE = /^[IOCMXT][A-Z0-9]+$/;

export function isActivityId(s: string): s is ActivityId {
    return ACTIVITY_ID_RE.test(s);
}

export function isContextId(s: string): s is "A-0" {
    return s === "A-0";
}

export function isFileId(s: string): s is FileId {
    return isContextId(s) || isActivityId(s);
}

export function isValidArrowId(s: string): boolean {
    return ARROW_ID_RE.test(s);
}

// Проверка, что arrow id корректен и его роль входит в allowed-set.
export function isValidArrowIdInRoles(
    s: string,
    allowedRoles: ReadonlySet<ArrowRole>
): boolean {
    if (!ARROW_ID_RE.test(s)) return false;
    return allowedRoles.has(s.charAt(0) as ArrowRole);
}

// Извлечение ID из имени файла: префикс до первой точки.
// '.' и '/' уже отрезаны caller'ом (basename без пути).
export function extractFileId(basename: string): string {
    const dot = basename.indexOf(".");
    return dot < 0 ? basename : basename.substring(0, dot);
}

// Родитель активности по правилам IDEF0: отрезает последний суффикс-знак.
// 'A11' → 'A1', 'A1A' → 'A1', 'A1' → 'A0' (прямые дети корня), 'AZ' → 'A0'.
// Для 'A0' — null (корень). Для некорректных id (не начинаются с 'A', одиночный 'A') — null.
export function parentActivityId(id: ActivityId): ActivityId | null {
    if (id === "A0") return null;
    if (!id.startsWith("A")) return null;
    if (id.length < 2) return null;
    if (id.length === 2) return "A0";
    return id.substring(0, id.length - 1);
}

// Лексикографическое (точнее, IDEF-естественное) сравнение ID активностей:
// A1, A2, …, A9, AA, AB, …, AZ — то же самое, что обычное строковое сравнение,
// потому что суффиксы — заглавные буквы, а цифры '0'–'9' < 'A'–'Z' по ASCII.
export function compareActivityIds(a: ActivityId, b: ActivityId): number {
    if (a === b) return 0;
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : 1;
}

// Сортировка стрелок внутри роли: цифры/буквы идут до '[' (то есть голые I1 до I[X11]).
// Сравнение посимвольно с учётом, что '[' имеет специальный «больший» вес.
export function compareArrowKeys(a: string, b: string): number {
    if (a === b) return 0;
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i += 1) {
        const ca = a.charCodeAt(i);
        const cb = b.charCodeAt(i);
        if (ca === cb) continue;
        // '[' (0x5B) уже больше всех заглавных букв и цифр в ASCII,
        // так что обычное сравнение даёт правильный порядок.
        return ca - cb;
    }
    return a.length - b.length;
}
