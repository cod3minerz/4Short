# Hashpix domain migration

This runbook moves the public product from `4short.ru` to `hashpix.ru` without
moving data, changing the database, or renaming private object storage keys.
It deliberately keeps the legacy hosts live during the migration window.

## Target routing

| Host | Target | Purpose |
| --- | --- | --- |
| `hashpix.ru` | Vercel | public site and dashboard |
| `www.hashpix.ru` | Vercel | redirect to canonical host |
| `api.hashpix.ru` | Timeweb control server (`147.45.99.153`) | control API and auth |
| `4short.ru`, `www.4short.ru` | Vercel | legacy redirect only |
| `api.4short.ru` | Timeweb control server | temporary API compatibility |

The media worker (`217.149.30.219`) has no public DNS record. It connects to
the control API as a private service.

## Vercel

1. Add `hashpix.ru` and `www.hashpix.ru` to the same Vercel project.
2. Set `hashpix.ru` as the production domain and configure `www` to redirect
   to it. Keep both `4short.ru` hosts attached and redirect them to
   `https://hashpix.ru` for at least 90 days.
3. Set production environment variables and redeploy:

   ```text
   NEXT_PUBLIC_SITE_URL=https://hashpix.ru
   NEXT_PUBLIC_CONTROL_API_URL=https://api.hashpix.ru
   ```

4. Confirm the Vercel certificate is issued before marking the migration live.

## Control API and Caddy

On the control server, back up the current environment and Caddyfile first.
Then set only these public-origin values (preserve all existing secrets):

```text
WEB_ORIGIN=https://hashpix.ru
WEB_TRUSTED_ORIGINS=https://www.hashpix.ru,https://4short.ru,https://www.4short.ru
API_PUBLIC_URL=https://api.hashpix.ru
PAYMENT_RETURN_URL=https://hashpix.ru/dashboard/billing
```

Install `infra/server/caddy/hashpix.env.example` as the server-only Caddy
environment file, with a real monitored email address. The Caddy host list
must contain both `api.hashpix.ru` and `api.4short.ru` during migration.

Validate before reloading:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl --fail --silent --show-error https://api.hashpix.ru/health/live
```

Do not reload Caddy with an unset `LEGACY_API_DOMAIN`: the supplied Caddyfile
expects both hostnames.

## Worker and storage

Set the worker's server-only value to:

```text
CONTROL_API_URL=https://api.hashpix.ru
```

Restart its compose stack only after the new API health endpoint is live.

Add these origins to the Timeweb S3 bucket CORS policy for direct browser
uploads and editor preview:

```text
https://hashpix.ru
https://www.hashpix.ru
https://4short.ru
https://www.4short.ru
```

Do not make the bucket public and do not use `*` with credentialed requests.
Keep private object keys and existing `4short-*` bucket names; they are
internal implementation details and renaming them would break retention and
deduplication.

## Payments and identity

Update the T-Bank success/fail return URL to the canonical Hashpix billing
page. Webhook delivery remains on `API_PUBLIC_URL`, so validate its signature
and retry one sandbox payment before enabling production billing.

Better Auth cookies cannot span two registrable domains. Existing users will
need to enter their OTP once on Hashpix, while their account and projects stay
in the same database.

## Verification and rollback

Verify from a clean browser session:

1. `https://hashpix.ru`, `robots.txt`, `sitemap.xml`, and `/blog/rss.xml`.
2. API live and ready health endpoints on the new host.
3. OTP callback, upload signed URL, and a T-Bank sandbox return.
4. A worker registration and one non-production job.
5. Legacy `4short.ru` redirects to Hashpix; do not redirect `api.4short.ru`
   until workers and payment callbacks use the new API host.

The repository also has a repeatable public check. Run it only after DNS and
Caddy have been changed; it deliberately fails while the migration is not yet
live:

```bash
npm run release:check-domain
```

Rollback is DNS/Vercel routing plus restoring the saved server environment and
Caddyfile. Do not roll back the database schema or S3 object data for a domain
problem.
