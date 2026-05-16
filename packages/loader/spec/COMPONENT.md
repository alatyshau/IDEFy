# @idefy/loader

## Purpose

FS-IO слой между файловой системой workspace'а и `@idefy/core`. Отвечает за:

- определение корня сканирования `src/idef0/` в произвольной точке файлового дерева workspace'а,
- сборку списка `.idef0` файлов проекта,
- разрешение sidecar-путей (`<name>.idef0` ↔ `<name>.idef0.ascii`),
- обнаружение orphan-файлов (`.idef0` вне какого-либо проекта),
- поддержку multi-root workspaces (каждый workspace-рут — независимый scan).

**Не парсит** содержимое файлов — это задача `@idefy/core` (`parse`). **Не валидирует** структуру проекта — это задача `@idefy/core` (assembler + validator). Loader — про **дискавери и I/O**, не про семантику.

## Состав

- **Scan root detection.** Поиск ближайшего `src/idef0/` ancestor для произвольного пути.
- **Project discovery.** Поиск проектов (`A0.*.idef0` маркеров) под scan root.
- **Project file enumeration.** Сбор всех `.idef0` файлов проекта.
- **Sidecar resolver.** Маппинг `.idef0` ↔ `.idef0.ascii`.
- **FS adapter.** Абстракция над операциями файловой системы для тестируемости.

## Public API contract

### FS adapter

```
FsAdapter {
    readFile(path: string): Promise<string>
    writeFile(path: string, content: string): Promise<void>
    deleteFile(path: string): Promise<void>
    renameFile(from: string, to: string): Promise<void>
    listDirectory(path: string): Promise<DirectoryEntry[]>
    exists(path: string): Promise<boolean>
}

DirectoryEntry {
    name: string                // имя файла/папки без пути
    kind: 'file' | 'directory'
}
```

Loader работает **через адаптер**, не через `fs`/`workspace.fs` напрямую. Это позволяет:

- `@idefy/vscode` инжектировать адаптер поверх `vscode.workspace.fs` (нативная VS Code FS, работает с remote-workspaces, virtual filesystems и т.д.).
- Тесты использовать in-memory FS.

`@idefy/loader` экспортирует один готовый адаптер — `createNodeFsAdapter()` для Node.js окружения, исключительно для тестов. В продакшене `@idefy/vscode` поставляет свой адаптер.

### Scan root detection

```
findScanRoot(filePath: string, fs: FsAdapter): Promise<string | null>
```

Возвращает путь к ближайшему **существующему** на FS предку `<...>/src/idef0/`, под которым лежит `filePath`. `null`, если такого предка нет или если кандидатный путь существует только лексически (не подтверждён через `fs.exists()`).

Реализует **lazy walk-up** из [`spec/03-layout.md`](../../../spec/03-layout.md): идём от папки `filePath` вверх по дереву до первого сегмента `src/idef0`, на каждом шаге проверяя существование через `fs.exists()`. Если `filePath` сам равен `<...>/src/idef0` директории — возвращает её (после exists-check). Корень `src/idef0/` может быть на любой глубине в workspace.

Чисто лексические совпадения без подтверждения существованием — отвергаются (возвращается `null`), чтобы избежать ложноположительных результатов при опечатках в пути.

### Project discovery

```
discoverProjects(scanRoot: string, fs: FsAdapter): Promise<DiscoveryResult>

DiscoveryResult {
    projects: ProjectDescriptor[]
    orphans: string[]                       // .idef0 файлы под scanRoot, не попавшие
                                            // ни в один проект (нет A0.*.idef0 маркера
                                            // в их предках вплоть до scanRoot)
    nestedProjects: NestedProjectMarker[]   // пары (outer, inner), где inner.projectRoot —
                                            // строгий потомок outer.projectRoot. Структурная
                                            // surface для rule 15 (запрет вложенных проектов).
}

ProjectDescriptor {
    name: string            // 'banking.lending.as_is'
    scanRoot: string        // путь корня сканирования
    projectRoot: string     // путь корневой папки проекта (где лежит A0.*.idef0)
    files: string[]         // все .idef0 файлы проекта (полные пути)
}

NestedProjectMarker {
    outerProjectRoot: string    // путь корня внешнего проекта (предка)
    innerProjectRoot: string    // путь корня вложенного проекта
    innerMarkerPath: string     // полный путь к вложенному A0.*.idef0 файлу
}
```

Рекурсивно сканирует `scanRoot`, ищет файлы по паттерну `A0.*.idef0`, для каждого определяет `projectRoot` (папка, где он лежит) и собирает все `.idef0` файлы под этой папкой. Вычисляет имя проекта по правилам [`spec/03-layout.md`](../../../spec/03-layout.md) (Java-package notation от `scanRoot` до `projectRoot`).

**Структурные конфликты (rule 15 surface).** Каждый `A0`-маркер даёт свой `ProjectDescriptor`, даже если он лежит внутри уже найденного проекта. Дополнительно loader заполняет `DiscoveryResult.nestedProjects` — список пар (outer, inner), где `inner.projectRoot` является строгим потомком `outer.projectRoot`. Это **структурные данные**, не `Diagnostic`'и — loader не классифицирует это как ошибку. Caller (`@idefy/core/validator` через `diagnosticsForNestedProjects` или UI) оборачивает `NestedProjectMarker` в rule-15 диагностики. Такое разделение сохраняет инвариант «loader не валидирует», но даёт ровно ту информацию, которую невозможно получить из единичного `IdefProject`.

