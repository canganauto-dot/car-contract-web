-- PROPOSAL: backend transaction primitives. contract_private is NEVER a PostgREST exposed schema.
-- Actor UUID comes exclusively from backend-verified Auth identity, never from request JSON.
BEGIN;
CREATE FUNCTION contract_private.authorize_write(c uuid,b uuid,u uuid,manager_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Serialize with deactivation/role administration. Hold locks until transaction commit.
 PERFORM 1 FROM app.employees WHERE id=u AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM app.companies WHERE id=c AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM app.branches WHERE id=b AND company_id=c AND active FOR SHARE;
 IF NOT FOUND OR NOT contract_private.can_branch(c,b,u) OR
 (manager_only AND NOT contract_private.can_manage(c,b,u))
 THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 PERFORM set_config('contract.actor_id',u::text,true);
END $$;
CREATE FUNCTION contract_private.lock_draft(u uuid,rid uuid,expected_version bigint,manager_only boolean DEFAULT false)
RETURNS app.revisions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r app.revisions; c app.contracts;
BEGIN
 SELECT * INTO r FROM app.revisions WHERE id=rid;
 IF NOT FOUND THEN RAISE EXCEPTION 'not found or inaccessible' USING ERRCODE='42501'; END IF;
 PERFORM contract_private.authorize_write(r.company_id,r.branch_id,u,manager_only);
 SELECT * INTO c FROM app.contracts WHERE id=r.contract_id FOR UPDATE;
 SELECT * INTO r FROM app.revisions WHERE id=rid FOR UPDATE;
 IF c.voided_at IS NOT NULL OR r.state<>'draft' THEN RAISE EXCEPTION 'not editable' USING ERRCODE='55000'; END IF;
 IF expected_version IS NULL OR r.lock_version<>expected_version THEN RAISE EXCEPTION 'stale revision version' USING ERRCODE='40001'; END IF;
 RETURN r;
END $$;
CREATE FUNCTION contract_private.anchor_month(d date,n integer) RETURNS date
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT (date_trunc('month',d)::date + make_interval(months=>n))::date
 + (least(extract(day FROM d)::integer, extract(day FROM
 (date_trunc('month',d) + make_interval(months=>n+1) - interval '1 day'))::integer)-1)
$$;
CREATE FUNCTION contract_private.validate_finance(rid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r app.revisions; f app.revision_finance; k text; extra numeric; outstanding numeric;
 n integer; expected numeric; scheduled numeric; i integer; item record; has_guarantor boolean;
BEGIN
 SELECT * INTO r FROM app.revisions WHERE id=rid;
 SELECT kind INTO k FROM app.contracts WHERE id=r.contract_id;
 SELECT * INTO f FROM app.revision_finance WHERE revision_id=rid;
 IF k='letter' THEN
 IF FOUND OR EXISTS(SELECT 1 FROM app.payment_schedule WHERE revision_id=rid)
 OR EXISTS(SELECT 1 FROM app.promissory_notes WHERE revision_id=rid)
 THEN RAISE EXCEPTION 'letter must not have contract finance' USING ERRCODE='23514'; END IF;
 RETURN;
 END IF;
 IF NOT FOUND OR (f.mode<>'installment' AND f.total<=0) THEN RAISE EXCEPTION 'finance missing or nonpositive cash total' USING ERRCODE='23514'; END IF;
 IF NOT ((k='installment' AND f.mode='installment') OR (k='cash' AND f.mode='cash') OR
 (k='external' AND f.mode='external') OR (k='exchange' AND f.mode IN ('installment','exchange_manual')))
 THEN RAISE EXCEPTION 'finance mode/type mismatch' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount),0),count(*) INTO scheduled,n FROM app.payment_schedule WHERE revision_id=rid AND kind='initial';
 IF scheduled<>f.initial_amount OR n<>(CASE WHEN f.initial_amount>0 THEN 1 ELSE 0 END)
 THEN RAISE EXCEPTION 'initial payment mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.payment_schedule WHERE revision_id=rid AND kind='initial' AND due_date IS DISTINCT FROM f.initial_date)
 THEN RAISE EXCEPTION 'initial payment date mismatch' USING ERRCODE='23514'; END IF;
 IF f.mode='installment' THEN
 SELECT coalesce(sum(amount),0),count(*) INTO extra,n FROM app.payment_schedule WHERE revision_id=rid AND kind='additional';
 IF n>4 THEN RAISE EXCEPTION 'at most four additional payments' USING ERRCODE='23514'; END IF;
 outstanding:=f.total-f.initial_amount-extra;
 IF outstanding<0 OR (outstanding=0 AND f.installment_count<>0) OR (outstanding>0 AND f.installment_count<1)
 THEN RAISE EXCEPTION 'invalid installment balance/count' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.payment_schedule WHERE revision_id=rid AND (due_date IS NULL OR kind='balance'))
 THEN RAISE EXCEPTION 'invalid installment schedule date/kind' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO n FROM app.payment_schedule WHERE revision_id=rid AND kind IN ('installment','final');
 IF n<>f.installment_count THEN RAISE EXCEPTION 'installment count mismatch' USING ERRCODE='23514'; END IF;
 IF n>0 AND (f.first_due_date IS NULL OR f.first_due_date<r.contract_date)
 THEN RAISE EXCEPTION 'first date required' USING ERRCODE='23514'; END IF;
 i:=0;
 FOR item IN SELECT * FROM app.payment_schedule WHERE revision_id=rid AND kind IN ('installment','final') ORDER BY ordinal LOOP
 expected:=CASE WHEN i=f.installment_count-1 THEN
 outstanding-f.phase_count*f.phase_amount-(f.installment_count-f.phase_count-1)*f.installment_amount
 WHEN i<f.phase_count THEN f.phase_amount ELSE f.installment_amount END;
 IF item.amount<>expected OR item.due_date<>contract_private.anchor_month(f.first_due_date,i*f.interval_months)
 OR item.kind<>(CASE WHEN i=f.installment_count-1 THEN 'final' ELSE 'installment' END)
 THEN RAISE EXCEPTION 'installment arithmetic/date mismatch' USING ERRCODE='23514'; END IF;
 i:=i+1;
 END LOOP;
 ELSE
 outstanding:=f.total-f.initial_amount;
 IF EXISTS(SELECT 1 FROM app.payment_schedule WHERE revision_id=rid AND kind NOT IN ('initial','balance'))
 THEN RAISE EXCEPTION 'non-installment contract has installments' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount),0),count(*) INTO scheduled,n FROM app.payment_schedule WHERE revision_id=rid AND kind='balance';
 IF outstanding=0 AND n>0 THEN RAISE EXCEPTION 'settled contract has balance schedule' USING ERRCODE='23514'; END IF;
 IF NOT f.cash_split AND EXISTS(SELECT 1 FROM app.payment_schedule WHERE revision_id=rid AND kind='balance' AND due_date IS DISTINCT FROM f.balance_due_date)
 THEN RAISE EXCEPTION 'balance date mismatch' USING ERRCODE='23514'; END IF;
 IF f.cash_split AND (n>4 OR scheduled<>outstanding) THEN RAISE EXCEPTION 'cash split mismatch' USING ERRCODE='23514'; END IF;
 IF NOT f.cash_split AND ((f.balance_due_date IS NULL AND n<>0) OR
 (f.balance_due_date IS NOT NULL AND outstanding>0 AND (n<>1 OR scheduled<>outstanding)))
 THEN RAISE EXCEPTION 'cash balance schedule mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.payment_schedule WHERE revision_id=rid AND kind='balance' AND due_date<r.contract_date)
 THEN RAISE EXCEPTION 'cash date precedes contract' USING ERRCODE='23514'; END IF;
 -- A cash balance WITHOUT a due date is intentionally legal; do not invent a due row.
 END IF;
 SELECT EXISTS(SELECT 1 FROM app.revision_parties WHERE revision_id=rid AND role='guarantor') INTO has_guarantor;
 IF EXISTS(SELECT 1 FROM app.promissory_notes WHERE revision_id=rid AND
 (outstanding<=0 OR k='external' OR (obligor='guarantor' AND (k='cash' OR NOT has_guarantor)) OR
 amount<>CASE WHEN part=1 THEN floor(outstanding/2) ELSE outstanding-floor(outstanding/2) END))
 THEN RAISE EXCEPTION 'promissory amount/obligor mismatch' USING ERRCODE='23514'; END IF;
 -- Optional note pages may be absent. When included, buyer/guarantor each secure the FULL balance.
