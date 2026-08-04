# HVE worker benchmark

Этот benchmark измеряет реальный профиль одного вертикального FFmpeg-рендера
на конкретном worker. Он не использует пользовательские видео, S3, Control API
или STT: создаёт детерминированный `testsrc2 + sine`-исходник и рендерит его в
`1080×1920 H.264/AAC` с тем же лимитом потоков, что и worker.

Это **не** release gate. Один синтетический рендер не доказывает качество
layout'ов, честность очереди, memory-профиль Faster-Whisper или качество
лицензированного корпуса. Его задача — получить воспроизводимые факты для
candidate baseline HVE-G7, а не «зелёный» production-статус.

## Связь benchmark и пользовательского ETA

Каждый worker регистрирует вычисляемый `runtimeFingerprint`: SHA-256 от
версий HVE/renderer, pinned OCI image digest, проверенных fingerprint локальных
моделей, font pack и фактических cgroup CPU/RAM ограничений. Такой же fingerprint прикладывается к
метрикам успешной задачи. Control API строит ETA только по наблюдениям ровно
того runtime, который сейчас активен. Во время rolling deploy, при нескольких
разных runtime или до накопления шести сопоставимых задач API честно возвращает
`insufficient_evidence`, а не усредняет старый и новый worker. Когда данных
достаточно, пользовательский интервал — p10–p90, а не p50–p90: второй по
определению покрывает около 40% стационарных запусков и не соответствует
целевому HVE-G7 покрытию 80–95%.

Локальный worker без `FOURSHORT_WORKER_IMAGE_DIGEST=sha256:…` не считается
достаточно определённым для пользовательского ETA: его наблюдения можно
использовать только при отладке. Deploy-команда передаёт digest фактически
запущенного образа автоматически.

## Проверка калибровки ETA после rollout

Baseline рендера и ETA — два разных доказательства. После rollout один и тот
же pinned runtime должен собрать минимум **40** успешных HVE-attempts с
зафиксированными при claim `p10/p50/p90` и фактическим `wallSeconds`. Только
тогда администратор запрашивает агрегатную, не содержащую пользовательских
данных проверку:

```text
GET /v1/admin/hve/eta-coverage?runtimeFingerprint=<64-hex>&days=30
```

`runtimeFingerprint` берётся из регистрации активного worker или из метрик
успешного attempt. Проверка намеренно исключает другой образ, worker без
immutable identity, provider-waiting и malformed snapshots. Для G7 нужна
`status: "pass"`, 40+ наблюдений и `p10P90Coverage` в диапазоне **0.80–0.95**.
Ниже 0.80 означает ложную уверенность ETA; выше 0.95 — чрезмерно широкий
диапазон, который нужно перекалибровать. Изменение образа, модели, FFmpeg,
font pack или cgroup envelope создаёт другой fingerprint и начинает новую
калибровку, а не смешивает throughput старого запуска.

## Запуск на новом Timeweb worker

Запускайте от deploy-пользователя внутри того же container image и cgroup, в
котором будет работать media-worker. Не запускайте на хосте вместо контейнера:
тогда RAM и лимит CPU будут другими.

## Проверка образа до доступа к production worker

Локальная машина или GitHub runner могут не иметь тех же Python wheels,
FFmpeg-фильтров и PID 1, что в worker. Поэтому executable smoke всегда можно
привязать к уже собранному образу:

```sh
docker build --file services/media-worker/Dockerfile --tag fourshort-media-worker:verify .
HVE_WORKER_TEST_IMAGE=fourshort-media-worker:verify npm run hve:smoke:g2
HVE_WORKER_TEST_IMAGE=fourshort-media-worker:verify npm run hve:smoke:g3
HVE_WORKER_TEST_IMAGE=fourshort-media-worker:verify npm run hve:smoke:g7
```

Runner сохраняет synthetic evidence в `outputs/hve/`. Он запускает дочерние
процессы под `tini`, как production image, поэтому проверка отмены не
создаёт ложный zombie-PID из-за подмены container init. Это подтверждает
исполнение FFmpeg, compositor и bounded-resource logic именно в образе; это
всё ещё **не** заменяет три 60-секундных замера на целевом Timeweb worker.

## Изолированные проверки PostgreSQL-очереди

Интеграционные проверки очереди создают и удаляют рабочие пространства,
задачи, leases и события. Поэтому они **никогда** не читают `DATABASE_URL`.
Для них нужна отдельная пустая база (например, `fourshort_hve_test`) либо
отдельный ephemeral PostgreSQL service CI. Явный запуск выглядит так:

```sh
export HVE_TEST_DATABASE_URL='postgresql://…/fourshort_hve_test'
export HVE_ALLOW_DESTRUCTIVE_INTEGRATION_TESTS=1
npm run db:migrate
npm run test:integration:queue
npm run test:integration:queue-load
```

