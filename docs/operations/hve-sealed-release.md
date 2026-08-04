# HVE sealed release procedure

This procedure produces HVE-G9 evidence. It does **not** make the product
production-ready by itself: a release can be approved only after every command
below has supplied genuine, evaluator-owned evidence. `INSUFFICIENT` means
stop and fill the missing evidence; it is never a warning to ignore.

## 1. Separate roles and secrets

| Role | May access | Must never receive |
|---|---|---|
| Media worker / deploy account | worker API token, model pack, source/result S3 prefixes | evaluator private key, sealed labels, corpus S3 credentials |
| Implementation / CI | public code, synthetic fixtures, evaluator public key when needed | evaluator private key, sealed corpus object keys and annotations |
| Release evaluator | private corpus prefix, evaluator private key, approved hardware baseline | customer production media outside consented corpus |
| Release verifier | signed evidence directory and evaluator public key | evaluator private key |

Generate and store the Ed25519 evaluator private key only on the evaluator
host. The key path is passed through
`HVE_RELEASE_EVALUATOR_PRIVATE_KEY_FILE`; do not put key contents in GitHub
Actions, Compose, `.env`, shell history or a ticket.

```sh
umask 077
openssl genpkey -algorithm ED25519 -out /secure/evaluator/hve-release-private.pem
openssl pkey -in /secure/evaluator/hve-release-private.pem -pubout \
  -out /secure/evaluator/hve-release-public.pem
```

## 2. Freeze the candidate identity

Record before running any corpus work:

- exact 40-character Git SHA;
- immutable `sha256:` OCI image digest, not a mutable tag;
- renderer/FFmpeg build SHA-256;
- every model manifest hash;
- target Timeweb cgroup CPU quota, memory and scratch envelope.

The release evaluator writes those facts into `environment.json`. The assembler
and verifier reject an environment that does not match the candidate SHA/image
or lacks FFmpeg/model provenance.

## 3. Produce the target-worker baseline

Deploy the exact candidate image to the 8 CPU / 12 GB Timeweb worker. Drain it
and collect three 60-second benchmark reports from the live container as
described in [hve-worker-benchmark.md](./hve-worker-benchmark.md). The reports
must share the same image, cgroup quota, FFmpeg build and thread count.

Create a signed baseline candidate; a different evaluator approves it only
after checking the three raw reports. Then compare the release candidate
report with that approved baseline. Place the resulting signed/verified result
in the release-evidence directory as `baseline-comparison.json`.

Do not substitute a local macOS run, short smoke run or a manually edited JSON
file. The HVE release verifier treats missing or incompatible baseline evidence
as `INSUFFICIENT`.

## 4. Run the private corpus and chaos suites

The evaluator uses only owned/licensed/consented corpus media and the signed
S3 object index. It runs the immutable candidate image across smoke,
development, sealed holdout and stress splits. Holdout annotations cannot be
available to the implementation environment.

Required outputs in one private release directory:

```text
metrics.json
corpus-summary.json
junit.xml
report.html
failed-items.json
baseline-comparison.json
environment.json
```

`metrics.json` contains all required suite results and an
`aggregateMetrics` object. `corpus-summary.json` contains split counts,
manifest hashes, sealed-holdout state and each required stratum result. Both
are checked byte-for-byte against the later signed envelope.

The suite includes worker-kill, S3/provider timeout, lost lease, corrupted
asset/model/font, expired signed URL, scratch pressure and one-failed-clip
recovery. It also includes the blinded HVE vs. previous release / competitors /
manual-reference comparison required by `production-v1.json`.

## 5. Freeze thresholds and sign evidence

Only after development-corpus calibration and independent threshold review,
copy the threshold file to a controlled evaluator location and set its
`gate.status` to `active`. Record the review reference separately. The
checked-in scaffold file is deliberately not changed by a release command.

Then have the evaluator assemble the signed evidence. The command hashes every
required report before signing and refuses an absent report, wrong candidate
runtime provenance or non-passing baseline comparison.

```sh
HVE_RELEASE_EVALUATOR_PRIVATE_KEY_FILE=/secure/evaluator/hve-release-private.pem \
npm run hve:assemble:release -- \
  --evidence-dir=/secure/releases/2026-08-03-candidate \
  --thresholds=/secure/evaluator/production-v1.frozen.json \
  --candidate-git-sha=<40-character-sha> \
  --candidate-image-digest=sha256:<64-character-digest>
```

The assembler creates `release-evidence.json` with mode `0600`. It refuses to
overwrite a prior envelope without explicit `--overwrite`.

## 6. Verify from a public-key environment

Copy the complete private evidence directory only to a controlled verifier
location. The verifier needs the evaluator public key, not the private key:

```sh
npm run hve:verify:release -- \
  --evidence-dir=/secure/releases/2026-08-03-candidate \
  --thresholds=/secure/evaluator/production-v1.frozen.json \
  --public-key=/secure/evaluator/hve-release-public.pem
```

Expected result is exactly exit `0`. Exit `1` is a failed or tampered result;
exit `2` means insufficient evidence or an un-frozen threshold. Neither can
be promoted.

## 7. Controlled rollout

After a signed pass, deploy as:

```text
shadow analysis → 5% → 25% → 50% → 100%
```

At each stage compare render-validation failures, fallback rate, worker RSS /
scratch / swap, queue p90 and manual-correction rate to the release evidence.
Stop and roll back to the prior immutable image on a threshold breach. Never
roll a candidate forward merely because its container is healthy.
