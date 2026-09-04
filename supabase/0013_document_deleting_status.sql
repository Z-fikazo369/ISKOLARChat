-- ============================================================
-- Document delete lifecycle
--
-- SECURITY/DATA-INTEGRITY FIX: deleting a document raced with the
-- ingestion worker. The old flow was:
--   delete endpoint:  qdrant-delete chunks → delete DB row
--   ingest worker:    check row exists → qdrant-delete old → upsert
-- If the worker passed its existence check just before the row was
-- deleted, it re-upserted the chunks of a deleted document —
-- orphaned vectors that answered queries forever (nothing owning
-- them remained to clean them up).
--
-- The new flow uses a 'deleting' tombstone status:
--   delete endpoint:  flip status → 'deleting' (first step, always),
--                     then storage / Qdrant cleanup, then the row.
--   ingest worker:    only indexes while status is still 'processing',
--                     and re-verifies AFTER upserting — if the doc was
--                     deleted meanwhile, it removes what it just wrote.
-- The claim RPC only picks 'queued'/'processing' rows, so a deleting
-- document is never (re)claimed.
-- ============================================================

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_status_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN ('queued', 'processing', 'ready', 'failed', 'deleting'));
