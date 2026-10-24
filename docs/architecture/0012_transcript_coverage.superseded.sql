-- Historical, superseded branch migration; do not add this file to the active
-- Drizzle journal. The canonical PostgreSQL lineage adds these columns in
-- drizzle/0017_transcript_range_bindings.sql.
ALTER TABLE "transcripts"
  ADD COLUMN "coverage_start_ms" bigint,
  ADD COLUMN "coverage_end_ms" bigint;
