-- Enable UUID generation extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'employee')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create employee availability table
CREATE TABLE IF NOT EXISTS public.employee_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  available BOOLEAN NOT NULL DEFAULT TRUE,
  earliest_start TIME,
  latest_end TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, day_of_week)
);

-- Create schedule_weeks table
CREATE TABLE IF NOT EXISTS public.schedule_weeks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')) DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create shifts table
CREATE TABLE IF NOT EXISTS public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_week_id UUID NOT NULL REFERENCES public.schedule_weeks(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  position TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

-- Create schedule acknowledgments table
CREATE TABLE IF NOT EXISTS public.schedule_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_week_id UUID NOT NULL REFERENCES public.schedule_weeks(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schedule_week_id, employee_id)
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_availability_updated_at BEFORE UPDATE ON public.employee_availability FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_schedule_weeks_updated_at BEFORE UPDATE ON public.schedule_weeks FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_shifts_updated_at BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS Helper to check if current user is manager
CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'manager' AND active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create a profile for a new auth user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role TEXT;
  is_first_user BOOLEAN;
  full_name_val TEXT;
BEGIN
  -- Check if this is the first profile in the system
  SELECT COUNT(*) = 0 INTO is_first_user FROM public.profiles;

  -- Determine role
  IF is_first_user THEN
    user_role := 'manager';
  ELSE
    user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'employee');
  END IF;

  -- Determine full name
  full_name_val := COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1));

  INSERT INTO public.profiles (id, full_name, role, active)
  VALUES (NEW.id, full_name_val, user_role, TRUE);

  -- Insert default availability records (all available 9am to 5pm by default)
  FOR i IN 0..6 LOOP
    INSERT INTO public.employee_availability (employee_id, day_of_week, available, earliest_start, latest_end)
    VALUES (NEW.id, i, TRUE, '09:00:00', '17:00:00')
    ON CONFLICT (employee_id, day_of_week) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger to validate shifts
CREATE OR REPLACE FUNCTION public.check_shift_validations()
RETURNS TRIGGER AS $$
DECLARE
  week_start_date DATE;
  employee_active BOOLEAN;
  total_hours NUMERIC;
  shift_duration NUMERIC;
  existing_hours NUMERIC;
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

  -- 4. Check for overlapping shifts for the same employee
  IF EXISTS (
    SELECT 1 FROM public.shifts
    WHERE employee_id = NEW.employee_id
      AND shift_date = NEW.shift_date
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (
        (NEW.start_time >= start_time AND NEW.start_time < end_time) OR
        (NEW.end_time > start_time AND NEW.end_time <= end_time) OR
        (NEW.start_time <= start_time AND NEW.end_time >= end_time)
      )
  ) THEN
    RAISE EXCEPTION 'Shift overlaps with an existing shift for this employee on %', NEW.shift_date;
  END IF;

  -- 5. Validate total weekly hours do not exceed 39
  shift_duration := EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 3600.0;

  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0), 0)
  INTO existing_hours
  FROM public.shifts
  WHERE employee_id = NEW.employee_id
    AND schedule_week_id = NEW.schedule_week_id
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  total_hours := existing_hours + shift_duration;

  IF total_hours > 39.0 THEN
    RAISE EXCEPTION 'Total scheduled hours for this employee this week (%) would exceed the 39-hour limit', total_hours;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_shift_validations
  BEFORE INSERT OR UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.check_shift_validations();

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_acknowledgments ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Allow users to read their own profile or managers to read all" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_manager());

CREATE POLICY "Allow managers to update profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- Availability Policies
CREATE POLICY "Allow employees to manage own availability or managers to manage all" ON public.employee_availability
  FOR ALL TO authenticated
  USING (employee_id = auth.uid() OR public.is_manager())
  WITH CHECK (employee_id = auth.uid() OR public.is_manager());

-- Schedule Weeks Policies
CREATE POLICY "Managers can manage all weeks" ON public.schedule_weeks
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY "Employees can view published weeks" ON public.schedule_weeks
  FOR SELECT TO authenticated
  USING (status = 'published');

-- Shifts Policies
CREATE POLICY "Managers can manage all shifts" ON public.shifts
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY "Employees can view shifts of published weeks" ON public.shifts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.schedule_weeks
      WHERE id = shifts.schedule_week_id AND status = 'published'
    )
  );

-- Acknowledgments Policies
CREATE POLICY "Managers can read all acknowledgments" ON public.schedule_acknowledgments
  FOR SELECT TO authenticated
  USING (public.is_manager());

CREATE POLICY "Employees can read own acknowledgments" ON public.schedule_acknowledgments
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

CREATE POLICY "Employees can insert own acknowledgments" ON public.schedule_acknowledgments
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid());

-- RPC function for manager to create employee account without using service role key in frontend
CREATE OR REPLACE FUNCTION public.create_employee_account(
  email TEXT,
  password TEXT,
  full_name TEXT
) RETURNS UUID AS $$
DECLARE
  new_user_id UUID;
  encrypted_pw TEXT;
BEGIN
  -- Check if caller is manager
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Only managers can create employee accounts';
  END IF;

  -- Create hashed password
  encrypted_pw := extensions.crypt(password, extensions.gen_salt('bf'));

  -- Insert into auth.users
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
    confirmation_token
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    email,
    encrypted_pw,
    NOW(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', full_name, 'role', 'employee'),
    NOW(),
    NOW(),
    'authenticated',
    'authenticated',
    ''
  )
  RETURNING id INTO new_user_id;

  -- Force profile update to ensure name and role are set correctly
  UPDATE public.profiles
  SET role = 'employee', full_name = full_name
  WHERE id = new_user_id;

  RETURN new_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
