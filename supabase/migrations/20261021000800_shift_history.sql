BEGIN;
CREATE INDEX cash_shifts_store_opened_cursor ON public.cash_shifts(store_id,opened_at DESC,id DESC);
CREATE INDEX payments_shift_created_cursor ON public.payments(shift_id,created_at DESC,id DESC);
CREATE INDEX refunds_shift_created_cursor ON public.refunds(shift_id,created_at DESC,id DESC);
CREATE FUNCTION public.shift_history_access(p_org_id uuid,p_store_id uuid,p_shift_id uuid) RETURNS public.cash_shifts
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE shift public.cash_shifts%ROWTYPE; manager boolean;
BEGIN
 manager:=public.authorize_action(p_org_id,p_store_id,'pos.report.read','pos');
 IF NOT manager AND NOT public.authorize_action(p_org_id,p_store_id,'pos.shift.manage','pos') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO shift FROM public.cash_shifts WHERE id=p_shift_id AND organization_id=p_org_id AND store_id=p_store_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF NOT manager AND shift.opened_by<>auth.uid() THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 RETURN shift;
END $$;
CREATE FUNCTION public.rpc_shift_history(p_org_id uuid,p_store_id uuid,p_from date DEFAULT NULL,p_to date DEFAULT NULL,
 p_status text DEFAULT 'ALL',p_before_time timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE manager boolean; zone text; first_day date; last_day date; entries jsonb;
BEGIN
 manager:=public.authorize_action(p_org_id,p_store_id,'pos.report.read','pos');
 IF NOT manager AND NOT public.authorize_action(p_org_id,p_store_id,'pos.shift.manage','pos') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT timezone INTO zone FROM public.stores WHERE id=p_store_id AND organization_id=p_org_id;
 last_day:=COALESCE(p_to,(now() AT TIME ZONE zone)::date);first_day:=COALESCE(p_from,last_day-6);
 IF first_day>last_day OR last_day-first_day>92 OR p_status IS NULL OR p_status NOT IN ('ALL','OPEN','CLOSED') OR
  ((p_before_time IS NULL) IS DISTINCT FROM (p_before_id IS NULL)) THEN RAISE EXCEPTION 'INVALID_SHIFT_FILTER'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.opened_at DESC,x.id DESC),'[]') INTO entries FROM
  (SELECT s.id,s.opened_by,p.full_name,s.opening_amount,s.opened_at,s.closed_at,s.expected_cash,s.counted_cash,s.difference
   FROM public.cash_shifts s JOIN public.profiles p ON p.id=s.opened_by
   WHERE s.organization_id=p_org_id AND s.store_id=p_store_id AND (manager OR s.opened_by=auth.uid())
    AND s.opened_at>=(first_day::timestamp AT TIME ZONE zone) AND s.opened_at<((last_day+1)::timestamp AT TIME ZONE zone)
    AND (p_status='ALL' OR (p_status='OPEN' AND s.closed_at IS NULL) OR (p_status='CLOSED' AND s.closed_at IS NOT NULL))
    AND (p_before_time IS NULL OR (s.opened_at,s.id)<(p_before_time,p_before_id)) ORDER BY s.opened_at DESC,s.id DESC LIMIT 51) x;
 RETURN jsonb_build_object('shifts',CASE WHEN jsonb_array_length(entries)>50 THEN entries-50 ELSE entries END,
  'next_cursor',CASE WHEN jsonb_array_length(entries)>50 THEN jsonb_build_object('time',entries->49->'opened_at','id',entries->49->'id') ELSE NULL END,
  'from_date',first_day,'to_date',last_day,'timezone',zone,'scope',CASE WHEN manager THEN 'STORE' ELSE 'OWN' END);