END $$;
CREATE FUNCTION contract_private.finalize_revision(u uuid,rid uuid,expected_version bigint,request_key uuid,request_hash text,content_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r app.revisions; c app.contracts; old_request contract_private.operation_requests; seq bigint; yr integer; result jsonb; code text;
BEGIN
 SELECT * INTO r FROM app.revisions WHERE id=rid;
 IF NOT FOUND THEN RAISE EXCEPTION 'not found or inaccessible' USING ERRCODE='42501'; END IF;
 -- Staff may issue an authorized draft independently of printing.
 PERFORM contract_private.authorize_write(r.company_id,r.branch_id,u,false);
 SELECT * INTO c FROM app.contracts WHERE id=r.contract_id FOR UPDATE;
 SELECT * INTO old_request FROM contract_private.operation_requests
 WHERE company_id=r.company_id AND actor_id=u AND operation_requests.request_key=finalize_revision.request_key;
 IF FOUND THEN
 IF old_request.operation<>'finalize' OR old_request.payload_sha256 IS DISTINCT FROM request_hash
 OR old_request.result->>'revision_id' IS DISTINCT FROM rid::text
 THEN RAISE EXCEPTION 'idempotency key reused for different request' USING ERRCODE='23505'; END IF;
 RETURN old_request.result;
 END IF;
 r:=contract_private.lock_draft(u,rid,expected_version,false);
 IF r.previous_revision_id IS DISTINCT FROM c.current_revision_id THEN
 RAISE EXCEPTION 'correction does not follow current revision' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.templates t JOIN app.template_versions v ON v.template_id=t.id
 WHERE v.id=r.template_version_id AND t.kind=c.kind)
 THEN RAISE EXCEPTION 'template/type mismatch' USING ERRCODE='23514'; END IF;
 PERFORM contract_private.validate_finance(rid);
 IF request_key IS NULL OR request_hash IS NULL OR request_hash !~ '^[a-f0-9]{64}$'
 OR content_hash IS NULL OR content_hash !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'validated backend hashes required' USING ERRCODE='23514'; END IF;
 IF c.number_seq IS NULL THEN
 yr:=extract(year FROM clock_timestamp() AT TIME ZONE 'Asia/Baghdad')::integer;
 SELECT ordinal,label INTO STRICT seq,code FROM contract_private.reservations
  WHERE client_key=c.client_key AND company_id=c.company_id AND branch_id=c.branch_id FOR UPDATE;
 UPDATE contract_private.reservations SET issued=true WHERE client_key=c.client_key;
 UPDATE app.contracts SET number_year=yr,number_seq=seq,display_number=code WHERE id=c.id; END IF;
 UPDATE app.revisions SET state='finalized',finalized_at=clock_timestamp(),finalized_by=u,content_sha256=content_hash WHERE id=rid;
 UPDATE app.contracts SET current_revision_id=rid WHERE id=c.id;
 SELECT jsonb_build_object('contract_id',id,'revision_id',rid,'number',display_number) INTO result FROM app.contracts WHERE id=c.id;
 INSERT INTO contract_private.operation_requests(company_id,actor_id,request_key,operation,payload_sha256,result)
 VALUES(c.company_id,u,request_key,'finalize',request_hash,result);
 INSERT INTO app.audit_events(company_id,branch_id,actor_id,action,entity_type,entity_id,request_id)
 VALUES(c.company_id,c.branch_id,u,'finalize','revisions',rid::text,request_key::text);
 RETURN result;
