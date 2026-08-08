# HASHPIX — MASTER-СПЕЦИФИКАЦИЯ МИГРАЦИИ ВНУТРЕННЕГО ИНТЕРФЕЙСА НА SHADCN/UI

**Статус:** обязательная рабочая спецификация для Codex/агента  
**Проект:** Hashpix  
**Зона миграции:** вся внутренняя продуктовая часть  
**Не входит в миграцию:** публичный лендинг  
**Целевой preset:** `b38miVLH6`  
**Каноническая команда первичной инициализации:**

```bash
npx shadcn@latest init --preset b38miVLH6 --template next
```

---

# 0. Как использовать этот документ

Этот файл — не предложение и не набор необязательных рекомендаций. Это **контракт миграции**.

Перед началом работы:

1. Прочитай документ целиком один раз.
2. Не пересказывай его пользователю.
3. Не пиши длинный предварительный отчёт.
4. Зафиксируй короткий исполнимый план в репозитории.
5. Работай по этапам и проверяемым критериям.
6. Не расходуй токены на повторное объяснение уже зафиксированных решений.
7. Не начинай редизайн продукта за пределами обозначенной задачи.

Этот большой документ **не нужно целиком копировать в `AGENTS.md`**. Корневой `AGENTS.md` должен оставаться коротким. Длинные правила миграции хранятся в отдельном документе, например:

```text
docs/migrations/shadcn-ui-migration.md
```

В `AGENTS.md` достаточно сослаться на него одной строкой для задач, связанных с интерфейсом.

---

# 1. Главная цель

Нужно провести **полный и системный переезд внутреннего интерфейса Hashpix**:

```text
самописные UI-примитивы
+ случайные локальные стили
+ неоднородные радиусы
+ разрозненные цвета
+ хардкод
+ компоненты, сгенерированные разными агентами
        ↓
shadcn/ui
+ единые semantic design tokens
+ переиспользуемые Hashpix-компоненты
+ единые состояния
+ единая доступность
+ единые правила композиции
```

Цель миграции — не просто установить shadcn/ui. Цель — получить **одну законченную дизайн-систему**, которой подчинена вся внутренняя платформа.

После завершения миграции недопустимо, чтобы:

- одна страница работала на старой системе, а другая на новой;
- на одной странице одновременно использовались старые и новые кнопки;
- одно модальное окно было самописным, а другое — shadcn;
- часть радиусов бралась из токенов, а часть была захардкожена;
- одинаковые действия имели разные компоненты;
- notification/toast/dialog создавались разными способами;
- компоненты разных primitive-баз смешивались без причины;
- агенты продолжали создавать новые локальные аналоги уже существующих UI-примитивов.

---

# 2. Что мигрируем

Миграция распространяется на всю внутреннюю продуктовую часть:

- dashboard;
- платформу создания и обработки видео;
- мастер создания нарезки;
- проекты;
- редактор;
- страницу стилей;
- тарифы и минуты;
- профиль;
- настройки;
- внутренние библиотеки и медиатеку;
- страницы входа;
- страницы регистрации;
- восстановление доступа;
- onboarding;
- админ-панель;
- внутренние таблицы;
- фильтры;
- формы;
- модальные окна;
- confirmation dialogs;
- sheets/drawers;
- dropdown/context menus;
- tooltips;
- уведомления;
- toast-сообщения;
- skeleton/loading;
- empty/error/success states;
- внутренние служебные страницы;
- все остальные закрытые и продуктовые routes.

## 2.1. Что не мигрируем

Публичный лендинг не входит в эту задачу.

Не изменять без отдельного задания:

- маркетинговую главную страницу;
- промо-секции;
- публичные рекламные страницы;
- отдельную айдентику лендинга;
- публичные страницы, не использующие внутренний UI shell.

Если общие файлы лендинга и платформы пересекаются, отдели внутренние токены и компоненты так, чтобы миграция не вызвала визуальную регрессию лендинга.

---

# 3. Что категорически нельзя делать

## 3.1. Не превращать Hashpix в дефолтный SaaS-dashboard

Shadcn/ui — это фундамент интерактивных компонентов, а не разрешение заменить продукт шаблоном.

Нельзя:

- менять существующую структуру бокового меню на типовой shadcn sidebar;
- переносить навигацию без продуктовой причины;
- менять расположение главных областей экрана;
- превращать каждую секцию в стандартную `Card`;
- добавлять dashboard cards ради заполнения пространства;
- использовать готовый block, если он ломает существующую UX-логику;
- менять архитектуру страниц только потому, что в registry есть красивый пример;
- заменять продуктовые экраны generic-композициями из preview shadcn.

## 3.2. Сохраняем продуктовую структуру

Если сейчас интерфейс строится так:

```text
левое фирменное меню
+ верхняя пользовательская область
+ основной контейнер справа
```

эта структура сохраняется.

Если внутри страницы уже есть правильный пользовательский порядок действий, он сохраняется. Меняется качество UI:

