BEGIN;
CREATE INDEX audit_logs_pos_entity_cursor ON public.audit_logs(store_id,entity_type,entity_id,created_at DESC,id DESC) WHERE module_key='pos';
CREATE FUNCTION public.rpc_order_events(p_org_id uuid,p_store_id uuid,p_order_id uuid,
 p_before_time timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE payment_id uuid; entries jsonb;
BEGIN
 IF NOT (public.authorize_action(p_org_id,p_store_id,'pos.order.write','pos') OR public.authorize_action(p_org_id,p_store_id,'pos.report.read','pos')) THEN
  RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id AND organization_id=p_org_id AND store_id=p_store_id) THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF (p_before_time IS NULL) IS DISTINCT FROM (p_before_id IS NULL) THEN RAISE EXCEPTION 'INVALID_EVENT_FILTER'; END IF;
 SELECT id INTO payment_id FROM public.payments WHERE order_id=p_order_id AND organization_id=p_org_id AND store_id=p_store_id;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC),'[]') INTO entries FROM
  (SELECT a.id,a.created_at,a.action_key AS action,a.actor_user_id AS actor_id,COALESCE(p.full_name,'Hệ thống') AS full_name,
    CASE WHEN a.action_key='pos.order.transferred' THEN a.after_state->>'reason' WHEN a.action_key IN ('pos.order.voided','pos.payment.refunded') THEN a.reason ELSE NULL END AS reason,
    CASE a.action_key
     WHEN 'pos.order.saved' THEN jsonb_build_object('revision',a.after_state->'revision','total_amount',a.after_state->'total_amount')
     WHEN 'pos.order.transferred' THEN jsonb_build_object('revision',a.after_state->'revision','total_amount',a.after_state->'total_amount',
      'from_position_id',a.before_state->'position_id','to_position_id',a.after_state->'position_id',
      'from_position_name',src.name,'to_position_name',dst.name)
     WHEN 'pos.payment.collected' THEN jsonb_build_object('payment_id',a.after_state->'id','shift_id',a.after_state->'shift_id','method',a.after_state->'method',
      'amount',a.after_state->'amount','received_amount',a.after_state->'received_amount','change_amount',a.after_state->'change_amount')
     WHEN 'pos.order.voided' THEN jsonb_build_object('revision',a.after_state->'revision','total_amount',a.after_state->'total_amount')
     WHEN 'pos.payment.refunded' THEN jsonb_build_object('refund_id',a.after_state->'id','payment_id',a.after_state->'payment_id','shift_id',a.after_state->'shift_id',
      'method',a.after_state->'method','amount',a.after_state->'amount') END AS details
   FROM public.audit_logs a LEFT JOIN public.profiles p ON p.id=a.actor_user_id
   LEFT JOIN public.service_positions src ON a.action_key='pos.order.transferred' AND src.id::text=a.before_state->>'position_id' AND src.organization_id=p_org_id AND src.store_id=p_store_id
   LEFT JOIN public.service_positions dst ON a.action_key='pos.order.transferred' AND dst.id::text=a.after_state->>'position_id' AND dst.organization_id=p_org_id AND dst.store_id=p_store_id
   WHERE a.organization_id=p_org_id AND a.store_id=p_store_id AND a.module_key='pos'
    AND ((a.entity_type='order' AND a.entity_id=p_order_id::text AND a.action_key IN ('pos.order.saved','pos.order.transferred','pos.payment.collected','pos.order.voided'))
     OR (a.entity_type='payment' AND a.entity_id=payment_id::text AND a.action_key='pos.payment.refunded'))
    AND (p_before_time IS NULL OR (a.created_at,a.id)<(p_before_time,p_before_id))
   ORDER BY a.created_at DESC,a.id DESC LIMIT 51) x;
 RETURN jsonb_build_object('order_id',p_order_id,'events',CASE WHEN jsonb_array_length(entries)>50 THEN entries-50 ELSE entries END,
  'next_cursor',CASE WHEN jsonb_array_length(entries)>50 THEN jsonb_build_object('time',entries->49->'created_at','id',entries->49->'id') ELSE NULL END,
  'timezone',(SELECT timezone FROM public.stores WHERE id=p_store_id),'read_at',now());
END $$;
REVOKE ALL ON FUNCTION public.rpc_order_events(uuid,uuid,uuid,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_order_events(uuid,uuid,uuid,timestamptz,uuid) TO authenticated;
COMMIT;
