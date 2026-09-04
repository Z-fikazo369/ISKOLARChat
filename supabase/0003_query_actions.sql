-- ============================================================
-- ISKOLARCHAT — Admin query actions
-- Run this in the Supabase SQL Editor (safe to re-run).
-- Adds a 'rejected' status so admins can dismiss HITL queries
-- (e.g. spam or out-of-scope) without answering them.
-- ============================================================

ALTER TABLE chat_requests DROP CONSTRAINT IF EXISTS chat_requests_status_check;
ALTER TABLE chat_requests ADD CONSTRAINT chat_requests_status_check
  CHECK (status IN ('pending', 'answered', 'rejected'));
