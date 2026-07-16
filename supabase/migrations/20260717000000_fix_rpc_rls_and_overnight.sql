-- Fixes from app diagnosis (2026-07-16):
--   1. create_employee_account: parameter names collided with column names
--      ("column reference full_name is ambiguous"), and rows inserted into
--      auth.users left token columns NULL, which breaks GoTrue logins.
--   2. Profiles RLS did not let employees read teammates' names (Team view).
--   3. Copy-previous-week was a non-atomic client-side delete-then-insert;
--      moved into a transactional RPC.
--   4. Overnight shifts (crossing midnight) were rejected by a CHECK constraint
--      and miscounted by the validation trigger, while the frontend supports them.
--   5. SECURITY DEFINER functions did not pin search_path.

-- Needed by create_employee_account and seed.sql (crypt / gen_salt).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1a. Repair existing auth.users rows created by direct inserts (seed/RPC):
--     GoTrue errors on NULL string token columns.
UPDATE auth.users SET
  confirmation_token         = COALESCE(confirmation_token, ''),
  recovery_token             = COALESCE(recovery_token, ''),
  email_change               = COALESCE(email_change, ''),
  email_change_token_new     = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  phone_change               = COALESCE(phone_change, ''),
  phone_change_token         = COALESCE(phone_change_token, ''),
  reauthentication_token     = COALESCE(reauthentication_token, '')
WHERE confirmation_token IS NULL OR recovery_token IS NULL OR email_change IS NULL
   OR email_change_token_new IS NULL OR email_change_token_current IS NULL
   OR phone_change IS NULL OR phone_change_token IS NULL OR reauthentication_token IS NULL;

-- 1b. Recreate create_employee_account with prefixed parameters (the old
--     UPDATE ... SET full_name = full_name was ambiguous and always errored).
DROP FUNCTION IF EXISTS public.create_employee_account(TEXT, TEXT, TEXT);

CREATE FUNCTION public.create_employee_account(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_user_id UUID;
  encrypted_pw TEXT;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Only managers can create employee accounts';
  END IF;

  encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id,
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    role,
    aud,
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_new,
    email_change_token_current,
    phone_change,
    phone_change_token,
    reauthentication_token
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    p_email,
    encrypted_pw,
    NOW(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_full_name, 'role', 'employee'),
    NOW(),
    NOW(),
    'authenticated',
    'authenticated',
    '', '', '', '', '', '', '', ''
  )
  RETURNING id INTO new_user_id;

  UPDATE public.profiles
  SET role = 'employee', full_name = p_full_name
  WHERE id = new_user_id;

  RETURN new_user_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Profiles RLS: employees need teammate names for the Team view, and users
--    may update their own profile (role/active changes guarded by trigger).
DROP POLICY IF EXISTS "Allow users to read their own profile or managers to read all" ON public.profiles;

CREATE POLICY "Read active profiles, own profile, or manager reads all" ON public.profiles
  FOR SELECT TO authenticated
  USING (active = true OR id = auth.uid() OR public.is_manager());

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Guard: non-managers must not escalate role or flip active status.
-- auth.uid() IS NULL covers service-role/admin contexts (seeding, SQL editor).
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.active IS DISTINCT FROM OLD.active)
     AND auth.uid() IS NOT NULL
     AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'Only managers can change role or active status';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_privileges ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileges();

