# Bootstrap production media worker

This is a one-time procedure for a new HVE worker. It is deliberately split
from ordinary deploys: bootstrap uses the provider's temporary root password;
ordinary releases use a restricted `deploy` account with an SSH key.

## Required GitHub production secrets

| Secret | Purpose |
| --- | --- |
| `WORKER_HOST` | Worker IPv4 address or DNS name. |
| `WORKER_ROOT_PASSWORD` | Temporary provider root password; remove after successful finalization. |
| `WORKER_DEPLOY_PUBLIC_KEY` | Public half of the dedicated GitHub Actions deploy key. |
| `WORKER_DEPLOY_PRIVATE_KEY` | Private half of that key. |
| `WORKER_DEPLOY_KNOWN_HOSTS` | Verified OpenSSH `known_hosts` record for `WORKER_HOST`. |
| `WORKER_API_TOKEN` | Shared control-plane/worker token; required by normal deploy. |

`WORKER_DEPLOY_KNOWN_HOSTS` must be obtained from a trusted console or
out-of-band fingerprint check. Do not treat an unauthenticated `ssh-keyscan`
result on a hostile network as proof of host identity.

To create a hashed known-host record after comparing the fingerprint shown by
the Timeweb console with an independent SSH session:

```bash
ssh-keyscan -H <worker-ip-or-hostname> > worker-known-hosts
ssh-keygen -lf worker-known-hosts
```

Compare that fingerprint before placing the complete `worker-known-hosts`
content into `WORKER_DEPLOY_KNOWN_HOSTS`.

## Run order

1. Configure the secrets above and set the `MEDIA_WORKER_DEPLOY_ENABLED`
   repository variable to `true` only after bootstrap succeeds.
2. Run **Bootstrap media worker** manually in GitHub Actions.
3. Confirm its final `verify` step passed. It installs Docker, a non-root
   `deploy` account, UFW/fail2ban/unattended upgrades, and then disables root
   and password SSH.
4. Remove `WORKER_ROOT_PASSWORD` from GitHub Secrets. It has no place in the
   normal release path.
5. Provision the immutable Faster-Whisper pack as described in
   [whisper-model-provisioning.md](./whisper-model-provisioning.md).
6. Trigger an ordinary deploy. It refuses to become green unless the running
container is healthy, has the recorded immutable OCI image, and reads the
verified Whisper and YuNet model assets.

The ordinary deployer validates the staged `WORKER_API_TOKEN` upload and
atomically installs it as `/etc/4short/worker-api-token.env` (`root:deploy`,
mode `0640`) before Compose starts the worker. GitHub Actions removes the
temporary `/tmp` copy afterwards; it is not an `env_file` dependency, so a
Docker or host restart cannot make a healthy worker lose its API token.

If an older bootstrap installed a deployer before `verify-runtime` existed,
run the new bootstrap once while root access is still available. Future
successful releases update the privileged deployer from the reviewed release
archive only after the worker has passed admission and health checks.

After the first healthy worker release, create the CPU8/12GB hardware baseline
using [hve-worker-benchmark.md](./hve-worker-benchmark.md). The deployer
refuses benchmark execution until the worker is drained and idle, then records
three fixed 60-second samples in `/var/lib/4short/reports`; an evaluator still
has to sign and independently approve the resulting baseline.
