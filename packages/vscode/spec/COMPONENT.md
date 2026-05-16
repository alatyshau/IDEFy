# @idefy/vscode

## Purpose

VS Code extension shell. Связывает чистую логику из [`@idefy/core`](../../core/spec/COMPONENT.md) и FS-операции из [`@idefy/loader`](../../loader/spec/COMPONENT.md) с пользовательским UX в VS Code.

Отвечает за:

- регистрацию языков `idef0` и `idef0.ascii`,
- TextMate-грамматику и semantic tokens (раскраска ролей стрелок),
- live-валидацию с debounce и публикацию диагностик через VS Code Diagnostic API,
- команду форматирования (`IDEFy: Format Document`),
- кнопку открытия ASCII-вьюера в editor toolbar,
- custom editor для `.idef0.ascii` (см. [`UI.md`](UI.md)),
- sidecar lifecycle (FS-события, синхронизация при rename/move/delete),
- авто-добавление `*.idef0.ascii` в `.gitignore`,
- banner для orphan `.idef0` файлов,
- multi-root workspace support.

**Не содержит** бизнес-логики IDEF0 — она вся в `@idefy/core`. Не делает прямых FS-операций — они через `@idefy/loader` с инжектируемым адаптером поверх `vscode.workspace.fs`.

UI-контракты — в отдельном файле [`UI.md`](UI.md).

## Engine и метаданные

- VS Code engine: `^1.95.0`. Зафиксировано как минимум; не понижать без явного решения.
- Extension ID: `idefy`.
- Display name: `IDEFy`.
- Дистрибуция: локальный `.vsix`, без публикации в Marketplace.

## Активация

Современные версии VS Code (`engine ^1.95`) автоматически выводят `onLanguage:`
и `onCustomEditor:` события из `contributes.languages` / `contributes.customEditors`,
поэтому в `package.json` они **не дублируются**. Явно объявляется только:

- `onStartupFinished` — для авто-добавления `*.idef0.ascii` в `.gitignore` каждого workspace folder'а (см. ниже).

## Регистрация языков

```
languages: [
    { id: 'idef0',        extensions: ['.idef0'],        aliases: ['IDEF0'] },
    { id: 'idef0.ascii',  extensions: ['.idef0.ascii'],  aliases: ['IDEF0 ASCII'] }
]
```

- `idef0` — основной язык DSL. Подключаются TextMate-грамматика и semantic tokens.
- `idef0.ascii` — язык для sidecar-файлов. TextMate-грамматика **не нужна** в текущей итерации, потому что sidecar открывается через custom editor (WebView), а не как текстовый editor. Регистрация языка остаётся для случаев, когда пользователь явно открывает `.idef0.ascii` как plain text (например, через "Reopen Editor With...").

## TextMate-грамматика для `idef0`

Скоупы подобраны так, чтобы «activity-семья» (ключевые слова, активити-ID, фигурные скобки тела, операторы списка `:` / `->`) делила один и тот же цвет — стандартные темы окрашивают `entity.name.activity` одним foreground'ом.

