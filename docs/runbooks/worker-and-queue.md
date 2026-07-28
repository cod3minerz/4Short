# Runbook: worker и очередь

## Worker перестал присылать heartbeat

1. Проверить `worker_leases.last_heartbeat_at`, RAM, swap и scratch.
2. Не изменять job вручную до истечения `lease_expires_at`.
3. Lease sweep сам переведёт job в `queued` либо `failed`.
4. Проверить, что checkpoint/artifact уже записан: повторный handler обязан использовать его.
5. После восстановления сравнить `job_attempts` и `job_events`.

## Заполнение диска

- При свободном месте меньше 8 ГБ новые тяжёлые jobs не стартуют.
- При 70% заполнения проверить orphan job dirs только против активных leases.
- Не удалять путь по glob или по неизвестному job id.
- Media, загруженные в S3, можно очистить из scratch после проверки ETag/head.

## Ошибка провайдера

- 5xx/timeout — retry с exponential backoff.
- Ошибка входных данных — terminal failure с понятным code.
- До принятия STT резерв можно release.
- После технической ошибки сервиса создаётся компенсирующая minute transaction.

## Расхождение минут

1. Остановить новые reservation.
2. Сравнить сумму `minute_buckets.available_seconds` с append-only ledger.
3. Не редактировать старые записи.
4. Создать `adjustment` с incident id и зафиксировать audit event.

## Подключение второго worker

Запустить тот же versioned image с уникальным `WORKER_ID` и теми же API/S3 credentials.
Миграция очереди не требуется. Проверить, что один workspace не получает оба heavy slots подряд
при наличии jobs других workspace.
