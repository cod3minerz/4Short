-- Expand-only. Drain all workers before deploying the protocol-2 API.
ALTER TABLE jobs ADD COLUMN lease_token uuid;
--> statement-breakpoint
ALTER TABLE job_attempts ADD COLUMN lease_token uuid;
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN failure_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE jobs SET failure_count = GREATEST(attempt_count - CASE
  WHEN status IN ('leased', 'waiting_provider', 'succeeded') THEN 1 ELSE 0 END, 0);
