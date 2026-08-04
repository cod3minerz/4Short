-- A media object may represent exactly one user-visible brand asset. This
-- makes multipart completion idempotent even when a browser retries it.
CREATE UNIQUE INDEX IF NOT EXISTS "brand_assets_media_object_unique" ON "brand_assets" USING btree ("media_object_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_assets_workspace_idx" ON "brand_assets" USING btree ("workspace_id","created_at");
