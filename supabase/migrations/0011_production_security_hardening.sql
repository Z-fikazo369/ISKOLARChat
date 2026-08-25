-- Production security hardening.
--
-- Browser roles receive only the table/function privileges used by the UI.
-- SECURITY DEFINER helpers are either hidden in a non-exposed schema or
-- callable only with the backend's service-role key.

BEGIN;

-- Compatibility guard for projects where migration 0005 was applied from an
-- older or partial copy. The hardened message policy below relies on this
-- link to ensure delayed admin answers belong to the same conversation.
ALTER TABLE public.chat_requests
  ADD COLUMN IF NOT EXISTS conversation_id UUID
  REFERENCES public.conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_requests_conversation
  ON public.chat_requests (conversation_id);

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS hitl_request_id UUID
  REFERENCES public.chat_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_hitl_request_unique
  ON public.messages (hitl_request_id)
  WHERE hitl_request_id IS NOT NULL;

-- Keep RLS-only helpers outside the public Data API schema. Authenticated
-- users need schema usage/execute for policy evaluation, but PostgREST does
-- not expose this schema unless it is explicitly added in API settings.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.get_my_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT profile.role
  FROM public.profiles AS profile
  WHERE profile.id = (SELECT auth.uid())
$$;

REVOKE ALL ON FUNCTION private.get_my_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_my_role() TO authenticated;

-- Trigger functions must only be entered by their auth.users triggers, never
-- through /rest/v1/rpc. Empty search paths require every relation to be
-- explicitly qualified and prevent object-shadowing attacks.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    'student'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_admin_application()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  application JSONB := NEW.raw_user_meta_data -> 'admin_application';
BEGIN
  IF application IS NULL
     OR jsonb_typeof(application) <> 'object'
     OR BTRIM(COALESCE(application ->> 'full_name', '')) = ''
     OR BTRIM(COALESCE(application ->> 'employee_id', '')) = ''
     OR BTRIM(COALESCE(application ->> 'department', '')) = ''
     OR BTRIM(COALESCE(application ->> 'position', '')) = ''
     OR BTRIM(COALESCE(application ->> 'phone', '')) = ''
     OR BTRIM(COALESCE(application ->> 'reason', '')) = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.admin_applications (
    user_id,
    full_name,
    employee_id,
    department,
    position,
    email,
    phone,
    reason,
    status
  )
  SELECT
    NEW.id,
    LEFT(BTRIM(application ->> 'full_name'), 200),
    LEFT(BTRIM(application ->> 'employee_id'), 100),
    LEFT(BTRIM(application ->> 'department'), 200),
    LEFT(BTRIM(application ->> 'position'), 200),
    NEW.email,
    LEFT(BTRIM(application ->> 'phone'), 50),
    LEFT(BTRIM(application ->> 'reason'), 4000),
    'pending'
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.admin_applications AS existing
    WHERE existing.user_id = NEW.id
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_admin_application()
  FROM PUBLIC, anon, authenticated;

