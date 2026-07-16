-- Generalize the scheduler for any company:
--   * admin role above managers (first signup bootstraps as admin)
--   * departments; employees belong to one, managers can run several
--   * department-scoped RLS everywhere
--   * employee time-off requests with manager approval
--   * app settings (org name, weekly hours cap) instead of hardcoded values

-- ---------------------------------------------------------------------------
-- 1. Roles: allow 'admin'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'manager', 'employee'));

-- Existing managers had app-wide power; keep it by promoting them to admin.
UPDATE public.profiles SET role = 'admin' WHERE role = 'manager';

-- ---------------------------------------------------------------------------
-- 2. New tables
CREATE TABLE IF NOT EXISTS public.app_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  org_name TEXT NOT NULL DEFAULT 'Spredsheep',
  weekly_hours_cap NUMERIC NOT NULL DEFAULT 39 CHECK (weekly_hours_cap > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.app_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.manager_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (manager_id, department_id)
);

CREATE TABLE IF NOT EXISTS public.time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')) DEFAULT 'pending',
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_time_off_updated_at BEFORE UPDATE ON public.time_off_requests FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Department columns + backfill existing data into a starter department
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.schedule_weeks ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE CASCADE;

DO $$
DECLARE
  general_id UUID;
BEGIN
  INSERT INTO public.departments (name) VALUES ('General')
  ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO general_id;

  UPDATE public.profiles SET department_id = general_id
  WHERE role = 'employee' AND department_id IS NULL;

  UPDATE public.schedule_weeks SET department_id = general_id
  WHERE department_id IS NULL;
END $$;

ALTER TABLE public.schedule_weeks ALTER COLUMN department_id SET NOT NULL;
ALTER TABLE public.schedule_weeks DROP CONSTRAINT IF EXISTS schedule_weeks_week_start_key;
ALTER TABLE public.schedule_weeks ADD CONSTRAINT schedule_weeks_department_week_key UNIQUE (department_id, week_start);

-- ---------------------------------------------------------------------------
-- 4. Role/department helpers (SECURITY DEFINER so policies don't recurse)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND active = true
  );
END;
$$;

-- "Manager powers": true for active managers AND admins.
CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'manager') AND active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.current_department()
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT department_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.department_of(p_user UUID)
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT department_id FROM public.profiles WHERE id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.department_of_week(p_week UUID)
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT department_id FROM public.schedule_weeks WHERE id = p_week;
$$;

CREATE OR REPLACE FUNCTION public.manages_department(p_department UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN TRUE;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.manager_departments md
    JOIN public.profiles p ON p.id = md.manager_id
    WHERE md.manager_id = auth.uid()
      AND md.department_id = p_department
      AND p.role = 'manager' AND p.active = true
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. First signup bootstraps as admin (was manager)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  user_role TEXT;
  is_first_user BOOLEAN;
  full_name_val TEXT;
BEGIN
  SELECT COUNT(*) = 0 INTO is_first_user FROM public.profiles;

  IF is_first_user THEN
    user_role := 'admin';
  ELSE
    user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'employee');
  END IF;

  full_name_val := COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1));

  INSERT INTO public.profiles (id, full_name, role, active)
  VALUES (NEW.id, full_name_val, user_role, TRUE);

  FOR i IN 0..6 LOOP
    INSERT INTO public.employee_availability (employee_id, day_of_week, available, earliest_start, latest_end)
    VALUES (NEW.id, i, TRUE, '09:00:00', '17:00:00')
    ON CONFLICT (employee_id, day_of_week) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Department-scoped RLS
-- profiles: read own, admins read all, employees read active departmentmates,
-- managers read staff of departments they manage.
DROP POLICY IF EXISTS "Read active profiles, own profile, or manager reads all" ON public.profiles;
CREATE POLICY "Department-scoped profile reads" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_admin()
    OR (active = true AND department_id IS NOT NULL AND department_id = public.current_department())
    OR public.manages_department(department_id)
  );

DROP POLICY IF EXISTS "Allow managers to update profiles" ON public.profiles;
CREATE POLICY "Update own profile, managed staff, or admin all" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin() OR public.manages_department(department_id))
  WITH CHECK (id = auth.uid() OR public.is_admin() OR public.manages_department(department_id));

