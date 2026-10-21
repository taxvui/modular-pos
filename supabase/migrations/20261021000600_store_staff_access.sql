BEGIN;
INSERT INTO public.permissions(permission_key,module_key,name,description,is_sensitive)
 VALUES('pos.staff.manage','pos','Quản lý nhân viên cửa hàng','Mời, đổi quyền và ngừng quyền nhân viên theo cửa hàng',true)
 ON CONFLICT(permission_key) DO NOTHING;
CREATE TABLE public.store_staff (
 organization_id uuid NOT NULL,store_id uuid NOT NULL,user_id uuid NOT NULL,
 role_code text NOT NULL CHECK(role_code IN ('CASHIER','MANAGER')),active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),updated_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,store_id,user_id),
 FOREIGN KEY(organization_id,store_id) REFERENCES public.stores(organization_id,id),
 FOREIGN KEY(organization_id,user_id) REFERENCES public.memberships(organization_id,user_id)
);
CREATE TABLE public.staff_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,store_id uuid NOT NULL,
 email text NOT NULL,role_code text NOT NULL CHECK(role_code IN ('CASHIER','MANAGER')),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),operation_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACCEPTED','REVOKED','EXPIRED')),
 accepted_by uuid REFERENCES public.profiles(id),accepted_at timestamptz,revoked_by uuid REFERENCES public.profiles(id),revoked_at timestamptz,
 UNIQUE(organization_id,store_id,operation_id),FOREIGN KEY(organization_id,store_id) REFERENCES public.stores(organization_id,id)
);
CREATE UNIQUE INDEX staff_invitation_one_open ON public.staff_invitations(organization_id,store_id,email) WHERE status='OPEN';
CREATE TABLE public.staff_access_requests (
 organization_id uuid NOT NULL,store_id uuid NOT NULL,operation_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.profiles(id),
 payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,store_id,operation_id),FOREIGN KEY(organization_id,store_id) REFERENCES public.stores(organization_id,id)
);
CREATE TRIGGER staff_access_requests_immutable BEFORE UPDATE OR DELETE ON public.staff_access_requests
 FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_append_only_ledger();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['store_staff','staff_invitations','staff_access_requests'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
 END LOOP;
END $$;
CREATE FUNCTION public.staff_inviter_authorized(p_org uuid,p_store uuid,p_actor uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.memberships m
  JOIN public.profiles p ON p.id=m.user_id AND p.status='ACTIVE'
  JOIN public.organizations o ON o.id=m.organization_id AND o.status='ACTIVE'
  JOIN public.stores s ON s.organization_id=o.id AND s.id=p_store AND s.status='ACTIVE'
  JOIN public.user_roles ur ON ur.organization_id=m.organization_id AND ur.membership_id=m.id
  JOIN public.roles r ON r.organization_id=m.organization_id AND r.id=ur.role_id
  WHERE m.organization_id=p_org AND m.user_id=p_actor AND m.status='ACTIVE'
   AND (ur.store_id=p_store OR (ur.store_id IS NULL AND m.scope_type='ORG_WIDE' AND r.scope_level='ORG_WIDE'))
   AND (r.code='OWNER' OR EXISTS(SELECT 1 FROM public.role_permissions rp JOIN public.permissions perm ON perm.id=rp.permission_id
    WHERE rp.organization_id=p_org AND rp.role_id=r.id AND perm.permission_key='pos.staff.manage' AND perm.module_key='pos')));
$$;
CREATE FUNCTION public.staff_role_id(p_org uuid,p_role text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE expected text[]; actual text[]; role public.roles%ROWTYPE; preset_code text;
BEGIN
 IF p_role NOT IN ('CASHIER','MANAGER') OR p_role IS NULL THEN RAISE EXCEPTION 'INVALID_STAFF_ROLE'; END IF;
 expected:=ARRAY['pos.order.write','pos.payment.collect','pos.shift.manage'];
 IF p_role='MANAGER' THEN expected:=expected||ARRAY['catalog.manage','pos.order.void','pos.order.refund','pos.report.read','pos.offline.resolve']; END IF;
 SELECT array_agg(x ORDER BY x) INTO expected FROM unnest(expected) AS x;
 preset_code:='POS_STAFF_'||p_role;
 SELECT * INTO role FROM public.roles r WHERE r.organization_id=p_org AND r.code=preset_code;
 IF FOUND THEN
  SELECT array_agg(p.permission_key::text ORDER BY p.permission_key::text) INTO actual FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id WHERE rp.role_id=role.id;
  IF NOT role.is_system_role OR role.scope_level<>'STORE_SPECIFIC' OR actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'STAFF_ROLE_CONFIGURATION_INVALID'; END IF;
 ELSE
  INSERT INTO public.roles(organization_id,code,name,is_system_role,scope_level)
   VALUES(p_org,preset_code,CASE WHEN p_role='CASHIER' THEN 'Thu ngân' ELSE 'Quản lý cửa hàng' END,true,'STORE_SPECIFIC') RETURNING * INTO role;
  INSERT INTO public.role_permissions(organization_id,role_id,permission_id) SELECT p_org,role.id,id FROM public.permissions WHERE permission_key=ANY(expected);
  IF (SELECT count(*) FROM public.role_permissions WHERE role_id=role.id)<>cardinality(expected) THEN RAISE EXCEPTION 'STAFF_ROLE_CONFIGURATION_INVALID'; END IF;
 END IF;
 RETURN role.id;
END $$;
CREATE FUNCTION public.staff_target_allowed(p_org uuid,p_store uuid,p_user uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE member public.memberships%ROWTYPE;
BEGIN
 IF EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND owner_user_id=p_user) OR
  EXISTS(SELECT 1 FROM public.memberships m JOIN public.user_roles ur ON ur.membership_id=m.id AND ur.organization_id=m.organization_id
   JOIN public.roles r ON r.id=ur.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id=p_user AND r.code='OWNER') THEN
  RAISE EXCEPTION 'OWNER_ACCESS_PROTECTED'; END IF;
 SELECT * INTO member FROM public.memberships WHERE organization_id=p_org AND user_id=p_user;
 IF NOT FOUND THEN RETURN; END IF;
 IF member.status<>'ACTIVE' THEN RAISE EXCEPTION 'MEMBERSHIP_INACTIVE'; END IF;
 IF member.scope_type<>'STORE_SPECIFIC' THEN RAISE EXCEPTION 'STAFF_ACCESS_MANAGED_ELSEWHERE'; END IF;
 IF EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
  WHERE ur.organization_id=p_org AND ur.membership_id=member.id AND
   (ur.store_id IS NULL OR (ur.store_id=p_store AND r.code NOT IN ('POS_STAFF_CASHIER','POS_STAFF_MANAGER')))) THEN
  RAISE EXCEPTION 'STAFF_ACCESS_MANAGED_ELSEWHERE'; END IF;
END $$;
CREATE FUNCTION public.rpc_create_staff_invitation(p_org_id uuid,p_store_id uuid,p_operation_id uuid,p_email text,p_role text,p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE invitation public.staff_invitations%ROWTYPE; normalized text; verifier text;
BEGIN
 IF NOT public.authorize_action(p_org_id,p_store_id,'pos.staff.manage','pos') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 IF p_operation_id IS NULL THEN RAISE EXCEPTION 'OPERATION_REQUIRED'; END IF;
 normalized:=lower(trim(p_email));
 IF normalized IS NULL OR length(normalized)>254 OR normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'INVALID_INVITATION_EMAIL'; END IF;
 IF p_role IS NULL OR p_role NOT IN ('CASHIER','MANAGER') THEN RAISE EXCEPTION 'INVALID_STAFF_ROLE'; END IF;
 IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43,128}$' THEN RAISE EXCEPTION 'INVALID_INVITATION_TOKEN'; END IF;
 verifier:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text,2));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,1));
 IF NOT public.authorize_action(p_org_id,p_store_id,'pos.staff.manage','pos') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO invitation FROM public.staff_invitations WHERE organization_id=p_org_id AND store_id=p_store_id AND operation_id=p_operation_id;
 IF FOUND THEN
  IF invitation.created_by<>auth.uid() OR invitation.email<>normalized OR invitation.role_code<>p_role OR invitation.token_hash<>verifier THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
  RETURN to_jsonb(invitation)-'token_hash';
 END IF;
 IF EXISTS(SELECT 1 FROM public.store_staff staff JOIN auth.users u ON u.id=staff.user_id WHERE staff.organization_id=p_org_id AND staff.store_id=p_store_id AND staff.active AND lower(u.email)=normalized) THEN RAISE EXCEPTION 'STAFF_ALREADY_ACTIVE'; END IF;
 UPDATE public.staff_invitations SET status='EXPIRED' WHERE organization_id=p_org_id AND store_id=p_store_id AND status='OPEN' AND expires_at<=now();
 IF EXISTS(SELECT 1 FROM public.staff_invitations WHERE organization_id=p_org_id AND store_id=p_store_id AND email=normalized AND status='OPEN') THEN RAISE EXCEPTION 'INVITATION_ALREADY_OPEN'; END IF;
 INSERT INTO public.staff_invitations(organization_id,store_id,email,role_code,token_hash,operation_id,created_by)
  VALUES(p_org_id,p_store_id,normalized,p_role,verifier,p_operation_id,auth.uid()) RETURNING * INTO invitation;
 INSERT INTO public.audit_logs(organization_id,store_id,actor_user_id,module_key,action_key,entity_type,entity_id,after_state)
  VALUES(p_org_id,p_store_id,auth.uid(),'pos','pos.staff.invited','staff_invitation',invitation.id::text,jsonb_build_object('email',normalized,'role',p_role,'expires_at',invitation.expires_at));
 RETURN to_jsonb(invitation)-'token_hash';
