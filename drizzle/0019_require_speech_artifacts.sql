-- New speech jobs return only an immutable S3 reference, never the complete
-- word-level transcript in jobs.result/payload. Drain old workers before this
-- migration. Legacy queued speech jobs without a content-addressed STT model
-- fingerprint are explicitly marked and fail closed in the queue claim path;
-- the API recovery sweep can pin them only when the immutable audio manifest
-- is valid and an exact payload or configured model fingerprint is available.
INSERT INTO job_requirements (job_id, requirements)
SELECT j.id, jsonb_build_object(
  'engineVersion', 'hve-0.1',
  'requiredModels', jsonb_build_object(
    'speech_result', 's3-json-v1',
    'stt', CASE
      WHEN coalesce(j.payload->>'modelFingerprint', '') ~* '^[a-f0-9]{64}$'
        THEN lower(j.payload->>'modelFingerprint')
      ELSE 'legacy-unpinned'
    END
  ),
  'minimumRamBytes', 4294967296,
  'minimumScratchBytes', 2147483648,
  'requiredClasses', jsonb_build_array('cpu_heavy'),
  'requiredJobTypes', jsonb_build_array('speech_to_text'),
  'workspaceConcurrencyLimit', 1
)
FROM jobs j
LEFT JOIN job_requirements r ON r.job_id = j.id
WHERE j.type = 'speech_to_text' AND j.status = 'queued' AND r.job_id IS NULL;
--> statement-breakpoint
UPDATE job_requirements r
SET requirements = jsonb_set(
  CASE
    WHEN jsonb_typeof(r.requirements->'requiredModels') = 'object' THEN r.requirements
    ELSE r.requirements || '{"requiredModels":{}}'::jsonb
  END,
  '{requiredModels}',
  (CASE
    WHEN jsonb_typeof(r.requirements->'requiredModels') = 'object' THEN r.requirements->'requiredModels'
    ELSE '{}'::jsonb
  END)
    || '{"speech_result":"s3-json-v1"}'::jsonb
    || CASE
      WHEN coalesce(r.requirements->'requiredModels'->>'stt', '') ~* '^[a-f0-9]{64}$'
        THEN jsonb_build_object('stt', lower(r.requirements->'requiredModels'->>'stt'))
      WHEN coalesce(j.payload->>'modelFingerprint', '') ~* '^[a-f0-9]{64}$'
        THEN jsonb_build_object('stt', lower(j.payload->>'modelFingerprint'))
      ELSE '{"stt":"legacy-unpinned"}'::jsonb
    END,
  true
)
FROM jobs j
WHERE r.job_id = j.id AND j.type = 'speech_to_text' AND j.status = 'queued';
--> statement-breakpoint
UPDATE jobs
SET class = 'cpu_heavy'
WHERE type = 'speech_to_text' AND status = 'queued' AND class <> 'cpu_heavy';
--> statement-breakpoint
UPDATE job_requirements r
SET requirements = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(r.requirements, '{minimumRamBytes}', '4294967296'::jsonb, true),
        '{minimumScratchBytes}', '2147483648'::jsonb, true
      ),
      '{requiredClasses}', '["cpu_heavy"]'::jsonb, true
    ),
    '{requiredJobTypes}', '["speech_to_text"]'::jsonb, true
  ),
  '{workspaceConcurrencyLimit}', '1'::jsonb, true
)
FROM jobs j
WHERE r.job_id = j.id AND j.type = 'speech_to_text' AND j.status = 'queued';
