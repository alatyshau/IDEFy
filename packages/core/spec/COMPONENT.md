# @idefy/core

## Purpose

Чистая логика обработки IDEF0-моделей: парсинг текста `.idef0` файлов, сборка project model, валидация, форматирование, делегация рендеринга ASCII-схемы.

**Не зависит** от VS Code API, файловой системы и Node-специфики (за исключением `TextEncoder`/`TextDecoder`). Все операции — чистые функции над in-memory структурами. FS-IO живёт в [`@idefy/loader`](../../loader/spec/COMPONENT.md); UX-обёртки — в [`@idefy/vscode`](../../vscode/spec/COMPONENT.md).

Это разделение — форвард-обязательное: открывает дорогу к LSP-серверу и кросс-редакторной поставке (см. forward direction в [`spec/PRODUCT.md`](../../../spec/PRODUCT.md)).

## Состав

Логически разделён на пять зон:

- **Парсер** — текст `.idef0` → AST одного файла + диагностики парсинга.
- **Project assembler** — список ParsedFile → `IdefProject` + диагностики структуры проекта.
- **Валидатор** — `IdefProject` → семантические диагностики по правилам [`spec/04-validator.md`](../../../spec/04-validator.md).
- **Форматтер** — AST одного файла → отформатированный текст по правилам [`spec/02-formatting.md`](../../../spec/02-formatting.md).
- **Renderer registry** — pluggable архитектура рендереров. В текущей итерации зарегистрирован один рендерер — `ascii` (заглушка, см. [`RENDERERS.md`](RENDERERS.md)).

Структуры данных — в [`DATA_MODEL.md`](DATA_MODEL.md). Контракт рендереров — в [`RENDERERS.md`](RENDERERS.md).

## Public API contract

Сигнатуры даются как типы; реализация — задача Phase 3.

### Парсер

```
parse(text: string, options?: ParseOptions): ParseResult

ParseOptions {
    filePath?: string       // полный путь файла как opaque-идентификатор; используется
                            // для source locations в AST и Diagnostic (caller получает
                            // ту же строку обратно при чтении locations).
    basename?: string       // имя файла без пути (например, "A0.brewing.idef0");
                            // используется для извлечения ID активности из имени
                            // (часть до первой точки) в поле filenameId AST.
}

ParseResult {
    ast: ActivityAST | ContextAST | null  // null, если файл не содержит шапки activity/context
    errors: Diagnostic[]                   // ошибки парсинга
}
```

`filePath` и `basename` независимы: caller может передать оба, ни одного, или только один. Парсер не делает FS-операций (нет резолва пути), не парсит структуру `filePath` (это opaque-строка), не сравнивает `basename` с header'ом активности — он только извлекает префикс до первой точки и кладёт в `filenameId`. Сверка `filenameId == header.id` — задача валидатора (правило 10 из [`spec/04-validator.md`](../../../spec/04-validator.md)).

### Project assembler

```
assembleProject(files: ParsedFile[], scanRoot: string, projectRoot: string): AssembleResult

ParsedFile {
    path: string            // полный путь файла (любая строка-идентификатор; FS-агностично)
    ast: ActivityAST | ContextAST | null
    parseErrors: Diagnostic[]
}

AssembleResult {
    project: IdefProject | null   // null только если files == [] (нечего собирать).
                                  // При любых других структурных нарушениях
                                  // (нет A0, нет A-0, дубли ID, и т. п.) возвращается
                                  // максимально полная модель + diagnostics в errors.
    errors: Diagnostic[]          // структурные ошибки проекта (assembler-source)
}
```

Project assembler **не парсит** — он работает над уже распарсенными файлами. Это нужно, чтобы `@idefy/vscode` мог кэшировать ParsedFile между вызовами и пересобирать проект инкрементально при изменении одного файла.

**Best-effort политика.** При отсутствии A0 / A-0, дубликате id, лишнем context-файле и т. п. assembler возвращает частично собранный `IdefProject` плюс диагностики в `errors`, а не `null`. `null` — только когда вход пуст. Это даёт `@idefy/vscode` live-friendly поведение: пользователь видит и проблему (через диагностики), и то, что уже собралось (через model).