END $$;
CREATE FUNCTION public.rpc_accept_staff_invitation(p_token text,p_full_name text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE invitation public.staff_invitations%ROWTYPE; actor uuid:=auth.uid(); actor_email text; confirmed timestamptz;
 member public.memberships%ROWTYPE; role_id uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT lower(email),email_confirmed_at INTO actor_email,confirmed FROM auth.users WHERE id=actor;
 IF confirmed IS NULL OR actor_email IS NULL THEN RAISE EXCEPTION 'EMAIL_VERIFICATION_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND status<>'ACTIVE') THEN RAISE EXCEPTION 'ACCOUNT_DISABLED'; END IF;
 IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43,128}$' THEN RAISE EXCEPTION 'INVITATION_INVALID'; END IF;
 SELECT * INTO invitation FROM public.staff_invitations WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(invitation.organization_id::text,2));
 PERFORM pg_advisory_xact_lock(hashtextextended(invitation.store_id::text,1));
 SELECT * INTO invitation FROM public.staff_invitations WHERE id=invitation.id FOR UPDATE;
 IF invitation.status='ACCEPTED' AND invitation.accepted_by=actor THEN
  RETURN jsonb_build_object('organization_id',invitation.organization_id,'store_id',invitation.store_id,'invitation_id',invitation.id,'status','ACCEPTED'); END IF;
 IF invitation.status<>'OPEN' OR invitation.expires_at<=now() OR invitation.email<>actor_email OR
  NOT public.staff_inviter_authorized(invitation.organization_id,invitation.store_id,invitation.created_by) THEN RAISE EXCEPTION 'INVITATION_INVALID'; END IF;
 IF p_full_name IS NULL OR length(trim(p_full_name)) NOT BETWEEN 2 AND 150 THEN RAISE EXCEPTION 'INVALID_STAFF_NAME'; END IF;
 IF EXISTS(SELECT 1 FROM public.store_staff WHERE organization_id=invitation.organization_id AND store_id=invitation.store_id AND user_id=actor AND active) THEN RAISE EXCEPTION 'STAFF_ALREADY_ACTIVE'; END IF;
 PERFORM public.staff_target_allowed(invitation.organization_id,invitation.store_id,actor);
 role_id:=public.staff_role_id(invitation.organization_id,invitation.role_code);
 INSERT INTO public.profiles(id,email,full_name) VALUES(actor,actor_email,trim(p_full_name)) ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.memberships(organization_id,user_id,scope_type,invited_by) VALUES(invitation.organization_id,actor,'STORE_SPECIFIC',invitation.created_by)
  ON CONFLICT(organization_id,user_id) DO NOTHING;
 SELECT * INTO member FROM public.memberships WHERE organization_id=invitation.organization_id AND user_id=actor;
 DELETE FROM public.user_roles ur USING public.roles r WHERE ur.role_id=r.id AND ur.organization_id=invitation.organization_id AND ur.membership_id=member.id AND ur.store_id=invitation.store_id AND r.code IN ('POS_STAFF_CASHIER','POS_STAFF_MANAGER');
 INSERT INTO public.user_roles(organization_id,membership_id,role_id,store_id,assigned_by)
  VALUES(invitation.organization_id,member.id,role_id,invitation.store_id,invitation.created_by);
 INSERT INTO public.store_staff(organization_id,store_id,user_id,role_code,updated_by)
  VALUES(invitation.organization_id,invitation.store_id,actor,invitation.role_code,invitation.created_by)
  ON CONFLICT(organization_id,store_id,user_id) DO UPDATE SET role_code=EXCLUDED.role_code,active=true,revision=store_staff.revision+1,updated_by=EXCLUDED.updated_by,updated_at=now();
 UPDATE public.staff_invitations SET status='ACCEPTED',accepted_by=actor,accepted_at=now() WHERE id=invitation.id;
 INSERT INTO public.audit_logs(organization_id,store_id,actor_user_id,module_key,action_key,entity_type,entity_id,after_state)
  VALUES(invitation.organization_id,invitation.store_id,actor,'pos','pos.staff.joined','staff',actor::text,jsonb_build_object('role',invitation.role_code,'invitation_id',invitation.id));
 RETURN jsonb_build_object('organization_id',invitation.organization_id,'store_id',invitation.store_id,'invitation_id',invitation.id,'status','ACCEPTED');
