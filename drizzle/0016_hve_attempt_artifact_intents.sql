-- Durable write-ahead ownership for attempt-scoped S3 outputs. This lets a
-- later reconciler find bytes left behind if a worker dies after PUT.
CREATE TABLE job_attempt_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  lease_token uuid NOT NULL,
  bucket text NOT NULL,
  object_key text NOT NULL CHECK (octet_length(object_key) BETWEEN 1 AND 1024),
  object_hash text NOT NULL CHECK (object_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'deleted')),
  cleanup_lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_attempt_artifacts_unique UNIQUE (job_id, attempt, object_hash)
);
--> statement-breakpoint
CREATE INDEX job_attempt_artifacts_cleanup_idx
  ON job_attempt_artifacts (status, cleanup_lease_expires_at, created_at);
