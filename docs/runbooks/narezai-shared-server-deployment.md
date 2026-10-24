# Narezai на общем сервере Timeweb

Статус: процедура подготовлена, **не развёрнуто и не подтверждено испытаниями**. На сервере
также работают CryoDoc/FunPay Cloud. Не запускайте глобальный `4short-server-provision`: он
меняет общие SSH/firewall/Docker настройки и конфигурацию reverse proxy.

## Факты последней read-only инвентаризации

- `api.narezai.com` указывает на `89.23.99.196`, общий сервер Timeweb.
- `narezai.com` и `www.narezai.com` указывают на `95.163.244.138`; это пока не подтверждённые
  адреса deployment Vercel. Не менять эти DNS-записи, пока их не сверили с Vercel.
- `app.narezai.com` не разрешается в DNS. Сейчас предполагается один Vercel project: лендинг на
  `/`, приложение на `/dashboard`, но фактическую привязку домена ещё требуется проверить.
- С сервера разрешается приватный PostgreSQL endpoint `managed-652579-9035109` в
  `192.168.0.5`. Проверка `psql` с `sslmode=verify-full` прошла как `narezai_app` в базе
  `narezai`; сертификат сверялся по hostname. Эффективные `CONNECT`, DB `CREATE`, schema
  `USAGE/CREATE` есть в `narezai`, `CONNECT` к `creodock` отсутствует. Пароль хранится только
  в `/etc/4short/database.env` (`root:root`, `0600`). Публичный IPv4 базе не нужен.
- БД уже не пустая: 59 public tables и 23 rows в `__drizzle_migrations`; все 59 таблиц и 4
  sequence принадлежат `narezai_app`. Read-only production-query сравнил все 23 remote migration
  hashes с SHA-256 SQL-файлов `0000`–`0022` в этой ветке: все совпали. В ветку добавлена миграция
  `0023_gpu_worker_queue_class`, затем
  `0024_workspace_clipping_defaults`. Отдельная прежняя `0012_transcript_coverage` дублировала
  колонки `0017_transcript_range_bindings`; её SQL оставлен как незадействованная историческая
  запись, а из активного journal исключён. `0023` и `0024` ещё не применялись к live DB. Миграции не запускать до ревью
  неизменяемого release-архива и pre-deploy проверки pending SQL.
- `s3.twcstorage.ru` разрешается; `narezai-s3` приватный. Пользователь `narezai-app` получил
  custom policy только на `narezai-s3/{raw,proxy,derived,assets}/*`; другие бакеты без доступа.
  Ключи установлены в `/etc/4short/s3.env` (`root:root`, `0600`). С сервера прошли PUT/HEAD/GET/
  DELETE временного тестового объекта и multipart upload/list/abort; объект был удалён, multipart
  завершён abort. Browser CORS и API интеграция не проверены; API-контейнеры не развёрнуты.
- 80/443 принадлежат существующему Caddy container с сайтами `api.creodoc.com`,
  `api.funpay.cloud`, `agent.funpay.cloud`. Narezai route отсутствует.
- `/etc/4short` содержит root-only PostgreSQL/S3 secrets и pinned certificate; `/opt/4short`
  отсутствует. `control-api.env` и worker env отсутствуют, приложение не развернуто. Наличие
  prerequisites на диске не означает, что они подключены к работающему Narezai release.

Это только наблюдения inventory/connectivity, а не health-проверка развёрнутого сервиса.

## Изоляция сети

`compose.production.yml` публикует API только на `127.0.0.1:4100`, подключает миграции/API к
закрытой внутренней сети и подключает API к внешней Docker-сети `narezai_edge` с alias
`narezai-control-api`. До релиза нужно создать `narezai_edge` и подключить к ней существующий
Caddy container. Не подключать Narezai к `creodock_edge`, где находятся другие приложения.

Разовое `docker network connect` не переживёт пересоздание Caddy. Перед будущим recreate нужно
согласовать устойчивое подключение сети в Compose/конфигурации владельца Caddy. Не перезапускать
общие контейнеры ради подготовки Narezai.

## Порядок релиза

1. Выбрать reviewed immutable commit. Не релизить dirty checkout. Локальные Mac ограничения
   остаются: никакие тесты, сборки, контейнеры, загрузки моделей/видео или медиапрогоны.
2. Установить root-owned protected env files с правами `0600`: API получает private PG URL и
   `verify-full`, `narezai-s3` credentials, точные origins и auth secrets; worker — отдельный
   token, S3 credentials, model identity и `CONTROL_API_URL=https://api.narezai.com`. Секреты
   не должны попадать в Git, image layers, deployment artifacts, CI logs или `NEXT_PUBLIC_*`.
3. Проверить отдельную `narezai_edge` и connectivity Caddy→API alias, сохраняя loopback-only
   публикацию порта 4100.
4. Ревьюить `infra/server/bin/4short-deploy` на соответствие общему серверу. Он должен
   затрагивать только Narezai compose project, не перезапускать Docker/Caddy или соседние
  приложения; запускать только после наличия root-owned `0600` control env, staged worker token
  `0600` и выделенной `narezai_edge` сети. Скрипт ограничивает staging path точным именем архива
  SHA и распаковывает root-owned копию; всё равно требуется серверный review/archive-path check
  перед первым запуском. Проверить миграции и readiness перед переключением release symlink.
5. Добавить `infra/server/caddy/narezai-api.caddy` к полной существующей Caddy-конфигурации,
   не заменяя остальные site blocks. Проверить полную конфигурацию в текущем Caddy image,
   затем graceful reload. Проверить TLS, `/health/live`, `/health/ready`, CORS и все текущие
   CryoDoc/FunPay endpoints. При регрессии вернуть прежний Caddyfile и выполнить graceful reload.
6. Отдельно подтвердить домен/production deployment на Vercel. До этого не менять DNS apex/WWW.
   Установить `NEXT_PUBLIC_CONTROL_API_URL=https://api.narezai.com`, затем согласовать точные
   web origin для API и S3 CORS.
7. До открытия продукта провести серверные проверки в изолированном контуре: API/DB, signed
   upload/download, resume/cancel, очередь, внешний worker, рендер, QC, backup/restore и rollback.

## GPU-worker — отдельный незавершённый этап

Immers.cloud screenshots показывают OpenStack endpoints и project/user IDs, но не подтверждают
действующую авторизацию API, доступную GPU quota или существующий GPU instance. Текущий compose
worker сам по себе не реализует OpenStack lifecycle/autoscaling. До платных действий нужно
получить пригодные provider credentials, проверить flavor/image/network/quota и фактические
тарифы, затем реализовать и серверно проверить ограниченный lifecycle:
create → claim одного job → heartbeat/cancel → upload artifacts → stop/delete → idle timeout
и hard spend limits. Не пополнять баланс и не создавать платную VM без отдельного подтверждения.

## Незакрытые release gates

- S3 application key/policy и базовые server-side object/multipart операции проверены; production
  CORS и frontend signed upload flow не проверены.
- DB connectivity с PostgreSQL TLS verify-full подтверждена. Live migration history совпадает с
  23-entry journal основного checkout, но не с активным `codex/opus-product-rebuild`; миграции
  из активного checkout не запускались.
- GPU provider authorization, worker lifecycle и автоматическая остановка не реализованы.
- Нет production Narezai API deployment и Caddy route.
- Vercel binding и корректность frontend DNS не подтверждены.
- Не пройдены серверные HVE/full-cycle/queue/render/QC/backup/rollback проверки.

До выполнения всех соответствующих пунктов статус — **не production-ready**.