END $$;
CREATE FUNCTION public.rpc_revoke_staff_invitation(p_org_id uuid,p_store_id uuid,p_invitation_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE invitation public.staff_invitations%ROWTYPE;
BEGIN
 IF NOT public.authorize_action(p_org_id,p_store_id,'pos.staff.manage','pos') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text,2));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,1));
 IF NOT public.authorize_action(p_org_id,p_store_id,'pos.staff.manage','pos') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO invitation FROM public.staff_invitations WHERE id=p_invitation_id AND organization_id=p_org_id AND store_id=p_store_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_INVALID'; END IF;
 IF invitation.status='REVOKED' THEN RETURN to_jsonb(invitation)-'token_hash'; END IF;
 IF invitation.status='ACCEPTED' THEN RAISE EXCEPTION 'INVITATION_ALREADY_USED'; END IF;
 UPDATE public.staff_invitations SET status='REVOKED',revoked_by=auth.uid(),revoked_at=now() WHERE id=invitation.id RETURNING * INTO invitation;
 INSERT INTO public.audit_logs(organization_id,store_id,actor_user_id,module_key,action_key,entity_type,entity_id,after_state)
  VALUES(p_org_id,p_store_id,auth.uid(),'pos','pos.staff.invitation_revoked','staff_invitation',invitation.id::text,jsonb_build_object('email',invitation.email));
 RETURN to_jsonb(invitation)-'token_hash';