- кнопки;
- inputs;
- selects;
- switches;
- sliders;
- tabs;
- dialogs;
- menus;
- цвета;
- поверхности;
- состояния;
- радиусы;
- тени;
- focus;
- spacing;
- типографическая иерархия;
- accessibility.

Перемещение крупных блоков допускается только тогда, когда это прямо необходимо для исправления подтверждённой UX-проблемы или описано в отдельном ТЗ страницы.

---

# 4. Конечный архитектурный принцип

Интерфейс должен иметь три уровня.

```text
1. shadcn/ui primitives
        ↓
2. Hashpix reusable components
        ↓
3. Product screens/routes
```

## 4.1. Уровень 1 — `components/ui`

Здесь хранятся базовые shadcn/ui-компоненты:

- Button;
- Input;
- Textarea;
- Field/Label;
- Select;
- Combobox;
- Checkbox;
- Radio Group;
- Switch;
- Slider;
- Tabs;
- Dialog;
- Alert Dialog;
- Sheet;
- Drawer;
- Dropdown Menu;
- Context Menu;
- Popover;
- Tooltip;
- Command;
- Skeleton;
- Progress;
- Badge;
- Separator;
- Scroll Area;
- Table;
- Sonner;
- другие реально необходимые primitives.

Не устанавливать весь registry заранее. Добавлять только компоненты, которые требуются по итогам аудита и текущей волны миграции.

## 4.2. Уровень 2 — `components/hashpix` или аналогичная product-папка

Здесь находятся специфичные переиспользуемые компоненты продукта:

- `SourceMethodSelector`;
- `VideoSourceInput`;
- `VideoUploadDropzone`;
- `VideoSourceSummary`;
- `WizardStepper`;
- `WizardActionBar`;
- `ProjectCard`;
- `VideoPreview`;
- `StyleCard`;
- `StylePreview`;
- `SubtitleSettings`;
- `ProcessingCostSummary`;
- `MinutesBalance`;
- `DashboardPageHeader`;
- `EmptyState`;
- `InlineStatus`;
- `FormSection`;
- `SettingsGroup`;
- другие продуктовые композиции.

Они могут использовать shadcn/ui внутри, но не должны дублировать базовые primitives.

## 4.3. Уровень 3 — страницы

Route/page-компоненты должны:

- собирать готовые переиспользуемые компоненты;
- связывать их с данными и бизнес-логикой;
- не содержать собственную реализацию Button/Dialog/Select;
- не создавать локальную дизайн-систему;
- не содержать большие наборы повторяющихся utility-классов;
- не хранить локальные копии одних и тех же визуальных паттернов.

---

# 5. Целевая база и preset

Используется preset:

```text
b38miVLH6
```

Каноническая команда:

```bash
npx shadcn@latest init --preset b38miVLH6 --template next
```

Preset был выбран как единый источник:

- базового визуального стиля;
- шрифтов;
- радиусов;
- иконок;
- theme configuration;
- primitive-base.

## 5.1. Перед запуском команды

Не запускай команду вслепую.

Сначала:

```bash
git status
git branch --show-current
npx shadcn@latest preset decode b38miVLH6 --json
```

Проверь:

- текущий проект действительно Next.js;
- команда выполняется из корня нужного frontend-приложения;
- preset декодируется без ошибки;
- preset использует ожидаемую primitive-base;
- нет незакоммиченных изменений, которые невозможно отделить;
- определён используемый package manager;
- Tailwind и import aliases настроены;
- проект не является monorepo либо корректно выбрана рабочая директория;
- отсутствует конфликтующий `components.json` либо он заранее проанализирован.

## 5.2. Важное правило безопасности

Не использовать без отдельной причины:

```text
--force
--overwrite
-y для потенциально разрушительных операций
```

Перед перезаписью существующего компонента использовать:

```bash
npx shadcn@latest add <component> --dry-run
npx shadcn@latest add <component> --diff
npx shadcn@latest view <component>
```

Если shadcn/ui уже инициализирован и `components.json` существует, сначала выясни текущее состояние:

```bash
npx shadcn@latest info --json
npx shadcn@latest preset resolve --json
```

После этого реши, нужен ли `init --preset`, либо корректнее применить preset:

```bash
npx shadcn@latest apply b38miVLH6
```

Пользовательский целевой preset изменять нельзя без согласования.

---

# 6. Codebase Memory MCP — обязательная часть подготовки

## 6.1. Зачем он нужен

Главная задача Codebase Memory MCP — не писать код, а уменьшить бессмысленное чтение репозитория.

Использовать его для:

- построения постоянного графа кодовой базы;
- поиска страниц и routes;
- поиска UI-примитивов;
- поиска импортов;
- поиска повторных реализаций;
- построения dependency graph;
- определения blast radius;
- поиска всех мест использования legacy-компонента;
- проверки текущего diff;
- обнаружения связей между страницами, состоянием и API.

Рабочий принцип:

```text
сначала структурный запрос к графу
→ затем чтение только найденных файлов/символов
→ затем изменение
→ затем проверка diff через граф
```

Не начинать с широкого `grep` по всему проекту, если граф уже содержит нужную информацию.

