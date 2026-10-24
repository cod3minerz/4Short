-- Earlier CHECK semantics accepted NULL results, so partial coverage tuples
-- could be stored. Such rows are legacy/unknown coverage and must not become
-- reusable transcripts.
UPDATE transcripts
SET source_hash = NULL, coverage_start_ms = NULL, coverage_end_ms = NULL
WHERE NOT (
  source_hash IS NULL AND coverage_start_ms IS NULL AND coverage_end_ms IS NULL
  OR source_hash IS NOT NULL
    AND source_hash ~ '^[a-f0-9]{64}$'
    AND coverage_start_ms IS NOT NULL AND coverage_start_ms >= 0
    AND coverage_end_ms IS NOT NULL AND coverage_end_ms > coverage_start_ms
);
--> statement-breakpoint
ALTER TABLE transcripts DROP CONSTRAINT IF EXISTS transcripts_coverage_pair_check;
--> statement-breakpoint
ALTER TABLE transcripts
  ADD CONSTRAINT transcripts_coverage_pair_check CHECK (
    (source_hash IS NULL AND coverage_start_ms IS NULL AND coverage_end_ms IS NULL)
    OR (
      source_hash IS NOT NULL
      AND source_hash ~ '^[a-f0-9]{64}$'
      AND coverage_start_ms IS NOT NULL
      AND coverage_start_ms >= 0
      AND coverage_end_ms IS NOT NULL
      AND coverage_end_ms > coverage_start_ms
    )
  );
