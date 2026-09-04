-- ============================================================
-- ISKOLARChat — reliable admin applications
--
-- Admin signup can require email confirmation, so the browser may not have
-- an authenticated session with which to insert the application row. Create
-- it server-side from the metadata supplied during auth signup instead.
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_admin_application()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  application JSONB := NEW.raw_user_meta_data -> 'admin_application';
BEGIN
  -- Normal student/superadmin signups do not carry this object. Also ignore
  -- incomplete direct-API submissions instead of breaking auth user creation.
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
    BTRIM(application ->> 'full_name'),
    BTRIM(application ->> 'employee_id'),
    BTRIM(application ->> 'department'),
    BTRIM(application ->> 'position'),
    NEW.email,
    BTRIM(application ->> 'phone'),
    BTRIM(application ->> 'reason'),
    'pending'
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.admin_applications existing
    WHERE existing.user_id = NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_admin_application_user_created ON auth.users;
CREATE TRIGGER on_admin_application_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_admin_application();

-- Recover applications for auth users who signed up after the frontend began
-- sending metadata but before this trigger was installed.
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
  users.id,
  BTRIM(users.raw_user_meta_data -> 'admin_application' ->> 'full_name'),
  BTRIM(users.raw_user_meta_data -> 'admin_application' ->> 'employee_id'),
  BTRIM(users.raw_user_meta_data -> 'admin_application' ->> 'department'),
  BTRIM(users.raw_user_meta_data -> 'admin_application' ->> 'position'),
  users.email,
  BTRIM(users.raw_user_meta_data -> 'admin_application' ->> 'phone'),
  BTRIM(users.raw_user_meta_data -> 'admin_application' ->> 'reason'),
  'pending'
FROM auth.users AS users
WHERE jsonb_typeof(users.raw_user_meta_data -> 'admin_application') = 'object'
  AND BTRIM(COALESCE(users.raw_user_meta_data -> 'admin_application' ->> 'full_name', '')) <> ''
  AND BTRIM(COALESCE(users.raw_user_meta_data -> 'admin_application' ->> 'employee_id', '')) <> ''
  AND BTRIM(COALESCE(users.raw_user_meta_data -> 'admin_application' ->> 'department', '')) <> ''
  AND BTRIM(COALESCE(users.raw_user_meta_data -> 'admin_application' ->> 'position', '')) <> ''
  AND BTRIM(COALESCE(users.raw_user_meta_data -> 'admin_application' ->> 'phone', '')) <> ''
  AND BTRIM(COALESCE(users.raw_user_meta_data -> 'admin_application' ->> 'reason', '')) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.admin_applications existing
    WHERE existing.user_id = users.id
  );
