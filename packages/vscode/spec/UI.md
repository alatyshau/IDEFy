# @idefy/vscode — UI Contracts

UX-поведение пакета: что и где видит пользователь, как взаимодействует. Реализационные подробности (компиляция расширения, регистрация провайдеров) — в [`COMPONENT.md`](COMPONENT.md).

## Editor toolbar button: "View ASCII"

**Где:** правый верхний угол editor pane, когда активный таб — `.idef0` файл (стандартный VS Code editor title menu, location `editor/title`, group `navigation`).

**Иконка:** codicon `preview` (или `eye`; финальный выбор — Phase 3).

**Тултип:** "View ASCII".

**Поведение по клику:** запускает команду `idefy.viewAscii` (см. [`COMPONENT.md`](COMPONENT.md)). Результат:

- Если sidecar `<name>.idef0.ascii` существует → открывается в **новом табе той же editor group**. Текущий `.idef0` таб **остаётся открытым**, становится неактивным (фокус переходит на ASCII-таб).
- Если sidecar не существует → notification «Sidecar not found. Run `IDEFy: Format Document` to generate.»

**Параметры открытия:**

- `viewColumn: ViewColumn.Active` — в текущую editor group, **не** split.
- `preview: false` — обычный закреплённый таб, не preview-italic.
- Custom editor type: `idefy.asciiViewer`.

**Не делает:**

- Не открывает split view справа.
- Не использует preview-режим (таб не пересоздаётся при следующем клике с другого `.idef0`).
- При повторном клике с того же `.idef0`, если sidecar уже открыт — VS Code сам переключает фокус на существующий таб без второго открытия.

## Custom Editor: ASCII Viewer

**View type:** `idefy.asciiViewer`. Default для `*.idef0.ascii`.

**Открытие:** автоматически, когда пользователь открывает `.idef0.ascii` (через "View ASCII" кнопку, через File → Open, через клик в Explorer). Если пользователь хочет видеть raw text — `Reopen Editor With...` → `Text Editor`.

### Layout

Single-pane WebView с тремя зонами:

1. **Toolbar сверху** — горизонтальная полоса с кнопками действий. См. ниже.
2. **Viewer area** — основная область, monospace font, white background (адаптируется под VS Code тему). Содержит отрендеренный ASCII-контент из sidecar-файла.
3. **(Опционально) Status bar снизу** — путь к источнику (`<name>.idef0`), индикатор "in sync / stale". В текущей итерации **не делаем** stale-индикатор (см. ниже), но место в layout зарезервировано.

### Содержимое viewer area

В текущей итерации — содержимое sidecar-файла как есть. ASCII-рендерер выдаёт одно слово `ASCII` (см. [`packages/core/spec/RENDERERS.md`](../../core/spec/RENDERERS.md)), поэтому viewer показывает это слово.

**Стилизация:**

- Monospace font (`var(--vscode-editor-font-family)`).
- Цвет текста: `var(--vscode-editor-foreground)`.
- Фон: `var(--vscode-editor-background)`.
- Padding по краям, scrollable (для будущих больших ASCII-диаграмм).
- **Семантическая раскраска ролей стрелок** (когда реальный ASCII-рендер появится): тот же mapping ролей и цветов, что для DSL semantic tokens. Это форвард-обязательное требование: рендерер выдаёт plain ASCII + структурную разметку токенов (механизм разметки — `[TODO]`, будет введён вместе с реальным рендерером), viewer применяет CSS-цвета по ролям.

В текущей итерации `ascii` renderer (см. `@idefy/core/spec/RENDERERS.md`) — детерминированная placeholder-заглушка, которая для каждой активности выдаёт identifier-summary:

```
# IDEFy ASCII placeholder for A1 "Помол зерна"
  I: I1
  C: C1
  M: M1 M2
  O: O1
  X: X11
  children: A11 A12
```

Это не настоящая ASCII-диаграмма, а минимальный материал для UI-пайплайна: viewer токенизирует placeholder, оборачивает каждый ID в colored span по semantic-токенам, и так проверяется вся цепочка ролевой раскраски — включая PNG-экспорт. Реальный layout-рендерер заменит placeholder без изменения публичного контракта `Renderer`.

### WebView security

Sidecar в текущей итерации — детерминированная заглушка. Однако post-MVP sidecar будет содержать описания стрелок и блоков, которые пришли из `.idef0` (текст, написанный пользователем — могут содержать `<`, `>`, `&`, кавычки, скрипт-подобный контент). WebView рендерит **workspace-controlled content**, поэтому требования к безопасности обязательны с MVP:

1. **Escape всего workspace-content.** Содержимое sidecar вставляется в DOM исключительно через `element.textContent = ...` или эквивалентное (например, через `document.createTextNode`). **Никогда `innerHTML`** для контента из sidecar или вообще из workspace.
2. **Content Security Policy.** WebView отдаёт `<meta http-equiv="Content-Security-Policy">` с:
   - `default-src 'none'`
   - `style-src ${webview.cspSource} 'unsafe-inline'` (inline-стили для дин. раскраски ролей)
   - `script-src ${webview.cspSource} 'nonce-{nonce}'` (nonce-генерация на каждое открытие)
   - `img-src ${webview.cspSource} data:` (для PNG-canvas экспорта)
   - **Не разрешать** `font-src`, `connect-src`, `child-src`, `frame-src`.
3. **`enableCommandUris: false`** в `WebviewOptions`. Запрещаем command URIs полностью — у нас нет use case'а, требующего их.
4. **`localResourceRoots`** — минимальный набор: только директория самого extension'а (для иконок toolbar) и директория файла sidecar'а (если потребуется загружать прилегающие ресурсы; в MVP не используется, но оставим extension dir).
5. **`postMessage` validation.** Все сообщения от WebView к extension host'у — strictly-typed по схеме `{ kind: 'copy-text' | 'copy-png' | 'request-refresh', payload?: ... }`. Любой `kind` вне набора — игнорируется и логируется в Output channel. `payload` валидируется per-kind (например, payload для `copy-png` — массив bytes ограниченного размера).
6. **Никаких `eval`, `Function()`, `setTimeout(string)`, `setInterval(string)`** в WebView-скриптах.

Эти ограничения проверяются code review'ом в Phase 3 и закладываются в шаблон WebView перед первым merge.

### Toolbar buttons

Слева направо:

1. **`Copy as Text`**
   - Иконка: codicon `copy`.
   - Тултип: "Copy ASCII as Text".
   - Поведение: копирует raw содержимое sidecar-файла в clipboard (через VS Code `vscode.env.clipboard.writeText` — команда из extension host'а, инициируется postMessage из WebView).
   - Toast/feedback: notification "Copied" внизу VS Code.

2. **`Copy as PNG`**
   - Иконка: codicon `device-camera` (в MVP toolbar показывает текстовую подпись «Copy as PNG»; иконочные кнопки — Phase 3).
   - Тултип: "Copy ASCII as PNG (with role colors)".
   - Поведение:
     - WebView получает контент sidecar'а + лексические токены `(offset, length, role)[]` от extension host'а (см. `src/sidecar/ascii-tokens.ts`), строит DOM как последовательность `<span class="role-X">` с CSS-цветами из общей палитры (см. §Цветовая палитра DSL).
     - Клик по кнопке вызывает `renderViewerToPng()`: расходит DOM viewer'а на сегменты `(text, color)` с учётом `\n`, измеряет ширину каждой строки через `CanvasRenderingContext2D.measureText`, аллоцирует canvas (с учётом `window.devicePixelRatio` для retina), заливает фон цветом editor background, рисует сегмент за сегментом методом `fillText` с `fillStyle = seg.color` — итог совпадает с тем, что видит пользователь на экране.
     - WebView пытается записать blob в clipboard через `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`. Успех → постит host'у `{ kind: 'copy-png-ok' }`; host показывает «IDEFy: ASCII copied as PNG».
     - Если image-clipboard не поддерживается (старый Electron на некоторых Linux-сборках, нет `ClipboardItem`) — WebView сериализует blob в base64 и постит host'у `{ kind: 'copy-png-fallback', payload: { base64 } }`. Host открывает `vscode.window.showSaveDialog` (default URI рядом с sidecar'ом, расширение `.png`) и записывает байты через хост-helper `writeBinaryToWorkspace`. Тост: «IDEFy: saved `<name>.png`».
     - Если рендер сорвался (canvas или ClipboardItem бросили исключение) — WebView постит `{ kind: 'copy-png-failed', payload: { reason } }`. Host логирует причину в Output channel + показывает warning «failed to copy ASCII as PNG (see IDEFy Output)».
   - **Реальный layout-алгоритм** (раскладка блоков и стрелок) — задача Phase 3 ASCII-рендерера. До тех пор `core.renderers.ascii` выдаёт сводку ID (см. [`packages/core/spec/RENDERERS.md`](../../core/spec/RENDERERS.md)) — этого достаточно, чтобы прокрасить и протестировать PNG-пайплайн end-to-end на любом валидном проекте.