- `entity.name.activity.idef0` — `activity`, `context`, активити-ID (`A0`/`A1`/…/`A-0`/`...A0`), `{`, `}`, `:`, `->`. Шарят activity-цвет.
- `entity.name.arrow.input.idef0` / `.output` / `.control` / `.mechanism` / `.internal` / `.tunnel` — соответствующие ID стрелок (fallback под semantic tokens).
- `string.quoted.double.idef0` — строковые литералы.
- `comment.line.number-sign.idef0` — `#` комментарии.
- `punctuation.section.brackets.idef0` — `[`, `]` вне bracket-форм (внутри bracket-форм цвет переопределяется semantic-token'ом outer-роли).
- `punctuation.separator.idef0` — `,` (визуально приглушается декоратором в `descriptionForeground`).

Точный JSON грамматики — `syntaxes/idef0.tmLanguage.json`.

## Semantic tokens для `idef0`

Реализуется через `vscode.languages.registerDocumentSemanticTokensProvider`.

**Один кастомный token type `idef0Arrow` с шестью modifiers**, по одному на ролевой префикс ID (см. [`UI.md`](UI.md) §Semantic tokens и `package.json` → `contributes.semanticTokenTypes` / `semanticTokenModifiers` / `semanticTokenScopes`):

| Modifier    | Роль                  | Что красится                             |
|-------------|-----------------------|------------------------------------------|
| `input`     | I — Input             | I-стрелки, outer `I` в `I[...]` + скобки |
| `output`    | O — Output            | O-стрелки, inner `O` в `X[O*]`           |
| `control`   | C — Control           | C-стрелки, outer `C` в `C[...]` + скобки |
| `mechanism` | M — Mechanism         | M-стрелки, outer `M` в `M[...]` + скобки |
| `internal`  | X — Internal arrow    | X-стрелки, inner `X` в `*[X*]`, outer X  |
| `tunnel`    | T — Tunnel            | T-туннели, inner `T` в `*[T*]`           |

**Цвета задаются детерминированно через `TextEditorDecorationType`**, не через `semanticTokenColors` в contributions. Это сознательное отклонение: семантические токены сами по себе не позволяют расширению гарантировать конкретный цвет — итоговый foreground зависит от темы пользователя. Палитра и hex-коды зафиксированы в [`UI.md`](UI.md) §Цветовая палитра DSL. Modifiers + `semanticTokenScopes` маппинг на TextMate scope'ы оставлены ради совместимости с темами, которые таки решат покрасить через `editor.semanticTokenColorCustomizations`.

**Источник информации:** лексический скан исходного текста (см. `src/providers/arrow-scan.ts`). Спека изначально предписывала AST-walk через `core.parse`, но имплементация осознанно отклонилась по двум причинам:

1. **Робастность.** При наличии parse errors AST-провайдер потерял бы все семантические токены, пока пользователь печатает; лексический скан продолжает раскрашивать ID стрелок и в «битом» файле.
2. **Sub-token positions.** Ссылки вида `I[X11]` или `X11[T1]` несут на AST-узле один композитный `location`. Восстановление inner-vs-outer диапазонов всё равно требует посимвольного скана внутри этого диапазона, что фактически и делает лексический провайдер — напрямую.

DSL гарантирует, что роль однозначно кодируется первой буквой ID, поэтому лексический скан даёт тот же результат, что AST-walk на валидных файлах, и более полезное поведение на невалидных. Strings (`"..."`) и `#`-комментарии skip-руются, чтобы идентификаторо-подобные подстроки в литералах не раскрашивались.

**Производительность:** provider вызывается VS Code'ом по запросу, в т.ч. инкрементально через `provideDocumentSemanticTokensEdits` (опциональный API). В текущей итерации реализуем только полное `provideDocumentSemanticTokens` (нет инкрементальности); инкрементальность — `[TODO]` форвард, если упрёмся в производительность на больших файлах.

## Live-валидация

**Дебаунс 500 мс** на изменение `TextDocument`. По истечении debounce:

1. Парсим текущий документ через `core.parse(text, { filename })`.
2. Определяем `scanRoot` через `loader.findScanRoot(documentUri)` поверх адаптера на `vscode.workspace.fs`.
   - Если `scanRoot == null` — документ orphan «case 1» (вне любого `src/idef0/`), валидация выключается, показывается banner (см. [`UI.md`](UI.md)).
3. Вызываем `loader.discoverProjects(scanRoot)` → получаем `DiscoveryResult { projects, orphans }`.
4. Определяем, попал ли текущий документ в один из `projects[].files` или в `orphans`:
   - Если в `orphans` — документ orphan «case 2» (под `scanRoot`, но вне любого проекта). Banner показывается, валидация per-project пропускается, но **rule-16 диагностика публикуется** (см. шаг 8).
   - Если в каком-то `ProjectDescriptor` — продолжаем с этим проектом.
5. Собираем все `.idef0` файлы проекта (`ProjectDescriptor.files`). Для каждого:
   - Если файл = текущий открытый документ — используем его in-memory содержимое из `TextDocument.getText()`.
   - Иначе — читаем через адаптер. Кэш ParsedFile, инвалидируем по `onDidChangeTextDocument` и `onDidChangeFiles`.
6. Парсим все собранные файлы (с кэшем).
7. Вызываем `core.assembleProject(parsedFiles, scanRoot, projectRoot)`.
8. Вызываем `core.validate(project)` для рулов 4, 7–15, 17. Дополнительно вызываем `core.validateOrphans(discoveryResult.orphans)` для правила 16.
9. Объединяем диагностики: parser errors + assembler errors + validator diagnostics + orphan diagnostics.
10. Публикуем через `vscode.languages.createDiagnosticCollection('idefy')` в виде `vscode.Diagnostic` с маппингом severity и range. Orphan-диагностики публикуются под URI orphan-файлов, даже если они не открыты в editor'ах (появятся в Problems panel).

Caller debounce'а — `vscode.workspace.onDidChangeTextDocument`. Debounce per document, не глобальный.

**Multi-root workspaces.** Для каждого workspace folder — независимая loader-сессия. Проекты разных рутов изолированы.

## Context keys

Расширение выставляет VS Code context keys для when-clauses в menu/keybindings:

- `idefy.inProject` — `true`, если активный документ принадлежит recognized project (попал в `ProjectDescriptor.files`).
- `idefy.isOrphan` — `true`, если активный документ — orphan любого случая (нет `scanRoot` ИЛИ есть `scanRoot`, но файл в `DiscoveryResult.orphans`).
- `idefy.inInvalidProject` — `true`, если активный документ принадлежит invalid project descriptor (`projectRoot == scanRoot`, правило 14).

Context keys обновляются при каждом активации/смене editor'а и при каждом проходе live-валидации. Команды дополнительно делают **runtime guards** в handler'ах, потому что Command Palette и Extensions API позволяют вызвать команду в обход when-clauses.

## Команда форматирования

```
command:    idefy.formatDocument
title:      "IDEFy: Format Document"
keybinding: shift+alt+f when editorLangId == idef0 && idefy.inProject
menu:       editor/context when editorLangId == idef0 && idefy.inProject (group: '1_modification')
```

**Поведение:**

1. Получаем активный editor; runtime guard: `languageId == idef0` И активный документ принадлежит valid project (не orphan, не invalid project). Иначе показываем notification «File outside IDEF project; cannot format.» и прерываем.
2. Парсим in-memory содержимое через `core.parse({ filePath: documentUri.fsPath, basename: <basename> })`.
3. Если `parseErrors.length > 0` — **форматтер не запускается.** Показываем notification «Cannot format: file has parse errors. Fix diagnostics first.» Live-валидация уже подсветила ошибки. Прерываем команду.
4. Вызываем `core.format(ast, { maxLineWidth: settings.get('idefy.formatter.maxLineWidth') })`.
5. Применяем результат через `vscode.WorkspaceEdit` к активному документу (replace всего диапазона). Это undoable.
6. Собираем `IdefProject` (как в live-валидации, шаги 2–6 выше).
7. Вызываем `core.createRendererRegistry().get('ascii').render(project)` — получаем `RenderResult.sidecars: Map<idef0Path, content>`. **Core возвращает только содержимое; запись на диск делает шаг 8.**
8. Для каждой пары `(idef0Path, content)` в `RenderResult.sidecars`:
   - Вычисляем sidecar-путь через `loader.sidecarPathFor(idef0Path)`.
   - Пишем через loader-адаптер `fs.writeFile(sidecarPath, content)`.
9. Если custom editor для соответствующего sidecar открыт — VS Code сам отреагирует на изменение файла, custom editor сделает refresh (см. [`UI.md`](UI.md)).

**Что _не_ делает форматтер:** не запускается на save; не запускается автоматически на изменение текста; не запускается при открытии файла. Только по явной команде.

## Команда "View ASCII"

```
command:    idefy.viewAscii
title:      "IDEFy: View ASCII"
menu:       editor/title when resourceLangId == idef0 && idefy.inProject (group: 'navigation')
```

Контракт UX — в [`UI.md`](UI.md). Команда:

1. Runtime guard: `languageId == idef0` И активный документ — в valid project. Иначе showInformationMessage «File outside IDEF project; ASCII view unavailable.» и прерываем.
2. Получает URI активного `.idef0` файла.
3. Вычисляет sidecar URI через `loader.sidecarPathFor`.
4. Проверяет существование sidecar через `fs.exists`. Если нет — showInformationMessage «Sidecar not found. Run `IDEFy: Format Document` to generate.» и прерывает.
5. Открывает sidecar в соседнем табе той же editor group:
   - `vscode.commands.executeCommand('vscode.openWith', sidecarUri, 'idefy.asciiViewer', { viewColumn: vscode.ViewColumn.Active, preview: false })`.

## Custom editor для `.idef0.ascii`

Регистрируется как:

```
viewType:    'idefy.asciiViewer'
displayName: 'IDEFy ASCII Viewer'
selector:    [{ filenamePattern: '*.idef0.ascii' }]
priority:    'default'
```

Контракт UX, layout, кнопки экспорта — в [`UI.md`](UI.md).

## Settings

Единственная настройка в текущей итерации:

```
"idefy.formatter.maxLineWidth": {
    type: "number",
    default: 120,
    description: "Максимальная ширина строки для триггера Mode 2/3 в форматтере."
}
```

Других настроек не добавляем без явного решения — каждая новая настройка увеличивает surface area.

## Sidecar lifecycle (FS watcher)

API VS Code: `vscode.workspace.createFileSystemWatcher(globPattern, ignoreCreate?, ignoreChange?, ignoreDelete?)`. `globPattern` — это `string | RelativePattern`, не URI.

Используем **один workspace-wide watcher на extension**:

```
const watcher = vscode.workspace.createFileSystemWatcher(
    '**/*.idef0',
    false,  // не игнорировать create
    true,   // игнорировать change (на content events не реагируем)
    false   // не игнорировать delete
);
```

**На события:**

- **`onDidDelete(uri)`** для `<name>.idef0` → если `<name>.idef0.ascii` существует, удаляем его.
- **`onDidCreate(uri)`** для `<name>.idef0` → ничего не делаем (sidecar появится после первого форматирования).
- **Rename/move** — VS Code сообщает через `vscode.workspace.onDidRenameFiles` (отдельная подписка, не file watcher). Для каждого rename `from → to`: если `from` имеет расширение `.idef0` и существует `from.idef0.ascii` — переименовываем sidecar в `to.idef0.ascii`.

**Не делает** контентной синхронизации (ASCII меняется только по команде форматирования). FS watcher отвечает только за **lifecycle** (existence, naming), не за **content sync**.

Custom editor для `.idef0.ascii` подписывается на свои собственные изменения (см. [`UI.md`](UI.md), раздел про refresh) — это отдельный механизм, не связан с этим watcher'ом.

## Gitignore auto-entry

При активации в каждом workspace folder:

1. Читаем `<workspaceFolder>/.gitignore` через адаптер.
2. Если файл не существует **или** не содержит строку, матчащую паттерн `*.idef0.ascii` (точное совпадение или подматчер вроде `**/*.idef0.ascii` или `*.ascii`) — добавляем строку `*.idef0.ascii` в конец файла (создаём файл, если не было).
3. Делаем это **один раз** за workspace activation. Не следим за изменениями `.gitignore` в runtime — пользователь может удалить запись, и при следующей активации мы её вернём; явный отказ от такого поведения — `[TODO]` если будет жалоба.

Workspace folder без git-репозитория тоже обрабатывается — на случай, если пользователь добавит git позже.

## Orphan handling

Два случая orphan-файлов, обработка разная (UX-контракт — [`UI.md`](UI.md)):

- **Case 1: `loader.findScanRoot(uri) == null`.** Файл вне любого `src/idef0/`. Нет project context — рулы валидатора в принципе неприменимы. Показываем **`vscode.window.showInformationMessage`** с per-file дедупликацией (один раз на сессию для конкретного URI). Текст: «File outside IDEF project. Move under `src/idef0/<package>/` to enable validation.»
- **Case 2: `findScanRoot` нашёл, но файл в `DiscoveryResult.orphans`.** Под `src/idef0/`, но вне любого проекта. Live-валидация per-project пропускается, но публикуется **единственная file-level Diagnostic** правила 16 от `core.validateOrphans` — она появляется в Problems panel и как info-marker в файле. **Не показываем** отдельный showInformationMessage — Diagnostic уже доносит информацию через стандартную VS Code-поверхность.

В обоих случаях команды (`Format Document`, `View ASCII`) для документа отключаются: when-clauses используют `idefy.inProject`, runtime guards в handler'ах проверяют то же.

## Behaviors

- **Multi-root**: каждый workspace folder обрабатывается независимо. Проекты не пересекаются в id-пространствах. Команды действуют на активный editor, который однозначно принадлежит одному workspace folder'у.
- **Кэширование**: ParsedFile кэшируются в памяти на время сессии. Инвалидация — при `onDidChangeTextDocument` (in-memory) и при FS-событиях (внешние правки). Полностью пересоздаём при изменении workspace folders.
- **Производительность**: target — debounced revalidate в пределах 200 мс на проекте до 50 файлов. Конкретные бенчмарки — задача Phase 3.

## Invariants

- Бизнес-логика IDEF0 **никогда не реализуется** в этом пакете. Если возникает соблазн посчитать что-то на месте — это знак, что функция должна быть в `@idefy/core`.
- FS-операции **никогда не идут мимо `@idefy/loader`-адаптера**. Прямое `vscode.workspace.fs` использование запрещено в кодовой базе пакета, **за исключением** места, где создаётся адаптер и оборачивается в loader-интерфейс.
- VS Code Notebook API не используется. UX-связка DSL ↔ ASCII делается через нативный text editor + Custom Editor для sidecar (см. [`UI.md`](UI.md)), а не через `vscode.workspace.registerNotebookSerializer`.

## Errors

- **FS-ошибки в loader-адаптере** → ловим в команд-handler'ах, показываем notification, не падаем.
- **Парсер/валидатор/форматтер не выбрасывают** по контракту `@idefy/core`. Если выбрасывают — это баг core, ловим и логируем в Output channel.
- **Невалидное состояние UI** (например, custom editor не может прочитать sidecar) → показываем сообщение в WebView, не падаем.

## Dependencies

- `@idefy/core` — для `parse`, `assembleProject`, `validate`, `format`, `createRendererRegistry`, типов AST/Project/Diagnostic.
- `@idefy/loader` — для `findScanRoot`, `discoverProjects`, `listProjectFiles`, `sidecarPathFor`, `isOrphan`, типа `FsAdapter`.
- VS Code API (`vscode` тип-import).
- Никаких других runtime-зависимостей в текущей итерации.

## Open questions

Ничего открытого.