END $$;
-- Company-scoped role changes. A company admin cannot alter another company or global employee.active.
CREATE FUNCTION contract_private.set_company_membership(actor uuid,c uuid,target uuid,new_role text,enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM app.employees WHERE id=actor AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM app.companies WHERE id=c FOR UPDATE;
 IF NOT contract_private.is_admin(c,actor) THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 IF new_role IS NULL OR new_role NOT IN ('administrator','staff') OR enabled IS NULL
 THEN RAISE EXCEPTION 'invalid role' USING ERRCODE='23514'; END IF;
 PERFORM set_config('contract.actor_id',actor::text,true);
 INSERT INTO app.company_memberships(company_id,employee_id,role,active) VALUES(c,target,new_role,enabled)
 ON CONFLICT(company_id,employee_id) DO UPDATE SET role=EXCLUDED.role,active=EXCLUDED.active;
 IF NOT EXISTS(SELECT 1 FROM app.company_memberships m JOIN app.employees e ON e.id=m.employee_id
 WHERE m.company_id=c AND m.role='administrator' AND m.active AND e.active)
 THEN RAISE EXCEPTION 'cannot remove last active administrator' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION contract_private.set_branch_membership(actor uuid,c uuid,b uuid,target uuid,new_role text,enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM app.employees WHERE id=actor AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM app.companies WHERE id=c FOR UPDATE;
 IF NOT contract_private.is_admin(c,actor) THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 IF new_role IS NULL OR new_role NOT IN ('branch_manager','employee') OR enabled IS NULL
 THEN RAISE EXCEPTION 'invalid role' USING ERRCODE='23514'; END IF;
 PERFORM set_config('contract.actor_id',actor::text,true);
 INSERT INTO app.branch_memberships(company_id,branch_id,employee_id,role,active) VALUES(c,b,target,new_role,enabled)
 ON CONFLICT(company_id,branch_id,employee_id) DO UPDATE SET role=EXCLUDED.role,active=EXCLUDED.active;
END $$;
-- Global suspension is an operational security action; NEVER expose it to company administrators.
CREATE FUNCTION contract_private.suspend_employee(target uuid,reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid;
BEGIN
 IF reason IS NULL OR length(trim(reason))=0 THEN RAISE EXCEPTION 'reason required'; END IF;
 PERFORM 1 FROM app.employees WHERE id=target FOR UPDATE;
 FOR c IN SELECT company_id FROM app.company_memberships WHERE employee_id=target AND active ORDER BY company_id LOOP
 PERFORM 1 FROM app.companies WHERE id=c FOR UPDATE;
 IF EXISTS(SELECT 1 FROM app.company_memberships WHERE company_id=c AND employee_id=target AND role='administrator')
 AND NOT EXISTS(SELECT 1 FROM app.company_memberships m JOIN app.employees e ON e.id=m.employee_id
 WHERE m.company_id=c AND m.role='administrator' AND m.active AND e.active AND e.id<>target)
 THEN RAISE EXCEPTION 'appoint replacement administrator before suspension' USING ERRCODE='23514'; END IF;
 INSERT INTO app.audit_events(company_id,actor_id,action,entity_type,entity_id,detail)
 VALUES(c,NULL,'global_suspension','employees',target::text,jsonb_build_object('reason',reason));
 END LOOP;
 UPDATE app.employees SET active=false WHERE id=target;
END $$;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA contract_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION contract_private.read_company(uuid),contract_private.read_branch(uuid,uuid),contract_private.admin_company(uuid) TO authenticated;
-- The web backend may invoke verified operations. Trigger functions and global suspension
-- stay with the migration/operations owner. Browser roles keep only identity-bound RLS wrappers.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA contract_private FROM service_role;
GRANT EXECUTE ON FUNCTION contract_private.authorize_write(uuid,uuid,uuid,boolean),
 contract_private.lock_draft(uuid,uuid,bigint,boolean),
 contract_private.finalize_revision(uuid,uuid,bigint,uuid,text,text),
 contract_private.set_branch_membership(uuid,uuid,uuid,uuid,text,boolean),
 contract_private.set_company_membership(uuid,uuid,uuid,text,boolean) TO service_role;
REVOKE INSERT,UPDATE,DELETE ON app.audit_events,app.company_memberships,app.branch_memberships,
 app.employees,contract_private.number_counters,contract_private.operation_requests FROM service_role;
-- New users and the first administrator are provisioned through a separate operational identity.
REVOKE INSERT,UPDATE,DELETE ON app.contracts,app.revisions FROM service_role;
GRANT INSERT(id,company_id,branch_id,kind,letter_key,created_by) ON app.contracts TO service_role;
GRANT UPDATE(voided_at,void_reason) ON app.contracts TO service_role;
GRANT INSERT(id,company_id,branch_id,contract_id,revision_no,previous_revision_id,correction_reason,
 template_version_id,contract_date,contract_time,date_manually_set,time_manually_set,branding_company_id,
 company_snapshot,organizer_snapshot,notes,transfer_note,warranty_years,no_warranty,custom_fields,print_options,
 legacy_import,calculation_version) ON app.revisions TO service_role;
GRANT UPDATE(template_version_id,contract_date,contract_time,date_manually_set,time_manually_set,
 branding_company_id,company_snapshot,organizer_snapshot,notes,transfer_note,warranty_years,no_warranty,
 custom_fields,print_options,legacy_import,calculation_version,customer_photo_id,correction_reason)
 ON app.revisions TO service_role;
-- Child edits bump the draft via the owner, without granting raw lock_version writes.
ALTER FUNCTION contract_private.guard_revision_child() SECURITY DEFINER;
COMMIT;