### Валидатор

```
validate(project: IdefProject): Diagnostic[]
validateOrphans(orphanFilePaths: string[]): Diagnostic[]
```

`validate(project)` применяет правила из [`spec/04-validator.md`](../../../spec/04-validator.md), **не помеченные `[TODO]`** и **проверяемые в границах одного проекта**: правила **4, 7–14, 17, 18**. Правила 1–3 (ICOM-согласованность) и 5–6 (туннели) — `[TODO]`, не реализуются. Правило **15** (запрет вложенных проектов) реализуется на стороне [`@idefy/loader`](../../loader/spec/COMPONENT.md), потому что требует FS-обзора и группировки файлов в проекты — недоступно из `IdefProject` в изоляции (loader при сканировании видит, что внутри одного проекта лежит маркер второго `A0.*.idef0` и репортит это как структурную ошибку).

`validateOrphans(orphanFilePaths)` реализует правило 16 («Принадлежность файла проекту»): для каждого пути из списка генерирует Diagnostic с `severity: 'error'`, `ruleId: 'validator.rule-16'`, `file: <path>`, range — на первой строке, сообщение «`.idef0` file under `src/idef0/` but outside any project root». Список orphan-файлов поставляет caller (`@idefy/vscode` через [`@idefy/loader`](../../loader/spec/COMPONENT.md) → `discoverProjects().orphans`).

Разделение на две функции — потому что `validate` требует `IdefProject` (per-project scope), а правило 16 описывает файлы, **не принадлежащие** никакому проекту (per-scanRoot scope).

### Форматтер

```
format(ast: ActivityAST | ContextAST, options: FormatOptions): string

FormatOptions {
    maxLineWidth: number    // в текущей итерации единственный параметр; default'ы задаёт caller
}
```

Возвращает отформатированный текст одного файла. Применяет правила из [`spec/02-formatting.md`](../../../spec/02-formatting.md) полностью — для обоих типов узлов: `activity` (граничные стрелки + функциональные блоки + комментарии + Modes 1/2/3) и `context A-0` (туннели + опциональная `...A0`-ссылка + комментарии).

**Не вызывается на сломанном AST** (с `parseErrors`); это ответственность caller'а — проверить и не вызывать.

**Trailer dropped.** Любой текст после закрывающей `}` шапки активности/контекста в исходном файле — не сохраняется при форматировании (per [`spec/02-formatting.md`](../../../spec/02-formatting.md), раздел «Текст после закрывающей `}` шапки»). AST не хранит этот текст, форматтер не имеет к нему доступа. Сознательный отказ — формат вызывается по явной команде пользователя.

### Renderer registry

См. [`RENDERERS.md`](RENDERERS.md).

## Behaviors

### Парсер

- Реализует синтаксис из [`spec/01-dsl.md`](../../../spec/01-dsl.md) полностью.
- **Panic-mode recovery.** При синтаксической ошибке восстанавливается до следующего sync-токена: `;`, `}` или конца строки. Это позволяет собрать максимум информации из частично сломанного файла, что критично для live-валидации в IDE.
- Парсер всегда возвращает результат (best-effort), даже если файл содержит ошибки. Ошибки накапливаются в `errors`.
- Многострочные объявления функциональных блоков (Modes 2/3 из [`spec/02-formatting.md`](../../../spec/02-formatting.md)) распознаются: переносы строк после `->` и после `,` внутри списка стрелок интерпретируются как обычные пробелы.
- Источник ID активности/контекста — **шапка** файла. Если `options.basename` передан, парсер дополнительно извлекает ID из имени файла (часть до первой точки) и кладёт в результат как `filenameId`. Сверка `filenameId` против `header.id` — задача validator'а (правило 10 из `spec/04-validator.md`).
- Каждый узел AST хранит `SourceLocation` (file, line, column для начала; line, column для конца), см. [`DATA_MODEL.md`](DATA_MODEL.md). Это форвард-обязательное требование (см. forward direction в `PRODUCT.md`: cross-file навигация).
- Анализ прекращается после закрывающей `}` шапки активности или контекста — всё дальше игнорируется парсером (per [`spec/01-dsl.md`](../../../spec/01-dsl.md)).

