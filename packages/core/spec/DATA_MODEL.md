# @idefy/core — Data Model

Структуры данных, циркулирующие через публичный API `@idefy/core`. Все типы — `readonly` после возврата из конструктора-функции (парсер, assembler).

## Source location

```
SourcePosition {
    line: number        // 1-based, как принято в редакторах
    column: number      // 1-based, в символах (codepoint), не байтах
}

SourceRange {
    start: SourcePosition
    end: SourcePosition  // exclusive
}

SourceLocation {
    file: string        // путь к файлу как переданный в ParseOptions.filePath;
                        // если filePath не передан — пустая строка
    range: SourceRange
}
```

`SourceLocation` присутствует на **каждом** узле AST (включая литералы строк и ID). Это форвард-обязательное требование — открывает дорогу к cross-file навигации (`A1` в `A0.idef0` → `A1.idef0`) и к точным диагностикам.

## AST одного файла

Каждый `.idef0` файл — это либо `activity`, либо `context` (см. [`spec/01-dsl.md`](../../../spec/01-dsl.md)):

```
ActivityAST {
    kind: 'activity'
    id: ActivityId          // ID из шапки
    name: StringLiteral     // имя в кавычках из шапки
    boundary: BoundaryArrow[]   // граничные стрелки (интерфейс активности)
    blocks: FunctionalBlock[]   // декомпозиция
    floatingComments: Comment[] // комментарии вне функциональных блоков (например, перед
                                // блоком boundary, между boundary и blocks, после последнего
                                // блока). См. правило прилипания в spec/02-formatting.md.
    location: SourceLocation
    filenameId?: FileId         // ID, извлечённый из basename (если ParseOptions.basename был
                                // передан). Сверяется валидатором, правило 10.
}

ContextAST {
    kind: 'context'
    id: ContextId               // всегда 'A-0' в текущей спеке
    name: StringLiteral
    tunnels: TunnelDecl[]
    rootRef?: RootReference     // опциональная ссылка ...A0
    floatingComments: Comment[] // комментарии вне tunnel-деклараций
    location: SourceLocation
    filenameId?: FileId         // см. ActivityAST.filenameId; для context-файла это обычно 'A-0'
}
```

## Идентификаторы

```
type ActivityId = string    // 'A0', 'A1', 'A11', 'AA', 'A1Z' и т.д. Формат — spec/01-dsl.md.
type ContextId = 'A-0'      // в текущей спеке единственное значение
type FileId = ActivityId | ContextId   // что может быть в имени файла до первой точки
type ArrowId = string       // 'I1', 'O2', 'C42', 'M1', 'X11', 'T1'. Префикс — роль.
type ArrowRole = 'I' | 'O' | 'C' | 'M' | 'X' | 'T'
```

Идентификаторы — строки, но контракт обязывает caller обращаться с ними как с opaque-токенами; не парсить, не модифицировать. Префиксная буква роли извлекается через `roleOf(id): ArrowRole`.

## Строковые литералы

```
StringLiteral {
    value: string           // unescaped значение (внутренние \" уже превращены в ")
    location: SourceLocation
}
```

## Граничные стрелки (boundary, в шапке activity)

```
BoundaryArrow {
    id: ArrowId             // I*, O*, C*, M* — TunnelDecl отдельно
    description: StringLiteral
    location: SourceLocation
}
```

## Туннели (в шапке context)

```
TunnelDecl {
    id: ArrowId                     // T*
    description: StringLiteral
    leadingBlankLine: boolean       // была ли пустая строка перед группой комментариев + туннеля
                                    // (см. правило "ведущая пустая едет с группой" в
                                    // spec/02-formatting.md, раздел про комментарии)
    commentsAbove: Comment[]        // комментарии, прилипшие сверху (нет пустой строки между ними
                                    // и туннелем)
    commentsBelow: Comment[]        // комментарии, прилипшие снизу
    location: SourceLocation
}
```

## Ссылка на корень из context-файла

```
RootReference {
    targetId: ActivityId    // обычно 'A0'
    location: SourceLocation
}
```

## Функциональные блоки декомпозиции

```
FunctionalBlock {
    id: ActivityId          // 'A1', 'A11', ...
    name: StringLiteral
    consumed: ConsumedArrowRef[]    // слева от ->
    produced: ProducedArrowRef[]    // справа от ->
    leadingBlankLine: boolean       // была ли пустая строка перед группой комментариев + блока
                                    // (см. правило "ведущая пустая едет с группой" в
                                    // spec/02-formatting.md, раздел про комментарии)
    commentsAbove: Comment[]        // комментарии, прилипшие к блоку сверху (нет пустой строки
                                    // между комментарием и блоком)
    commentsBelow: Comment[]        // комментарии, прилипшие к блоку снизу
    location: SourceLocation
}
```