## 6.2. Установка

Для macOS/Linux использовать стандартную headless-версию без 3D UI:

```bash
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
```

Графическая 3D-визуализация для этой миграции не нужна. Она не улучшает качество кода и не является обязательной для экономии токенов.

Перед запуском стороннего install script допустимо и желательно просмотреть его содержимое, поскольку инструмент получает доступ к исходникам и конфигурации агента.

После установки:

1. перезапустить Codex;
2. проверить список MCP;
3. убедиться, что `codebase-memory-mcp` подключён;
4. не продолжать миграцию, пока MCP не доступен или пока не зафиксирован осознанный fallback.

## 6.3. Исключения индексации

До первого полного индексирования создай или проверь `.cbmignore`.

Исключить как минимум:

```gitignore
node_modules/
.next/
dist/
build/
coverage/
out/
tmp/
temp/
logs/
*.log

public/uploads/
public/videos/
uploads/
videos/
renders/
exports/

*.mp4
*.mov
*.mkv
*.webm
*.avi

generated/
fixtures/media/
test-results/
playwright-report/
```

Не исключать исходный код, routes, tests, Storybook/preview-файлы и конфигурацию, если они помогают понять архитектуру UI.

## 6.4. Первичная индексация

Проиндексировать весь корень реального Git-репозитория или frontend-workspace:

```bash
codebase-memory-mcp cli index_repository --repo-path /absolute/path/to/repository
```

Либо через MCP-инструмент `index_repository`.

После этого проверить:

```bash
codebase-memory-mcp cli list_projects
```

Через MCP получить:

- `index_status`;
- `get_graph_schema`;
- `get_architecture`;
- краткий список packages/routes;
- coverage для критичных путей.

Не печатать пользователю полный graph dump.

## 6.5. Что считать результатом индексации

Индексирование закончено, когда:

- проект присутствует в `list_projects`;
- статус не находится в состоянии ошибки;
- видны основные frontend routes;
- находятся shared UI-компоненты;
- находятся импорты legacy-примитивов;
- архитектурный обзор соответствует реальному проекту;
- критические директории не пропущены.

Чистый coverage не является доказательством абсолютной полноты. Если граф не видит динамическую связь, проверь исходники напрямую.

## 6.6. Повторное индексирование

Не выполнять полный reindex перед каждой задачей.

После первого индекса:

- использовать фоновый watcher;
- изменённые файлы должны обновляться инкрементально;
- полный `index_repository` повторять только при явном рассинхроне, изменении структуры или проблеме индекса.

## 6.7. Правила работы с графом

Перед каждой миграционной волной:

1. найти route;
2. найти импортируемые UI-компоненты;
3. найти все references legacy-примитивов;
4. определить минимальный scope;
5. прочитать точные реализации;
6. выполнить замену;
7. вызвать `detect_changes`;
8. проверить реальный blast radius;
9. запустить targeted checks.

Если Codebase Memory дал достаточные пути и символы, не повторять то же исследование через широкий `grep`.

---

# 7. Shadcn Skill — подключить обязательно

После появления `components.json` установить официальный shadcn skill:

```bash
npx skills add shadcn/ui
```

Если проект использует другой package manager, допустим эквивалент через него, но результат должен быть одинаковым.

Skill нужен, чтобы агент:

- определял framework и Tailwind-версию;
- видел aliases;
- видел выбранную primitive-base;
- знал установленную icon library;
- использовал корректные base-specific APIs;
- искал компонент в документации до генерации аналога;
- применял правильные shadcn composition patterns;
- не выдумывал несовместимые компоненты.

После установки проверить, что skill присутствует в проекте и активируется при наличии `components.json`.

## 7.1. Не устанавливать десятки случайных skills

Каждый дополнительный skill занимает часть доступного контекста.

На этом этапе нужны только skills, которые решают конкретную задачу:

- shadcn/ui;
- существующий Codebase Memory skill/hook, если установщик его добавил;
- Playwright/Browser skill — только для визуальной проверки, если он уже поддерживается текущей средой.

Не подключать случайные каталоги skills «на будущее».

---

# 8. Shadcn MCP — подключение и роль

Shadcn MCP полезен для:

- поиска компонентов в registry;
- просмотра blocks;
- поиска готовых форм;
- установки primitives;
- получения актуальной документации;
- работы со сторонними shadcn-compatible registries.

Для Codex конфигурация:

```toml
[mcp_servers.shadcn]
command = "npx"
args = ["shadcn@latest", "mcp"]
```

Обычно файл:

```text
~/.codex/config.toml
```

После изменения перезапустить Codex.

## 8.1. Разделение ролей MCP

```text
Codebase Memory MCP:
понимание текущего проекта

Shadcn MCP:
поиск и доставка компонентов из registry
```

Не использовать shadcn MCP для исследования собственной кодовой базы.

Не использовать Codebase Memory для поиска компонентов в публичном registry.

## 8.2. Экономия контекста

Во время миграции оставить включёнными только реально нужные MCP:

- Codebase Memory;
- shadcn.

