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

В текущей итерации слово `ASCII` рендерится **жирным**. Жирность задаётся CSS-стилем viewer'а, не текстом на диске (на диске — чистый `ASCII\n`).

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
   - Иконка: codicon `device-camera`.
   - Тултип: "Copy ASCII as PNG (with syntax colors)".
   - Поведение: рендерит текущее визуальное состояние viewer area (включая раскраску ролей) в `<canvas>`, экспортирует как PNG, копирует в clipboard как изображение.
   - Реализация через DOM-to-canvas: либо `html2canvas`-style, либо собственный рендер через `CanvasRenderingContext2D.fillText` с учётом стилей. Конкретная техника — Phase 3.
   - Если clipboard API не поддерживает image (некоторые версии Electron в Linux) — fallback: предлагает сохранить PNG как файл (`vscode.window.showSaveDialog`).
   - Toast: "Copied as PNG" или "Saved as `<name>.png`".

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
  - `I[X11]`, `C[T1]` (sibling/tunnel refs) — **внешняя** буква (роль на этом блоке) даёт modifier для всего токена; `X11`/`T1` внутри скобок — отдельные токены со своими modifiers (`internal`, `tunnel`).
  - `X11`, `X11[O1]`, `X11[T1]` в правой части — `X11` → modifier `internal`; `O1`/`T1` внутри скобок — отдельные токены со своими modifiers.

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
