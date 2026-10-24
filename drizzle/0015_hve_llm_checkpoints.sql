CREATE TABLE hve_llm_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  producer_job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  cache_key text NOT NULL,
  request_sha256 text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  media_object_id uuid NOT NULL REFERENCES media_objects(id),
  reference jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hve_llm_checkpoint_digest CHECK (
    cache_key ~ '^[a-f0-9]{64}$' AND request_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT hve_llm_checkpoint_provider CHECK (provider IN ('openrouter', 'deepseek'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX hve_llm_checkpoints_cache_unique ON hve_llm_checkpoints (workspace_id, cache_key);
--> statement-breakpoint
CREATE INDEX hve_llm_checkpoints_request_idx ON hve_llm_checkpoints (workspace_id, request_sha256);
