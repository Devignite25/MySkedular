-- Seed data for the scheduling system (demo company with two departments)

DO $$
DECLARE
  jorge_id UUID := gen_random_uuid();   -- admin
  maria_id UUID := gen_random_uuid();   -- manager of both departments
  carla_id UUID := gen_random_uuid();   -- Kitchen employee
  aidel_id UUID := gen_random_uuid();   -- Kitchen employee
  amanda_id UUID := gen_random_uuid();  -- Front of House employee
  marta_id UUID := gen_random_uuid();   -- Front of House employee
  luisa_id UUID := gen_random_uuid();   -- Front of House employee

  kitchen_id UUID := gen_random_uuid();
  foh_id UUID := gen_random_uuid();

  kitchen_pub_week UUID := gen_random_uuid();
  kitchen_draft_week UUID := gen_random_uuid();
  foh_pub_week UUID := gen_random_uuid();

  hashed_pw TEXT;
BEGIN
  -- Hash password123
  hashed_pw := extensions.crypt('password123', extensions.gen_salt('bf'));

  -- Clean existing seed data if any
  DELETE FROM auth.users WHERE email IN (
    'jorge@example.com', 'maria@example.com', 'carla@example.com',
    'aidel@example.com', 'amanda@example.com', 'marta@example.com', 'luisa@example.com'
  );
  DELETE FROM public.departments WHERE name IN ('Kitchen', 'Front of House');

  -- Branding
  UPDATE public.app_settings SET org_name = 'Demo Company', weekly_hours_cap = 39;

  -- Departments
  INSERT INTO public.departments (id, name) VALUES (kitchen_id, 'Kitchen');
  INSERT INTO public.departments (id, name) VALUES (foh_id, 'Front of House');

  -- Users (auth.users insert fires handle_new_user -> profiles + availability)
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  VALUES
    (jorge_id,  '00000000-0000-0000-0000-000000000000', 'jorge@example.com',  hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Jorge","role":"admin"}',    'authenticated', 'authenticated', NOW(), NOW(), '', '', '', '', '', '', '', ''),
    (maria_id,  '00000000-0000-0000-0000-000000000000', 'maria@example.com',  hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Maria","role":"manager"}',  'authenticated', 'authenticated', NOW(), NOW(), '', '', '', '', '', '', '', ''),
    (carla_id,  '00000000-0000-0000-0000-000000000000', 'carla@example.com',  hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Carla","role":"employee"}', 'authenticated', 'authenticated', NOW(), NOW(), '', '', '', '', '', '', '', ''),
    (aidel_id,  '00000000-0000-0000-0000-000000000000', 'aidel@example.com',  hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Aidel","role":"employee"}', 'authenticated', 'authenticated', NOW(), NOW(), '', '', '', '', '', '', '', ''),
    (amanda_id, '00000000-0000-0000-0000-000000000000', 'amanda@example.com', hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Amanda","role":"employee"}','authenticated', 'authenticated', NOW(), NOW(), '', '', '', '', '', '', '', ''),
    (marta_id,  '00000000-0000-0000-0000-000000000000', 'marta@example.com',  hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Marta","role":"employee"}', 'authenticated', 'authenticated', NOW(), NOW(), '', '', '', '', '', '', '', ''),
    (luisa_id,  '00000000-0000-0000-0000-000000000000', 'luisa@example.com',  hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Luisa","role":"employee"}', 'authenticated', 'authenticated', NOW(), NOW(), '', '', '', '', '', '', '', '');

  -- Roles and departments (guard trigger allows this: auth.uid() is NULL here)
  UPDATE public.profiles SET role = 'admin',   full_name = 'Jorge' WHERE id = jorge_id;
  UPDATE public.profiles SET role = 'manager', full_name = 'Maria' WHERE id = maria_id;
  UPDATE public.profiles SET role = 'employee', department_id = kitchen_id WHERE id IN (carla_id, aidel_id);
  UPDATE public.profiles SET role = 'employee', department_id = foh_id WHERE id IN (amanda_id, marta_id, luisa_id);

  -- Maria manages both departments
  INSERT INTO public.manager_departments (manager_id, department_id) VALUES
    (maria_id, kitchen_id),
    (maria_id, foh_id);

  -- Custom availability
  UPDATE public.employee_availability SET available = FALSE WHERE employee_id = carla_id AND day_of_week = 2;  -- Carla off Wednesdays
  UPDATE public.employee_availability SET earliest_start = '08:00:00', latest_end = '14:00:00' WHERE employee_id = marta_id;
  UPDATE public.employee_availability SET available = FALSE WHERE employee_id = aidel_id AND day_of_week = 6;  -- Aidel off Sundays

  -- Schedule weeks
  INSERT INTO public.schedule_weeks (id, department_id, week_start, status, published_at, created_by) VALUES
    (kitchen_pub_week,   kitchen_id, '2026-07-13', 'published', NOW() - INTERVAL '1 day', maria_id),
    (kitchen_draft_week, kitchen_id, '2026-07-20', 'draft', NULL, maria_id),
    (foh_pub_week,       foh_id,     '2026-07-13', 'published', NOW() - INTERVAL '1 day', maria_id);

  -- Kitchen shifts (published week)
  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes) VALUES
    (kitchen_pub_week, carla_id, '2026-07-13', '09:00:00', '15:00:00', 'Prep Cook', 'Opening duties'),
    (kitchen_pub_week, aidel_id, '2026-07-13', '10:00:00', '18:00:00', 'Line Cook', 'Kitchen prep'),
    (kitchen_pub_week, carla_id, '2026-07-16', '09:00:00', '17:00:00', 'Line Cook', 'Lunch rush'),
    (kitchen_pub_week, aidel_id, '2026-07-16', '09:00:00', '17:00:00', 'Shift Lead', 'Lead coverage');

  -- Front of House shifts (published week)
  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes) VALUES
    (foh_pub_week, amanda_id, '2026-07-14', '12:00:00', '18:00:00', 'Server', 'Front of house'),
    (foh_pub_week, marta_id,  '2026-07-14', '08:00:00', '14:00:00', 'Host', 'Morning register'),
    (foh_pub_week, luisa_id,  '2026-07-15', '14:00:00', '22:00:00', 'Closer', 'Closing and clean'),
    (foh_pub_week, luisa_id,  '2026-07-17', '15:00:00', '23:00:00', 'Server', 'Dinner shift');

  -- Kitchen draft week shift
  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes) VALUES
    (kitchen_draft_week, carla_id, '2026-07-20', '09:00:00', '16:00:00', 'Prep Cook', 'Draft schedule');

  -- Acknowledgments
  INSERT INTO public.schedule_acknowledgments (schedule_week_id, employee_id, acknowledged_at) VALUES
    (kitchen_pub_week, carla_id, NOW() - INTERVAL '12 hours'),
    (foh_pub_week, marta_id, NOW() - INTERVAL '8 hours');

  -- Time-off requests: one pending, one already approved
  INSERT INTO public.time_off_requests (employee_id, start_date, end_date, reason, status) VALUES
    (carla_id, '2026-07-24', '2026-07-26', 'Family trip', 'pending');
  INSERT INTO public.time_off_requests (employee_id, start_date, end_date, reason, status, reviewed_by, reviewed_at) VALUES
    (amanda_id, '2026-07-21', '2026-07-21', 'Medical appointment', 'approved', maria_id, NOW() - INTERVAL '2 days');

END $$;
