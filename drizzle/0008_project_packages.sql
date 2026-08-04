-- Project downloads are immutable manifests of already rendered artifacts.
-- The ZIP task can be retried safely without re-rendering or re-transcribing.
CREATE TABLE IF NOT EXISTS "project_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "job_id" uuid,
  "media_object_id" uuid,
  "status" text DEFAULT 'queued' NOT NULL,
  "manifest_hash" text NOT NULL,
  "manifest" jsonb NOT NULL,
  "error" jsonb,
  "created_by" uuid NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "project_packages" ADD CONSTRAINT "project_packages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_packages" ADD CONSTRAINT "project_packages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_packages" ADD CONSTRAINT "project_packages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_packages" ADD CONSTRAINT "project_packages_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_packages" ADD CONSTRAINT "project_packages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_packages_manifest_unique" ON "project_packages" USING btree ("project_id","manifest_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_packages_workspace_status_idx" ON "project_packages" USING btree ("workspace_id","status","created_at");
