BEGIN;
SELECT plan(4);
SELECT has_function('public','rpc_order_history',ARRAY['uuid','uuid','date','date','text','text','timestamp with time zone','uuid'],'History RPC exists');
SELECT has_function('public','rpc_order_receipt',ARRAY['uuid','uuid','uuid'],'Receipt RPC exists');
SELECT ok(NOT has_function_privilege('anon','public.rpc_order_receipt(uuid,uuid,uuid)','EXECUTE'),'Anonymous receipt read denied');
SELECT ok(has_function_privilege('authenticated','public.rpc_order_history(uuid,uuid,date,date,text,text,timestamptz,uuid)','EXECUTE'),'Authenticated history still requires scoped RPC authorization');
SELECT * FROM finish();
ROLLBACK;