**Стилизация toolbar:**

- Стандартные VS Code button styles из CSS-переменных темы.
- Высота ~28px, padding между кнопками 4px.
- Toolbar занимает всю ширину, прикреплён к верху (sticky при скролле viewer area).

### Refresh при изменении sidecar-файла

Custom editor подписывается на FS-события. API VS Code: `createFileSystemWatcher(globPattern, ignoreCreate?, ignoreChange?, ignoreDelete?)` — принимает `string | RelativePattern`, не URI.

Для каждого открытого sidecar custom editor создаёт **per-sidecar watcher** с `RelativePattern`:

```
const folder = vscode.Uri.joinPath(sidecarUri, '..');
const basename = path.posix.basename(sidecarUri.path);
const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, basename),
    true,   // ignore create (sidecar уже существует — иначе custom editor не открылся бы)
    false,  // не игнорировать change — это наш главный сигнал
    true    // ignore delete (delete обрабатывается через onDidDelete основного watcher'а из COMPONENT.md)
);
```

При `onDidChange`:

1. Extension host читает новое содержимое через `vscode.workspace.fs.readFile`.
2. Шлёт `postMessage` в WebView со схемой `{ kind: 'refresh', payload: { content: <string> } }`.
3. WebView перерисовывает viewer area через `textContent` (никакого `innerHTML`).

Это критично для UX: после `IDEFy: Format Document` ASCII-вьюер должен сам обновиться, без ручного перезакрытия таба. Watcher отписывается при закрытии custom editor (`onDidDispose`).

### Read-only

Viewer area **не редактируема**. WebView не содержит textarea/contenteditable. Это естественный read-only — Custom Editor отображает контент через DOM-разметку, написание в него физически невозможно.

Если пользователю нужно править ASCII вручную (anti-pattern, но возможно) — `Reopen Editor With... → Text Editor`. При следующем `IDEFy: Format Document` правки будут перезаписаны рендерером.

### Stale state

После изменений DSL и до следующего форматирования sidecar содержит **устаревший** ASCII. В текущей итерации **никаких индикаторов stale в UI не показываем** — это решение из доменного контракта (форматтер только по явной команде, см. [`COMPONENT.md`](COMPONENT.md)). Пользователь сам помнит, что нужно `Shift+Alt+F`.

Если в будущем UX-обратная связь покажет, что stale-индикатор нужен — место в status bar viewer'а зарезервировано, добавим.

## Diagnostics (red squiggles + Problems panel)

Через стандартный `vscode.languages.createDiagnosticCollection('idefy')` + `vscode.Diagnostic[]`.

**Маппинг severity:**

- `core.Diagnostic.severity == 'error'` → `vscode.DiagnosticSeverity.Error`.
- `'warning'` → `vscode.DiagnosticSeverity.Warning`.
- `'info'` → `vscode.DiagnosticSeverity.Information`.

**Маппинг range:** `core.SourceRange` (1-based line/column) → `vscode.Range` (0-based) с конвертацией `line - 1`, `column - 1`.

**Поле `code`:** заполняется из `core.Diagnostic.ruleId` (например, `validator.rule-10`). Виден в Problems panel и доступен для Quick Fix'ов в будущем.

**Поле `source`:** строка `"IDEFy"`.

**Related information:** маппится из `core.Diagnostic.relatedInformation` в `vscode.DiagnosticRelatedInformation`.

**Скоупинг:** диагностики **per-document**, но валидатор работает над всем проектом. Диагностика с `file == X.idef0` публикуется в DiagnosticCollection под URI этого `X.idef0` — даже если документ X.idef0 сейчас не открыт. VS Code покажет её в Problems panel.

## Semantic tokens — раскраска ролей стрелок

### Token type и modifiers

Token IDs не должны содержать точку — селекторы semantic-token colors используют синтаксис `tokenType.modifier` ([Semantic Highlight Guide](https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide)). Поэтому:

- **Один custom token type:** `idef0Arrow`.
- **Шесть modifiers:** `input`, `output`, `control`, `mechanism`, `internal`, `tunnel`.

Provider возвращает токен `(idef0Arrow, [<modifier>])` для каждого упоминания ID стрелки.

### Contribution points в `package.json`

