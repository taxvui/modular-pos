BEGIN;
CREATE TABLE public.order_transfer_requests (
 organization_id uuid NOT NULL,store_id uuid NOT NULL,operation_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.profiles(id),request_payload jsonb NOT NULL,response_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,store_id,operation_id),
 FOREIGN KEY(organization_id,store_id) REFERENCES public.stores(organization_id,id)
);
ALTER TABLE public.order_transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_transfer_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_transfer_requests FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.rpc_transfer_order(p_org_id uuid,p_store_id uuid,p_order_id uuid,p_expected_revision integer,
 p_position_id uuid,p_operation_id uuid,p_reason text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE req jsonb; prior public.order_transfer_requests%ROWTYPE; existing public.orders%ROWTYPE; result jsonb;
BEGIN
 IF NOT public.authorize_action(p_org_id,p_store_id,'pos.order.write','pos') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 IF p_operation_id IS NULL OR p_order_id IS NULL OR p_position_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 THEN RAISE EXCEPTION 'INVALID_TRANSFER'; END IF;
 IF length(trim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
 req:=jsonb_build_object('order_id',p_order_id,'revision',p_expected_revision,'position_id',p_position_id,'reason',trim(p_reason));
 -- Same lock as save, payment, void and offline sync: one store transaction at a time.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,1));
 SELECT * INTO prior FROM public.order_transfer_requests WHERE organization_id=p_org_id AND store_id=p_store_id AND operation_id=p_operation_id;
 IF FOUND THEN
  IF prior.actor_id<>auth.uid() OR prior.request_payload<>req THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
  RETURN prior.response_payload||jsonb_build_object('replayed',true);
 END IF;
 SELECT * INTO existing FROM public.orders WHERE id=p_order_id AND organization_id=p_org_id AND store_id=p_store_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
 IF existing.order_status<>'OPEN' THEN RAISE EXCEPTION 'ORDER_FINALIZED'; END IF;
 IF existing.revision<>p_expected_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF existing.channel<>'DINE_IN' THEN RAISE EXCEPTION 'DINE_IN_REQUIRED'; END IF;
 IF existing.position_id=p_position_id THEN RAISE EXCEPTION 'SAME_POSITION'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.service_positions WHERE id=p_position_id AND organization_id=p_org_id AND store_id=p_store_id AND active) THEN RAISE EXCEPTION 'POSITION_NOT_FOUND'; END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE organization_id=p_org_id AND store_id=p_store_id AND position_id=p_position_id AND order_status='OPEN') THEN RAISE EXCEPTION 'POSITION_OCCUPIED'; END IF;
 UPDATE public.orders SET position_id=p_position_id,revision=revision+1,updated_at=now() WHERE id=existing.id
  RETURNING jsonb_build_object('order_id',id,'revision',revision,'total_amount',total_amount,'status',order_status,'position_id',position_id,'previous_position_id',existing.position_id,'operation_id',p_operation_id) INTO result;
 INSERT INTO public.order_transfer_requests(organization_id,store_id,operation_id,actor_id,request_payload,response_payload)
  VALUES(p_org_id,p_store_id,p_operation_id,auth.uid(),req,result);
 INSERT INTO public.audit_logs(organization_id,store_id,actor_user_id,module_key,action_key,entity_type,entity_id,before_state,after_state)
  VALUES(p_org_id,p_store_id,auth.uid(),'pos','pos.order.transferred','order',existing.id::text,
   jsonb_build_object('position_id',existing.position_id,'revision',existing.revision,'total_amount',existing.total_amount),result||jsonb_build_object('reason',trim(p_reason)));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.rpc_transfer_order(uuid,uuid,uuid,integer,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_transfer_order(uuid,uuid,uuid,integer,uuid,uuid,text) TO authenticated;
COMMIT;
