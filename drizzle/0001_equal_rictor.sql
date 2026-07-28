ALTER TABLE "moment_searches" ADD COLUMN "job_id" uuid NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "moment_searches_job_unique" ON "moment_searches" USING btree ("job_id");