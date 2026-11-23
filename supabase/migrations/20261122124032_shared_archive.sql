-- Partial forms stay editable even before financial validation. Only issue creates a finalized revision.
CREATE TABLE contract_private.workspace_records (
 client_key text PRIMARY KEY REFERENCES contract_private.reservations(client_key), draft jsonb,
 version bigint NOT NULL DEFAULT 0, modified timestamptz NOT NULL DEFAULT now(), deleted_draft jsonb,
 deleted_by uuid REFERENCES app.employees
);
ALTER TABLE contract_private.workspace_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contract_private.workspace_records FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX reservations_by_company_branch ON contract_private.reservations(company_id,branch_id,client_key);
CREATE INDEX documents_revision_purpose ON app.documents(revision_id,purpose,version DESC);

CREATE FUNCTION contract_private.archive_op(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE co app.companies; rr contract_private.reservations; w contract_private.workspace_records;
 ct app.contracts; rev app.revisions; t uuid; tv uuid; rid uuid; rec text:=p->>'record'; d jsonb:=p->'data';
 fin jsonb:=p->'finance'; j jsonb; item record; doc_kind text; v int; cv bigint; hash text; outcome jsonb;
 doc app.documents; job contract_private.upload_jobs; key uuid; path text; purpose text:=p->>'purpose';
BEGIN
 SELECT * INTO co FROM app.companies WHERE code=p->>'company' AND active;
 IF actor IS NULL OR NOT contract_private.is_member(co.id,actor) THEN RAISE insufficient_privilege; END IF;
 PERFORM set_config('contract.actor_id',actor::text,true);
 IF action='list' THEN
  RETURN coalesce((SELECT jsonb_agg(row_value ORDER BY client_key) FROM (
   SELECT a.client_key,jsonb_build_object('record',a.client_key,'version',wr.version,'draft',wr.draft,'changed',wr.modified,
    'printed',r.custom_fields,'revision',r.id,'issuedAt',r.finalized_at,'signed',EXISTS(SELECT 1 FROM app.documents z WHERE z.revision_id=r.id AND z.purpose='signed_pdf')) row_value
   FROM contract_private.reservations a JOIN contract_private.workspace_records wr USING(client_key)
   LEFT JOIN app.contracts c ON c.client_key=a.client_key LEFT JOIN app.revisions r ON r.id=c.current_revision_id
   WHERE a.company_id=co.id AND contract_private.can_branch(co.id,a.branch_id,actor) AND a.client_key>coalesce(p->>'after','')
    AND (wr.draft IS NOT NULL OR r.id IS NOT NULL) ORDER BY a.client_key LIMIT 16) q),'[]');
 END IF;
 SELECT * INTO rr FROM contract_private.reservations WHERE client_key=rec AND company_id=co.id;
 IF rr.client_key IS NULL OR NOT contract_private.can_branch(co.id,rr.branch_id,actor) THEN RAISE insufficient_privilege; END IF;
 SELECT * INTO ct FROM app.contracts WHERE client_key=rec;
 IF action IN ('read','download') THEN
  SELECT * INTO rev FROM app.revisions WHERE contract_id=ct.id AND id=(p->>'revision')::uuid AND state='finalized';
  IF rev.id IS NULL THEN RAISE insufficient_privilege; END IF;
  IF action='read' THEN
   RETURN jsonb_build_object('config',rev.company_snapshot,'history',coalesce((SELECT jsonb_agg(jsonb_build_object('data',r.custom_fields,'revision',r.id,'changed',r.finalized_at,
   'signed',EXISTS(SELECT 1 FROM app.documents z WHERE z.revision_id=r.id AND z.purpose='signed_pdf')) ORDER BY r.revision_no DESC)
   FROM app.revisions r WHERE r.contract_id=ct.id AND r.revision_no<rev.revision_no AND r.state='finalized'),'[]'));
  END IF;
  SELECT * INTO doc FROM app.documents WHERE revision_id=rev.id AND app.documents.purpose=p->>'purpose' ORDER BY version DESC LIMIT 1;
  IF doc.id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO app.audit_events(company_id,branch_id,actor_id,action,entity_type,entity_id) VALUES(co.id,rr.branch_id,actor,'download','documents',doc.id::text);
  RETURN to_jsonb(doc.object_key);
 END IF;
 PERFORM contract_private.authorize_write(co.id,rr.branch_id,actor,false);
 PERFORM 1 FROM contract_private.reservations WHERE client_key=rec FOR UPDATE;
 SELECT * INTO ct FROM app.contracts WHERE client_key=rec;
 INSERT INTO contract_private.workspace_records(client_key) VALUES(rec) ON CONFLICT DO NOTHING;
 SELECT * INTO w FROM contract_private.workspace_records WHERE client_key=rec FOR UPDATE;
 IF action IN ('reserve_file','publish_file') THEN
  IF ct.current_revision_id IS DISTINCT FROM (p->>'revision')::uuid OR ct.current_revision_id IS NULL OR purpose NOT IN ('generated_pdf','signed_pdf') THEN RAISE serialization_failure; END IF;
  IF (p->>'size')::int NOT BETWEEN 1 AND 15000000 THEN RAISE invalid_parameter_value; END IF;
  SELECT * INTO doc FROM app.documents z WHERE z.revision_id=ct.current_revision_id AND z.purpose=p->>'purpose' AND z.sha256=p->>'hash' ORDER BY version DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('path',doc.object_key,'done',true); END IF;
  SELECT * INTO job FROM contract_private.upload_jobs u WHERE u.company_id=co.id AND u.actor_id=actor AND u.request_key=(p->>'request')::uuid;
  IF NOT FOUND THEN
   IF purpose='generated_pdf' AND (EXISTS(SELECT 1 FROM app.documents z WHERE z.revision_id=ct.current_revision_id AND z.purpose='generated_pdf') OR
    NOT EXISTS(SELECT 1 FROM app.revisions r WHERE r.id=ct.current_revision_id AND (r.finalized_by=actor OR contract_private.can_manage(co.id,rr.branch_id,actor)))) THEN RAISE insufficient_privilege; END IF;
   IF action<>'reserve_file' THEN RAISE invalid_parameter_value; END IF;
   key:=gen_random_uuid();path:=co.id||'/'||rr.branch_id||'/'||ct.current_revision_id||'/'||key;
   INSERT INTO contract_private.upload_jobs(company_id,branch_id,revision_id,purpose,actor_id,request_key,expected_sha256,expected_bytes,object_key,expires_at)
   VALUES(co.id,rr.branch_id,ct.current_revision_id,purpose,actor,(p->>'request')::uuid,p->>'hash',(p->>'size')::int,path,now()+interval '2 hours') RETURNING * INTO job;
  END IF;
  IF job.revision_id<>ct.current_revision_id OR job.expected_sha256<>p->>'hash' OR job.expected_bytes<>(p->>'size')::int OR job.purpose<>purpose OR job.expires_at<now() THEN RAISE serialization_failure; END IF;
  IF action='publish_file' THEN
   IF purpose='generated_pdf' AND EXISTS(SELECT 1 FROM app.documents z WHERE z.revision_id=job.revision_id AND z.purpose='generated_pdf') THEN RAISE serialization_failure; END IF;
   SELECT coalesce(max(z.version),0)+1 INTO v FROM app.documents z WHERE z.revision_id=job.revision_id AND z.purpose=job.purpose;
   key:=split_part(job.object_key,'/',4)::uuid;
   INSERT INTO app.documents(id,company_id,branch_id,revision_id,purpose,version,object_key,sha256,byte_size,mime_type,created_by)
   VALUES(key,co.id,rr.branch_id,job.revision_id,job.purpose,v,job.object_key,job.expected_sha256,job.expected_bytes,'application/pdf',actor);
   UPDATE contract_private.upload_jobs SET state='published',document_id=key WHERE id=job.id;
  END IF;
  RETURN jsonb_build_object('path',job.object_key,'done',action='publish_file');
 END IF;
 IF action NOT IN ('draft','issue','remove') THEN RAISE invalid_parameter_value; END IF;
 SELECT * INTO rev FROM app.revisions WHERE id=ct.current_revision_id;
 IF action<>'remove' THEN
  IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR d->>'recordId' IS DISTINCT FROM rec OR d->>'number' IS DISTINCT FROM rr.label
    OR d->>'companyId' IS DISTINCT FROM co.code OR d->>'numberBranch' IS DISTINCT FROM rr.branch_name THEN RAISE invalid_parameter_value; END IF;
  d:=d-'updatedAt'-'signedFile';
  IF d IS NOT DISTINCT FROM rev.custom_fields AND w.draft IS NULL THEN RETURN jsonb_build_object('version',w.version,'revision',rev.id); END IF;
  IF action='draft' AND d IS NOT DISTINCT FROM w.draft THEN RETURN jsonb_build_object('version',w.version); END IF;
 END IF;
 IF w.version IS DISTINCT FROM (p->>'version')::bigint THEN RAISE serialization_failure; END IF;
 IF (ct.current_revision_id IS NOT NULL OR actor<>rr.assigned_by) AND NOT contract_private.can_manage(co.id,rr.branch_id,actor) THEN RAISE insufficient_privilege; END IF;
 IF action='remove' THEN
  UPDATE contract_private.workspace_records SET deleted_draft=draft,draft=NULL,deleted_by=actor,modified=now(),version=version+1 WHERE client_key=rec RETURNING version INTO cv;
 ELSIF action='draft' THEN
  UPDATE contract_private.workspace_records SET draft=CASE WHEN d=rev.custom_fields THEN NULL ELSE d END,modified=now(),version=version+1 WHERE client_key=rec RETURNING version INTO cv;
 ELSE
  doc_kind:=CASE WHEN coalesce(d->>'standaloneBook','') NOT IN ('','0','false') THEN 'letter' ELSE coalesce(d->>'contractType','installment') END;
  IF ct.id IS NULL THEN
   INSERT INTO app.contracts(company_id,branch_id,kind,letter_key,created_by,client_key)
   VALUES(co.id,rr.branch_id,doc_kind,CASE WHEN doc_kind='letter' THEN d->>'standaloneBook' END,rr.assigned_by,rec) RETURNING * INTO ct;
  ELSIF ct.kind<>doc_kind THEN RAISE invalid_parameter_value; END IF;
  -- The renderer configuration is pinned per issued revision, including the approved layouts.
  INSERT INTO app.templates(company_id,template_key,name,kind) VALUES(co.id,'issued:'||doc_kind,doc_kind,doc_kind) ON CONFLICT DO NOTHING;
  SELECT id INTO t FROM app.templates WHERE company_id=co.id AND template_key='issued:'||doc_kind FOR UPDATE;
  SELECT id INTO tv FROM app.template_versions WHERE template_id=t ORDER BY version DESC LIMIT 1;
  IF tv IS NULL THEN
   INSERT INTO app.template_versions(company_id,template_id,version,layout,field_schema,renderer_version,content_sha256,created_by)
   VALUES(co.id,t,1,'{}','{}','workspace-v1',encode(sha256(convert_to('{}','UTF8')),'hex'),actor) RETURNING id INTO tv;
  END IF;
  INSERT INTO app.revisions(company_id,branch_id,contract_id,revision_no,previous_revision_id,correction_reason,template_version_id,
   contract_date,contract_time,company_snapshot,organizer_snapshot,custom_fields,calculation_version,notes)
  VALUES(co.id,rr.branch_id,ct.id,coalesce(rev.revision_no,0)+1,rev.id,CASE WHEN rev.id IS NOT NULL THEN 'تعديل معتمد' END,tv,
   (d->>'contractDate')::date,coalesce(nullif(d->>'contractTime','')::time,'00:00'),p->'config',coalesce(d->>'organizer',''),d,'contract-math-v1',coalesce(d->>'notes','')) RETURNING id INTO rid;
  FOR j IN SELECT value FROM jsonb_array_elements(coalesce(p->'parties','[]')) LOOP
   INSERT INTO app.revision_parties(company_id,branch_id,revision_id,role,full_name,phone,identity_number,address)
   VALUES(co.id,rr.branch_id,rid,j->>'role',j->>'name',j->>'phone',j->>'identity',j->>'address');
  END LOOP;
  FOR j IN SELECT value FROM jsonb_array_elements(coalesce(p->'vehicles','[]')) LOOP
   INSERT INTO app.revision_vehicles(company_id,branch_id,revision_id,role,vin,model_name,color,plate)
   VALUES(co.id,rr.branch_id,rid,j->>'role',j->>'vin',j->>'car',j->>'color',j->>'plate');
  END LOOP;
  IF doc_kind<>'letter' THEN
   INSERT INTO app.revision_finance(revision_id,company_id,branch_id,mode,total,initial_amount,initial_date,installment_count,installment_amount,first_due_date,
    interval_months,phase_count,phase_amount,cash_split,balance_due_date)
   VALUES(rid,co.id,rr.branch_id,fin->>'mode',(fin->>'total')::numeric,(fin->>'deposit')::numeric,nullif(fin->>'depositDate','')::date,
    (fin->>'count')::int,(fin->>'payment')::numeric,nullif(d->>'firstDate','')::date,(fin->>'interval')::int,(fin->>'earlyCount')::int,
    (fin->>'earlyPayment')::numeric,(fin->>'split')::boolean,nullif(d->>'cashDueDate','')::date);
   FOR item IN SELECT value,ordinality FROM jsonb_array_elements(fin->'rows') WITH ORDINALITY LOOP
    j:=item.value;
    INSERT INTO app.payment_schedule(company_id,branch_id,revision_id,ordinal,kind,label,amount,due_date)
    VALUES(co.id,rr.branch_id,rid,item.ordinality,j->>'kind',j->>'label',(j->>'amount')::numeric,nullif(j->>'date','')::date);
   END LOOP;
  END IF;
  SELECT lock_version INTO cv FROM app.revisions WHERE id=rid;
  hash:=encode(sha256(convert_to(jsonb_build_array(d,p->'config',fin)::text,'UTF8')),'hex');
  outcome:=contract_private.finalize_revision(actor,rid,cv,gen_random_uuid(),hash,hash);
  UPDATE contract_private.workspace_records SET draft=NULL,modified=now(),version=version+1 WHERE client_key=rec RETURNING version INTO cv;
 END IF;
 RETURN jsonb_build_object('version',cv,'revision',rid);
END $$;
CREATE FUNCTION public.contract_archive(actor uuid,action text,p jsonb) RETURNS jsonb LANGUAGE sql SET search_path=''
 AS $$SELECT contract_private.archive_op(actor,action,p)$$;
REVOKE ALL ON FUNCTION public.contract_archive(uuid,text,jsonb),contract_private.archive_op(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contract_archive(uuid,text,jsonb),contract_private.archive_op(uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION contract_private.validate_finance(rid uuid) RETURNS void
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
 IF f.cash_split AND (n>5 OR scheduled>outstanding OR (f.balance_due_date IS NOT NULL AND scheduled<>outstanding)) THEN RAISE EXCEPTION 'cash split mismatch' USING ERRCODE='23514'; END IF;
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