-- ---------------------------------------------------------------------------
-- 3. Transactional copy of one week's shifts into another. Runs with the
--    caller's rights, so RLS and the shift validation trigger still apply;
--    any failure rolls back the whole copy including the delete.
CREATE OR REPLACE FUNCTION public.copy_week_shifts(
  p_source_week_id UUID,
  p_target_week_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  source_start DATE;
  target_start DATE;
  day_offset INTEGER;
  copied_count INTEGER;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Only managers can copy schedules';
  END IF;

  SELECT week_start INTO source_start FROM public.schedule_weeks WHERE id = p_source_week_id;
  SELECT week_start INTO target_start FROM public.schedule_weeks WHERE id = p_target_week_id;
  IF source_start IS NULL OR target_start IS NULL THEN
    RAISE EXCEPTION 'Invalid source or target schedule week';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE schedule_week_id = p_source_week_id) THEN
    RAISE EXCEPTION 'Source week does not contain any shifts';
  END IF;

  day_offset := target_start - source_start;

  DELETE FROM public.shifts WHERE schedule_week_id = p_target_week_id;

  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes)
  SELECT p_target_week_id, employee_id, shift_date + day_offset, start_time, end_time, position, notes
  FROM public.shifts
  WHERE schedule_week_id = p_source_week_id;

  GET DIAGNOSTICS copied_count = ROW_COUNT;
  RETURN copied_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Overnight shifts: replace end > start with end <> start, and make the
--    validation trigger overnight-aware (duration, overlap, weekly hours).
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.shifts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%end_time%start_time%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.shifts DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.shifts ADD CONSTRAINT shifts_times_not_equal CHECK (end_time <> start_time);

-- Duration in hours; end_time <= start_time means the shift crosses midnight.
CREATE OR REPLACE FUNCTION public.shift_hours(p_start TIME, p_end TIME)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_end > p_start THEN EXTRACT(EPOCH FROM (p_end - p_start)) / 3600.0
    ELSE EXTRACT(EPOCH FROM (p_end - p_start)) / 3600.0 + 24.0
  END;
$$;

CREATE OR REPLACE FUNCTION public.check_shift_validations()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  week_start_date DATE;
  employee_active BOOLEAN;
  total_hours NUMERIC;
  new_start TIMESTAMP;
  new_end TIMESTAMP;
BEGIN
  -- 1. Get the week start date
  SELECT week_start INTO week_start_date FROM public.schedule_weeks WHERE id = NEW.schedule_week_id;
  IF week_start_date IS NULL THEN
    RAISE EXCEPTION 'Invalid schedule week ID';
  END IF;

  -- 2. Validate shift date belongs to schedule week (Monday to Sunday)
  IF NEW.shift_date < week_start_date OR NEW.shift_date > (week_start_date + 6) THEN
    RAISE EXCEPTION 'Shift date % does not belong to schedule week starting %', NEW.shift_date, week_start_date;
  END IF;

  -- 3. Validate employee is active
  SELECT active INTO employee_active FROM public.profiles WHERE id = NEW.employee_id;
  IF employee_active IS NULL OR NOT employee_active THEN
    RAISE EXCEPTION 'Cannot schedule inactive employee';
  END IF;

  -- 4. Check for overlapping shifts using absolute timestamps so overnight
  --    shifts spilling into the next day are compared correctly.
  new_start := NEW.shift_date + NEW.start_time;
  new_end   := NEW.shift_date + NEW.end_time
               + CASE WHEN NEW.end_time <= NEW.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END;

  IF EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.employee_id = NEW.employee_id
      AND s.shift_date BETWEEN NEW.shift_date - 1 AND NEW.shift_date + 1
      AND s.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND new_start < (s.shift_date + s.end_time
                       + CASE WHEN s.end_time <= s.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
      AND (s.shift_date + s.start_time) < new_end
  ) THEN
    RAISE EXCEPTION 'Shift overlaps with an existing shift for this employee on %', NEW.shift_date;
  END IF;

  -- 5. Validate total weekly hours do not exceed 39
  SELECT COALESCE(SUM(public.shift_hours(start_time, end_time)), 0)
  INTO total_hours
  FROM public.shifts
  WHERE employee_id = NEW.employee_id
    AND schedule_week_id = NEW.schedule_week_id
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  total_hours := total_hours + public.shift_hours(NEW.start_time, NEW.end_time);

  IF total_hours > 39.0 THEN
    RAISE EXCEPTION 'Total scheduled hours for this employee this week (%) would exceed the 39-hour limit', total_hours;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Pin search_path on the remaining SECURITY DEFINER / trigger functions.
ALTER FUNCTION public.is_manager() SET search_path = '';
ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.handle_updated_at() SET search_path = '';
