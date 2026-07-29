# Timeweb bootstrap

## PostgreSQL

Публичный CA Timeweb уже включён в control-api image:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/4short
DATABASE_SSL=verify-full
DATABASE_SSL_ROOT_CERT=/etc/ssl/certs/timeweb-cloud-root.crt
```

Пароль не хранится в Git, Docker image или compose-файле.

Первичную выдачу прав выполняет владелец базы:

```sql
GRANT USAGE, CREATE ON SCHEMA public TO gen_user;
```

После этого:

```bash
npm run db:migrate
```

Миграции сохраняются в `public.__drizzle_migrations`. Для обычного API рекомендуется
отдельная runtime-роль с `CONNECT`, `USAGE` на `public` и DML-правами на созданные
таблицы и sequence. DDL-права мигратора не нужно передавать приложению.

## Object Storage

Timeweb выдаёт один bucket, поэтому production environment выглядит так:

```env
S3_ENDPOINT=https://s3.twcstorage.ru
S3_REGION=ru-1
S3_FORCE_PATH_STYLE=true
S3_BUCKET=<bucket-name>
S3_RAW_PREFIX=raw
S3_PROXY_PREFIX=proxy
S3_DERIVED_PREFIX=derived
S3_ASSETS_PREFIX=assets
S3_ACCESS_KEY_ID=<secret>
S3_SECRET_ACCESS_KEY=<secret>
```

Bucket остаётся приватным. Браузер получает только короткоживущие signed URLs.
Access Key и Secret Key задаются как server secrets и никогда не попадают в
`NEXT_PUBLIC_*`.

Перед запуском beta проверить:

1. multipart upload через `/v1/uploads`;
2. чтение range-запросом worker;
3. загрузку derived artifact;
4. истечение signed URL;
5. lifecycle для незавершённых multipart upload и временных audio.
