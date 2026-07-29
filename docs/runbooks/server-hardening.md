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

## Recovery

1. Use the Timeweb web console if SSH is unavailable.
2. Validate `/etc/ssh/sshd_config.d/99-4short-hardening.conf`.
3. Temporarily disable the drop-in only from the provider console.
4. Never open PostgreSQL, Docker or Control API ports directly to the Internet.
