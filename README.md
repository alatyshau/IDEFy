# IDEFy

Текстовый DSL для моделирования бизнес-процессов в нотации IDEF0, оптимизированный под хранение в git и редактирование в обычном текстовом редакторе. Модель читается напрямую из исходников, без рендеринга в графику. Полный контекст продукта — [`spec/PRODUCT.md`](spec/PRODUCT.md).

## Архитектура

Три слоя, три пакета. Все три имплементированы.

- **[`@idefy/core`](packages/core)** — чистая логика: парсер, AST, project model, валидатор, форматтер, ASCII renderer registry. Без зависимостей от VS Code API и без FS. Спека — [`packages/core/spec/COMPONENT.md`](packages/core/spec/COMPONENT.md), модель данных — [`DATA_MODEL.md`](packages/core/spec/DATA_MODEL.md), рендерер — [`RENDERERS.md`](packages/core/spec/RENDERERS.md).
- **[`@idefy/loader`](packages/loader)** — FS-IO слой: scan-root detection, project discovery, sidecar lifecycle helpers, абстракция `FsAdapter`. Спека — [`packages/loader/spec/COMPONENT.md`](packages/loader/spec/COMPONENT.md).
- **[`@idefy/vscode`](packages/vscode)** — VS Code extension shell: TextMate-грамматика, semantic tokens с детерминированной ролевой палитрой, live-валидация, format + view-ASCII команды, custom editor для `.idef0.ascii` с canvas-PNG экспортом. Спека — [`packages/vscode/spec/COMPONENT.md`](packages/vscode/spec/COMPONENT.md), UX — [`UI.md`](packages/vscode/spec/UI.md).

UX-связка DSL ↔ ASCII построена на нативном text editor + Custom Editor для sidecar (`.idef0.ascii`).

## DSL спецификация

- [`spec/01-dsl.md`](spec/01-dsl.md) — синтаксис и семантика `.idef0` файлов, идентификаторы (префикс роли заглавный, суффикс `[1-9a-z]+`), границы деклараций.
- [`spec/02-formatting.md`](spec/02-formatting.md) — каноническое форматирование, режимы 1/2/3 + sub-mode Б, прилипание комментариев.
- [`spec/03-layout.md`](spec/03-layout.md) — структура `src/idef0/`, маркер проекта `A0.*.idef0`, имена проектов в стиле Java-package notation.
- [`spec/04-validator.md`](spec/04-validator.md) — правила валидатора: реализованы 4, 7–18 (rule 8 двухгрейдный: case violation → warning, structural violation → error). Правила 1–3 (ICOM-согласованность) и 5–6 (туннели) — `[TODO]`.
- [`spec/05-classical-gaps.md`](spec/05-classical-gaps.md) — фичи классической IDEF0, осознанно пропущенные.
- [`spec/PRODUCT.md`](spec/PRODUCT.md) — продуктовая обвязка: что считаем продуктом, что — инструментальной обвязкой.
- [`spec/SDD_CONVENTIONS.md`](spec/SDD_CONVENTIONS.md) — конвенции Spec-Driven Development.

## Sample-проекты

[`packages/samples/src/idef0/`](packages/samples/src/idef0/) — эталонные `.idef0` модели для smoke-проверок:

- `hr/recruitment/` — процесс найма (`A0` + `A1`).
- `kreator/developer_workflow/` — workflow разработчика с Креатором (`A0` + `A1` + `A4`).

## Монорепо

`pnpm` workspaces. Скрипты на корне:

```bash
pnpm install
pnpm typecheck            # tsc --noEmit во всех пакетах
pnpm test                 # vitest во всех пакетах
pnpm build                # tsup во всех пакетах
pnpm -F @idefy/vscode build      # отдельная сборка extension
pnpm -F @idefy/vscode vsce:package   # упаковка .vsix (нужен vsce глобально)
```

Дистрибуция — локальная установка `.vsix` через `code --install-extension`, без Marketplace.