Другие MCP временно отключить, если они не участвуют в задаче. Каждый MCP добавляет описание инструментов в контекст.

## 8.3. Registry

Собственный registry Hashpix пока не создавать.

Сначала:

- стабилизировать primitives;
- завершить миграцию;
- определить действительно переиспользуемые Hashpix-компоненты.

Свой registry имеет смысл только после появления нескольких продуктов, packages или повторяемой доставки компонентов между репозиториями.

---

# 9. Дизайн-токены — обязательная единая система

## 9.1. Никакого нового хардкода

После миграции в route-компонентах не должно быть случайных:

- HEX/RGB/HSL/OKLCH цветов;
- `border-radius: 13px`;
- уникальных box-shadow;
- уникальных transition-duration;
- произвольных z-index;
- разных высот однотипных controls;
- локальных значений borders;
- локальных focus-rings.

Допустимые исключения:

- динамические пользовательские цвета;
- графики с runtime-данными;
- цвета видео/медиа;
- canvas/WebGL;
- уникальные декоративные ассеты;
- точечно обоснованные размеры продуктовых media-компонентов.

Каждое исключение должно быть объяснимо.

## 9.2. Базовые semantic tokens shadcn

Использовать CSS variables:

- `--background`;
- `--foreground`;
- `--card`;
- `--card-foreground`;
- `--popover`;
- `--popover-foreground`;
- `--primary`;
- `--primary-foreground`;
- `--secondary`;
- `--secondary-foreground`;
- `--muted`;
- `--muted-foreground`;
- `--accent`;
- `--accent-foreground`;
- `--destructive`;
- `--border`;
- `--input`;
- `--ring`;
- chart tokens;
- базовый `--radius`.

В `components.json` должны использоваться CSS variables.

## 9.3. Дополнительные Hashpix tokens

Если стандартных tokens недостаточно, добавить ограниченный semantic layer:

```css
--surface-canvas;
--surface-panel;
--surface-raised;
--surface-overlay;
--surface-glass;

--border-subtle;
--border-default;
--border-strong;

--text-primary;
--text-secondary;
--text-muted;

--status-success;
--status-warning;
--status-error;
--status-info;

--shadow-raised;
--shadow-floating;
--shadow-dialog;

--focus-ring;
```

Названия отражают функцию, а не конкретный цвет.

Плохо:

```css
--gray-871;
--dark-card-2;
--cool-green;
```

Хорошо:

```css
--surface-raised;
--border-subtle;
--status-success;
```

## 9.4. Радиусы

Радиусы должны выводиться из выбранного preset и базового `--radius`.

Нельзя сохранять десятки локальных вариантов.

Нужна иерархия:

```text
small detail
control
card
panel
shell
full/round
```

Использовать derived tokens или Tailwind theme mapping.

Одинаковые типы компонентов должны иметь одинаковую логику radius.

## 9.5. Spacing

Использовать существующую Tailwind spacing scale или ограниченный согласованный набор.

Не создавать новые значения только для визуального «дотягивания» каждого экрана.

Если требуется исключение, проверить сначала:

- неправильную структуру;
- лишнюю обёртку;
- неправильный control size;
- неверную ширину контейнера.

## 9.6. Typography

Preset использует выбранные шрифты как источник истины.

Нужно нормализовать:

- page title;
- section title;
- component title;
- label;
- body;
- helper text;
- metadata;
- caption;
- button text.

Не использовать произвольные font-size/font-weight для каждого экрана.

## 9.7. Motion

Создать ограниченный набор:

- fast;
- normal;
- slow;
- standard easing;
- enter easing;
- exit easing.

Не добавлять собственную анимацию каждой кнопке.

Уважать `prefers-reduced-motion`.

---

# 10. Что именно заменяем

## 10.1. Buttons

Найти все:

- `<button>` с визуальными классами;
- локальные `PrimaryButton`;
- `SecondaryButton`;
- `IconButton`;
- разрозненные CTA;
- самописные loading buttons.

Свести к единому `Button` и ограниченному набору variants/sizes.

Продуктовые варианты допускаются через `cva`, если они действительно повторяются.

## 10.2. Inputs и forms

Заменить:

- самописные input;
- textarea;
- labels;
- errors;
- descriptions;
- checkbox;
- radio;
- switch;
- slider;
- select.

Форма должна иметь:

- связанный label;
- description;
- error;
- focus;
- disabled;
- loading;
- validation state.

Не писать placeholder вместо label там, где label нужен.

## 10.3. Modals

Все внутренние модальные окна должны быть классифицированы:

- `Dialog` — обычное редактирование/создание;
- `AlertDialog` — опасное или необратимое подтверждение;
- `Sheet/Drawer` — боковая/мобильная панель;
- `Popover` — компактное привязанное действие.

Не использовать generic modal для каждого случая.

Все legacy modal wrappers после миграции удалить.

## 10.4. Notifications

Унифицировать:

- toast;
- success;
- error;
- warning;
- info.

Использовать одну систему, предпочтительно Sonner/shadcn integration.

