ALTER TABLE transcripts
  ADD COLUMN analysis_job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN source_hash text,
  ADD COLUMN coverage_start_ms bigint,
  ADD COLUMN coverage_end_ms bigint,
  ADD COLUMN analysis_artifact jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX transcripts_analysis_job_unique ON transcripts (analysis_job_id);
--> statement-breakpoint
UPDATE transcripts
SET source_hash = original_payload #>> '{hveSourceCoverage,sourceHash}',
    coverage_start_ms = (original_payload #>> '{hveSourceCoverage,range,startMs}')::bigint,
    coverage_end_ms = (original_payload #>> '{hveSourceCoverage,range,endMs}')::bigint
WHERE jsonb_typeof(original_payload->'hveSourceCoverage') = 'object'
  AND original_payload #>> '{hveSourceCoverage,sourceHash}' ~ '^[a-f0-9]{64}$'
  AND original_payload #>> '{hveSourceCoverage,range,startMs}' ~ '^[0-9]{1,8}$'
  AND original_payload #>> '{hveSourceCoverage,range,endMs}' ~ '^[0-9]{1,8}$'
  AND (original_payload #>> '{hveSourceCoverage,range,endMs}')::bigint
    > (original_payload #>> '{hveSourceCoverage,range,startMs}')::bigint;
--> statement-breakpoint
ALTER TABLE transcripts
  ADD CONSTRAINT transcripts_coverage_pair_check CHECK (
    (source_hash IS NULL AND coverage_start_ms IS NULL AND coverage_end_ms IS NULL)
    OR (
      source_hash ~ '^[a-f0-9]{64}$'
      AND coverage_start_ms >= 0
      AND coverage_end_ms > coverage_start_ms
    )
  );
--> statement-breakpoint
CREATE TABLE project_transcripts (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  transcript_id uuid NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO project_transcripts (project_id, transcript_id)
SELECT DISTINCT ON (project.id) project.id, transcript.id
FROM projects AS project
JOIN transcripts AS transcript ON transcript.source_id = project.source_id
WHERE project.source_id IS NOT NULL
ORDER BY project.id, transcript.created_at DESC, transcript.id;
--> statement-breakpoint
DROP INDEX transcripts_source_unique;
--> statement-breakpoint
CREATE INDEX transcripts_source_coverage_idx
  ON transcripts (source_id, source_hash, coverage_start_ms, coverage_end_ms, created_at);
--> statement-breakpoint
CREATE INDEX project_transcripts_transcript_idx ON project_transcripts (transcript_id);
