ALTER TABLE uploads ADD COLUMN creation_key text;
--> statement-breakpoint
ALTER TABLE uploads ADD COLUMN operation_token uuid;
--> statement-breakpoint
ALTER TABLE uploads ADD COLUMN operation_expires_at timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX uploads_creation_key_unique ON uploads (workspace_id, creation_key);
--> statement-breakpoint
CREATE INDEX uploads_reconcile_idx ON uploads (status, expires_at, operation_expires_at);
