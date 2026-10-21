BEGIN;
-- A single statement snapshot keeps order revision and item snapshots consistent.
CREATE FUNCTION public.rpc_open_order(p_org_id uuid,p_store_id uuid,p_order_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ord public.orders%ROWTYPE; lines jsonb;
BEGIN
 IF NOT public.authorize_action(p_org_id,p_store_id,'pos.order.write','pos') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO ord FROM public.orders WHERE id=p_order_id AND organization_id=p_org_id AND store_id=p_store_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF ord.order_status<>'OPEN' THEN RAISE EXCEPTION 'ORDER_FINALIZED' USING ERRCODE='55000'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') INTO lines FROM
  (SELECT id,variant_id,product_name,variant_name,quantity,unit_amount,modifier_snapshot,line_amount FROM public.order_items
   WHERE order_id=ord.id AND organization_id=p_org_id AND store_id=p_store_id) x;
 RETURN jsonb_build_object('order',to_jsonb(ord),'items',lines,
  'position_name',(SELECT name FROM public.service_positions WHERE id=ord.position_id AND organization_id=p_org_id AND store_id=p_store_id));
END $$;
REVOKE ALL ON FUNCTION public.rpc_open_order(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_open_order(uuid,uuid,uuid) TO authenticated;
COMMIT;