-- Guard trigger: role/active/department changes need manager powers;
-- anything touching the admin role needs an admin.
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service-role / admin contexts (seeding, SQL editor)
  END IF;

  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.active IS DISTINCT FROM OLD.active
      OR NEW.department_id IS DISTINCT FROM OLD.department_id)
     AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'Only managers can change role, department, or active status';
  END IF;

  IF (NEW.role IS DISTINCT FROM OLD.role AND (NEW.role = 'admin' OR OLD.role = 'admin'))
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can grant or revoke the admin role';
  END IF;

  RETURN NEW;
END;
$$;

-- app_settings
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in can read settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can update settings" ON public.app_settings
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- departments
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in can read departments" ON public.departments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage departments" ON public.departments
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- manager_departments
ALTER TABLE public.manager_departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own assignments or admin reads all" ON public.manager_departments
  FOR SELECT TO authenticated USING (manager_id = auth.uid() OR public.is_admin());
CREATE POLICY "Admins manage department assignments" ON public.manager_departments
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- schedule_weeks
DROP POLICY IF EXISTS "Managers can manage all weeks" ON public.schedule_weeks;
CREATE POLICY "Managers manage weeks of their departments" ON public.schedule_weeks
  FOR ALL TO authenticated
  USING (public.manages_department(department_id))
  WITH CHECK (public.manages_department(department_id));

DROP POLICY IF EXISTS "Employees can view published weeks" ON public.schedule_weeks;
CREATE POLICY "Employees view published weeks of their department" ON public.schedule_weeks
  FOR SELECT TO authenticated
  USING (status = 'published' AND department_id = public.current_department());

-- shifts
DROP POLICY IF EXISTS "Managers can manage all shifts" ON public.shifts;
CREATE POLICY "Managers manage shifts of their departments" ON public.shifts
  FOR ALL TO authenticated
  USING (public.manages_department(public.department_of_week(schedule_week_id)))
  WITH CHECK (public.manages_department(public.department_of_week(schedule_week_id)));

DROP POLICY IF EXISTS "Employees can view shifts of published weeks" ON public.shifts;
CREATE POLICY "Employees view published shifts of their department" ON public.shifts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.schedule_weeks w
      WHERE w.id = shifts.schedule_week_id
        AND w.status = 'published'
        AND w.department_id = public.current_department()
    )
  );

-- acknowledgments: manager read scoped by employee's department
DROP POLICY IF EXISTS "Managers can read all acknowledgments" ON public.schedule_acknowledgments;
CREATE POLICY "Managers read acknowledgments of their departments" ON public.schedule_acknowledgments
  FOR SELECT TO authenticated
  USING (public.manages_department(public.department_of(employee_id)));

-- availability: manager access scoped by employee's department
DROP POLICY IF EXISTS "Allow employees to manage own availability or managers to manage all" ON public.employee_availability;
CREATE POLICY "Own availability or managed department" ON public.employee_availability
  FOR ALL TO authenticated
  USING (employee_id = auth.uid() OR public.manages_department(public.department_of(employee_id)))
  WITH CHECK (employee_id = auth.uid() OR public.manages_department(public.department_of(employee_id)));

-- time_off_requests
ALTER TABLE public.time_off_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees create own pending requests" ON public.time_off_requests
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid() AND status = 'pending');
CREATE POLICY "Employees read own requests" ON public.time_off_requests
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());
CREATE POLICY "Employees cancel own pending requests" ON public.time_off_requests
  FOR DELETE TO authenticated
  USING (employee_id = auth.uid() AND status = 'pending');
CREATE POLICY "Managers read requests of their departments" ON public.time_off_requests
  FOR SELECT TO authenticated
  USING (public.manages_department(public.department_of(employee_id)));
CREATE POLICY "Managers review requests of their departments" ON public.time_off_requests
  FOR UPDATE TO authenticated
  USING (public.manages_department(public.department_of(employee_id)))
  WITH CHECK (public.manages_department(public.department_of(employee_id)));

-- ---------------------------------------------------------------------------
-- 7. Weekly hours cap comes from app_settings
CREATE OR REPLACE FUNCTION public.check_shift_validations()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  week_start_date DATE;
  employee_active BOOLEAN;
  total_hours NUMERIC;
  hours_cap NUMERIC;
  new_start TIMESTAMP;
  new_end TIMESTAMP;
