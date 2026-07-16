-- Let admins (and managers, for their own employees) correct a staff account's
-- email, name, or password without deleting and recreating it. Email and
-- password live in auth.users, which the browser client cannot touch, so this
-- goes through a SECURITY DEFINER RPC. Also expose staff emails to the admin
-- console (via a scoped RPC) so typos are visible instead of hidden.

-- ---------------------------------------------------------------------------
-- Read: emails of staff the caller may manage.
CREATE OR REPLACE FUNCTION public.list_staff_emails()
RETURNS TABLE(id UUID, email TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN QUERY
      SELECT u.id, u.email::TEXT
      FROM auth.users u
      JOIN public.profiles p ON p.id = u.id;
  ELSIF public.is_manager() THEN
    RETURN QUERY
      SELECT u.id, u.email::TEXT
      FROM auth.users u
      JOIN public.profiles p ON p.id = u.id
      WHERE p.role = 'employee' AND public.manages_department(p.department_id);
  ELSE
    RAISE EXCEPTION 'Not authorized';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Write: update email, name, and optionally password.
--   * admins may edit anyone
--   * managers may edit only employees of departments they manage
--   * a blank/NULL password leaves the current password unchanged
CREATE OR REPLACE FUNCTION public.update_staff_account(
  p_user_id UUID,
  p_email TEXT,
  p_full_name TEXT,
  p_password TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target_role TEXT;
  target_dept UUID;
BEGIN
  SELECT role, department_id INTO target_role, target_dept
  FROM public.profiles WHERE id = p_user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  -- Authorization
  IF target_role IN ('admin', 'manager') THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admins can edit admin or manager accounts';
    END IF;
  ELSE -- employee
    IF NOT public.manages_department(target_dept) THEN
      RAISE EXCEPTION 'You can only edit employees of departments you manage';
    END IF;
  END IF;

  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION 'Email cannot be empty';
  END IF;
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Name cannot be empty';
  END IF;

  UPDATE auth.users
  SET email = btrim(p_email),
      updated_at = NOW(),
      encrypted_password = CASE
        WHEN p_password IS NOT NULL AND length(p_password) > 0
          THEN extensions.crypt(p_password, extensions.gen_salt('bf'))
        ELSE encrypted_password
      END
  WHERE id = p_user_id;

  UPDATE public.profiles
  SET full_name = btrim(p_full_name)
  WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_staff_emails() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.update_staff_account(UUID, TEXT, TEXT, TEXT) FROM anon, public;