Не оставлять одновременно:

- старый toast provider;
- новый Sonner;
- локальные временные banners;
- `alert()`.

Inline errors остаются рядом с полем. Toast не заменяет field error.

## 10.5. Menus

Заменить:

- самописные dropdown;
- context menu;
- actions menu;
- kebab menu.

Использовать соответствующий primitive.

Обеспечить keyboard navigation и focus management.

## 10.6. Tabs и option groups

Не использовать tabs там, где это обычный выбор режима.

Принцип:

- Tabs — переключают панели/разделы.
- Toggle Group/Segmented control — выбирает вариант.
- Radio Group — взаимоисключающий form value.

## 10.7. Loading и progress

Унифицировать:

- skeleton;
- spinner;
- progress;
- async button;
- page loading;
- partial loading.

Не показывать final UI с прочерками вместо loading-state.

## 10.8. Empty/error/success

Создать переиспользуемые product patterns.

Каждое состояние должно отвечать:

- что произошло;
- блокирует ли это работу;
- что пользователь может сделать;
- какое действие главное.

---

# 11. Миграционная стратегия без смешения систем

Пользователь не принимает конечное состояние, где разные страницы живут на разных системах.

Чтобы одновременно сохранить качество и не делать один неконтролируемый diff, использовать:

- отдельную долгоживущую migration branch или worktree;
- маленькие последовательные commits;
- route-by-route миграцию внутри этой ветки;
- production/main не обновлять частично;
- финальный merge только после полного scope-аудита.

Допустимое временное смешение возможно **только внутри миграционной ветки во время работы**.

Недопустимо:

- выпустить половину платформы на новой системе;
- оставить переход «когда-нибудь потом»;
- считать задачу завершённой после установки tokens;
- оставить legacy wrappers «на всякий случай»;
- сохранять дублирующие primitives после окончания миграции.

---

# 12. Этапы работы

## Этап 0 — безопасность и baseline

До изменений:

1. проверить Git;
2. создать branch/worktree;
3. зафиксировать текущий commit;
4. определить команды запуска, lint, typecheck, tests, build;
5. снять screenshots ключевых внутренних routes;
6. зафиксировать существующие визуальные состояния;
7. проверить, что лендинг отделён;
8. не менять код.

Рекомендуемая ветка:

```bash
git checkout -b refactor/shadcn-ui-migration
```

## Этап 1 — Codebase Memory

1. установить;
2. настроить exclusions;
3. проиндексировать проект;
4. проверить status;
5. получить architecture;
6. определить frontend root;
7. найти routes и UI layers;
8. не писать большой отчёт.

## Этап 2 — инвентаризация

Создать файл:

```text
docs/migrations/shadcn-ui-inventory.md
```

В нём компактная таблица:

| Legacy component/pattern | Path | Usages | Target | Risk | Status |
|---|---|---:|---|---|---|

Обязательно перечислить:

- buttons;
- inputs/forms;
- dialogs;
- toasts;
- dropdowns;
- tabs;
- switches;
- sliders;
- cards/panels;
- loading;
- table;
- badges;
- navigation controls;
- auth controls;
- admin controls.

Также создать route ledger:

| Route | Area | Legacy imports | Target components | Status | Checks |
|---|---|---|---|---|---|

Не вставлять в чат полный inventory. Сохранить в репозиторий и сообщить только путь.

## Этап 3 — инициализация shadcn

1. decode preset;
2. проверить base;
3. выполнить init;
4. проверить diff;
5. установить skill;
6. подключить shadcn MCP;
7. проверить `components.json`;
8. проверить theme variables;
9. не начинать route migration до стабилизации foundation.

## Этап 4 — design tokens

1. собрать текущие цвета и радиусы;
2. сопоставить их с preset;
3. создать semantic layer;
4. удалить конфликтующие глобальные variables;
5. не ломать лендинг;
6. задокументировать tokens;
7. запустить build/typecheck.

Создать:

```text
docs/ui/design-system.md
```

Документ должен быть коротким и практичным:

- token roles;
- component layers;
- variants;
- do-not rules;
- migration status link.

## Этап 5 — базовые primitives

Добавлять компоненты только после inventory.

Приоритет:

1. Button;
2. Input/Field/Textarea;
3. Select/Combobox;
4. Checkbox/Radio/Switch;
5. Dialog/AlertDialog/Sheet;
6. DropdownMenu/Popover/Tooltip;
7. Tabs/ToggleGroup;
8. Slider;
9. Skeleton/Progress;
10. Sonner;
11. Table/ScrollArea;
12. остальные по реальной необходимости.

Каждый добавленный component:

- проверяется на соответствие preset;
- при необходимости адаптируется один раз в `components/ui`;
- не получает route-specific стили;
- не копируется в другие папки.

## Этап 6 — reusable Hashpix layer

До массовой миграции routes создать только повторяемые product-композиции.

Не создавать abstraction после первого единичного использования без доказанной повторяемости.

Хороший критерий:

- используется минимум в двух местах;
- имеет устойчивую продуктовую роль;
- уменьшает дублирование;
- не скрывает бизнес-логику.

