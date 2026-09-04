-- Durable document-ingestion queue.
-- A queued row survives browser/backend restarts. Multiple backend workers can
-- poll safely because FOR UPDATE SKIP LOCKED assigns a document only once.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

-- Give any ingestion already running during this migration a fresh lease so a
-- new worker does not immediately process it a second time.
UPDATE documents
   SET processing_started_at = COALESCE(processing_started_at, clock_timestamp())
 WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS documents_ingestion_queue_idx
  ON documents (status, created_at, processing_started_at)
  WHERE status IN ('queued', 'processing');

CREATE OR REPLACE FUNCTION claim_document_ingestion(
  p_stale_after_seconds INTEGER DEFAULT 900,
  p_max_attempts INTEGER DEFAULT 3
)
RETURNS TABLE(document_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_stale_after_seconds < 60 OR p_max_attempts < 1 THEN
    RAISE EXCEPTION 'Invalid document worker parameters';
  END IF;

  -- A repeatedly interrupted job must eventually stop consuming resources.
  UPDATE documents
     SET status = 'failed',
         processing_started_at = NULL,
         error = 'Ingestion was interrupted too many times. Retry it from the admin dashboard.'
   WHERE status = 'processing'
     AND COALESCE(processing_started_at, created_at) <
         clock_timestamp() - make_interval(secs => p_stale_after_seconds)
     AND attempt_count >= p_max_attempts;

  RETURN QUERY
  WITH candidate AS (
    SELECT d.id
      FROM documents AS d
     WHERE d.status = 'queued'
        OR (
          d.status = 'processing'
          AND COALESCE(d.processing_started_at, d.created_at) <
              clock_timestamp() - make_interval(secs => p_stale_after_seconds)
          AND d.attempt_count < p_max_attempts
        )
     ORDER BY
       CASE WHEN d.status = 'queued' THEN 0 ELSE 1 END,
       d.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE documents AS d
     SET status = 'processing',
         processing_started_at = clock_timestamp(),
         attempt_count = d.attempt_count + 1,
         error = CASE
           WHEN d.status = 'processing'
             THEN 'Previous ingestion attempt was interrupted; retrying.'
           ELSE NULL
         END
    FROM candidate AS c
   WHERE d.id = c.id
  RETURNING d.id;
END;
$$;

REVOKE ALL ON FUNCTION claim_document_ingestion(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_document_ingestion(INTEGER, INTEGER)
  TO service_role;
