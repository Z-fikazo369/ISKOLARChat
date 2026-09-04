-- Atomic and auditable superadmin review of admin applications.
-- Approval and role promotion now commit together or roll back together.

ALTER TABLE admin_applications
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE admin_applications
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION review_admin_application(
  p_application_id UUID,
  p_decision TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_application public.admin_applications%ROWTYPE;
  v_email TEXT;
BEGIN
  IF v_actor_id IS NULL OR public.get_my_role() <> 'superadmin' THEN
    RAISE EXCEPTION 'Superadmin access required' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_application
    FROM public.admin_applications
   WHERE id = p_application_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin application not found' USING ERRCODE = 'P0002';
  END IF;

  -- Safe retry after a response was lost: do not repeat or reverse a review.
  IF v_application.status = p_decision THEN
    RETURN jsonb_build_object('id', v_application.id, 'status', v_application.status);
  END IF;
  IF v_application.status <> 'pending' THEN
    RAISE EXCEPTION 'Admin application has already been reviewed' USING ERRCODE = '23514';
  END IF;

  IF p_decision = 'approved' THEN
    SELECT COALESCE(v_application.email, users.email)
      INTO v_email
      FROM auth.users AS users
     WHERE users.id = v_application.user_id;

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
         reviewed_by = v_actor_id,
         reviewed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE id = p_application_id;

  RETURN jsonb_build_object('id', p_application_id, 'status', p_decision);
END;
$$;

REVOKE ALL ON FUNCTION review_admin_application(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION review_admin_application(UUID, TEXT)
  TO authenticated, service_role;

-- Status changes must go through the checked transaction above.
DROP POLICY IF EXISTS "Superadmins can update applications" ON admin_applications;