## Этап 7 — auth

Мигрировать:

- login;
- registration;
- forgot password;
- reset password;
- verification;
- onboarding.

Проверить:

- forms;
- errors;
- disabled/loading;
- password visibility;
- keyboard;
- mobile;
- focus.

## Этап 8 — dashboard/platform routes

Мигрировать каждую route по ledger.

Для каждой route:

1. найти зависимости через Codebase Memory;
2. определить legacy imports;
3. выбрать shadcn primitives;
4. сохранить продуктовую структуру;
5. заменить UI;
6. проверить состояния;
7. targeted tests;
8. visual check;
9. пометить route complete.

## Этап 9 — admin

Админка должна использовать ту же систему:

- tokens;
- buttons;
- forms;
- table;
- dialogs;
- filters;
- notifications.

Не создавать отдельную вторую дизайн-систему для admin.

Допустима более плотная layout-density, но на тех же foundations.

## Этап 10 — global overlays

Финальный отдельный аудит:

- modal portals;
- toast provider;
- tooltip provider;
- command palette;
- dropdown layers;
- z-index;
- focus traps;
- overlays;
- destructive confirmations.

## Этап 11 — удаление legacy

После миграции всех routes:

1. найти все legacy imports;
2. найти неиспользуемые CSS classes;
3. найти hardcoded tokens;
4. удалить старые providers;
5. удалить старые modal/toast wrappers;
6. удалить dead UI components;
7. проверить build;
8. проверить current diff через Codebase Memory.

## Этап 12 — финальный gate

Миграция не завершена, пока не выполнен полный checklist из раздела 20.

---

# 13. Правила экономии токенов и кредитов

Это обязательная часть задания.

## 13.1. Модель

Для основной работы использовать **Terra Medium**.

Не повышать reasoning заранее.

Переход на Terra High допустим только при конкретной причине:

- архитектурная неоднозначность;
- сложный cross-module bug;
- data-flow невозможно восстановить;
- две корректно поставленные попытки Medium не дали результата;
- требуется изменить фундаментальный API-контракт.

Не использовать Ultra, subagents и Max без явного согласования.

Для локальных правок после основной миграции допустима Luna Medium.

## 13.2. Не читать весь проект повторно

После индексации:

- graph-first;
- exact-file-second;
- grep fallback.

Не перечитывать неизменённые файлы без причины.

Не открывать файл целиком, если нужен один symbol/range.

## 13.3. Не печатать полные логи

При ошибке показывать:

- команду;
- exit code;
- релевантный фрагмент;
- последние строки.

Не выводить в чат полный build log.

## 13.4. Не писать длинные статусы

Промежуточное сообщение:

- 1–3 предложения;
- что сделано;
- что делаешь дальше;
- блокер, если есть.

Не пересказывать архитектуру после каждого шага.

## 13.5. Финальный ответ

Не более 12–15 строк:

1. завершённый этап;
2. изменённые области;
3. проверки;
4. оставшиеся блокеры;
5. следующий логичный этап.

Полные отчёты сохранять в repo docs, а не в ответ.

## 13.6. Не делать несколько одинаковых планов

Один migration plan создаётся один раз и обновляется.

Не писать новый план в каждом чате.

## 13.7. Targeted checks first

После локальной волны:

- targeted tests;
- typecheck затронутого workspace;
- lint изменённых файлов;
- route/browser check.

Полный build и full suite — на checkpoints, а не после каждой кнопки.

## 13.8. Не задавать вопросы, ответы на которые есть в коде

Сначала:

- Codebase Memory;
- `package.json`;
- config;
- routes;
- tests;
- existing patterns.

Задавать вопрос пользователю только для продуктового решения, которое невозможно вывести из проекта или спецификации.

## 13.9. Не добавлять зависимости без причины

Перед новой production dependency:

- проверить shadcn registry;
- проверить существующие dependencies;
- объяснить необходимость;
- оценить bundle impact.

## 13.10. Не подключать лишние MCP

На этой задаче нужны:

- Codebase Memory;
- shadcn.

Остальные отключить, если они не используются.

---

# 14. Коммуникационный протокол агента

## Перед началом

Ответить кратко:

```text
Принял спецификацию. Сначала проверю Git, проиндексирую проект через Codebase Memory и создам inventory без изменений UI. Затем покажу только краткий результат и начну foundation migration.
```

## Во время работы

Не писать:

- длинные рассуждения;
- подробные пересказы документа;
- общие объяснения shadcn;
- историю каждого terminal command.

Писать:

```text
Индекс готов. Нашёл N routes, N legacy primitives и N modal implementations. Inventory сохранён в <path>. Перехожу к foundation/preset.
```

## При блокере

```text
Остановился: команда затрагивает <файл/контракт>, который выходит за scope. Нужен выбор между A и B.
```

## После этапа

```text
Этап X завершён. Проверки: typecheck — pass, targeted tests — pass. Ledger обновлён. Следующий этап — Y.
```

---