END $$;
CREATE FUNCTION public.rpc_shift_summary(p_org_id uuid,p_store_id uuid,p_shift_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE shift public.cash_shifts%ROWTYPE; cash_sales bigint; transfers bigint; cash_refunds bigint; transfer_refunds bigint;
 payment_count bigint; refund_count bigint; received bigint; change_given bigint;
BEGIN
 shift:=public.shift_history_access(p_org_id,p_store_id,p_shift_id);
 SELECT count(*),COALESCE(sum(amount) FILTER(WHERE method='CASH'),0),COALESCE(sum(amount) FILTER(WHERE method='TRANSFER'),0),
  COALESCE(sum(received_amount) FILTER(WHERE method='CASH'),0),COALESCE(sum(change_amount) FILTER(WHERE method='CASH'),0)
  INTO payment_count,cash_sales,transfers,received,change_given FROM public.payments WHERE shift_id=shift.id AND store_id=p_store_id;
 SELECT count(*),COALESCE(sum(amount) FILTER(WHERE method='CASH'),0),COALESCE(sum(amount) FILTER(WHERE method='TRANSFER'),0)
  INTO refund_count,cash_refunds,transfer_refunds FROM public.refunds WHERE shift_id=shift.id AND store_id=p_store_id;
 RETURN jsonb_build_object('shift',to_jsonb(shift),'full_name',(SELECT full_name FROM public.profiles WHERE id=shift.opened_by),
  'timezone',(SELECT timezone FROM public.stores WHERE id=p_store_id),'read_at',now(),
  'totals',jsonb_build_object('payment_count',payment_count,'refund_count',refund_count,'cash_sales',cash_sales,'transfer_sales',transfers,
   'cash_refunds',cash_refunds,'transfer_refunds',transfer_refunds,'cash_received',received,'change_given',change_given,
   'expected_cash',shift.opening_amount+cash_sales-cash_refunds,'net_collections',cash_sales+transfers-cash_refunds-transfer_refunds));
END $$;
CREATE FUNCTION public.rpc_shift_transactions(p_org_id uuid,p_store_id uuid,p_shift_id uuid,p_before_time timestamptz DEFAULT NULL,
 p_before_kind text DEFAULT NULL,p_before_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE shift public.cash_shifts%ROWTYPE; entries jsonb;
BEGIN
 shift:=public.shift_history_access(p_org_id,p_store_id,p_shift_id);
 IF num_nonnulls(p_before_time,p_before_kind,p_before_id) NOT IN (0,3) OR
  (p_before_kind IS NOT NULL AND p_before_kind NOT IN ('PAYMENT','REFUND')) THEN RAISE EXCEPTION 'INVALID_SHIFT_FILTER'; END IF;
 WITH events AS (
  SELECT p.id,'PAYMENT'::text AS kind,p.created_at,p.order_id,p.id AS payment_id,p.method,p.amount,p.received_amount,p.change_amount,NULL::text AS reason,p.actor_id
   FROM public.payments p WHERE p.shift_id=shift.id AND p.store_id=p_store_id
  UNION ALL
  SELECT r.id,'REFUND'::text,r.created_at,p.order_id,r.payment_id,r.method,r.amount,NULL::bigint,NULL::bigint,r.reason,r.actor_id
   FROM public.refunds r JOIN public.payments p ON p.id=r.payment_id AND p.store_id=r.store_id WHERE r.shift_id=shift.id AND r.store_id=p_store_id
 ) SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.kind DESC,x.id DESC),'[]') INTO entries FROM
  (SELECT e.*,p.full_name FROM events e JOIN public.profiles p ON p.id=e.actor_id
   WHERE p_before_time IS NULL OR (e.created_at,e.kind,e.id)<(p_before_time,p_before_kind,p_before_id)
   ORDER BY e.created_at DESC,e.kind DESC,e.id DESC LIMIT 51) x;
 RETURN jsonb_build_object('shift_id',shift.id,'transactions',CASE WHEN jsonb_array_length(entries)>50 THEN entries-50 ELSE entries END,
  'next_cursor',CASE WHEN jsonb_array_length(entries)>50 THEN jsonb_build_object('time',entries->49->'created_at','kind',entries->49->'kind','id',entries->49->'id') ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.shift_history_access(uuid,uuid,uuid),public.rpc_shift_history(uuid,uuid,date,date,text,timestamptz,uuid),
 public.rpc_shift_summary(uuid,uuid,uuid),public.rpc_shift_transactions(uuid,uuid,uuid,timestamptz,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_shift_history(uuid,uuid,date,date,text,timestamptz,uuid),public.rpc_shift_summary(uuid,uuid,uuid),
 public.rpc_shift_transactions(uuid,uuid,uuid,timestamptz,text,uuid) TO authenticated;
COMMIT;
