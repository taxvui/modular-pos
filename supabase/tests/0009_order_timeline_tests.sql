BEGIN;
SELECT plan(3);
SELECT has_function('public','rpc_order_events',ARRAY['uuid','uuid','uuid','timestamp with time zone','uuid'],'Order timeline RPC exists');
SELECT ok(NOT has_function_privilege('anon','public.rpc_order_events(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE'),'Anonymous timeline reads denied');
SELECT ok(has_function_privilege('authenticated','public.rpc_order_events(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE'),'Authenticated timeline uses scoped authorization');
SELECT * FROM finish();
ROLLBACK;