# 15. Короткий `AGENTS.md`, который нужно создать или обновить

Не копировать туда весь этот документ.

Рекомендуемый repo-level блок:

```md
# Hashpix agent rules

## UI system

- Internal product UI uses shadcn/ui with preset `b38miVLH6`.
- Read `docs/migrations/shadcn-ui-migration.md` for migration work.
- Preserve existing product layout and navigation structure.
- Do not introduce new legacy/self-written UI primitives.
- Use `components/ui` for shadcn primitives and `components/hashpix` for reusable product components.
- Do not hardcode colors, radii, shadows, focus rings, or control states in routes.
- The public landing page is outside the migration scope.

## Code exploration

- Use Codebase Memory before broad grep or whole-file reads.
- Verify exact source before editing.
- Run `detect_changes` after cross-file changes.

## Cost discipline

- Keep updates concise.
- Read only relevant files and line ranges.
- Run targeted checks before full suites.
- Do not print full logs.
- Stop when acceptance criteria are met.
```

Если корневой `AGENTS.md` уже существует, объединить правила аккуратно, не дублировать и не раздувать файл.

---

# 16. Проверка каждой route

Route считается мигрированной, когда:

- отсутствуют legacy UI imports;
- отсутствуют локальные аналоги shadcn primitives;
- нет случайных hardcoded colors/radii/shadows;
- используются semantic tokens;
- product layout сохранён;
- все buttons едины;
- forms доступны;
- dialogs заменены;
- notifications едины;
- loading/error/empty/success реализованы;
- keyboard navigation работает;
- focus-visible работает;
- responsive не сломан;
- route проходит typecheck;
- targeted tests проходят;
- visual check выполнен;
- ledger обновлён.

---

# 17. Правила для модальных окон

Каждое legacy modal найти через Codebase Memory и классифицировать.

## Dialog

Использовать для:

- создания;
- редактирования;
- подробной формы;
- обычного подтверждения с обратимым действием.

## AlertDialog

Использовать для:

- удаления;
- необратимого действия;
- потери данных;
- destructive confirmation.

## Sheet/Drawer

Использовать для:

- мобильной панели;
- боковых настроек;
- secondary workflow;
- панели, которая должна сохранять контекст страницы.

## Popover

Использовать для:

- компактной палитры;
- фильтра;
- даты;
- быстрого выбора;
- anchored helper UI.

Не вкладывать Dialog в Dialog без необходимости.

Проверить:

- focus return;
- escape;
- overlay;
- scroll lock;
- destructive button;
- mobile layout.

---

# 18. Правила для уведомлений

Одна глобальная toast-система.

Типы:

- success;
- error;
- warning;
- info;
- loading/promise.

Toast должен быть коротким.

Плохо:

```text
Произошла ошибка при выполнении операции. Пожалуйста, попробуйте ещё раз.
```

Лучше:

```text
Не удалось сохранить стиль.
```

Действие:

```text
Повторить
```

Field errors не выносить только в toast.

Не показывать success toast для каждого автосохранения, если достаточно тихого статуса «Сохранено».

---

# 19. Visual QA

Использовать браузерную проверку/Playwright, если доступно.

Проверить минимум:

- desktop основной размер;
- узкий desktop;
- tablet;
- mobile для auth и поддерживаемых product routes.

Сравнить:

- до;
- после;
- layout;
- spacing;
- overflow;
- modal;
- dropdown;
- focus;
- disabled;
- loading;
- error.

Не тратить итерации на идеальное пиксельное совпадение с preview shadcn. Цель — Hashpix на новой системе, а не копия showcase.

---

# 20. Финальный acceptance checklist

## Coverage

- [ ] Все внутренние routes перечислены.
- [ ] Все внутренние routes мигрированы.
- [ ] Auth мигрирован.
- [ ] Dashboard мигрирован.
- [ ] Admin мигрирован.
- [ ] Все modals мигрированы.
- [ ] Все notifications мигрированы.
- [ ] Все forms мигрированы.
- [ ] Все menus мигрированы.
- [ ] Все loading/error/empty states унифицированы.
- [ ] Лендинг не получил нежелательных изменений.

## Design system

- [ ] Preset `b38miVLH6` применён.
- [ ] `components.json` корректен.
- [ ] Primitive-base едина.
- [ ] Shadcn Skill установлен.
- [ ] Shadcn MCP подключён или осознанно отключён после migration.
- [ ] Semantic tokens используются.
- [ ] Hardcoded UI values удалены.
- [ ] Radius system едина.
- [ ] Typography system едина.
- [ ] Motion system едина.
- [ ] Focus system едина.

## Components

- [ ] Нет дублирующих Button.
- [ ] Нет дублирующих Input.
- [ ] Нет дублирующих Select.
- [ ] Нет дублирующих Dialog.
- [ ] Нет второй toast-системы.
- [ ] Нет legacy modal provider.
- [ ] Нет смешения Radix/Base UI/React Aria без задокументированной причины.
- [ ] Product components переиспользуются.

## Quality

