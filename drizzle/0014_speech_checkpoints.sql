CREATE TABLE speech_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  producer_job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  cache_key text NOT NULL,
  audio_sha256 text NOT NULL,
  profile_hash text NOT NULL,
  start_sample integer NOT NULL,
  end_sample integer NOT NULL,
  media_object_id uuid NOT NULL REFERENCES media_objects(id),
  reference jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT speech_checkpoint_range CHECK (start_sample >= 0 AND end_sample > start_sample AND end_sample - start_sample <= 1920000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX speech_checkpoints_cache_unique ON speech_checkpoints (workspace_id, cache_key);
--> statement-breakpoint
CREATE INDEX speech_checkpoints_audio_idx ON speech_checkpoints (workspace_id, audio_sha256, profile_hash);
