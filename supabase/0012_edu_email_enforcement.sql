-- ============================================================
-- Server-side .edu email enforcement
--
-- SECURITY FIX: the ".edu only" rule previously lived ONLY in the
-- React signup form (StudentSignup.jsx). Anyone could bypass the UI
-- by calling supabase.auth.signUp() directly with any email, and the
-- Google OAuth flow applied no domain restriction at all — a plain
-- Gmail account got a full student profile.
--
-- This BEFORE INSERT trigger on auth.users is the one place every
-- signup path (password, OAuth, admin-invited) must pass through, so
-- the rule cannot be bypassed by any client.
--
-- NOTE:
--  • Existing accounts are unaffected (trigger fires on INSERT only).
--  • This also applies to accounts created from the Supabase
--    dashboard / admin API — use a .edu / .edu.ph address for those.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_edu_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Phone-first accounts have no email yet; nothing to check here.
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT (lower(NEW.email) LIKE '%.edu' OR lower(NEW.email) LIKE '%.edu.ph') THEN
    RAISE EXCEPTION 'Sign-ups are restricted to .edu or .edu.ph email addresses.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_check ON auth.users;
CREATE TRIGGER on_auth_user_email_check
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.enforce_edu_email();