-- Shared rate limiting is backend-only.
CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(
  p_scope TEXT,
  p_key_hash TEXT,
  p_max_requests INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_window_started_at TIMESTAMPTZ;
  v_request_count INTEGER;
BEGIN
  IF p_scope IS NULL OR p_scope = '' OR p_key_hash IS NULL OR p_key_hash = ''
     OR p_max_requests < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate-limit parameters';
  END IF;

  INSERT INTO public.api_rate_limits (
    scope, key_hash, window_started_at, request_count, updated_at
  )
  VALUES (p_scope, p_key_hash, v_now, 0, v_now)
  ON CONFLICT (scope, key_hash) DO NOTHING;

  SELECT limits.window_started_at, limits.request_count
    INTO v_window_started_at, v_request_count
    FROM public.api_rate_limits AS limits
   WHERE limits.scope = p_scope AND limits.key_hash = p_key_hash
   FOR UPDATE;

  IF v_now >= v_window_started_at + make_interval(secs => p_window_seconds) THEN
    UPDATE public.api_rate_limits
       SET window_started_at = v_now,
           request_count = 1,
           updated_at = v_now
     WHERE scope = p_scope AND key_hash = p_key_hash;
    RETURN TRUE;
  END IF;

  IF v_request_count >= p_max_requests THEN
    RETURN FALSE;
  END IF;

  UPDATE public.api_rate_limits
     SET request_count = request_count + 1,
         updated_at = v_now
   WHERE scope = p_scope AND key_hash = p_key_hash;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_api_rate_limit(TEXT, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(TEXT, TEXT, INTEGER, INTEGER)
  TO service_role;

-- Durable document queue claiming is backend-only.
CREATE OR REPLACE FUNCTION public.claim_document_ingestion(
  p_stale_after_seconds INTEGER DEFAULT 900,
  p_max_attempts INTEGER DEFAULT 3
)
RETURNS TABLE(document_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_stale_after_seconds < 60 OR p_max_attempts < 1 THEN
    RAISE EXCEPTION 'Invalid document worker parameters';
  END IF;

  UPDATE public.documents
     SET status = 'failed',
         processing_started_at = NULL,
         error = 'Ingestion was interrupted too many times. Retry it from the admin dashboard.'
   WHERE status = 'processing'
     AND COALESCE(processing_started_at, created_at) <
         clock_timestamp() - make_interval(secs => p_stale_after_seconds)
     AND attempt_count >= p_max_attempts;

  RETURN QUERY
  WITH candidate AS (
    SELECT document.id
      FROM public.documents AS document
     WHERE document.status = 'queued'
        OR (
          document.status = 'processing'
          AND COALESCE(document.processing_started_at, document.created_at) <
              clock_timestamp() - make_interval(secs => p_stale_after_seconds)
          AND document.attempt_count < p_max_attempts
        )
     ORDER BY
       CASE WHEN document.status = 'queued' THEN 0 ELSE 1 END,
       document.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE public.documents AS document
     SET status = 'processing',
         processing_started_at = clock_timestamp(),
         attempt_count = document.attempt_count + 1,
         error = CASE
           WHEN document.status = 'processing'
             THEN 'Previous ingestion attempt was interrupted; retrying.'
           ELSE NULL
         END
    FROM candidate
   WHERE document.id = candidate.id
  RETURNING document.id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_document_ingestion(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_document_ingestion(INTEGER, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.bump_knowledge_base_version()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version BIGINT;
BEGIN
  UPDATE public.knowledge_base_state
     SET version = version + 1,
         updated_at = clock_timestamp()
   WHERE id = 1
  RETURNING version INTO v_version;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_knowledge_base_version()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_knowledge_base_version()
  TO service_role;

-- The frontend no longer calls the privileged review function. The backend
-- authenticates a superadmin and supplies that actor ID over its service-role
-- connection, preserving one atomic and auditable database transaction.
CREATE OR REPLACE FUNCTION public.review_admin_application(
  p_application_id UUID,
  p_decision TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application public.admin_applications%ROWTYPE;
  v_email TEXT;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS actor
    WHERE actor.id = p_actor_id AND actor.role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'Superadmin access required' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected' USING ERRCODE = '22023';
  END IF;

  SELECT application.*
    INTO v_application
    FROM public.admin_applications AS application
   WHERE application.id = p_application_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin application not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_application.status = p_decision THEN
    RETURN jsonb_build_object('id', v_application.id, 'status', v_application.status);
  END IF;
  IF v_application.status <> 'pending' THEN
    RAISE EXCEPTION 'Admin application has already been reviewed' USING ERRCODE = '23514';
  END IF;

  IF p_decision = 'approved' THEN
    SELECT COALESCE(v_application.email, applicant.email)
      INTO v_email
      FROM public.profiles AS applicant
     WHERE applicant.id = v_application.user_id;

    IF v_application.user_id IS NULL OR v_email IS NULL THEN
      RAISE EXCEPTION 'Application is not linked to a valid auth user' USING ERRCODE = '23503';
    END IF;

    INSERT INTO public.profiles (id, email, full_name, role, updated_at)
    VALUES (
      v_application.user_id,
      v_email,
      v_application.full_name,
      'admin',
      clock_timestamp()
    )
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          full_name = COALESCE(profiles.full_name, EXCLUDED.full_name),
          role = 'admin',
          updated_at = clock_timestamp();
  END IF;

  UPDATE public.admin_applications
     SET status = p_decision,
         reviewed_by = p_actor_id,
         reviewed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE id = p_application_id;

  RETURN jsonb_build_object('id', p_application_id, 'status', p_decision);
END;
$$;

REVOKE ALL ON FUNCTION public.review_admin_application(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_admin_application(UUID, TEXT, UUID)
  TO service_role;

DROP FUNCTION IF EXISTS public.review_admin_application(UUID, TEXT);

-- Future public functions start closed instead of inheriting Postgres's
-- execute-for-PUBLIC default. Every callable RPC must be granted explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Make role non-null before using it as an authorization fact.
UPDATE public.profiles SET role = 'student' WHERE role IS NULL;
ALTER TABLE public.profiles ALTER COLUMN role SET NOT NULL;

-- Bounds enforced for all new rows. NOT VALID avoids blocking deployment on
-- legacy data; a later cleanup can validate these constraints explicitly.
ALTER TABLE public.admin_applications
  DROP CONSTRAINT IF EXISTS admin_applications_field_lengths;
ALTER TABLE public.admin_applications
  ADD CONSTRAINT admin_applications_field_lengths CHECK (
    char_length(full_name) BETWEEN 1 AND 200
    AND char_length(employee_id) BETWEEN 1 AND 100
    AND char_length(department) BETWEEN 1 AND 200
    AND char_length(position) BETWEEN 1 AND 200
    AND char_length(phone) BETWEEN 1 AND 50
    AND char_length(reason) BETWEEN 1 AND 4000
  ) NOT VALID;

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_upload_bounds;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_upload_bounds CHECK (
    size BETWEEN 1 AND 26214400
    AND char_length(name) BETWEEN 1 AND 255
    AND lower(name) LIKE '%.pdf'
    AND char_length(file_path) BETWEEN 1 AND 512
  ) NOT VALID;

-- The private bucket rejects oversized/non-PDF uploads before metadata rows
-- are inserted. 25 MiB matches the application-level admin upload bound.
UPDATE storage.buckets
   SET public = FALSE,
       file_size_limit = 26214400,
       allowed_mime_types = ARRAY['application/pdf']::TEXT[]
 WHERE id = 'documents';

-- Replace broad implicit grants with the exact browser operations in use.
REVOKE ALL ON TABLE
  public.profiles,
  public.admin_applications,
  public.chat_requests,
  public.documents,
  public.conversations,
  public.messages,
  public.api_rate_limits,
  public.knowledge_base_state
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, DELETE ON TABLE public.admin_applications TO authenticated;
GRANT SELECT ON TABLE public.chat_requests TO authenticated;
GRANT SELECT, INSERT ON TABLE public.documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages TO authenticated;

-- Rebuild exposed-table policies with explicit authenticated roles.
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Superadmins can insert any profile" ON public.profiles;
DROP POLICY IF EXISTS "Superadmins can update any profile" ON public.profiles;

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK ((SELECT auth.uid()) = id AND role = 'student');

CREATE POLICY "Users can read own profile"
ON public.profiles FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = id);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = id)
WITH CHECK (
  (SELECT auth.uid()) = id
  AND role = (SELECT private.get_my_role())
);

CREATE POLICY "Admins can read all profiles"
ON public.profiles FOR SELECT TO authenticated
USING ((SELECT private.get_my_role()) IN ('admin', 'superadmin'));

CREATE POLICY "Superadmins can insert any profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK ((SELECT private.get_my_role()) = 'superadmin');

CREATE POLICY "Superadmins can update any profile"
ON public.profiles FOR UPDATE TO authenticated
USING ((SELECT private.get_my_role()) = 'superadmin')
WITH CHECK ((SELECT private.get_my_role()) = 'superadmin');

DROP POLICY IF EXISTS "Users can insert own application" ON public.admin_applications;
DROP POLICY IF EXISTS "Users can read own application" ON public.admin_applications;
DROP POLICY IF EXISTS "Superadmins can read all applications" ON public.admin_applications;
DROP POLICY IF EXISTS "Superadmins can update applications" ON public.admin_applications;
DROP POLICY IF EXISTS "Superadmins can delete applications" ON public.admin_applications;

CREATE POLICY "Users can read own application"
ON public.admin_applications FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Superadmins can read all applications"
ON public.admin_applications FOR SELECT TO authenticated
USING ((SELECT private.get_my_role()) = 'superadmin');

CREATE POLICY "Superadmins can delete applications"
ON public.admin_applications FOR DELETE TO authenticated
USING ((SELECT private.get_my_role()) = 'superadmin');

DROP POLICY IF EXISTS "Students can insert chat requests" ON public.chat_requests;
DROP POLICY IF EXISTS "Students can read own chat requests" ON public.chat_requests;
DROP POLICY IF EXISTS "Admins can update chat requests" ON public.chat_requests;

CREATE POLICY "Students read own and admins read all chat requests"
ON public.chat_requests FOR SELECT TO authenticated
USING (
  (SELECT auth.uid()) = student_id
  OR (SELECT private.get_my_role()) IN ('admin', 'superadmin')
);

DROP POLICY IF EXISTS "Admins can manage documents" ON public.documents;

CREATE POLICY "Admins can read documents"
ON public.documents FOR SELECT TO authenticated
USING ((SELECT private.get_my_role()) IN ('admin', 'superadmin'));

CREATE POLICY "Admins can queue valid documents"
ON public.documents FOR INSERT TO authenticated
WITH CHECK (
  (SELECT private.get_my_role()) IN ('admin', 'superadmin')
  AND uploaded_by = (SELECT auth.uid())
  AND status = 'queued'
  AND error IS NULL
  AND COALESCE(chunk_count, 0) = 0
  AND COALESCE(attempt_count, 0) = 0
  AND processing_started_at IS NULL
);

DROP POLICY IF EXISTS "Users manage own conversations" ON public.conversations;
CREATE POLICY "Users manage own conversations"
ON public.conversations FOR ALL TO authenticated
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own messages" ON public.messages;
CREATE POLICY "Users manage own messages"
ON public.messages FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.conversations AS conversation
    WHERE conversation.id = messages.conversation_id
      AND conversation.user_id = (SELECT auth.uid())
  )
)
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

-- Explicit deny policies document that these are service-role-only tables and
-- also satisfy the Security Advisor's "RLS enabled, no policy" lint.
DROP POLICY IF EXISTS "Deny Data API access" ON public.api_rate_limits;
CREATE POLICY "Deny Data API access"
ON public.api_rate_limits FOR ALL TO anon, authenticated
USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Deny Data API access" ON public.knowledge_base_state;
CREATE POLICY "Deny Data API access"
ON public.knowledge_base_state FOR ALL TO anon, authenticated
USING (FALSE) WITH CHECK (FALSE);

-- Keep storage access admin-only and prevent non-PDF object names.
DROP POLICY IF EXISTS "Admins can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can read documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete documents" ON storage.objects;

CREATE POLICY "Admins can upload documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND lower(storage.extension(name)) = 'pdf'
  AND (SELECT private.get_my_role()) IN ('admin', 'superadmin')
);

CREATE POLICY "Admins can read documents"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'documents'
  AND (SELECT private.get_my_role()) IN ('admin', 'superadmin')
);

CREATE POLICY "Admins can delete documents"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'documents'
  AND (SELECT private.get_my_role()) IN ('admin', 'superadmin')
);

-- Foreign-key and dashboard filter indexes needed as row counts grow.
CREATE INDEX IF NOT EXISTS admin_applications_user_id_idx
  ON public.admin_applications (user_id);
CREATE INDEX IF NOT EXISTS admin_applications_reviewed_by_idx
  ON public.admin_applications (reviewed_by);
CREATE INDEX IF NOT EXISTS admin_applications_status_created_idx
  ON public.admin_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_requests_student_id_idx
  ON public.chat_requests (student_id);
CREATE INDEX IF NOT EXISTS chat_requests_responded_by_idx
  ON public.chat_requests (responded_by);
CREATE INDEX IF NOT EXISTS chat_requests_status_created_idx
  ON public.chat_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_uploaded_by_idx
  ON public.documents (uploaded_by);
CREATE INDEX IF NOT EXISTS documents_created_at_idx
  ON public.documents (created_at DESC);

-- Remove the obsolete exposed role helper after every policy/function has
-- moved to private.get_my_role().
DROP FUNCTION IF EXISTS public.get_my_role();

COMMIT;
