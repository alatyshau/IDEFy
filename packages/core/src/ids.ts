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

// Активность: каноничная форма 'A0' (корень) или 'A' + суффикс [1-9a-z]+.
// Цифра 0 в суффиксе запрещена per spec/01-dsl.md («0» зарезервирован за
// корнем), заглавные буквы в суффиксе тоже запрещены — этот контраст
// префикс/суффикс визуально разделяет роль и путь декомпозиции. Невалидно:
// A0 в качестве дочернего, A10, A1z0.
const ACTIVITY_ID_RE = /^A(?:0|[1-9a-z]+)$/;

// Arrow id (каноничная форма): <role-letter><суффикс [1-9a-z]+>. Префикс —
// заглавный (I/O/C/M/X/T), суффикс — строчные буквы + цифры 1..9. Тот же
// запрет «0 в суффиксе», что и для активити.
const ARROW_ID_RE = /^[IOCMXT][1-9a-z]+$/;

// «Well-formed» формы — структурно валидны (корень `A0`, префикс заглавный,
// `0` в суффиксе запрещён), но допускают заглавные буквы в суффиксе. Спека
// `04-validator.md §rule 8` различает structural violation (error) и case
// violation (warning); парсер и валидатор используют lenient regex'ы как
// «well-formed» порог, а strict regex выше — как «canonical».
const ACTIVITY_ID_LENIENT_RE = /^A(?:0|[1-9A-Za-z]+)$/;
const ARROW_ID_LENIENT_RE = /^[IOCMXT][1-9A-Za-z]+$/;

// `ActivityId` / `FileId` are type aliases for `string`, so an `s is …`
// guard narrows the negative branch to `never` and breaks callers that try to
// touch the rejected value (.charAt, etc.). The annotation provides no real
// info either way — return `boolean`.
export function isActivityId(s: string): boolean {
    return ACTIVITY_ID_RE.test(s);
}

export function isContextId(s: string): s is "A-0" {
    return s === "A-0";
}

export function isFileId(s: string): boolean {
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

// «Well-formed» predicate — true iff id is structurally valid (parser-level),
// even if it violates the canonical lowercase-suffix convention. Validator
// uses this to distinguish error-grade structural violations from warning-grade
// case violations (see spec/04-validator.md §rule 8).
export function isWellFormedActivityId(s: string): boolean {
    return ACTIVITY_ID_LENIENT_RE.test(s);
}

export function isWellFormedArrowId(s: string): boolean {
    return ARROW_ID_LENIENT_RE.test(s);
}

export function isWellFormedArrowIdInRoles(
    s: string,
    allowedRoles: ReadonlySet<ArrowRole>
): boolean {
    if (!ARROW_ID_LENIENT_RE.test(s)) return false;
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

// Сортировка стрелок внутри роли: суффиксы (цифры 1..9, строчные a..z) идут
// до '[' (то есть голые I1, Ia — до bracket-форм I[X11]). По ASCII '[' (91) и
// ']' (93) сидят между заглавными и строчными буквами, поэтому без явной
// перенумерации lowercase ('a'=97..) попали бы ПОСЛЕ '['. Возвращаем bracket
// chars в «больший» хвост через rank().
export function compareArrowKeys(a: string, b: string): number {
    if (a === b) return 0;
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i += 1) {
        const ra = rank(a.charCodeAt(i));
        const rb = rank(b.charCodeAt(i));
        if (ra === rb) continue;
        return ra - rb;
    }
    return a.length - b.length;
}

function rank(c: number): number {
    // '[' (0x5B) → 200; ']' (0x5D) → 201. Любые suffix-символы (1..9, a..z)
    // оставляем как есть — их ASCII-коды (49..57, 97..122) меньше 200.
    if (c === 0x5b) return 200;
    if (c === 0x5d) return 201;
    return c;
}
