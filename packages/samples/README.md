# @idefy/samples

Эталонные модели IDEF0 в [`.idef0` DSL](../../spec/01-dsl.md), используемые как smoke-материал для парсера, валидатора, форматтера и UI-расширения.

Раскладка повторяет канон из [`spec/03-layout.md`](../../spec/03-layout.md):

```
src/idef0/
├── hr/recruitment/                — процесс найма
│   ├── A-0.context.idef0          — контекст модели
│   ├── A0.process.idef0           — корневая декомпозиция
│   └── A1.search_and_select.idef0
└── kreator/developer_workflow/    — work с Креатором глазами разработчика
    ├── A-0.context.idef0
    ├── A0.work_with_kreator.idef0
    ├── A1.design_sapr.idef0
    └── A4.act_sapr.idef0
```

Корневые папки проектов — `hr/recruitment/` и `kreator/developer_workflow/`. Имена проектов вычисляются по правилам Java-package notation: `hr.recruitment`, `kreator.developer_workflow`.

Файлы — намеренно живые: они **не** обязаны проходить per-project rules без warning'ов, потому что отражают реальные модели в процессе разработки. Для строгих regression-тестов парсера/валидатора смотри `packages/core/test/fixtures/`.