END $$;
CREATE FUNCTION public.rpc_set_store_staff(p_org_id uuid,p_store_id uuid,p_operation_id uuid,p_user_id uuid,p_role text,p_active boolean,p_expected_revision integer,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous public.staff_access_requests%ROWTYPE; staff public.store_staff%ROWTYPE; member_id uuid; role_id uuid; req jsonb; response jsonb;
BEGIN
 IF NOT public.authorize_action(p_org_id,p_store_id,'pos.staff.manage','pos') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 IF p_operation_id IS NULL OR p_active IS NULL OR p_expected_revision IS NULL THEN RAISE EXCEPTION 'INVALID_STAFF_REQUEST'; END IF;
 IF p_role IS NULL OR p_role NOT IN ('CASHIER','MANAGER') THEN RAISE EXCEPTION 'INVALID_STAFF_ROLE'; END IF;
 IF p_user_id=auth.uid() THEN RAISE EXCEPTION 'SELF_ACCESS_PROTECTED'; END IF;
 IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
 req:=jsonb_build_object('user',p_user_id,'role',p_role,'active',p_active,'revision',p_expected_revision,'reason',trim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text,2));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,1));
 IF NOT public.authorize_action(p_org_id,p_store_id,'pos.staff.manage','pos') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM public.staff_access_requests WHERE organization_id=p_org_id AND store_id=p_store_id AND operation_id=p_operation_id;
 IF FOUND THEN
  IF previous.actor_id<>auth.uid() OR previous.payload<>req THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
  RETURN previous.result;
 END IF;
 PERFORM public.staff_target_allowed(p_org_id,p_store_id,p_user_id);
 SELECT * INTO staff FROM public.store_staff WHERE organization_id=p_org_id AND store_id=p_store_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_NOT_FOUND'; END IF;
 IF staff.revision<>p_expected_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF p_active AND EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND status<>'ACTIVE') THEN RAISE EXCEPTION 'ACCOUNT_DISABLED'; END IF;
 IF NOT p_active AND (EXISTS(SELECT 1 FROM public.cash_shifts WHERE store_id=p_store_id AND opened_by=p_user_id AND closed_at IS NULL) OR
  EXISTS(SELECT 1 FROM public.offline_sale_reviews WHERE store_id=p_store_id AND actor_id=p_user_id AND status='OPEN')) THEN RAISE EXCEPTION 'STAFF_HAS_OPEN_WORK'; END IF;
 role_id:=public.staff_role_id(p_org_id,p_role);
 SELECT id INTO member_id FROM public.memberships WHERE organization_id=p_org_id AND user_id=p_user_id;
 DELETE FROM public.user_roles ur USING public.roles r WHERE ur.role_id=r.id AND ur.organization_id=p_org_id AND ur.membership_id=member_id AND ur.store_id=p_store_id AND r.code IN ('POS_STAFF_CASHIER','POS_STAFF_MANAGER');
 IF p_active THEN INSERT INTO public.user_roles(organization_id,membership_id,role_id,store_id,assigned_by) VALUES(p_org_id,member_id,role_id,p_store_id,auth.uid()); END IF;
 UPDATE public.store_staff SET role_code=p_role,active=p_active,revision=revision+1,updated_by=auth.uid(),updated_at=now()
  WHERE organization_id=p_org_id AND store_id=p_store_id AND user_id=p_user_id RETURNING * INTO staff;
 UPDATE public.staff_invitations SET status='REVOKED',revoked_by=auth.uid(),revoked_at=now()
  WHERE organization_id=p_org_id AND store_id=p_store_id AND status='OPEN' AND email IN
   (SELECT lower(email) FROM auth.users WHERE id=p_user_id UNION SELECT lower(email) FROM public.profiles WHERE id=p_user_id);
 response:=to_jsonb(staff);
 INSERT INTO public.staff_access_requests(organization_id,store_id,operation_id,actor_id,payload,result) VALUES(p_org_id,p_store_id,p_operation_id,auth.uid(),req,response);
 INSERT INTO public.audit_logs(organization_id,store_id,actor_user_id,module_key,action_key,entity_type,entity_id,reason,after_state)
  VALUES(p_org_id,p_store_id,auth.uid(),'pos','pos.staff.access_changed','staff',p_user_id::text,trim(p_reason),response);
 RETURN response;
