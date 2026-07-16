-- Managers need a way to fully remove an employee (not just deactivate).
-- Deleting the auth.users row cascades to profiles, which cascades to
-- employee_availability, shifts, and schedule_acknowledgments.
CREATE OR REPLACE FUNCTION public.delete_employee_account(p_employee_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_role TEXT;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Only managers can delete employee accounts';
  END IF;

  SELECT role INTO target_role FROM public.profiles WHERE id = p_employee_id;
  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
  IF target_role = 'manager' THEN
    RAISE EXCEPTION 'Manager accounts cannot be deleted from the app';
  END IF;

  DELETE FROM auth.users WHERE id = p_employee_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_employee_account(UUID) FROM anon, public;