Не задавайте здесь URL реальной базы 4Short. Без обоих переменных тесты будут
помечены `SKIP`, а HVE-G7 — `INSUFFICIENT`: это безопасное отсутствие
доказательства, а не разрешение тестировать production.

First drain the worker and wait for `Worker activity: idle`:

```sh
sudo /usr/local/sbin/4short-worker-deploy drain on
sudo /usr/local/sbin/4short-worker-deploy drain status
```

Then run the operator command. It invokes the benchmark **inside the already
running worker container**, uses its exact deployed OCI image/cgroup/model
mount, refuses a non-drained or active worker, and does not rely on a temporary
deployment token file.

```sh
for run in 1 2 3; do
  sudo /usr/local/sbin/4short-worker-deploy benchmark "run-${run}"
done
```

After saving the reports outside scratch, re-enable claims:

```sh
sudo /usr/local/sbin/4short-worker-deploy drain off
```

Для smoke-проверки образа разрешён только явный короткий режим:

```sh
HVE_PYTHON=python3 npm run hve:benchmark -- \
  --duration-seconds=5 --allow-short \
  --scratch-root=/tmp/hve-benchmark \
  --output=outputs/hve/benchmark-smoke.json
```

Короткий режим нельзя использовать для baseline или ETA-калибровки.

## Что сохраняется в отчёте

- модель CPU, видимые CPU и точную cgroup CPU-квоту, cgroup RAM, свободное scratch-место, ОС и строку версии FFmpeg;
- peak RSS, CPU/wall time и I/O дочернего FFmpeg-процесса;
- выходной размер, длительность, H.264/AAC profile и полный decode;
- `realtimeFactor = wallSeconds / outputDurationSeconds`.

Оператор сохраняет JSON как неизменяемый candidate artifact, задаёт
`FOURSHORT_WORKER_IMAGE_DIGEST=sha256:…` из фактически запущенного OCI-образа
и делает минимум три одинаковых прогона. Только эти три отчёта могут стать
candidate baseline; одиночный JSON нельзя показывать пользователю как ETA.
Baseline намеренно отклоняет запуск вне ограниченного worker-container: он
должен зафиксировать finite cgroup CPU quota, совпадающую с фактической
квотой Compose (`7.5` core на CPU8/12GB worker), а не только число ядер хоста.

## Candidate baseline и независимое утверждение

Ключ evaluator-а хранится только вне deploy-account. Скрипт не позволяет
молча сравнить отчёт с неподписанным или candidate baseline.

```sh
export HVE_HARDWARE_BASELINE_PRIVATE_KEY_FILE=/secure/evaluator/hve-baseline-private.pem
npm run hve:benchmark:baseline -- build \
  --baseline-id=timeweb-cpu8-12gb-v1 \
  --sample=/var/lib/4short/reports/run-1.json \
  --sample=/var/lib/4short/reports/run-2.json \
  --sample=/var/lib/4short/reports/run-3.json \
  --output=/secure/evaluator/timeweb-cpu8-12gb-v1.candidate.json
```

После отдельной проверки evaluator может создать подписанный approved
baseline, добавив **оба** реквизита approval. Это осознанная операция, а не
часть deploy-пайплайна:

```sh
npm run hve:benchmark:baseline -- build \
  --baseline-id=timeweb-cpu8-12gb-v1 \
  --sample=/var/lib/4short/reports/run-1.json \
  --sample=/var/lib/4short/reports/run-2.json \
  --sample=/var/lib/4short/reports/run-3.json \
  --approval-reference=HVE-REVIEW-2026-08-03 \
  --reviewed-by=release-evaluator \
  --output=/secure/evaluator/timeweb-cpu8-12gb-v1.approved.json
```

Проверка нового sample возвращает `PASS`, `FAIL` или `INSUFFICIENT`; последнее
означает несовместимый образ/машину или отсутствие independent approval, а не
«условно зелёный» результат:

```sh
export HVE_HARDWARE_BASELINE_PUBLIC_KEY_FILE=/secure/evaluator/hve-baseline-public.pem
npm run hve:benchmark:baseline -- compare \
  --sample=/var/lib/4short/reports/candidate.json \
  --baseline=/secure/evaluator/timeweb-cpu8-12gb-v1.approved.json
```

## Безопасность и очистка

- `--output` обязан быть вне `--scratch-root`, чтобы retention scratch не
  удалил доказательство;
- включайте drain перед benchmark: иначе замер конкурирует с пользовательским
  job и не может считаться базовой производительностью;
- benchmark оставляет только синтетические MP4 в указанном scratch-каталоге;
  его можно очистить обычной политикой temp-файлов после сохранения отчёта;
- в отчёт не попадают URL, имена или кадры пользовательских видео.
