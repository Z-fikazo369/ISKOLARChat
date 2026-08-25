-- Read-only verification after applying migration 0011.
-- Every row in the first result should be false except private_role_helper,
-- which should be true for authenticated policy evaluation.

SELECT *
FROM (
  VALUES
    ('anon_handle_new_user',
      has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')),
    ('authenticated_handle_new_user',
      has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')),
    ('anon_handle_admin_application',
      has_function_privilege('anon', 'public.handle_new_admin_application()', 'EXECUTE')),
    ('authenticated_handle_admin_application',
      has_function_privilege('authenticated', 'public.handle_new_admin_application()', 'EXECUTE')),
    ('authenticated_admin_review',
      has_function_privilege(
        'authenticated',
        'public.review_admin_application(uuid,text,uuid)',
        'EXECUTE'
      )),
    ('public_role_helper_still_exists',
      to_regprocedure('public.get_my_role()') IS NOT NULL),
    ('private_role_helper',
      has_function_privilege(
        'authenticated', 'private.get_my_role()', 'EXECUTE'
      ))
) AS checks(check_name, result)
ORDER BY check_name;

-- These two internal tables should each have an explicit deny policy.
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('api_rate_limits', 'knowledge_base_state')
ORDER BY tablename, policyname;

-- Confirm private/PDF-only/25 MiB storage configuration.
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'documents';