BEGIN
  SELECT week_start INTO week_start_date FROM public.schedule_weeks WHERE id = NEW.schedule_week_id;
  IF week_start_date IS NULL THEN
    RAISE EXCEPTION 'Invalid schedule week ID';
  END IF;

  IF NEW.shift_date < week_start_date OR NEW.shift_date > (week_start_date + 6) THEN
    RAISE EXCEPTION 'Shift date % does not belong to schedule week starting %', NEW.shift_date, week_start_date;
  END IF;

  SELECT active INTO employee_active FROM public.profiles WHERE id = NEW.employee_id;
  IF employee_active IS NULL OR NOT employee_active THEN
    RAISE EXCEPTION 'Cannot schedule inactive employee';
  END IF;

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

  SELECT weekly_hours_cap INTO hours_cap FROM public.app_settings LIMIT 1;
  hours_cap := COALESCE(hours_cap, 39.0);

  SELECT COALESCE(SUM(public.shift_hours(start_time, end_time)), 0)
  INTO total_hours
  FROM public.shifts
  WHERE employee_id = NEW.employee_id
    AND schedule_week_id = NEW.schedule_week_id
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  total_hours := total_hours + public.shift_hours(NEW.start_time, NEW.end_time);

  IF total_hours > hours_cap THEN
    RAISE EXCEPTION 'Total scheduled hours for this employee this week (%) would exceed the % hour limit', total_hours, hours_cap;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPCs
-- Replaces create_employee_account: admins create managers or employees,
-- managers create employees in departments they manage.
DROP FUNCTION IF EXISTS public.create_employee_account(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_staff_account(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_department_ids UUID[]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  new_user_id UUID;
  encrypted_pw TEXT;
  dept UUID;
BEGIN
  IF p_role NOT IN ('manager', 'employee') THEN
    RAISE EXCEPTION 'Role must be manager or employee';
  END IF;

  IF p_role = 'manager' THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admins can create manager accounts';
    END IF;
    IF p_department_ids IS NULL OR array_length(p_department_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'A manager needs at least one department';
    END IF;
  ELSE
    IF p_department_ids IS NULL OR array_length(p_department_ids, 1) <> 1 THEN
      RAISE EXCEPTION 'An employee needs exactly one department';
    END IF;
    IF NOT public.manages_department(p_department_ids[1]) THEN
      RAISE EXCEPTION 'You can only add employees to departments you manage';
    END IF;
  END IF;

  FOREACH dept IN ARRAY p_department_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.departments WHERE id = dept) THEN
      RAISE EXCEPTION 'Unknown department';
    END IF;
  END LOOP;

  encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id, id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(), p_email, encrypted_pw, NOW(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_full_name, 'role', p_role),
    NOW(), NOW(), 'authenticated', 'authenticated',
    '', '', '', '', '', '', '', ''
  ) RETURNING id INTO new_user_id;

  UPDATE public.profiles
  SET role = p_role,
      full_name = p_full_name,
      department_id = CASE WHEN p_role = 'employee' THEN p_department_ids[1] ELSE NULL END
  WHERE id = new_user_id;

  IF p_role = 'manager' THEN
    INSERT INTO public.manager_departments (manager_id, department_id)
    SELECT new_user_id, d FROM unnest(p_department_ids) AS d
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN new_user_id;
END;
$$;

-- Deleting staff: managers may delete employees of their departments,
-- admins may also delete managers. Admin accounts are never app-deletable.
CREATE OR REPLACE FUNCTION public.delete_employee_account(p_employee_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target_role TEXT;
  target_dept UUID;
BEGIN
  SELECT role, department_id INTO target_role, target_dept
  FROM public.profiles WHERE id = p_employee_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;
  IF target_role = 'admin' THEN
    RAISE EXCEPTION 'Admin accounts cannot be deleted from the app';
  END IF;
  IF target_role = 'manager' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can delete manager accounts';
  END IF;
  IF target_role = 'employee' AND NOT public.manages_department(target_dept) THEN
    RAISE EXCEPTION 'You can only delete employees of departments you manage';
  END IF;

  DELETE FROM auth.users WHERE id = p_employee_id;
END;
$$;

-- Copy weeks: scope to managed departments instead of any manager
CREATE OR REPLACE FUNCTION public.copy_week_shifts(
  p_source_week_id UUID,
  p_target_week_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  source_start DATE;
  target_start DATE;
  day_offset INTEGER;
  copied_count INTEGER;
BEGIN
  IF NOT (public.manages_department(public.department_of_week(p_source_week_id))
          AND public.manages_department(public.department_of_week(p_target_week_id))) THEN
    RAISE EXCEPTION 'You can only copy schedules within departments you manage';
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
-- 9. Function grants
REVOKE EXECUTE ON FUNCTION public.create_staff_account(TEXT, TEXT, TEXT, TEXT, UUID[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.manages_department(UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.current_department() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.department_of(UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.department_of_week(UUID) FROM anon, public;
