-- ============================================================
-- ISKOLARChat — route delayed admin answers back to the right chat
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.chat_requests
  ADD COLUMN IF NOT EXISTS conversation_id UUID
  REFERENCES public.conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_requests_conversation
  ON public.chat_requests (conversation_id);

-- One persisted message per answered escalation prevents duplicate admin
-- answers when the student opens the app in multiple tabs or devices.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS hitl_request_id UUID
  REFERENCES public.chat_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_hitl_request_unique
  ON public.messages (hitl_request_id)
  WHERE hitl_request_id IS NOT NULL;
