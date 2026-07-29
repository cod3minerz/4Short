# 4Short server hardening

## Public network surface

Only these TCP ports are public:

- `22` — key-only SSH for `deploy`;
- `80` — ACME redirect/challenge;
- `443` — HTTPS reverse proxy.

Control API binds to `127.0.0.1:4100`. Worker, Docker daemon, PostgreSQL and
object storage credentials are never exposed as listening services.

## SSH

- Root and password authentication are disabled over SSH.
- The `deploy` account uses a dedicated Ed25519 key.
- `deploy` has passwordless sudo for automated deployment.
- Agent, X11 and TCP forwarding are disabled.
- The provider console remains the recovery path.

Before reloading SSH:

```bash
sudo sshd -t
```

Always keep an already authenticated session open until a second key-only
session has been verified.

## Host protections

- UFW default-deny inbound and default-allow outbound.
- Fail2ban aggressive SSH jail using UFW.
- Unattended security updates.
- Kernel redirect, source-route, ptrace and BPF hardening.
- Persistent journal limited to 512 MB and 14 days.
- Emergency swap protects the worker from abrupt OOM but is not worker memory.

## DDoS and bots

UFW and fail2ban reduce scanning and brute force but cannot absorb volumetric
DDoS. Public HTTP must remain behind the provider network protection and,
where appropriate, a reverse proxy/CDN with request-rate controls.

The Timeweb CDN attached to the S3 bucket is not used for private source videos
or signed uploads. It can later serve explicitly public/static derivatives.

## API TLS

`api.4short.ru` resolves directly to the production server. Caddy is the only
public HTTP entrypoint and proxies to the control API on
`127.0.0.1:4100`. Domain and ACME contact values are stored in
`/etc/caddy/4short.env`, outside the repository.

## Recovery

1. Use the Timeweb web console if SSH is unavailable.
2. Validate `/etc/ssh/sshd_config.d/00-4short-hardening.conf`.
3. Temporarily disable the drop-in only from the provider console.
4. Never open PostgreSQL, Docker or Control API ports directly to the Internet.

## Production deployment

Production is released from an immutable Git archive. The deployment script:

- validates the full commit SHA;
- builds images before replacing running containers;
- runs database migrations once;
- waits for both API and worker health checks;
- switches `/opt/4short/current` only after success;
- restores the previous release if activation fails.

GitHub Actions requires these `production` environment secrets:

- `DEPLOY_HOST`;
- `DEPLOY_SSH_PRIVATE_KEY`;
- `DEPLOY_SSH_KNOWN_HOSTS`.

The workflow deploys `main`; feature branches only run CI.

## Database backups

The server creates a custom-format PostgreSQL dump every day around 02:30
Moscow time, encrypts it locally with `age`, and uploads only the encrypted
archive to the private object-storage prefix `backups/postgres/`.

Every run validates the archive with `pg_restore --list` before uploading and
then verifies the uploaded object metadata. The local dump is always removed.

The timer can be checked with:

```bash
systemctl list-timers 4short-postgres-backup.timer
systemctl status 4short-postgres-backup.service
```

A restore drill must be run monthly against a disposable database. Successful
upload is not treated as proof that a backup is restorable. The private age
recovery key is intentionally stored outside the server and must have a second
offline copy.
