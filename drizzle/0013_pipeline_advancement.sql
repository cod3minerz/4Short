ALTER TABLE jobs ADD COLUMN advance_token uuid;
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN advance_expires_at timestamptz;
--> statement-breakpoint
CREATE INDEX jobs_advance_idx ON jobs (status, checkpoint, advance_expires_at, available_at);
