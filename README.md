# Hashpix / 4Short

Конвейер коротких вертикальных видео: источник → транскрипция → поиск моментов → проверка → оформление → независимый рендер клипов.

## Состав репозитория

- `app/` — Next.js App Router: публичный сайт, блог, кабинет и закрытая админка.
- `services/control-api/` — Fastify API: авторизация, проекты, очередь, минуты, платежи, S3 и SSE.
- `services/media-worker/` — Python/FFmpeg worker для probe, импорта, анализа и рендера.
- `packages/contracts/` — общие Zod-контракты web/API/worker.
- `packages/product-config/` — тарифы, квоты, retention и безопасные product defaults.
- `db/` и `drizzle/` — PostgreSQL schema и миграции.
- `docs/architecture/` и `docs/runbooks/` — production-решения и эксплуатация.
- `.claude/skills/` — обязательные правила UI/UX, capability map и regression checks.

## Локальный запуск

Требуется Node.js 22 и Python 3.12 для тестов worker.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Control API запускается отдельно:

```bash
npm run dev:api
```

Публичный web по умолчанию доступен на `http://localhost:3000`, API — на `http://localhost:4100`. Без настроенного API кабинет явно работает в локальном preview-режиме и не должен выдавать демонстрационные данные за серверные.

## Основные проверки

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:worker
npm run db:check
npm run build
npm run build:vercel
```

`npm test` собирает vinext-версию и проверяет серверный HTML публичных и закрытых маршрутов. CI дополнительно собирает официальный Next.js output для Vercel.

## Данные и инфраструктура

- PostgreSQL — единственный источник истины для аккаунтов, проектов, очереди и minute ledger.
- Timeweb Object Storage — приватные исходники, производные файлы, бренд-ассеты и результаты.
- Multipart upload идёт из браузера напрямую в S3; API выдаёт только подписанные URL.
- Хранилище ограничено тарифом и проверяется сервером до создания upload session.
- T-Банк используется для интернет-эквайринга.
- STT и LLM подключаются через адаптеры и allowlist; конкретный провайдер не зашит в продуктовую модель.
- Пользовательские media и PII не должны проходить через публичный Next.js hosting.

Полная схема: [`docs/architecture/production-foundation.md`](docs/architecture/production-foundation.md). Настройка Timeweb: [`docs/runbooks/timeweb-bootstrap.md`](docs/runbooks/timeweb-bootstrap.md). Серверная безопасность: [`docs/runbooks/server-hardening.md`](docs/runbooks/server-hardening.md).

## Правила разработки кабинета

Перед изменением `app/dashboard/**` прочитайте применимые skills:

- `dashboard-design-system` — токены, плотность, HeroUI primitives;
- `dashboard-ux-flows` — четырёхшаговый flow, проекты, квоты и удаление;
- `backend-capability-map` — что действительно поддержано API/worker;
- `no-dead-ui` — запрет неработающих контролов;
- `css-regression-guard` — обязательный визуальный QA;
- `clip-formats` и `subtitle-styles` — возможности рендера.

Нельзя добавлять UI-функцию как активный control, пока её эффект не проходит до API/worker. Неподдержанное состояние показывается как честный `LockedField`.

## Секреты

Используйте только переменные из `.env.example`. Реальные ключи, пароли, URL с credentials и production `.env` не коммитятся. В web допускаются лишь `NEXT_PUBLIC_*`; database, auth, S3, provider и payment secrets принадлежат control API/worker.
