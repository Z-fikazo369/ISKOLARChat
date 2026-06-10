-- ============================================================
-- ISKOLARCHAT — Consolidated Schema (replaces supabase_setup.sql,
-- superadmin_patch.sql, and admin_dashboard_patch.sql)
--
-- Run this whole file in the Supabase SQL Editor.
--
-- ⚠ WARNING: this DROPS and recreates chat_requests because the two
-- old SQL files defined it with incompatible schemas. Any existing
-- rows in chat_requests will be lost (fine in dev).
-- ============================================================


-- ============================================================
-- HELPER FUNCTION (prevents circular reference in RLS policies)
-- SET search_path hardens the SECURITY DEFINER function against
-- search_path hijacking.
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;


-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT CHECK (role IN ('student', 'admin', 'superadmin')) DEFAULT 'student',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Superadmins can insert any profile" ON profiles;
DROP POLICY IF EXISTS "Superadmins can update any profile" ON profiles;

-- SECURITY FIX: self-inserted profiles are forced to role 'student'.
-- (Old policy let any logged-in user insert themselves as 'superadmin'.)
CREATE POLICY "Users can insert own profile"
ON profiles FOR INSERT
WITH CHECK (auth.uid() = id AND role = 'student');

CREATE POLICY "Users can read own profile"
ON profiles FOR SELECT
USING (auth.uid() = id);

-- SECURITY FIX: users may update their own row but may NOT change role.
-- get_my_role() reads the pre-update row, so new role must equal old role.
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id AND role = get_my_role());

CREATE POLICY "Admins can read all profiles"
ON profiles FOR SELECT
USING (get_my_role() IN ('admin', 'superadmin'));

CREATE POLICY "Superadmins can insert any profile"
ON profiles FOR INSERT
WITH CHECK (get_my_role() = 'superadmin');

CREATE POLICY "Superadmins can update any profile"
ON profiles FOR UPDATE
USING (get_my_role() = 'superadmin');

-- Auto-create a profile whenever an auth user is created (Supabase best
-- practice — removes the need for client-side profile inserts, which fail
-- when email confirmation is enabled because there is no session yet).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    'student'  -- never trust client-supplied metadata for role
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- ADMIN APPLICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  department TEXT NOT NULL,
  position TEXT NOT NULL,
  phone TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE admin_applications ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE admin_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own application" ON admin_applications;
DROP POLICY IF EXISTS "Users can read own application" ON admin_applications;
DROP POLICY IF EXISTS "Superadmins can read all applications" ON admin_applications;
DROP POLICY IF EXISTS "Superadmins can update applications" ON admin_applications;
DROP POLICY IF EXISTS "Superadmins can delete applications" ON admin_applications;

CREATE POLICY "Users can insert own application"
ON admin_applications FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own application"
ON admin_applications FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Superadmins can read all applications"
ON admin_applications FOR SELECT
USING (get_my_role() = 'superadmin');

CREATE POLICY "Superadmins can update applications"
ON admin_applications FOR UPDATE
USING (get_my_role() = 'superadmin');

CREATE POLICY "Superadmins can delete applications"
ON admin_applications FOR DELETE
USING (get_my_role() = 'superadmin');


-- ============================================================
-- CHAT REQUESTS (HITL escalations) — single authoritative schema.
-- Matches what AdminDashboard.jsx actually reads/writes.
-- ============================================================
DROP TABLE IF EXISTS chat_requests CASCADE;

CREATE TABLE chat_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  student_email TEXT,
  student_name TEXT,
  question TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'answered')),
  admin_response TEXT,
  responded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  answer_ingested BOOLEAN DEFAULT FALSE,   -- knowledge-loop tracking (Phase 1 Step 4)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE chat_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can insert chat requests"
ON chat_requests FOR INSERT
WITH CHECK (auth.uid() = student_id AND get_my_role() = 'student');

CREATE POLICY "Students can read own chat requests"
ON chat_requests FOR SELECT
USING (auth.uid() = student_id OR get_my_role() IN ('admin', 'superadmin'));

CREATE POLICY "Admins can update chat requests"
ON chat_requests FOR UPDATE
USING (get_my_role() IN ('admin', 'superadmin'));


-- ============================================================
-- DOCUMENTS (RAG knowledge base files)
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  size BIGINT DEFAULT 0,
  file_path TEXT NOT NULL,
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  error TEXT,
  chunk_count INTEGER DEFAULT 0,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Upgrade path if the old documents table already exists
ALTER TABLE documents ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_count INTEGER DEFAULT 0;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_status_check
  CHECK (status IN ('processing', 'ready', 'failed'));

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage documents" ON documents;
CREATE POLICY "Admins can manage documents"
ON documents FOR ALL
USING (get_my_role() IN ('admin', 'superadmin'));


-- ============================================================
-- STORAGE: "documents" bucket + policies
-- (Old patch said "create the bucket manually" but never added
-- storage.objects policies — uploads from the browser were failing RLS.)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admins can upload documents" ON storage.objects;
CREATE POLICY "Admins can upload documents"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'documents' AND get_my_role() IN ('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins can read documents" ON storage.objects;
CREATE POLICY "Admins can read documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'documents' AND get_my_role() IN ('admin', 'superadmin'));

DROP POLICY IF EXISTS "Admins can delete documents" ON storage.objects;
CREATE POLICY "Admins can delete documents"
ON storage.objects FOR DELETE
USING (bucket_id = 'documents' AND get_my_role() IN ('admin', 'superadmin'));


-- ============================================================
-- SUPERADMIN ACCOUNT
-- Do NOT insert directly into auth.users (the old setup file did this;
-- manually-inserted rows are missing GoTrue fields and are a known cause
-- of "Database error querying schema" at login).
--
-- Instead:
--   1. Supabase Dashboard → Authentication → Users → "Add user"
--      (email + password, check "Auto Confirm User")
--   2. Then run (replace the email):
--
--      UPDATE profiles SET role = 'superadmin'
--      WHERE email = 'your-superadmin@email.com';
--
-- The on_auth_user_created trigger will have already created the profile.
-- ============================================================
