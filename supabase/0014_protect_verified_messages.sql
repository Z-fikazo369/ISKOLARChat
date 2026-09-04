-- ============================================================
-- SECURITY FIX: protect admin-verified messages from student edits.
--
-- The old single "Users manage own messages" policy was FOR ALL, which
-- includes UPDATE and DELETE. A student could rewrite the content of a
-- message carrying hitl_request_id (an "Admin-verified answer") — passing
-- the WITH CHECK just by keeping the same hitl_request_id — and after a
-- refresh the fabricated text would display as human-verified.
--
-- The frontend only ever INSERTs messages, so UPDATE/DELETE restrictions
-- break nothing. Split into per-command policies:
--   • SELECT — any message in an owned conversation (unchanged).
--   • INSERT — own conversation; a hitl_request_id may only reference
--     the caller's own answered request (unchanged rule).
--   • UPDATE / DELETE — only messages that are NOT admin-verified
--     (hitl_request_id IS NULL). Verified answers are read-only for
--     students; the service-role backend (RLS-bypassed) can still
--     manage them.
-- ============================================================

DROP POLICY IF EXISTS "Users manage own messages" ON public.messages;

DROP POLICY IF EXISTS "Users read own messages" ON public.messages;
CREATE POLICY "Users read own messages"
ON public.messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.conversations AS conversation
    WHERE conversation.id = messages.conversation_id
      AND conversation.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "Users insert own messages" ON public.messages;
CREATE POLICY "Users insert own messages"
ON public.messages FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.conversations AS conversation
    WHERE conversation.id = messages.conversation_id
      AND conversation.user_id = (SELECT auth.uid())
  )
  AND (
    messages.hitl_request_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.chat_requests AS request
      WHERE request.id = messages.hitl_request_id
        AND request.student_id = (SELECT auth.uid())
        AND request.conversation_id = messages.conversation_id
        AND request.status = 'answered'
    )
  )
);

DROP POLICY IF EXISTS "Users update own messages" ON public.messages;
CREATE POLICY "Users update own messages"
ON public.messages FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.conversations AS conversation
    WHERE conversation.id = messages.conversation_id
      AND conversation.user_id = (SELECT auth.uid())
  )
  AND messages.hitl_request_id IS NULL  -- admin-verified answers are read-only
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.conversations AS conversation
    WHERE conversation.id = messages.conversation_id
      AND conversation.user_id = (SELECT auth.uid())
  )
  AND messages.hitl_request_id IS NULL
);

DROP POLICY IF EXISTS "Users delete own messages" ON public.messages;
CREATE POLICY "Users delete own messages"
ON public.messages FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.conversations AS conversation
    WHERE conversation.id = messages.conversation_id
      AND conversation.user_id = (SELECT auth.uid())
  )
  AND messages.hitl_request_id IS NULL
);
