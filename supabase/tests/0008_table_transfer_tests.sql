BEGIN;
SELECT plan(4);
SELECT has_function('public','rpc_transfer_order',ARRAY['uuid','uuid','uuid','integer','uuid','uuid','text'],'Table transfer RPC exists');
SELECT ok(NOT has_function_privilege('anon','public.rpc_transfer_order(uuid,uuid,uuid,integer,uuid,uuid,text)','EXECUTE'),'Anonymous transfers denied');
SELECT ok(has_function_privilege('authenticated','public.rpc_transfer_order(uuid,uuid,uuid,integer,uuid,uuid,text)','EXECUTE'),'Authenticated transfer uses live scoped authorization');
SELECT ok(NOT has_table_privilege('authenticated','public.order_transfer_requests','SELECT,INSERT,UPDATE,DELETE'),'Transfer receipts private');
SELECT * FROM finish();
ROLLBACK;
