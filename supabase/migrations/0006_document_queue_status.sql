-- ISKOLARChat — explicit document ingestion lifecycle
-- New uploads start as queued. The backend atomically claims them by changing
-- queued -> processing before scheduling the ingestion task.

ALTER TABLE documents
  ALTER COLUMN status SET DEFAULT 'queued';

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_status_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN ('queued', 'processing', 'ready', 'failed'));
