# Timeweb bootstrap for Narezai

This runbook records the agreed topology and the remaining server-side setup. It does not mean
that production has been deployed or tested.

## Managed PostgreSQL

The database is `narezai` on the existing private Timeweb Managed PostgreSQL service. Use the
single agreed application/migration role `narezai_app`; do not create additional roles unless a
later security review demonstrates a concrete need. The private service endpoint is
`managed-652579-9035109` on port 5432 and is reachable from the existing Timeweb server's private
network. Keep the database private; do not enable public IPv4 for this integration.

Production environment (the password is installed only as a protected server secret):

```env
DATABASE_URL=postgresql://narezai_app:<URL-ENCODED-PASSWORD>@managed-652579-9035109:5432/narezai
DATABASE_SSL=verify-full
DATABASE_SSL_ROOT_CERT=/etc/ssl/certs/narezai-managed-postgres.crt
```

Production startup validation fails closed unless database TLS is `verify-full`, the certificate
path is set, the single private `S3_BUCKET` is explicitly configured, and the API/web/S3 public
URLs use HTTPS. Development retains its local HTTP defaults. Do not treat these startup guards as
a connectivity check; the actual certificate, credentials, migrations and object operations still
require the pending server-side verification.

The public certificate is included in the control API image from
`infra/certs/timeweb-creodock-postgres.crt`; it is not a password or private key. Confirm the
endpoint's TLS name matches the certificate SAN and run the first connection/migration checks
from the server, not from the developer Mac. Do not weaken TLS to `require` or `disable` to bypass
a hostname/certificate error.

Migrations are executed by the same `narezai_app` role per the agreed single-user setup. From the
existing Timeweb host, a read-only `psql` check succeeded with `sslmode=verify-full` and the
provider certificate. Effective privileges were confirmed: `CONNECT` and database `CREATE` on
`narezai`, plus `USAGE` and `CREATE` on its `public` schema; the role has no `CONNECT` on
`creodock`. No global role privilege was granted. The required migration DDL access is therefore
already present in the intended database.

Do not run the current repository migrations yet. Read-only inventory found 59 public tables and
23 rows in `public.__drizzle_migrations`, while this checkout has 13 journal entries and its
Drizzle journal declares `dialect: sqlite` even though `drizzle.config.ts` declares PostgreSQL.
The first 11 database migration hashes match this checkout; the remaining 12 database records do
not match the current checkout's migrations 0011 and 0012. All 59 tables and 4 sequences are owned
by `narezai_app`, so this role can alter its existing objects without granting global privileges.
The divergent migration history still requires reconciliation against the exact reviewed release
before applying anything. Do not reset the journal, drop tables, or infer that matching table names
prove matching schemas. Apply only a reconciled migration plan through the release process and
verify its schema version. Never run migrations from an untrusted laptop network.

The PostgreSQL credentials are installed at `/etc/4short/database.env` on the existing server
(`root:root`, mode `0600`). `compose.production.yml` now references this file separately from
the still-missing API configuration. This is not an application deployment or migration run.

## Private S3 bucket

The existing bucket is `narezai-s3` and is private. Timeweb endpoint and region:

```env
S3_ENDPOINT=https://s3.twcstorage.ru
S3_REGION=ru-1
S3_FORCE_PATH_STYLE=true
S3_BUCKET=narezai-s3
S3_RAW_PREFIX=raw
S3_PROXY_PREFIX=proxy
S3_DERIVED_PREFIX=derived
S3_ASSETS_PREFIX=assets
S3_SERVER_SIDE_ENCRYPTION=none
```

The existing `narezai-app` key is configured for this bucket only; other Timeweb buckets remain
inaccessible. Its saved custom policy permits only the listed object actions under the four
Narezai prefixes below. The key pair has been installed directly on the shared production host in
`/etc/4short/s3.env` (`root:root`, mode `0600`) without printing the values. Compose supplies this
file to the API/migration and worker containers; the API image, Git, `.env.example`, CI logs,
browser variables, and chat must never contain the keys. This is configuration evidence, not an
S3 connectivity check. User-facing browsers receive short-lived signed URLs only.

The saved custom object policy allows only `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`,
`s3:AbortMultipartUpload`, and `s3:ListMultipartUploadParts`, on only these exact resources:

- `arn:aws:s3:::narezai-s3/raw/*`
- `arn:aws:s3:::narezai-s3/proxy/*`
- `arn:aws:s3:::narezai-s3/derived/*`
- `arn:aws:s3:::narezai-s3/assets/*`

The policy contains no bucket listing, `ListAllMyBuckets`, access to other buckets, or access
outside those prefixes. Multipart create and completion use `PutObject`; `HeadObject` is authorized
by `GetObject`. The Timeweb UI was reloaded and confirmed the custom policy and bucket-only grant.
From the existing server, a temporary non-user fixture under `assets/ops-smoke/` passed
`PutObject` → `HeadObject`/`GetObject`, and was deleted. A 5 MiB multipart part was uploaded,
listed, and its upload aborted successfully. These checks validate server-side credentials and
the scoped object policy, not browser uploads, production CORS, resumability, or application
integration.

Before enabling uploads, configure and check bucket CORS for the exact production web origin,
including signed multipart operations and required headers. Do not use wildcard origins with
credentials. Check the provider's multipart-abort lifecycle and configure cleanup/reconciliation
for incomplete uploads; do not delete objects outside Narezai's bucket/prefix ownership.

## Release checks to perform on the server

1. Confirm DNS/TLS for `api.narezai.com` and the selected Vercel origin before changing traffic.
2. Confirm private DB route and certificate verification, then apply migrations using
   `narezai_app`; verify schema version and a reversible read/write smoke check.
3. Verify private bucket access using a small non-user fixture: signed PUT/GET, range request,
   expiry, multipart completion, abort and object cleanup. Do not use customer videos.
4. Confirm API never proxies a whole video through its process memory/disk; browser upload uses
   bounded multipart concurrency and resumable server-side state.
5. Verify monitoring, backups/restore, rollback, secret rotation, and failure alerts before
   inviting users.

Checks above are pending until executed and recorded on the production host. Mac checks/builds,
container runs, model downloads and real video processing are explicitly out of scope.