END $$;
CREATE FUNCTION public.rpc_store_staff_snapshot(p_org_id uuid,p_store_id uuid,p_offset integer DEFAULT 0) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE members jsonb; invitations jsonb; total bigint;
BEGIN
 IF NOT public.authorize_action(p_org_id,p_store_id,'pos.staff.manage','pos') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_offset>1000000 THEN RAISE EXCEPTION 'INVALID_OFFSET'; END IF;
 SELECT count(*) INTO total FROM public.store_staff WHERE organization_id=p_org_id AND store_id=p_store_id;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at,x.user_id),'[]') INTO members FROM
  (SELECT s.*,p.full_name,COALESCE(u.email,p.email) AS email FROM public.store_staff s JOIN public.profiles p ON p.id=s.user_id LEFT JOIN auth.users u ON u.id=s.user_id
   WHERE s.organization_id=p_org_id AND s.store_id=p_store_id ORDER BY s.created_at,s.user_id LIMIT 100 OFFSET p_offset) x;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]') INTO invitations FROM
  (SELECT id,email,role_code,created_at,expires_at,CASE WHEN status='OPEN' AND expires_at<=now() THEN 'EXPIRED' ELSE status END AS status
   FROM public.staff_invitations WHERE organization_id=p_org_id AND store_id=p_store_id ORDER BY created_at DESC,id DESC LIMIT 100) x;
 RETURN jsonb_build_object('members',members,'members_total',total,'offset',p_offset,'invitations',invitations);
