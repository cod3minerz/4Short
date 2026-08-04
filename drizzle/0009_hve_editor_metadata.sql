-- HVE drafts need non-media metadata (clip and social titles) under the same
-- optimistic revision as visual edits. Keep each committed value immutable on
-- the clip version for audit/recovery; legacy versions simply have NULL.
ALTER TABLE "clip_versions" ADD COLUMN IF NOT EXISTS "editor_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "clip_drafts" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