```jsonc
"contributes": {
  "semanticTokenTypes": [
    { "id": "idef0Arrow", "description": "An IDEF0 arrow reference" }
  ],
  "semanticTokenModifiers": [
    { "id": "input",     "description": "Input role (I)" },
    { "id": "output",    "description": "Output role (O)" },
    { "id": "control",   "description": "Control role (C)" },
    { "id": "mechanism", "description": "Mechanism role (M)" },
    { "id": "internal",  "description": "Internal arrow (X)" },
    { "id": "tunnel",    "description": "Tunnel (T)" }
  ],
  "semanticTokenScopes": [
    {
      "language": "idef0",
      "scopes": {
        "idef0Arrow.input":     ["entity.name.arrow.input.idef0"],
        "idef0Arrow.output":    ["entity.name.arrow.output.idef0"],
        "idef0Arrow.control":   ["entity.name.arrow.control.idef0"],
        "idef0Arrow.mechanism": ["entity.name.arrow.mechanism.idef0"],
        "idef0Arrow.internal":  ["entity.name.arrow.internal.idef0"],
        "idef0Arrow.tunnel":    ["entity.name.arrow.tunnel.idef0"]
      }
    }
  ]
}
```

`semanticTokenScopes` мапит semantic-token селекторы на TextMate scope'ы — благодаря этому **темы**, которые не определяют semantic colors, отрисовывают наши токены через свои TextMate-цвета для соответствующих scope'ов (defensive fallback). Сами TextMate scope'ы регистрируются TextMate-грамматикой `idef0` (см. [`COMPONENT.md`](COMPONENT.md)).

### Цвета по умолчанию

Не задаются жёстко через `contributes.colors` — наследуются из активной темы через TextMate-fallback (mechanism из `semanticTokenScopes` выше). Пользователь может переопределить через `editor.semanticTokenColorCustomizations` в settings, используя селекторы `idef0Arrow.input` и т.п.

