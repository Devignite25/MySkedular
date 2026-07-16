-- Seed data for employee scheduling system

DO $$
DECLARE
  jorge_id UUID := gen_random_uuid();
  carla_id UUID := gen_random_uuid();
  aidel_id UUID := gen_random_uuid();
  amanda_id UUID := gen_random_uuid();
  marta_id UUID := gen_random_uuid();
  luisa_id UUID := gen_random_uuid();
  
  pub_week_id UUID := gen_random_uuid();
  draft_week_id UUID := gen_random_uuid();
  
  hashed_pw TEXT;
BEGIN
  -- Hash password123
  hashed_pw := extensions.crypt('password123', extensions.gen_salt('bf'));

  -- Clean existing seed data if any
  DELETE FROM auth.users WHERE email IN (
    'jorge@example.com', 'carla@example.com', 'aidel@example.com',
    'amanda@example.com', 'marta@example.com', 'luisa@example.com'
  );

  -- Insert users into auth.users
  -- Jorge (Manager)
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  VALUES (jorge_id, '00000000-0000-0000-0000-000000000000', 'jorge@example.com', hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Jorge","role":"manager"}', 'authenticated', 'authenticated', '', '', '', '', '', '', '', '');
  
  -- Carla (Employee)
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  VALUES (carla_id, '00000000-0000-0000-0000-000000000000', 'carla@example.com', hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Carla","role":"employee"}', 'authenticated', 'authenticated', '', '', '', '', '', '', '', '');

  -- Aidel
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  VALUES (aidel_id, '00000000-0000-0000-0000-000000000000', 'aidel@example.com', hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Aidel","role":"employee"}', 'authenticated', 'authenticated', '', '', '', '', '', '', '', '');

  -- Amanda
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  VALUES (amanda_id, '00000000-0000-0000-0000-000000000000', 'amanda@example.com', hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Amanda","role":"employee"}', 'authenticated', 'authenticated', '', '', '', '', '', '', '', '');

  -- Marta
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  VALUES (marta_id, '00000000-0000-0000-0000-000000000000', 'marta@example.com', hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Marta","role":"employee"}', 'authenticated', 'authenticated', '', '', '', '', '', '', '', '');

  -- Luisa
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  VALUES (luisa_id, '00000000-0000-0000-0000-000000000000', 'luisa@example.com', hashed_pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Luisa","role":"employee"}', 'authenticated', 'authenticated', '', '', '', '', '', '', '', '');

  -- Update profiles explicitly just to guarantee triggers align
  UPDATE public.profiles SET role = 'manager', full_name = 'Jorge' WHERE id = jorge_id;
  UPDATE public.profiles SET role = 'employee', full_name = 'Carla' WHERE id = carla_id;
  UPDATE public.profiles SET role = 'employee', full_name = 'Aidel' WHERE id = aidel_id;
  UPDATE public.profiles SET role = 'employee', full_name = 'Amanda' WHERE id = amanda_id;
  UPDATE public.profiles SET role = 'employee', full_name = 'Marta' WHERE id = marta_id;
  UPDATE public.profiles SET role = 'employee', full_name = 'Luisa' WHERE id = luisa_id;

  -- Set custom availability
  -- Carla unavailable on Wednesdays (day 2 = Wednesday)
  UPDATE public.employee_availability SET available = FALSE WHERE employee_id = carla_id AND day_of_week = 2;
  -- Marta only available 8am to 2pm
  UPDATE public.employee_availability SET earliest_start = '08:00:00', latest_end = '14:00:00' WHERE employee_id = marta_id;
  -- Aidel unavailable on Sundays (day 6 = Sunday)
  UPDATE public.employee_availability SET available = FALSE WHERE employee_id = aidel_id AND day_of_week = 6;

  -- Create schedule weeks
  INSERT INTO public.schedule_weeks (id, week_start, status, published_at, created_by)
  VALUES (pub_week_id, '2026-07-13', 'published', NOW() - INTERVAL '1 day', jorge_id);

  INSERT INTO public.schedule_weeks (id, week_start, status, published_at, created_by)
  VALUES (draft_week_id, '2026-07-20', 'draft', NULL, jorge_id);

  -- Insert shifts for published week (2026-07-13)
  -- Mon Jul 13: Carla (Opener, 09:00 - 15:00), Aidel (Cook, 10:00 - 18:00)
  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes)
  VALUES (pub_week_id, carla_id, '2026-07-13', '09:00:00', '15:00:00', 'Opener', 'Opening duties');
  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes)
  VALUES (pub_week_id, aidel_id, '2026-07-13', '10:00:00', '18:00:00', 'Cook', 'Kitchen prep');

  -- Tue Jul 14: Amanda (FOH, 12:00 - 18:00), Marta (Opener, 08:00 - 14:00)
  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes)
  VALUES (pub_week_id, amanda_id, '2026-07-14', '12:00:00', '18:00:00', 'FOH', 'Front of house');
  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes)
  VALUES (pub_week_id, marta_id, '2026-07-14', '08:00:00', '14:00:00', 'Opener', 'Morning register');

  -- Wed Jul 15: Luisa (Closer, 14:00 - 22:00)
  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes)
  VALUES (pub_week_id, luisa_id, '2026-07-15', '14:00:00', '22:00:00', 'Closer', 'Closing and clean');

  -- Thu Jul 16: Carla (FOH, 09:00 - 17:00), Aidel (Lead, 09:00 - 17:00)
  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes)
  VALUES (pub_week_id, carla_id, '2026-07-16', '09:00:00', '17:00:00', 'FOH', 'Lunch rush');
  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes)
  VALUES (pub_week_id, aidel_id, '2026-07-16', '09:00:00', '17:00:00', 'Lead', 'Shift lead coverage');

  -- Fri Jul 17: Luisa (Cook, 15:00 - 23:00)
  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes)
  VALUES (pub_week_id, luisa_id, '2026-07-17', '15:00:00', '23:00:00', 'Cook', 'Dinner shift');

  -- Insert acknowledgments
  INSERT INTO public.schedule_acknowledgments (schedule_week_id, employee_id, acknowledged_at)
  VALUES (pub_week_id, carla_id, NOW() - INTERVAL '12 hours');
  INSERT INTO public.schedule_acknowledgments (schedule_week_id, employee_id, acknowledged_at)
  VALUES (pub_week_id, marta_id, NOW() - INTERVAL '8 hours');

  -- Insert shifts for draft week (2026-07-20)
  -- Mon Jul 20: Carla (Opener, 09:00 - 16:00)
  INSERT INTO public.shifts (schedule_week_id, employee_id, shift_date, start_time, end_time, position, notes)
  VALUES (draft_week_id, carla_id, '2026-07-20', '09:00:00', '16:00:00', 'Opener', 'Draft schedule');

END $$;