**`A0.*.idef0` непосредственно в `scanRoot` (правило 14 валидатора).** Файл с `A0` маркером, лежащий прямо в `scanRoot` (без промежуточной папки между `scanRoot` и `projectRoot`) — это **попытка проекта**, выполненная неправильно. Loader возвращает такой случай **как `ProjectDescriptor` с `projectRoot == scanRoot`**, не как orphan. Validator (`@idefy/core`) распознаёт `projectRoot == scanRoot` как нарушение правила 14 и выдаёт error-диагностику.

Это сознательный выбор между двумя классификациями: файл с `A0` маркером семантически — попытка проекта, не сирота. Reporting его как orphan через правило 16 был бы misleading.

`.idef0` файлы под `scanRoot`, не попавшие ни в один проект (нет `A0.*.idef0` маркера в их предках, и сам файл — не `A0`-маркер в `scanRoot`), возвращаются в `orphans`. Loader выявляет их, но **не классифицирует** как ошибку — это задача validator'а из `@idefy/core` (правило 16).

### Project file enumeration

```
listProjectFiles(projectRoot: string, fs: FsAdapter): Promise<string[]>
```

Возвращает все `.idef0` файлы под `projectRoot` (рекурсивно, на любой глубине подпапок). Используется внутри `discoverProjects`, но также экспортируется отдельно — для случая, когда `@idefy/vscode` знает projectRoot и хочет переподтянуть файлы после FS-события.

### Sidecar resolver

```
sidecarPathFor(idef0Path: string): string
isSidecarPath(path: string): boolean
idef0PathForSidecar(sidecarPath: string): string | null
```

- `sidecarPathFor("a/b/A0.idef0")` → `"a/b/A0.idef0.ascii"`.
- `isSidecarPath` распознаёт `.idef0.ascii` суффикс (не пишет в FS, чистая функция).
- `idef0PathForSidecar` — обратная операция; возвращает `null`, если переданный путь не sidecar.

Расширение `.idef0.ascii` **зашито** в loader. Это единственное место в кодовой базе, где этот суффикс прописан.

### Orphan detection

```
isOrphan(idef0Path: string, scanRoot: string, projects: ProjectDescriptor[]): boolean
```

Возвращает `true`, если `idef0Path` лежит под `scanRoot`, но не попадает ни в один проект из `projects`. Используется UI-слоем для показа banner'а (см. [`packages/vscode/spec/UI.md`](../../vscode/spec/UI.md)).

### Multi-root workspaces

Loader сам не управляет multi-root: `@idefy/vscode` итерирует по workspace folders и вызывает `findScanRoot` / `discoverProjects` для каждого независимо. Id-пространства разных рутов **не пересекаются**: проекты с одинаковым именем из разных workspace folders — это два независимых проекта.

Конкретно, контракт loader'а: функции `discoverProjects` и `listProjectFiles` работают над **одним** scan root за раз и не имеют глобального состояния.

## Behaviors

- Все функции — асинхронные (через FS adapter). Loader обрабатывает «not-found» специально: при отсутствии файла/директории функции возвращают `null`/`false` либо пустые коллекции (no-op semantics, без exception). Любые другие FS-ошибки (permission denied, I/O errors, network failures для remote FS) пропагируются caller'у как exceptions — заглушать их silently недопустимо, потому что caller обязан различить «ничего нет» от «нет доступа».
- `discoverProjects` идёт в ширину/глубину по дереву; конкретный порядок обхода не специфицирован, кроме гарантии: внутри одного `ProjectDescriptor.files` порядок детерминирован (например, лексикографический по полному пути), чтобы упростить тесты и не давать «мигающих» диагностик из-за изменений порядка обхода FS.
- Loader не кэширует результаты между вызовами. Caller (`@idefy/vscode`) отвечает за кэширование и инвалидацию по FS-событиям.

## Invariants

- Все пути в публичном API — **opaque строки**. Loader не предполагает конкретный формат (POSIX / Windows). Сравнение и операции над путями — внутренние; loader использует подобласть POSIX-совместимых операций (separator `/`, `..` resolution). На Windows работа обеспечивается VS Code FS API, которое нормализует пути на уровне адаптера.
- `findScanRoot` возвращает путь, **гарантированно** оканчивающийся на сегмент `idef0` после сегмента `src` (т.е. путь `.../src/idef0`). Trailing slash не нормализуется — caller должен использовать path-utilities, если требуется.
- Все loader-функции — чистые относительно FS (читают, не пишут), за исключением `FsAdapter.writeFile`/`deleteFile`/`renameFile`, которые предоставляются адаптером и не вызываются самим loader'ом. Запись sidecar'ов делает caller через адаптер.

## Errors

Loader не использует исключения как контрольный поток. Возможные FS-проблемы:

- **File not found, directory missing** — пустой результат или `null`.
- **Permission denied / FS catastrophic failure** — пробрасывается из адаптера как `Error`. Caller обязан ловить эти исключения на уровне команд UI.

Структурные ошибки проекта (несоответствие имён папок Java-package правилам, отсутствие `A-0.*.idef0` и т.п.) **не** обнаруживаются loader'ом — это задача validator'а из `@idefy/core`. Loader лишь предоставляет полный список файлов.

## Dependencies

- На `@idefy/core` — **никаких** зависимостей. Loader не использует `Diagnostic` из core; структурные конфликты (rule 15 surface) возвращаются как `NestedProjectMarker[]` — pure data, без diagnostic-семантики. Caller сам оборачивает в `Diagnostic` (например, через `@idefy/core` helper `diagnosticsForNestedProjects`). Это позволяет `@idefy/core` импортировать loader-типы при необходимости в будущем без циклов.
- Внешние: TypeScript stdlib. Node `fs` используется **только** в `createNodeFsAdapter()` (тестовый адаптер).

## Open questions

Ничего открытого.
