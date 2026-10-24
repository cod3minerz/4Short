CREATE INDEX IF NOT EXISTS job_attempts_eta_runtime_idx
  ON job_attempts ((metrics ->> 'runtimeFingerprint'), finished_at DESC)
  WHERE status = 'succeeded' AND finished_at IS NOT NULL;