Ориентировочные цвета (для Phase 3 при выборе TextMate scope foreground'ов в грамматике): I — синий, O — зелёный, C — жёлтый, M — фиолетовый, X — серый, T — оранжевый. Конкретные hex'и задаёт TextMate-грамматика и/или дефолтная тема пользователя.

### Скоуп раскраски

- Объявления стрелок в шапке `activity` (например, `I1 "..."`) — modifier по букве префикса.
- Объявления туннелей в `A-0` контексте (`T1 "..."`) — modifier `tunnel`.
- Упоминания стрелок в потребляемых/производимых списках функциональных блоков:
  - `I1`, `C1`, `M1` (parent boundary refs) — modifier по букве префикса.
  - `I[X11]`, `C[T1]` (sibling/tunnel refs) — **внешняя** буква и обе скобки (`[`, `]`) образуют единый «выносной» токен с modifier'ом по внешней роли; `X11`/`T1` внутри скобок — отдельные токены с modifier'ами `internal` / `tunnel`.
  - `X11`, `X11[O1]`, `X11[T1]` в правой части — `X11` → modifier `internal`; `O1`/`T1` внутри скобок — отдельные токены со своими modifiers. Скобки в `X11[O1]` / `X11[T1]` несут тот же modifier, что `X11` (internal).

### Цветовая палитра DSL

Расширение задаёт цвета **детерминированно**, через `TextEditorDecorationType` поверх семантических токенов и TextMate. Это даёт одинаковую визуальную иерархию в любой теме — VS Code semantic-token modifiers не позволяют расширению контролировать цвет и font style, а полагаться на тему пользователя означает что «I — синий, C — жёлтый» работает только в Dark+/Light+.

| Группа | Светлая тема | Тёмная тема | Где применяется |
|---|---|---|---|
| **Activity (red)** | `#A31515` | `#F44747` | `activity` / `context`, `{` `}`, `:`, `->`, A-IDs (`A0`, `A1`, …, `A-0`, `...A0`) |
| **I — Input (blue)** | `#0000FF` | `#569CD6` | I-стрелки в шапке, parent refs, outer letter `I` в `I[...]` + скобки |
| **O — Output (green)** | `#267F99` | `#4EC9B0` | O-стрелки в шапке, inner ID `O*` в `X*[O*]` |
| **C — Control (yellow)** | `#795E26` | `#DCDCAA` | C-стрелки, parent refs, outer letter `C` в `C[...]` + скобки |
| **M — Mechanism (purple)** | `#AF00DB` | `#C586C0` | M-стрелки, parent refs, outer letter `M` в `M[...]` + скобки |
| **X — Internal (gray)** | `#808080` | `#9D9D9D` | X-стрелки (produced), inner ID `X*` в `I[X*]` / `C[X*]` / `M[X*]`, outer X в `X*[...]` + скобки |
| **T — Tunnel (orange)** | `#A0522D` | `#CE9178` | T-туннели в `A-0`, inner ID `T*` в `*[T*]` |
| **String (muted)** | `#A0A0A0` | `#8B8B8B` | `"строковые литералы"` (фон) |
| **Comment (muted)** | `#999999` | `#6E6E6E` | `# комментарии` (ещё тише, чтобы не отвлекали) |
| **Comma (muted)** | ThemeColor `descriptionForeground` | ThemeColor `descriptionForeground` | `,` |

### Font style overlays

Поверх цветовых декораций накладываются стилевые:

| Что | Что применяем |
|---|---|
| Активити-ID (`A0`, `A1`, …, `A-0`, `...A0`) | `fontWeight: "bold"` |
| Все ID стрелок (`I1`, `O1`, `C[T1]`, `X11`, …) | `fontWeight: "bold"` по умолчанию |
| Inner часть bracket-формы (ID внутри `[...]`) | `fontStyle: "italic"` (вместо bold) |

### Принципы палитры

- **Активити-цвет — красный, насыщенный**, аналог TS keyword blue в `Dark+`, чтобы каркас декомпозиции читался первым.
- **Стрелки** имеют уникальные ролевые цвета — наиболее «информативная» часть строки, должны выделяться.
- **Строки и комментарии** — приглушены: это пользовательское содержимое, должно уступать структуре DSL.
- **Запятые** — самое тихое: технический разделитель, не должен шуметь.

## Orphan UX

VS Code не предоставляет публичного API для in-editor banner (welcome-banner API — internal). Используем уже существующие public-поверхности — **Diagnostic** для случая с project context и **notification** для случая без.

**Case 2: файл под `src/idef0/`, но вне любого проекта** (`DiscoveryResult.orphans`).

Публикуется **file-level Diagnostic** правила 16 от `core.validateOrphans` через `DiagnosticCollection`. Диагностика появляется:
- маркером слева в gutter editor'а (severity error → red dot);
- в Problems panel (со ссылкой и navigate-on-click);
- в файл-эксплорере у имени файла (стандартный VS Code badge).

Это даёт пользователю «in-editor sign» без отдельной banner-поверхности. Никакого дополнительного notification не показываем — Diagnostic уже доносит информацию.

**Case 1: `loader.findScanRoot(uri) == null`** — файл полностью вне любого `src/idef0/`.

Нет project context, нет правил валидатора, которые бы стрельнули — Diagnostic-механизм здесь не подходит. Используем **`vscode.window.showInformationMessage`** с **per-file дедупликацией** на сессию (хранится `Set<string>` уже показанных URI). Сообщение:

> File outside any `src/idef0/` directory. Move under `src/idef0/<package>/` to enable IDEFy validation and formatting.

Без кнопок (информационный). Если пользователь dismiss'ит — за сессию повторно не показываем.

**Что выключается для orphan-файла (оба случая):**

- Live-валидация per-project — пропускается (нет project context для правил 4, 7–15, 17).
- Команды `Format Document` / `View ASCII` — disabled через context keys (`idefy.inProject == false`) + runtime guards в handler'ах (см. [`COMPONENT.md`](COMPONENT.md), раздел Context keys).
- Подсветка синтаксиса (TextMate) и semantic tokens — **работают** (не зависят от project context).

## Output channel

Создаётся `vscode.window.createOutputChannel('IDEFy')` для логов:

- Ошибки парсера/валидатора, которые попали в catch (баги core, не должны случаться).
- FS-ошибки при чтении/записи sidecar.
- Время цикла live-валидации (для дебага производительности).

Не показывается автоматически — пользователь открывает через View → Output → IDEFy.

## Что NOT в UI

- **Inline preview ASCII в DSL-редакторе** — нет. ASCII всегда в отдельном табе через `View ASCII` кнопку.
- **Split-view DSL + ASCII бок-о-бок** — нет (это явный отказ от прежнего «notebook»-подхода).
- **Команды Run / Execute / Select Kernel** — нет (нет kernel-системы; не используем Notebook API).
- **Hover-tooltips** с информацией о стрелках, definition-providers (Cmd-click навигация) — `[TODO]` forward direction.
- **Tree view проекта** в sidebar — `[TODO]` forward direction.
- **Code lens, code actions, quick fixes** — `[TODO]` forward direction.
