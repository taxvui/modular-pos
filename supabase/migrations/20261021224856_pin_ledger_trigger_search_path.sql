-- Keep trigger name resolution independent of the calling session.
ALTER FUNCTION public.tg_touch_updated_at_and_version() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_enforce_append_only_ledger() SET search_path = public, pg_temp;
