ALTER TABLE app.company_memberships ADD COLUMN department text NOT NULL DEFAULT 'contracts'
 CHECK (department IN ('contracts','sales','finance'));
CREATE FUNCTION contract_private.department(c uuid,u uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN m.role='administrator' THEN 'management' ELSE m.department END
 FROM app.company_memberships m WHERE m.company_id=c AND m.employee_id=u AND contract_private.is_member(c,u)
$$;
CREATE TABLE contract_private.sales_forms (
 id uuid PRIMARY KEY, company_id uuid NOT NULL, branch_id uuid NOT NULL,
 author uuid NOT NULL REFERENCES app.employees, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 version bigint NOT NULL DEFAULT 1, changed timestamptz NOT NULL DEFAULT now(),
 published timestamptz, approved timestamptz, approver uuid REFERENCES app.employees,
 contract_key text UNIQUE REFERENCES contract_private.reservations(client_key),
 FOREIGN KEY(company_id,branch_id) REFERENCES app.branches(company_id,id)
);
CREATE INDEX forms_branch_published ON contract_private.sales_forms(company_id,branch_id,changed DESC) WHERE published IS NOT NULL;
CREATE INDEX forms_author ON contract_private.sales_forms(author,company_id,changed DESC);
ALTER TABLE contract_private.sales_forms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contract_private.sales_forms FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION contract_private.department(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION contract_private.department(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION contract_private.read_branch(c uuid,b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
 AS $$ SELECT contract_private.can_branch(c,b,auth.uid()) AND contract_private.department(c,auth.uid()) IN ('management','contracts') $$;

ALTER TABLE contract_private.workspace_records ADD COLUMN draft_owner uuid REFERENCES app.employees;
UPDATE contract_private.workspace_records w SET draft_owner=r.assigned_by FROM contract_private.reservations r WHERE r.client_key=w.client_key AND w.draft IS NOT NULL;
CREATE OR REPLACE FUNCTION public.contract_archive(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid; rr contract_private.reservations; owner_id uuid; ans jsonb;
BEGIN
 SELECT id INTO c FROM app.companies WHERE code=p->>'company' AND active;
 IF coalesce(contract_private.department(c,actor),'') NOT IN ('management','contracts') THEN RAISE insufficient_privilege; END IF;
 IF action='list' THEN
  RETURN coalesce((SELECT jsonb_agg(q.item ORDER BY q.client_key) FROM (
   SELECT a.client_key,jsonb_build_object('record',a.client_key,'version',w.version,'draft',CASE WHEN w.draft_owner=actor THEN w.draft END,
   'changed',CASE WHEN w.draft_owner=actor THEN w.modified ELSE i.finalized_at END,'printed',i.custom_fields,'revision',i.id,'issuedAt',i.finalized_at,
   'signed',EXISTS(SELECT 1 FROM app.documents z WHERE z.revision_id=i.id AND z.purpose='signed_pdf')) item
   FROM contract_private.reservations a JOIN contract_private.workspace_records w USING(client_key)
   LEFT JOIN app.contracts ct ON ct.client_key=a.client_key LEFT JOIN app.revisions i ON i.id=ct.current_revision_id AND i.state='finalized'
   WHERE a.company_id=c AND contract_private.can_branch(c,a.branch_id,actor) AND a.client_key>coalesce(p->>'after','')
   AND ((w.draft IS NOT NULL AND w.draft_owner=actor) OR i.id IS NOT NULL) ORDER BY a.client_key LIMIT 16) q),'[]');
 END IF;
 IF action IN ('draft','issue','remove') THEN
  SELECT * INTO rr FROM contract_private.reservations WHERE client_key=p->>'record' AND company_id=c FOR UPDATE;
  IF rr.client_key IS NULL OR (NOT rr.issued AND rr.assigned_by<>actor) THEN RAISE insufficient_privilege; END IF;
  SELECT draft_owner INTO owner_id FROM contract_private.workspace_records WHERE client_key=rr.client_key AND draft IS NOT NULL;
  IF owner_id IS NOT NULL AND owner_id<>actor THEN RAISE insufficient_privilege; END IF;
 END IF;
 ans:=contract_private.archive_op(actor,action,p);
 IF action IN ('draft','issue','remove') THEN
  UPDATE contract_private.workspace_records SET draft_owner=CASE WHEN draft IS NOT NULL THEN actor END WHERE client_key=rr.client_key;
 END IF;
 RETURN ans;
END $$;
CREATE OR REPLACE FUNCTION public.contract_number(actor uuid,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid;
BEGIN
 SELECT id INTO c FROM app.companies WHERE code=p->>'company';
 IF coalesce(contract_private.department(c,actor),'') NOT IN ('management','contracts') OR EXISTS(SELECT 1 FROM contract_private.reservations WHERE client_key=p->>'record' AND NOT issued AND assigned_by<>actor) THEN RAISE insufficient_privilege; END IF;
 RETURN contract_private.number_request(actor,p);
END $$;

CREATE FUNCTION public.sales_forms(actor uuid,action text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid; dept text; f contract_private.sales_forms; b app.branches; target uuid; form_data jsonb:=p->'data'; key text; num jsonb; result jsonb;
BEGIN
 SELECT id INTO c FROM app.companies WHERE code=p->>'company' AND active;
 dept:=contract_private.department(c,actor);
 IF dept IS NULL THEN RAISE insufficient_privilege; END IF;
 IF action='forms_list' THEN
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY changed DESC,id) FROM (
   SELECT s.id,s.version,s.changed,s.published,s.approved,(s.contract_key IS NOT NULL) AS linked,
    s.author=actor AS mine,br.name AS branch,e.display_name AS author_name,ae.display_name AS approved_by,
    coalesce(nullif(s.data->>'buyer',''),nullif(s.data->>'externalBuyer',''),s.data->>'externalSeller','') AS buyer,s.data->>'car' AS car,s.data->>'contractType' AS kind
   FROM contract_private.sales_forms s JOIN app.branches br ON br.id=s.branch_id JOIN app.employees e ON e.id=s.author LEFT JOIN app.employees ae ON ae.id=s.approver
   WHERE s.company_id=c AND contract_private.can_branch(c,s.branch_id,actor)
   AND ((s.author=actor AND dept<>'finance') OR (s.published IS NOT NULL AND dept<>'sales'))
   AND (p->>'before' IS NULL OR s.changed<(p->>'before')::timestamptz OR (s.changed=(p->>'before')::timestamptz AND s.id>(p->>'cursor')::uuid))
   ORDER BY s.changed DESC,s.id LIMIT 100) q),'[]');
 END IF;
 IF action='move_contract' THEN
  SELECT r.branch_id,r.client_key INTO target,key FROM contract_private.reservations r WHERE r.company_id=c AND r.client_key=p->>'record' AND r.assigned_by=actor AND NOT r.issued FOR UPDATE;
  IF key IS NULL OR dept NOT IN ('contracts','management') THEN RAISE insufficient_privilege; END IF;
  PERFORM contract_private.authorize_write(c,target,actor,false);
  SELECT br.* INTO b FROM app.branches br JOIN app.companies co ON co.id=br.company_id WHERE co.code=p->>'destination' AND br.active AND br.name=(SELECT name FROM app.branches WHERE id=target);
  IF coalesce(contract_private.department(b.company_id,actor),'') NOT IN ('management','contracts') THEN RAISE insufficient_privilege; END IF;
  PERFORM contract_private.authorize_write(b.company_id,b.id,actor,false);
  UPDATE contract_private.workspace_records SET draft=draft||jsonb_build_object('companyId',p->>'destination','initialCompanyId',p->>'destination'),version=version+1,modified=now()
   WHERE client_key=key AND draft_owner=actor AND draft IS NOT NULL AND version=(p->>'version')::bigint;
  IF NOT FOUND THEN RAISE serialization_failure; END IF;
  UPDATE contract_private.reservations SET company_id=b.company_id,branch_id=b.id WHERE client_key=key;
  RETURN 'true';
 END IF;
 SELECT * INTO f FROM contract_private.sales_forms WHERE id=(p->>'id')::uuid FOR UPDATE;
 IF f.id IS NULL THEN
  IF action<>'form_save' OR dept='finance' OR (p->>'version')::bigint IS DISTINCT FROM 0 THEN RAISE insufficient_privilege; END IF;
  SELECT * INTO b FROM app.branches WHERE company_id=c AND name=p->>'branch' AND active;
  PERFORM contract_private.authorize_write(c,b.id,actor,false);
  INSERT INTO contract_private.sales_forms(id,company_id,branch_id,author,data) VALUES((p->>'id')::uuid,c,b.id,actor,form_data) RETURNING * INTO f;
  RETURN jsonb_build_object('version',f.version);
 END IF;
 IF f.company_id<>c OR NOT contract_private.can_branch(c,f.branch_id,actor) OR
   ((f.published IS NULL OR dept='sales') AND f.author<>actor) OR (dept='finance' AND f.published IS NULL) THEN RAISE insufficient_privilege; END IF;
 IF action='form_read' THEN RETURN (to_jsonb(f)-'company_id'-'author'-'contract_key')||jsonb_build_object('linked',f.contract_key IS NOT NULL); END IF;
 PERFORM contract_private.authorize_write(c,f.branch_id,actor,false);
 IF action='form_convert' AND dept IN ('contracts','management') AND f.published IS NOT NULL AND f.contract_key IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM contract_private.reservations WHERE client_key=f.contract_key AND assigned_by=actor AND NOT issued) THEN RAISE EXCEPTION 'already converted' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('record',f.contract_key);
 END IF;
 IF f.author=actor AND dept<>'finance' AND f.data=form_data AND
    ((action='form_save' AND f.published IS NULL) OR (action='form_publish' AND f.published IS NOT NULL)) THEN
  RETURN jsonb_build_object('version',f.version);
 END IF;
 IF f.version IS DISTINCT FROM (p->>'version')::bigint THEN RAISE serialization_failure; END IF;
 IF action IN ('form_save','form_publish') AND f.author=actor AND dept<>'finance' AND f.published IS NULL THEN
  IF action='form_publish' AND nullif(trim(concat_ws('',form_data->>'buyer',form_data->>'externalBuyer',form_data->>'externalSeller')),'') IS NULL THEN RAISE invalid_parameter_value; END IF;
  UPDATE contract_private.sales_forms SET data=form_data,published=CASE WHEN action='form_publish' THEN now() END,version=version+1,changed=now() WHERE id=f.id RETURNING * INTO f;
 ELSIF action='form_approve' AND f.published IS NOT NULL AND contract_private.can_manage(c,f.branch_id,actor) THEN
  UPDATE contract_private.sales_forms SET approved=now(),approver=actor,version=version+1,changed=now() WHERE id=f.id AND approved IS NULL RETURNING * INTO f;
  IF NOT FOUND THEN RAISE serialization_failure; END IF;
 ELSIF action='form_convert' AND dept IN ('contracts','management') AND f.published IS NOT NULL THEN
  key:='contract-'||gen_random_uuid();SELECT * INTO b FROM app.branches WHERE id=f.branch_id;
  num:=public.contract_number(actor,jsonb_build_object('company',p->>'company','branch',b.name,'record',key,'mode','claim','prefix',p->>'prefix'));
  form_data:=(f.data-'signedFile'-'customerPhoto'-'offlineNumber'-'numberRequest'-'numberUnconfirmed'-'standaloneBook')||jsonb_build_object('recordId',key,'companyId',p->>'company','initialCompanyId',p->>'company','numberBranch',b.name,'number',num->>'number');
  PERFORM public.contract_archive(actor,'draft',jsonb_build_object('record',key,'data',form_data,'company',p->>'company','version',0));
  UPDATE contract_private.sales_forms SET contract_key=key,version=version+1,changed=now() WHERE id=f.id;
  result:=jsonb_build_object('record',key);
 ELSE RAISE insufficient_privilege; END IF;
 IF action<>'form_save' THEN
  INSERT INTO app.audit_events(company_id,branch_id,actor_id,action,entity_type,entity_id) VALUES(c,f.branch_id,actor,action,'sales_forms',f.id::text);
 END IF;
 RETURN coalesce(result,jsonb_build_object('version',f.version));
END $$;
REVOKE ALL ON FUNCTION public.sales_forms(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_forms(uuid,text,jsonb) TO service_role;


CREATE OR REPLACE FUNCTION contract_private.staff_row(m app.company_memberships) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',m.employee_id,'name',e.display_name,'username',h.username,'email',h.username,
  'department',m.department,'companies',(SELECT coalesce(jsonb_agg(co.code),'[]') FROM app.company_memberships peer JOIN app.companies co ON co.id=peer.company_id WHERE peer.employee_id=m.employee_id AND peer.active AND contract_private.is_admin(co.id,nullif(current_setting('contract.actor_id',true),'')::uuid)),
  'role',CASE WHEN m.role='administrator' THEN 'administrator' WHEN COALESCE(bool_or(bm.role='branch_manager'),false) THEN 'branch_manager' ELSE 'employee' END,
  'active',m.active AND e.active,'version',m.version,'branchIds',COALESCE(jsonb_agg(b.id ORDER BY b.name) FILTER(WHERE b.id IS NOT NULL),'[]'),
  'branchRoles',COALESCE(jsonb_object_agg(b.id,bm.role) FILTER(WHERE b.id IS NOT NULL),'{}'))
 FROM app.employees e JOIN contract_private.handles h ON h.employee=e.id
 LEFT JOIN app.branch_memberships bm ON bm.company_id=m.company_id AND bm.employee_id=e.id AND bm.active
 LEFT JOIN app.branches b ON b.id=bm.branch_id AND b.active
 WHERE e.id=m.employee_id GROUP BY e.id,h.username
$$;
CREATE FUNCTION public.contract_staff_assignment(actor uuid,action text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE base uuid; target_id uuid:=(p->>'target')::uuid; co app.companies; selected boolean; enabled boolean:=(p->>'active')::boolean;
 dept text:=coalesce(p->>'department','contracts'); role_name text:=p->>'role'; assigned record; branch_key uuid; result jsonb;
BEGIN
 SELECT id INTO base FROM app.companies WHERE code=p->>'company' AND active;
 IF target_id IS NULL OR actor=target_id OR NOT contract_private.is_admin(base,actor) THEN RAISE insufficient_privilege; END IF;
 IF role_name IN ('administrator','branch_manager') THEN dept:='contracts'; END IF;
 IF dept NOT IN ('contracts','sales','finance') THEN RAISE invalid_parameter_value; END IF;
 IF action='create' AND p->>'requestId' IS NOT NULL THEN
  result:=public.contract_review(actor,'approve_access',p);
 ELSIF action IN ('create','update') THEN result:=contract_private.portal(actor,action,p);
 ELSE RAISE invalid_parameter_value;END IF;
 UPDATE app.company_memberships SET department=dept WHERE employee_id=target_id AND company_id=base;
 IF p?'companies' THEN
  IF jsonb_typeof(p->'companies') IS DISTINCT FROM 'array' OR NOT (p->'companies' ? (p->>'company')) THEN RAISE invalid_parameter_value; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p->'companies') x WHERE NOT EXISTS(SELECT 1 FROM app.companies a WHERE a.code=x AND a.active AND contract_private.is_admin(a.id,actor))) THEN RAISE insufficient_privilege; END IF;
  FOR co IN SELECT * FROM app.companies WHERE id<>base AND active AND contract_private.is_admin(id,actor) ORDER BY id LOOP
   selected:=role_name IN ('administrator','branch_manager') OR (p->'companies' ? co.code);
   IF NOT selected AND NOT EXISTS(SELECT 1 FROM app.company_memberships WHERE company_id=co.id AND employee_id=target_id AND active) THEN CONTINUE; END IF;
   PERFORM contract_private.set_company_membership(actor,co.id,target_id,CASE WHEN role_name='administrator' AND selected THEN 'administrator' ELSE 'staff' END,selected AND enabled);
   UPDATE app.company_memberships SET department=dept,version=version+1 WHERE company_id=co.id AND employee_id=target_id;
   UPDATE app.branch_memberships SET active=false WHERE company_id=co.id AND employee_id=target_id AND active;
   IF selected AND role_name<>'administrator' THEN
    FOR assigned IN SELECT b.name,x.value AS role FROM jsonb_each_text(p->'branchRoles') x JOIN app.branches b ON b.id=x.key::uuid AND b.company_id=base LOOP
     SELECT id INTO branch_key FROM app.branches WHERE company_id=co.id AND name=assigned.name AND active;
     IF branch_key IS NULL THEN RAISE invalid_parameter_value; END IF;
     PERFORM contract_private.set_branch_membership(actor,co.id,branch_key,target_id,assigned.role,true);
    END LOOP;
   END IF;
  END LOOP;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.contract_staff_assignment(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contract_staff_assignment(uuid,text,jsonb) TO service_role;
-- Direct browser reads of the normalized archive expose issued revisions only.
-- Personal work-in-progress is read through the owner-checked workspace operation.
CREATE POLICY archive_issued ON app.contracts AS RESTRICTIVE FOR SELECT TO authenticated USING(current_revision_id IS NOT NULL);
CREATE POLICY archive_issued ON app.revisions AS RESTRICTIVE FOR SELECT TO authenticated USING(state='finalized');
DO $policies$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['revision_finance','revision_parties','revision_vehicles','payment_schedule','revision_table_rows','promissory_notes','documents'] LOOP
  EXECUTE format('CREATE POLICY archive_issued ON app.%I AS RESTRICTIVE FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM app.revisions r WHERE r.id=revision_id AND r.state=''finalized''))',t);
 END LOOP;
END $policies$;