- [ ] Typecheck проходит.
- [ ] Lint проходит.
- [ ] Targeted tests проходят.
- [ ] Full build проходит.
- [ ] Критические flows проверены.
- [ ] Keyboard navigation проверена.
- [ ] Focus проверен.
- [ ] Mobile auth проверен.
- [ ] Visual QA выполнен.
- [ ] Codebase Memory `detect_changes` не показывает непросмотренный риск.
- [ ] Legacy inventory закрыт.
- [ ] Dead code удалён.

## Delivery

- [ ] Migration ledger завершён.
- [ ] `docs/ui/design-system.md` актуален.
- [ ] `AGENTS.md` короткий.
- [ ] Нет огромных временных migration comments.
- [ ] Нет TODO «перенести позже» без issue/решения.
- [ ] В main/production не попало смешанное состояние.

---

# 21. Stop conditions

Остановись и запроси решение, если:

- требуется менять бизнес-логику;
- требуется менять API-контракт;
- требуется менять routing;
- требуется менять database schema;
- требуется менять архитектуру лендинга;
- preset конфликтует с критичной существующей зависимостью;
- shadcn init собирается уничтожить custom logic;
- migration требует смены primitive-base вопреки preset;
- необходимо установить крупную production dependency;
- обнаружена критичная accessibility/architecture проблема, исправление которой меняет продуктовый flow.

Не останавливайся ради:

- выбора имени локальной переменной;
- очевидного расположения файла;
- форматирования;
- исправления type error;
- выбора существующего shadcn primitive;
- вопроса, который разрешается через codebase.

---

# 22. Первый исполнимый запрос после получения этого файла

Выполни следующий порядок:

```text
1. Ничего пока не меняй в UI.
2. Проверь Git и создай отдельную migration branch/worktree.
3. Установи и подключи стандартный Codebase Memory MCP без UI.
4. Создай `.cbmignore`.
5. Проиндексируй весь репозиторий.
6. Проверь index status, schema и architecture.
7. Найди все внутренние routes.
8. Найди legacy UI primitives, modal и toast implementations.
9. Создай migration inventory и route ledger в `docs/migrations/`.
10. Дай пользователю только краткий итог: пути документов, количество routes, количество legacy patterns и обнаруженные блокеры.
11. Не начинай массовую замену, пока foundation plan не зафиксирован.
```

После подтверждения foundation:

```text
1. Decode preset `b38miVLH6`.
2. Проверить base и текущую конфигурацию.
3. Инициализировать shadcn/ui командой:
   npx shadcn@latest init --preset b38miVLH6 --template next
4. Проверить diff.
5. Установить shadcn skill:
   npx skills add shadcn/ui
6. Подключить shadcn MCP.
7. Стабилизировать semantic tokens.
8. Добавить только необходимые primitives.
9. Начать route-by-route migration внутри migration branch.
```

---

# 23. Ресурсы для ознакомления

Использовать как актуальные первичные источники:

- shadcn CLI  
  https://ui.shadcn.com/docs/cli

- shadcn MCP  
  https://ui.shadcn.com/docs/mcp

- shadcn Theming  
  https://ui.shadcn.com/docs/theming

- shadcn Registry  
  https://ui.shadcn.com/docs/registry

- shadcn Skills  
  https://ui.shadcn.com/docs/skills

- Skills directory  
  https://www.skills.sh/

- Codebase Memory MCP  
  https://github.com/DeusData/codebase-memory-mcp

- Codex best practices  
  https://developers.openai.com/codex/learn/best-practices

- Codex MCP  
  https://developers.openai.com/codex/mcp

- Codex AGENTS.md  
  https://developers.openai.com/codex/agent-configuration/agents-md

- Codex skills  
  https://developers.openai.com/codex/build-skills

- Codex usage optimization  
  https://developers.openai.com/codex/pricing

---

# 24. Финальное определение готовности

Задача не считается выполненной после:

- установки shadcn;
- применения preset;
- миграции одной страницы;
- добавления новых buttons;
- создания tokens;
- замены только dashboard;
- удаления части старого CSS.

Задача считается выполненной, когда:

> Вся внутренняя часть Hashpix использует одну новую систему shadcn/ui + Hashpix semantic tokens + Hashpix reusable components; старая компонентная система удалена; хардкод устранён; структура продукта сохранена; ни одна внутренняя страница, модальное окно, форма или уведомление не осталось на legacy UI; проверки проходят; лендинг не затронут.

---

# 25. Краткая директива агенту

```text
Работай как инженер миграции, а не как генератор нового дизайна.

Сначала пойми проект через Codebase Memory.
Затем стабилизируй shadcn foundation и tokens.
После этого мигрируй каждую внутреннюю route в изолированной ветке.
Не меняй продуктовую структуру.
Не создавай новые самописные primitives.
Не оставляй смешанную систему.
Не трать токены на длинные объяснения.
Не читай весь репозиторий повторно.
Не печатай полные логи.
Не повышай reasoning без реального блокера.
Проверяй каждый этап.
Остановись только при настоящем продуктовом или архитектурном конфликте.
```
