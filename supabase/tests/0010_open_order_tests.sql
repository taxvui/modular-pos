BEGIN;
SELECT plan(3);
SELECT has_function('public','rpc_open_order',ARRAY['uuid','uuid','uuid'],'Open order snapshot RPC exists');
SELECT ok(NOT has_function_privilege('anon','public.rpc_open_order(uuid,uuid,uuid)','EXECUTE'),'Anonymous editing snapshot denied');
SELECT ok(has_function_privilege('authenticated','public.rpc_open_order(uuid,uuid,uuid)','EXECUTE'),'Authenticated snapshot requires live order-write permission');
SELECT * FROM finish();
ROLLBACK;
