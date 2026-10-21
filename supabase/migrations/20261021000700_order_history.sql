BEGIN;
CREATE INDEX orders_store_created_cursor ON public.orders(store_id,created_at DESC,id DESC);
CREATE FUNCTION public.rpc_order_history(p_org_id uuid,p_store_id uuid,p_from date DEFAULT NULL,p_to date DEFAULT NULL,
 p_status text DEFAULT 'ALL',p_search text DEFAULT '',p_before_time timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE zone text; first_day date; last_day date; start_at timestamptz; end_at timestamptz; entries jsonb; term text;
BEGIN
 IF NOT (public.authorize_action(p_org_id,p_store_id,'pos.order.write','pos') OR public.authorize_action(p_org_id,p_store_id,'pos.report.read','pos')) THEN
  RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT timezone INTO zone FROM public.stores WHERE id=p_store_id AND organization_id=p_org_id;
 last_day:=COALESCE(p_to,(now() AT TIME ZONE zone)::date);first_day:=COALESCE(p_from,last_day-6);term:=trim(COALESCE(p_search,''));
 IF first_day>last_day OR last_day-first_day>92 OR p_status IS NULL OR p_status NOT IN ('ALL','OPEN','PAID','VOID','REFUNDED') OR length(term)>100 OR
  ((p_before_time IS NULL) IS DISTINCT FROM (p_before_id IS NULL)) THEN RAISE EXCEPTION 'INVALID_HISTORY_FILTER'; END IF;
 start_at:=first_day::timestamp AT TIME ZONE zone;end_at:=(last_day+1)::timestamp AT TIME ZONE zone;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC),'[]') INTO entries FROM
  (SELECT o.id,o.channel,o.order_status,o.total_amount,o.created_at,o.revision,o.customer,
    p.id AS payment_id,p.method AS payment_method,p.amount AS paid_amount,r.id AS refund_id,r.amount AS refund_amount
   FROM public.orders o LEFT JOIN public.payments p ON p.order_id=o.id AND p.store_id=o.store_id
   LEFT JOIN public.refunds r ON r.payment_id=p.id AND r.store_id=o.store_id
   WHERE o.organization_id=p_org_id AND o.store_id=p_store_id AND o.created_at>=start_at AND o.created_at<end_at
    AND (p_status='ALL' OR o.order_status=p_status OR (p_status='PAID' AND o.order_status='REFUNDED') OR (p_status='REFUNDED' AND r.id IS NOT NULL))
    AND (term='' OR position(lower(term) IN lower(o.id::text))=1 OR position(lower(term) IN lower(COALESCE(o.customer->>'name','')))>0 OR position(term IN COALESCE(o.customer->>'phone',''))>0)
    AND (p_before_time IS NULL OR (o.created_at,o.id)<(p_before_time,p_before_id))
   ORDER BY o.created_at DESC,o.id DESC LIMIT 51) x;
 RETURN jsonb_build_object('orders',CASE WHEN jsonb_array_length(entries)>50 THEN entries-50 ELSE entries END,
  'next_cursor',CASE WHEN jsonb_array_length(entries)>50 THEN jsonb_build_object('time',entries->49->'created_at','id',entries->49->'id') ELSE NULL END,
  'from_date',first_day,'to_date',last_day,'timezone',zone);
END $$;
CREATE FUNCTION public.rpc_order_receipt(p_org_id uuid,p_store_id uuid,p_order_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ord public.orders%ROWTYPE; lines jsonb; payment jsonb; refund jsonb; position_name text;
BEGIN
 IF NOT (public.authorize_action(p_org_id,p_store_id,'pos.order.write','pos') OR public.authorize_action(p_org_id,p_store_id,'pos.report.read','pos')) THEN
  RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO ord FROM public.orders WHERE id=p_order_id AND organization_id=p_org_id AND store_id=p_store_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') INTO lines FROM
  (SELECT id,product_name,variant_name,quantity,unit_amount,modifier_snapshot,line_amount FROM public.order_items WHERE order_id=ord.id AND store_id=p_store_id) x;
 SELECT jsonb_build_object('id',p.id,'method',p.method,'amount',p.amount,'received_amount',p.received_amount,'change_amount',p.change_amount,'created_at',p.created_at)
  INTO payment FROM public.payments p WHERE p.order_id=ord.id AND p.store_id=p_store_id;
 SELECT jsonb_build_object('id',r.id,'method',r.method,'amount',r.amount,'reason',r.reason,'created_at',r.created_at)
  INTO refund FROM public.refunds r JOIN public.payments p ON p.id=r.payment_id WHERE p.order_id=ord.id AND r.store_id=p_store_id;
 SELECT name INTO position_name FROM public.service_positions WHERE id=ord.position_id AND store_id=p_store_id;
 RETURN jsonb_build_object('order',to_jsonb(ord),'items',lines,'payment',payment,'refund',refund,'position_name',position_name,
  'void_reason',(SELECT reason FROM public.audit_logs WHERE organization_id=p_org_id AND store_id=p_store_id AND entity_id=ord.id::text AND action_key='pos.order.voided' ORDER BY created_at DESC,id DESC LIMIT 1),
  'timezone',(SELECT timezone FROM public.stores WHERE id=p_store_id));
END $$;
REVOKE ALL ON FUNCTION public.rpc_order_history(uuid,uuid,date,date,text,text,timestamptz,uuid),public.rpc_order_receipt(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_order_history(uuid,uuid,date,date,text,text,timestamptz,uuid),public.rpc_order_receipt(uuid,uuid,uuid) TO authenticated;
COMMIT;
