-- Persistent weighted fair queue state. The state is intentionally separate
-- from a job attempt: retries retain their normal queue semantics and only a
-- successfully leased job advances the workspace virtual finish.
CREATE TABLE IF NOT EXISTS "workspace_queue_states" (
  "workspace_id" uuid PRIMARY KEY NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "virtual_finish" numeric(20, 6) NOT NULL DEFAULT '0',
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "queue_dispatch_states" (
  "id" integer PRIMARY KEY NOT NULL,
  "last_workspace_id" uuid,
  "consecutive_claims" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "queue_dispatch_states_singleton" CHECK ("id" = 1)
);