### Потребляемая стрелка

```
ConsumedArrowRef =
    | { kind: 'parent', role: ArrowRole, id: ArrowId, location: SourceLocation }
       // I1, C1, M1 — граничные родителя, роль фиксирована
    | { kind: 'sibling', role: ArrowRole, sourceId: ArrowId, location: SourceLocation }
       // I[X11], C[T1] — внутренняя стрелка соседа или туннель в явной роли
```

### Производимая стрелка

```
ProducedArrowRef =
    | { kind: 'new', id: ArrowId, description: StringLiteral, location: SourceLocation }
       // X11 "Описание" — новая внутренняя стрелка
    | { kind: 'boundary-out', id: ArrowId, mappedTo: ArrowId, location: SourceLocation }
       // X11[O1] — также выход родителя
    | { kind: 'tunnel-out', id: ArrowId, mappedTo: ArrowId, location: SourceLocation }
       // X11[T1] — также туннель
```

## Комментарии

```
Comment {
    text: string            // содержимое после '# ', без префикса
    location: SourceLocation
}
```

Прилипание комментариев к блокам/туннелям/декларациям определяется **парсером** на основе правила из `spec/02-formatting.md` («между комментарием и блоком нет пустой строки»). Парсер раскладывает комментарии по полям `commentsAbove` / `commentsBelow` соответствующего узла; комментарии, не прилипшие ни к чему (например, перед блоком boundary в шапке `activity`, или между секциями), попадают в `floatingComments` AST верхнего уровня.

Это **отступление от классического «парсер — только синтаксис»**: парсер делает trivia-классификацию для удобства форматтера. Альтернатива (форматтер сам анализирует пустые строки) потребовала бы дублирования whitespace-tracking, который уже есть у парсера.

## Project model

```
IdefProject {
    name: string                            // 'banking.lending.as_is' — Java-package notation
    scanRoot: string                        // абсолютный/относительный путь корня сканирования
    projectRoot: string                     // путь корневой папки проекта (где лежит A0.*.idef0)
    files: ReadonlyMap<string, ProjectFile>     // ключ — путь файла как в ParsedFile.path
    activities: ReadonlyMap<ActivityId, ActivityNode>
    context: ContextNode | null             // null = нет A-0 (ошибка, но проект частично собран)
    diagnostics: Diagnostic[]               // структурные диагностики, выявленные при сборке
}

ProjectFile {
    path: string
    ast: ActivityAST | ContextAST | null
    parseErrors: Diagnostic[]
}

ActivityNode {
    id: ActivityId
    file: ProjectFile                       // файл, где активность определена в шапке
    parent: ActivityNode | null             // null только для A0
    children: ReadonlyMap<ActivityId, ActivityNode>
                                             // прямые дети по правилам нумерации IDEF0
    blockInParent: FunctionalBlock | null    // ссылка на ту же активность как functional block у родителя
                                             // null для A0
}

ContextNode {
    file: ProjectFile
    tunnels: ReadonlyMap<ArrowId, TunnelDecl>
    rootRef: RootReference | null
}
```

**Инвариант:** `parent`/`children` связи в `ActivityNode` — форвард-обязательные. Они избыточны относительно AST'ов, но позволяют валидатору и (forward direction) cross-file навигации работать без повторного парсинга.

## Diagnostic

```
Diagnostic {
    severity: 'error' | 'warning' | 'info'
    source: 'parser' | 'assembler' | 'validator'
    range: SourceRange
    file: string                            // путь файла, к которому относится диагностика
    message: string                         // человекочитаемое сообщение
    ruleId?: string                         // например, 'validator.rule-10' — для валидатора
                                            // парсер/assembler могут не задавать
    relatedInformation?: RelatedInfo[]      // опционально, для ссылок на связанные локации
}

RelatedInfo {
    file: string
    range: SourceRange
    message: string
}
```

## Конвенции

- Все коллекции — `ReadonlyMap`/`ReadonlyArray`/`readonly`-tuples. Caller не должен мутировать возвращённые структуры; в Phase 3 реализация обеспечит это через `Object.freeze` или TypeScript-типы.
- `null` означает «отсутствует», `undefined` не используется (за исключением опциональных полей, явно помеченных `?`).
- Path-строки (`SourceLocation.file`, `Diagnostic.file`, `ProjectFile.path`) — **opaque-идентификаторы**, не предполагают FS-операций со стороны core. Core их хранит, передаёт обратно caller'у в local-структурах и не парсит. Поиск файлов по glob-паттернам (например, `A0.*.idef0`) и любые FS-операции — задача `@idefy/loader`. Извлечение ID активности из `basename` (часть до первой точки) — выполняет парсер при наличии `ParseOptions.basename`; это не «парсинг path», это извлечение строкового префикса.