END $$;
REVOKE ALL ON FUNCTION public.staff_inviter_authorized(uuid,uuid,uuid),public.staff_role_id(uuid,text),public.staff_target_allowed(uuid,uuid,uuid),
 public.rpc_create_staff_invitation(uuid,uuid,uuid,text,text,text),public.rpc_accept_staff_invitation(text,text),
 public.rpc_revoke_staff_invitation(uuid,uuid,uuid),public.rpc_set_store_staff(uuid,uuid,uuid,uuid,text,boolean,integer,text),
 public.rpc_store_staff_snapshot(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_staff_invitation(uuid,uuid,uuid,text,text,text),public.rpc_accept_staff_invitation(text,text),
 public.rpc_revoke_staff_invitation(uuid,uuid,uuid),public.rpc_set_store_staff(uuid,uuid,uuid,uuid,text,boolean,integer,text),
 public.rpc_store_staff_snapshot(uuid,uuid,integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.rpc_store_context(p_org_id uuid,p_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.has_store_access(p_org_id,p_store_id) THEN RAISE EXCEPTION 'STORE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('can_manage_catalog',public.authorize_action(p_org_id,p_store_id,'catalog.manage','catalog'),
  'can_sell',public.authorize_action(p_org_id,p_store_id,'pos.order.write','pos'),
  'can_manage_shift',public.authorize_action(p_org_id,p_store_id,'pos.shift.manage','pos'),
  'can_collect',public.authorize_action(p_org_id,p_store_id,'pos.payment.collect','pos'),
  'can_void',public.authorize_action(p_org_id,p_store_id,'pos.order.void','pos'),
  'can_refund',public.authorize_action(p_org_id,p_store_id,'pos.order.refund','pos'),
  'can_report',public.authorize_action(p_org_id,p_store_id,'pos.report.read','pos'),
  'can_review_offline',public.authorize_action(p_org_id,p_store_id,'pos.offline.resolve','pos'),
  'can_manage_staff',public.authorize_action(p_org_id,p_store_id,'pos.staff.manage','pos'));
END $$;
-- Permissions must be checked again after waiting for the store lock. Otherwise
-- a previously authorized request could open a shift after access was removed.
DO $$
DECLARE item record; definition text;
 anchor text:='PERFORM pg_advisory_xact_lock(hashtextextended(p_store_id::text,1));';
 guard text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('rpc_save_order(uuid,uuid,uuid,text,uuid,jsonb,jsonb,uuid,integer)','pos.order.write','pos'),
  ('rpc_update_variant(uuid,uuid,uuid,bigint,boolean)','catalog.manage','catalog'),
  ('rpc_open_shift(uuid,uuid,uuid,bigint)','pos.shift.manage','pos'),
  ('rpc_close_shift(uuid,uuid,uuid,uuid,bigint)','pos.shift.manage','pos'),
  ('rpc_collect_payment(uuid,uuid,uuid,uuid,uuid,integer,text,bigint,boolean)','pos.payment.collect','pos'),
  ('rpc_void_order(uuid,uuid,uuid,integer,uuid,text)','pos.order.void','pos'),
  ('rpc_refund_payment(uuid,uuid,uuid,uuid,uuid,text)','pos.order.refund','pos'),
  ('rpc_submit_offline_review(uuid,uuid,uuid,jsonb,text)','pos.order.write','pos'),
  ('rpc_cancel_offline_review(uuid,uuid,uuid,uuid,text,boolean)','pos.offline.resolve','pos'),
  ('rpc_sync_offline_sale(uuid,uuid,uuid,text,uuid,jsonb,jsonb,bigint,uuid,uuid,bigint)',NULL,'pos')
 ) AS x(signature,permission,module) LOOP
  SELECT pg_get_functiondef(('public.'||item.signature)::regprocedure) INTO definition;
  IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'STAFF_PERMISSION_GUARD_MISSING: %',item.signature; END IF;
  guard:=CASE WHEN item.permission IS NULL THEN 'public.has_store_access(p_org_id,p_store_id)'
   ELSE format('public.authorize_action(p_org_id,p_store_id,%L,%L)',item.permission,item.module) END;
  EXECUTE replace(definition,anchor,anchor||chr(10)||' IF NOT '||guard||' THEN RAISE EXCEPTION ''PERMISSION_DENIED'' USING ERRCODE=''42501''; END IF;');
 END LOOP;
 -- Catalog creation originally had no store lock; acquire it before authorizing.
 FOR item IN SELECT * FROM (VALUES('rpc_create_product(uuid,uuid,jsonb)'),('rpc_create_position(uuid,uuid,text)')) AS x(signature) LOOP
  SELECT pg_get_functiondef(('public.'||item.signature)::regprocedure) INTO definition;
  IF position(chr(10)||'BEGIN'||chr(10) IN definition)=0 THEN RAISE EXCEPTION 'STAFF_CATALOG_GUARD_MISSING'; END IF;
  EXECUTE replace(definition,chr(10)||'BEGIN'||chr(10),chr(10)||'BEGIN'||chr(10)||' '||anchor||chr(10));
 END LOOP;
END $$;

COMMIT;
