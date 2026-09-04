-- Read-only verification — safe to run any time; this changes nothing.
-- Run after migrations 0011–0015 in the Supabase SQL Editor.
--
-- NOTE: the Supabase SQL Editor only displays the LAST statement's result,
-- so everything here is combined into ONE result set. Each row is a check;
-- look at the `status` column — anything FAIL needs attention (it usually
-- means a migration was never applied, or was applied only partially).

WITH checks AS (
  SELECT * FROM (
    VALUES
      ('anon_handle_new_user',
        to_regprocedure('public.handle_new_user()') IS NOT NULL
        AND has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE'),
        'should be false'),
      ('authenticated_handle_new_user',
        to_regprocedure('public.handle_new_user()') IS NOT NULL
        AND has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'),
        'should be false'),
      ('anon_handle_admin_application',
        to_regprocedure('public.handle_new_admin_application()') IS NOT NULL
        AND has_function_privilege('anon', 'public.handle_new_admin_application()', 'EXECUTE'),
        'should be false'),
      ('authenticated_handle_admin_application',
        to_regprocedure('public.handle_new_admin_application()') IS NOT NULL
        AND has_function_privilege('authenticated', 'public.handle_new_admin_application()', 'EXECUTE'),
        'should be false'),
      ('authenticated_admin_review',
        to_regprocedure('public.review_admin_application(uuid,text,uuid)') IS NOT NULL
        AND has_function_privilege(
          'authenticated',
          'public.review_admin_application(uuid,text,uuid)',
          'EXECUTE'
        ),
        'should be false'),
      ('public_role_helper_still_exists',
        to_regprocedure('public.get_my_role()') IS NOT NULL,
        'should be false'),
      ('private_role_helper',
        to_regprocedure('private.get_my_role()') IS NOT NULL
        AND has_function_privilege('authenticated', 'private.get_my_role()', 'EXECUTE'),
        'should be true')
  ) AS t(check_name, result, expectation)

  UNION ALL
  -- Migration 0012: server-side .edu email enforcement trigger exists.
  SELECT 'edu_email_enforcement_trigger',
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'on_auth_user_email_check'
        AND tgrelid = 'auth.users'::regclass
        AND NOT tgisinternal
    ),
    'should be true'

  UNION ALL
  -- Migration 0013: documents status constraint includes the 'deleting'
  -- tombstone used by the delete/ingest race fix.
  SELECT 'documents_status_allows_deleting',
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'documents_status_check'
        AND conrelid = 'public.documents'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%deleting%'
    ),
    'should be true'

  UNION ALL
  -- Migration 0014: admin-verified messages (hitl_request_id set) must not be
  -- updatable/deletable by students.
  SELECT 'messages_verified_readonly',
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'messages'
        AND policyname = 'Users update own messages'
        AND qual ~ 'hitl_request_id IS NULL'
    ),
    'should be true'

  UNION ALL
  -- Migration 0015: user-initiated profile email changes are blocked.
  SELECT 'profile_email_immutable',
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'on_profiles_before_update'
        AND tgrelid = 'public.profiles'::regclass
        AND NOT tgisinternal
    ),
    'should be true'

  UNION ALL
  -- 0011: service-role-only tables must have an explicit deny policy
  -- (FOR ALL TO anon, authenticated USING (FALSE)).
  SELECT 'deny_policy_api_rate_limits',
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'api_rate_limits'
        AND cmd = 'ALL'
        AND qual ~ 'false'
    ),
    'should be true'

  UNION ALL
  SELECT 'deny_policy_knowledge_base_state',
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'knowledge_base_state'
        AND cmd = 'ALL'
        AND qual ~ 'false'
    ),
    'should be true'

  UNION ALL
  -- 0011: storage bucket must be private, PDF-only, 25 MiB cap.
  SELECT 'storage_bucket_documents_private',
    (SELECT NOT public FROM storage.buckets WHERE id = 'documents') IS TRUE,
    'should be true'

  UNION ALL
  SELECT 'storage_bucket_documents_pdf_only',
    (SELECT allowed_mime_types = ARRAY['application/pdf']::text[]
       FROM storage.buckets WHERE id = 'documents') IS TRUE,
    'should be true'

  UNION ALL
  SELECT 'storage_bucket_documents_size_cap',
    (SELECT file_size_limit = 26214400
       FROM storage.buckets WHERE id = 'documents') IS TRUE,
    'should be true'
)
SELECT check_name, result, expectation,
  CASE WHEN result = (expectation LIKE '%true%')
    THEN 'PASS'
    ELSE 'FAIL'
  END AS status
FROM checks
ORDER BY status DESC, check_name;
