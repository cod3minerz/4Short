-- HVE-1 is an expand-only rollout. v1 EDL/clip_versions remain authoritative
-- until a later feature-flagged backfill and parity validation are complete.
ALTER TYPE "job_class" ADD VALUE IF NOT EXISTS 'cpu_medium';--> statement-breakpoint

ALTER TABLE "clip_versions" ADD COLUMN IF NOT EXISTS "document_v2" jsonb;--> statement-breakpoint
ALTER TABLE "clip_versions" ADD COLUMN IF NOT EXISTS "document_hash" text;--> statement-breakpoint
ALTER TABLE "clip_versions" ADD COLUMN IF NOT EXISTS "layout_plan_id" uuid;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "engine_releases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "engine_version" text NOT NULL,
  "planner_version" text NOT NULL,
  "renderer_version" text NOT NULL,
  "contract_version" integer DEFAULT 2 NOT NULL,
  "capabilities" jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "engine_releases_version_unique" ON "engine_releases" USING btree ("engine_version","planner_version","renderer_version");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "model_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "engine_release_id" uuid,
  "name" text NOT NULL,
  "version" text NOT NULL,
  "sha256" text NOT NULL,
  "license" text NOT NULL,
  "compatibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "model_artifacts" ADD CONSTRAINT "model_artifacts_engine_release_id_engine_releases_id_fk" FOREIGN KEY ("engine_release_id") REFERENCES "public"."engine_releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_artifacts_hash_unique" ON "model_artifacts" USING btree ("name","version","sha256");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "source_analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "engine_release_id" uuid,
  "source_hash" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "manifest" jsonb NOT NULL,
  "manifest_hash" text NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "source_analyses" ADD CONSTRAINT "source_analyses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_analyses" ADD CONSTRAINT "source_analyses_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_analyses" ADD CONSTRAINT "source_analyses_engine_release_id_engine_releases_id_fk" FOREIGN KEY ("engine_release_id") REFERENCES "public"."engine_releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_analyses_source_manifest_unique" ON "source_analyses" USING btree ("source_id","engine_release_id","manifest_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_analyses_source_idx" ON "source_analyses" USING btree ("source_id","created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "analysis_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "analysis_id" uuid NOT NULL,
  "media_object_id" uuid,
  "kind" text NOT NULL,
  "schema_version" integer NOT NULL,
  "engine_version" text NOT NULL,
  "model_version" text,
  "object_key" text NOT NULL,
  "sha256" text NOT NULL,
  "byte_size" bigint NOT NULL,
  "coverage" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "density" text DEFAULT 'sparse' NOT NULL,
  "supersedes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "analysis_artifacts" ADD CONSTRAINT "analysis_artifacts_analysis_id_source_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."source_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_artifacts" ADD CONSTRAINT "analysis_artifacts_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analysis_artifacts_object_unique" ON "analysis_artifacts" USING btree ("analysis_id","kind","object_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analysis_artifacts_analysis_idx" ON "analysis_artifacts" USING btree ("analysis_id","kind");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "layout_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clip_version_id" uuid,
  "document_hash" text NOT NULL,
  "plan_hash" text NOT NULL,
  "planner_version" text NOT NULL,
  "plan" jsonb,
  "plan_artifact_id" uuid,
  "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "layout_plans" ADD CONSTRAINT "layout_plans_clip_version_id_clip_versions_id_fk" FOREIGN KEY ("clip_version_id") REFERENCES "public"."clip_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_plans" ADD CONSTRAINT "layout_plans_plan_artifact_id_analysis_artifacts_id_fk" FOREIGN KEY ("plan_artifact_id") REFERENCES "public"."analysis_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "layout_plans_hash_unique" ON "layout_plans" USING btree ("document_hash","planner_version","plan_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "layout_plans_clip_version_idx" ON "layout_plans" USING btree ("clip_version_id","created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "clip_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "clip_id" uuid NOT NULL,
  "base_version" integer NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  "document" jsonb NOT NULL,
  "document_hash" text NOT NULL,
  "updated_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "clip_drafts" ADD CONSTRAINT "clip_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_drafts" ADD CONSTRAINT "clip_drafts_clip_id_clips_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_drafts" ADD CONSTRAINT "clip_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clip_drafts_clip_unique" ON "clip_drafts" USING btree ("clip_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clip_drafts_workspace_updated_idx" ON "clip_drafts" USING btree ("workspace_id","updated_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "editor_command_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clip_draft_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "base_revision" integer NOT NULL,
  "resulting_revision" integer NOT NULL,
  "commands" jsonb NOT NULL,
  "results" jsonb NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "editor_command_batches" ADD CONSTRAINT "editor_command_batches_clip_draft_id_clip_drafts_id_fk" FOREIGN KEY ("clip_draft_id") REFERENCES "public"."clip_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_command_batches" ADD CONSTRAINT "editor_command_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "editor_command_batches_unique" ON "editor_command_batches" USING btree ("clip_draft_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_command_batches_draft_idx" ON "editor_command_batches" USING btree ("clip_draft_id","created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "job_requirements" (
  "job_id" uuid PRIMARY KEY NOT NULL,
  "requirements" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "quality_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "engine_release_id" uuid,
  "suite" text NOT NULL,
  "status" text NOT NULL,
  "metrics" jsonb NOT NULL,
  "report_artifact_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_engine_release_id_engine_releases_id_fk" FOREIGN KEY ("engine_release_id") REFERENCES "public"."engine_releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_report_artifact_id_analysis_artifacts_id_fk" FOREIGN KEY ("report_artifact_id") REFERENCES "public"."analysis_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quality_reports_release_idx" ON "quality_reports" USING btree ("engine_release_id","created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "benchmark_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "engine_release_id" uuid,
  "hardware_profile" jsonb NOT NULL,
  "stage_metrics" jsonb NOT NULL,
  "baseline_comparison" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_engine_release_id_engine_releases_id_fk" FOREIGN KEY ("engine_release_id") REFERENCES "public"."engine_releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "benchmark_runs_release_idx" ON "benchmark_runs" USING btree ("engine_release_id","created_at");
