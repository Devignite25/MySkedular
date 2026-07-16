-- Supabase security advisor: SECURITY DEFINER functions should not be callable
-- by anon (or by authenticated, for trigger-only functions) via /rest/v1/rpc.
REVOKE EXECUTE ON FUNCTION public.create_employee_account(TEXT, TEXT, TEXT) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.copy_week_shifts(UUID, UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_manager() FROM anon, public;

-- Trigger functions are never called through the API.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.protect_profile_privileges() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.check_shift_validations() FROM anon, authenticated, public;