### Project assembler

- Реализует сборку проекта по правилам из [`spec/03-layout.md`](../../../spec/03-layout.md) и [`spec/01-dsl.md`](../../../spec/01-dsl.md) (раздел «Проект»).
- Вычисляет имя проекта из пути `scanRoot → projectRoot` (Java-package notation).
- Строит иерархию декомпозиции по ID активностей и собирает родитель↔наследник связи в `IdefProject`. Эти связи — форвард-обязательные (см. cross-file навигация).
- При структурных нарушениях (отсутствие A0/A-0, дубли ID, orphan-файлы) — выдаёт диагностики, но возвращает максимально полную модель.

### Валидатор

- `validate(project)` применяет правила без `[TODO]` маркеров **и** с per-project scope (сейчас 4, 7–14, 17, 18). Правило 16 — отдельная функция `validateOrphans` (см. Public API). Правило 15 делегировано в `@idefy/loader`.
- Каждая диагностика содержит ссылку на правило (поле `ruleId`), source range и severity (`error` / `warning`).
- Live-friendly: работает на incomplete project'е (например, с одним невалидным файлом из десятка) без exceptions.

### Форматтер

- Реализует полную спецификацию [`spec/02-formatting.md`](../../../spec/02-formatting.md) без исключений.
- Сортировка функциональных блоков по ID. Сортировка стрелок внутри ролей-групп (правило сортировки — спека форматирования).
- Выбор Mode 1/2/3 по триггерам из `spec/02-formatting.md`.
- Прилипание комментариев к блокам (спека форматирования, раздел 3.6).
- `maxLineWidth` берётся из `FormatOptions`; в продукте дефолт 120, но дефолт задаёт caller — форматтер default не имеет.

### Renderer

- Форматтер **не делает** рендеринг ASCII сам. Рендеринг — отдельный шаг pipeline'а, делегируется в `Renderer registry`. См. [`RENDERERS.md`](RENDERERS.md).
- В текущей итерации единственный рендерер `ascii` возвращает строку `ASCII\n` независимо от входа.

## Invariants

- Парсер **никогда не выбрасывает исключения** на любой входной строке. Любые проблемы — через `errors`.
- Валидатор **никогда не выбрасывает исключения** на любом `IdefProject` (включая частично собранные).
- Форматтер **может** выбрасывать `InvariantViolation`, если получает AST с `parseErrors`. Caller обязан проверять.
- AST неизменяем после возврата из парсера. Все операции форматтера/валидатора — read-only поверх AST.
- Source locations в AST референсят оригинальный текст: при многострочных объявлениях диагностика указывает либо конкретную физическую строку, либо строку начала логического объявления (per `spec/04-validator.md`).

## Errors

Все диагностики — в едином формате `Diagnostic` (см. [`DATA_MODEL.md`](DATA_MODEL.md)):

- `severity`: `error` | `warning` | `info`.
- `range`: `SourceRange`.
- `message`: человекочитаемое сообщение.
- `ruleId?`: идентификатор правила (для валидатора).
- `source`: `parser` | `assembler` | `validator`.

Контракт: код, использующий `@idefy/core`, не делает try/catch вокруг основных функций (см. invariants). Все исключения = баги.

## Dependencies

- На другие пакеты IDEFy: **никаких**.
- Внешние: `TextEncoder`/`TextDecoder` (стандарт Web/Node), TypeScript stdlib (Map, Set). Никаких parser-генераторов и runtime-зависимостей — парсер пишется вручную (handcrafted recursive-descent).

## Open questions

Ничего открытого. Все вопросы по DSL/форматированию/раскладке/валидации решаются ссылками на доменную спеку. Если в Phase 3 (Implementation) обнаружится противоречие или пробел — это сигнал поправить доменную спеку, а не подменить решение здесь.
