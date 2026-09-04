-- ============================================================
-- DATA-INTEGRITY FIX: profiles.email is freely updatable by users.
--
-- The "Users can update own profile" RLS policy pins only `role`;
-- `email` can be changed to any unused value, silently diverging from
-- auth.users.email — which the login pages, admin dashboards, and
-- admin-application flow all treat as the source of truth. A UNIQUE
-- collision also surfaces as a raw Postgres error to the user.
--
-- This trigger blocks user-initiated email changes via the Data API.
-- Service-role / SQL-editor / auth-admin sessions (auth.uid() IS NULL)
-- can still sync it legitimately.
-- ============================================================

CREATE OR REPLACE FUNCTION public.block_user_email_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email
     AND (SELECT auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'The email field cannot be changed here.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profiles_before_update ON public.profiles;
CREATE TRIGGER on_profiles_before_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.block_user_email_change();
