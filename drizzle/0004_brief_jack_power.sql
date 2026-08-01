CREATE TABLE "generative_balance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"operation_id" uuid,
	"kind" text NOT NULL,
	"amount_kopecks" integer NOT NULL,
	"balance_after_kopecks" integer NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generative_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"clip_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'quoted' NOT NULL,
	"estimated_units" numeric(14, 4) NOT NULL,
	"actual_units" numeric(14, 4),
	"estimated_price_kopecks" integer NOT NULL,
	"actual_price_kopecks" integer,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moment_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moment_candidate_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"patch" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generative_balance_transactions" ADD CONSTRAINT "generative_balance_transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generative_balance_transactions" ADD CONSTRAINT "generative_balance_transactions_operation_id_generative_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."generative_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generative_operations" ADD CONSTRAINT "generative_operations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generative_operations" ADD CONSTRAINT "generative_operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generative_operations" ADD CONSTRAINT "generative_operations_clip_id_clips_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_revisions" ADD CONSTRAINT "moment_revisions_moment_candidate_id_moment_candidates_id_fk" FOREIGN KEY ("moment_candidate_id") REFERENCES "public"."moment_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_revisions" ADD CONSTRAINT "moment_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generative_balance_transactions_idempotency_unique" ON "generative_balance_transactions" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "generative_balance_transactions_workspace_idx" ON "generative_balance_transactions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "generative_operations_idempotency_unique" ON "generative_operations" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "generative_operations_workspace_idx" ON "generative_operations" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "generative_operations_clip_idx" ON "generative_operations" USING btree ("clip_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "moment_revisions_unique" ON "moment_revisions" USING btree ("moment_candidate_id","revision");