# Provisioning local Whisper model packs

4Short runs STT locally through Faster-Whisper. The media worker intentionally
does not accept a Hugging Face model name at transcription time: a worker that
downloads a model while it owns a customer job has unbounded latency and an
untraceable model version.

## Invariant

The running worker accepts a pack only when all conditions hold:

1. it is a local CTranslate2 Faster-Whisper directory;
2. every file matches `hve-model-manifest.json`;
3. the manifest is content-addressed;
4. `STT_MODEL_FINGERPRINT` in `/etc/4short/media-worker.env` equals that
   content address.

If one condition fails, the worker advertises STT as unavailable and an STT
job fails before audio is sent to a model. Rendering and other safe jobs can
continue.

## First installation on the worker

Do this during a maintenance window, from a checked-out worker release after
its image has been built. Substitute the immutable commit SHA from the model
repository; never use `main` or `master`.

```bash
cd /opt/4short/current-worker
FOURSHORT_IMAGE_TAG="$(cat .worker-image-tag)" \
  docker compose -f compose.worker.yml run --rm --no-deps --user root \
  --entrypoint fourshort-model-sync media-worker \
  --model large-v3-turbo \
  --source Systran/faster-whisper-large-v3-turbo \
  --revision <immutable-hugging-face-commit-sha> \
  --destination /var/lib/4short/models/large-v3-turbo
```

The command prints two lines, including `STT_MODEL_FINGERPRINT=<sha256>`.
Copy that value into `/etc/4short/media-worker.env` together with:

```dotenv
STT_MODEL=large-v3-turbo
STT_MODEL_PATH=/var/lib/4short/models/large-v3-turbo
STT_MODEL_FINGERPRINT=<printed-sha256>
```

Then make the pack immutable to the non-root worker and deploy the release:

```bash
chown -R root:worker /var/lib/4short/models/large-v3-turbo
find /var/lib/4short/models/large-v3-turbo -type d -exec chmod 0750 {} \;
find /var/lib/4short/models/large-v3-turbo -type f -exec chmod 0440 {} \;
sudo /usr/local/sbin/4short-worker-deploy <40-character-release-sha> \
  /tmp/4short-worker-<40-character-release-sha>.tar.gz
```

The release command verifies the complete pack before starting the worker. It
does not download a model. To upgrade a model, provision it to a new directory,
benchmark it, update the fingerprint and only then release a new worker image.

## Deployment verification

After every production release, the deploy workflow calls:

```bash
sudo /usr/local/sbin/4short-worker-deploy verify-runtime
```

It rejects a worker unless exactly one container is healthy, its OCI image ID
matches the immutable digest recorded in the active release, and the running
non-root process can read the verified Whisper and YuNet assets. This is
deliberately stronger than checking whether Docker merely started a container.

## Face-tracking model

The worker image separately bundles the pinned YuNet INT8 detector. It is
checksum-verified during the same deployment preflight. Do **not** put an empty
`FACE_DETECTOR_FINGERPRINT=` line in `/etc/4short/media-worker.env`: Compose
would override the image's pinned value and the worker will deliberately report
face tracking as unavailable. A custom local detector is unsupported until it
has its own reviewed model-pack/provisioning flow.

## Verification

```bash
docker compose -f compose.worker.yml run --rm --no-deps \
  --entrypoint python media-worker -c \
  'from fourshort_worker.config import Settings; from fourshort_worker.model_assets import verify_local_stt_model; print(verify_local_stt_model(Settings()))'
```

The verification hashes the model pack. Run it at deploy, after a storage
restore and before enabling a newly provisioned worker in the queue.
