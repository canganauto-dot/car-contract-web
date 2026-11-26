-- Brands in this workspace share staff and branch permissions. Historical records
-- retain their issuer and immutable revisions retain their original snapshots.
ALTER TABLE app.companies ADD COLUMN shared_brand boolean NOT NULL DEFAULT false,
 ADD COLUMN brand_profile jsonb NOT NULL DEFAULT '{}';
UPDATE app.companies SET shared_brand=true WHERE code IN ('bakheet','imad');

CREATE FUNCTION contract_private.copy_brand_staff(src uuid,dst uuid,emp uuid)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 INSERT INTO app.company_memberships(company_id,employee_id,role,active,department)
 SELECT dst,employee_id,role,active,department FROM app.company_memberships WHERE company_id=src AND employee_id=emp
 ON CONFLICT(company_id,employee_id) DO UPDATE SET role=excluded.role,active=excluded.active,department=excluded.department,
 version=app.company_memberships.version+1;
 UPDATE app.branch_memberships SET active=false WHERE company_id=dst AND employee_id=emp AND active;
 INSERT INTO app.branch_memberships(company_id,branch_id,employee_id,role,active)
 SELECT dst,d.id,emp,m.role,true FROM app.branch_memberships m JOIN app.branches b ON b.id=m.branch_id
 JOIN app.branches d ON d.company_id=dst AND d.code=b.code AND d.active
 WHERE m.company_id=src AND m.employee_id=emp AND m.active AND b.active
 ON CONFLICT(company_id,branch_id,employee_id) DO UPDATE SET role=excluded.role,active=true;
END $$;
DO $$ DECLARE m record; dest uuid; BEGIN
 IF EXISTS(SELECT x.employee_id FROM app.company_memberships x JOIN app.companies c ON c.id=x.company_id
  WHERE c.shared_brand AND x.active GROUP BY x.employee_id HAVING count(DISTINCT (x.role,x.department))>1)
 THEN RAISE EXCEPTION 'Resolve conflicting active staff roles or departments before unifying the workspace'; END IF;
 CREATE TEMP TABLE original_workspace_branches ON COMMIT DROP AS
 SELECT bm.employee_id,b.code,CASE WHEN bool_or(bm.role='branch_manager') THEN 'branch_manager' ELSE 'employee' END AS role
 FROM app.branch_memberships bm JOIN app.branches b ON b.id=bm.branch_id JOIN app.companies c ON c.id=bm.company_id
 JOIN app.company_memberships membership ON membership.company_id=c.id AND membership.employee_id=bm.employee_id
 WHERE c.shared_brand AND membership.active AND bm.active AND b.active GROUP BY bm.employee_id,b.code;
 FOR m IN SELECT DISTINCT ON (x.employee_id) x.employee_id,x.company_id FROM app.company_memberships x
 JOIN app.companies c ON c.id=x.company_id WHERE c.shared_brand ORDER BY x.employee_id,x.active DESC,(c.code='bakheet') DESC LOOP
  FOR dest IN SELECT id FROM app.companies WHERE shared_brand AND id<>m.company_id LOOP
   PERFORM contract_private.copy_brand_staff(m.company_id,dest,m.employee_id);
  END LOOP;
 END LOOP;
 INSERT INTO app.branch_memberships(company_id,branch_id,employee_id,role,active)
 SELECT c.id,b.id,s.employee_id,s.role,true FROM pg_temp.original_workspace_branches s
 JOIN app.branches b ON b.code=s.code AND b.active JOIN app.companies c ON c.id=b.company_id AND c.shared_brand
 ON CONFLICT(company_id,branch_id,employee_id) DO UPDATE SET role=excluded.role,active=true;
END $$;

ALTER FUNCTION public.contract_staff_assignment(uuid,text,jsonb) SET SCHEMA contract_private;
CREATE FUNCTION public.contract_staff_assignment(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE src app.companies; dst uuid; result jsonb;
BEGIN
 SELECT * INTO src FROM app.companies WHERE code=p->>'company' AND active;
 IF NOT src.shared_brand THEN RETURN contract_private.contract_staff_assignment(actor,action,p); END IF;
 -- Serialize staff changes and brand creation in the same workspace.
 PERFORM 1 FROM app.companies WHERE code='bakheet' FOR UPDATE;
 result:=contract_private.contract_staff_assignment(actor,action,p-'companies');
 FOR dst IN SELECT id FROM app.companies WHERE shared_brand AND active AND id<>src.id LOOP
  PERFORM contract_private.copy_brand_staff(src.id,dst,(p->>'target')::uuid);
 END LOOP;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.contract_portal(actor uuid,action text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; base uuid; dest uuid; emp uuid; brand jsonb:=payload->'brand'; current_brand boolean;
BEGIN
 SELECT id INTO base FROM app.companies WHERE code='bakheet' AND shared_brand AND active;
 SELECT shared_brand INTO current_brand FROM app.companies WHERE code=payload->>'company' AND active;
 IF action='brand_save' THEN
  PERFORM 1 FROM app.companies WHERE id=base FOR UPDATE;
  IF NOT contract_private.is_admin(base,actor) THEN RAISE insufficient_privilege; END IF;
  IF jsonb_typeof(brand) IS DISTINCT FROM 'object' OR coalesce(brand->>'id','') !~ '^[a-zA-Z0-9_-]{1,64}$' OR
     length(trim(coalesce(brand->>'name',''))) NOT BETWEEN 1 AND 120 OR octet_length(brand::text)>15000000 THEN RAISE invalid_parameter_value; END IF;
  SELECT id INTO dest FROM app.companies WHERE code=brand->>'id';
  IF dest IS NULL THEN
   INSERT INTO app.companies(code,name,legal_name,brand_profile,shared_brand) VALUES(brand->>'id',brand->>'name',coalesce(brand->>'fullName',''),brand,true) RETURNING id INTO dest;
   INSERT INTO app.branches(company_id,code,name,active) SELECT dest,code,name,active FROM app.branches WHERE company_id=base;
   FOR emp IN SELECT employee_id FROM app.company_memberships WHERE company_id=base LOOP
    PERFORM contract_private.copy_brand_staff(base,dest,emp);
   END LOOP;
  ELSE
   UPDATE app.companies SET name=brand->>'name',legal_name=coalesce(brand->>'fullName',''),brand_profile=brand
   WHERE id=dest AND shared_brand AND active;
   IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  END IF;
  INSERT INTO app.audit_events(company_id,actor_id,action,entity_type,entity_id) VALUES(dest,actor,'brand_save','companies',dest::text);
  RETURN 'true';
 END IF;
 IF action IN ('layouts','publish') AND current_brand THEN
  payload:=payload||'{"company":"bakheet"}';
 END IF;
 result:=contract_private.portal(actor,action,payload);
 IF action='layouts' AND current_brand THEN
  -- Preserve layouts edited under either name before consolidation. For each
  -- template use the most recently approved version, excluding issued snapshots.
  RETURN result||jsonb_build_object('layouts',coalesce((SELECT jsonb_object_agg(s.template_key,s.val) FROM (
   SELECT DISTINCT ON(t.template_key) t.template_key,jsonb_build_object('layout',v.layout,'baseHash',v.renderer_version) val
   FROM app.templates t JOIN app.template_versions v ON v.template_id=t.id JOIN app.companies c ON c.id=t.company_id
   WHERE c.shared_brand AND t.template_key ~ '^(book|contract):' ORDER BY t.template_key,v.created_at DESC,v.id) s),'{}'));
 END IF;
 IF action='session' THEN
  RETURN result||jsonb_build_object('companies',coalesce((SELECT jsonb_agg(j||jsonb_build_object('sharedBrand',c.shared_brand,'brandProfile',c.brand_profile) ORDER BY (c.code='bakheet') DESC,c.code)
    FROM jsonb_array_elements(result->'companies') j JOIN app.companies c ON c.code=j->>'id'),'[]'));
 END IF;
 RETURN result;
END $$;

-- The issuer can be changed on a personal draft, together with its versioned
-- write. Approval and author names come exclusively from the employee registry.
ALTER TABLE contract_private.sales_forms ADD COLUMN author_label text, ADD COLUMN approver_label text;
UPDATE contract_private.sales_forms f SET author_label=(SELECT display_name FROM app.employees WHERE id=f.author),
 approver_label=(SELECT display_name FROM app.employees WHERE id=f.approver) WHERE f.published IS NOT NULL;
ALTER FUNCTION public.sales_forms(uuid,text,jsonb) SET SCHEMA contract_private;
ALTER FUNCTION contract_private.sales_forms(uuid,text,jsonb) RENAME TO sales_form_op;
CREATE FUNCTION public.sales_forms(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f contract_private.sales_forms; dest app.companies; b uuid; result jsonb;
BEGIN
 IF action='forms_list' AND EXISTS(SELECT FROM app.companies c WHERE c.code=p->>'company' AND c.shared_brand AND contract_private.is_member(c.id,actor)) THEN
  RETURN coalesce((SELECT jsonb_agg(q.item ORDER BY (q.item->>'changed')::timestamptz DESC,q.item->>'id') FROM (
   SELECT j||jsonb_build_object('company',c.code) AS item FROM app.companies c
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN c.active AND c.shared_brand AND contract_private.is_member(c.id,actor)
    THEN contract_private.sales_form_op(actor,action,p||jsonb_build_object('company',c.code)) ELSE '[]'::jsonb END) j
   ORDER BY (j->>'changed')::timestamptz DESC,j->>'id' LIMIT 100) q),'[]');
 END IF;
 IF action IN ('form_save','form_publish') THEN
  SELECT * INTO f FROM contract_private.sales_forms WHERE id=(p->>'id')::uuid FOR UPDATE;
  SELECT * INTO dest FROM app.companies WHERE code=p->>'company' AND active;
  IF f.id IS NOT NULL AND dest.id IS DISTINCT FROM f.company_id THEN
   IF f.author<>actor OR f.published IS NOT NULL OR NOT dest.shared_brand OR NOT EXISTS(SELECT FROM app.companies WHERE id=f.company_id AND shared_brand)
    OR NOT contract_private.can_branch(f.company_id,f.branch_id,actor) OR f.version IS DISTINCT FROM (p->>'version')::bigint THEN RAISE insufficient_privilege; END IF;
   SELECT d.id INTO b FROM app.branches old JOIN app.branches d ON d.company_id=dest.id AND d.code=old.code AND d.active WHERE old.id=f.branch_id;
   PERFORM contract_private.authorize_write(dest.id,b,actor,false);
   IF contract_private.department(dest.id,actor) NOT IN ('management','contracts','sales') THEN RAISE insufficient_privilege; END IF;
   UPDATE contract_private.sales_forms SET company_id=dest.id,branch_id=b WHERE id=f.id;
  END IF;
  p:=jsonb_set(p,'{data,companyId}',to_jsonb(dest.code));
 END IF;
 result:=contract_private.sales_form_op(actor,action,p);
 IF action='form_publish' THEN
  UPDATE contract_private.sales_forms s SET author_label=e.display_name FROM app.employees e
   WHERE s.id=(p->>'id')::uuid AND e.id=s.author AND s.author_label IS NULL;
 ELSIF action='form_approve' THEN
  UPDATE contract_private.sales_forms s SET approver_label=e.display_name FROM app.employees e
   WHERE s.id=(p->>'id')::uuid AND e.id=s.approver AND s.approver_label IS NULL;
 END IF;
 IF action='form_read' THEN
  SELECT result||jsonb_build_object('company',c.code,'branch',b.name,'author_name',coalesce(s.author_label,e.display_name),'approved_by',coalesce(s.approver_label,a.display_name)) INTO result
  FROM contract_private.sales_forms s JOIN app.companies c ON c.id=s.company_id JOIN app.branches b ON b.id=s.branch_id
  JOIN app.employees e ON e.id=s.author LEFT JOIN app.employees a ON a.id=s.approver WHERE s.id=(p->>'id')::uuid;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION contract_private.copy_brand_staff(uuid,uuid,uuid),contract_private.sales_form_op(uuid,text,jsonb),contract_private.contract_staff_assignment(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.contract_staff_assignment(uuid,text,jsonb),public.sales_forms(uuid,text,jsonb),public.contract_portal(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contract_staff_assignment(uuid,text,jsonb),public.sales_forms(uuid,text,jsonb),public.contract_portal(uuid,text,jsonb) TO service_role;

ALTER FUNCTION public.contract_archive(uuid,text,jsonb) SET SCHEMA contract_private;
CREATE FUNCTION public.contract_archive(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF action='list' AND EXISTS(SELECT FROM app.companies c WHERE c.code=p->>'company' AND c.shared_brand AND contract_private.is_member(c.id,actor)) THEN
  IF contract_private.department((SELECT id FROM app.companies WHERE code=p->>'company'),actor) NOT IN ('management','contracts') THEN RAISE insufficient_privilege; END IF;
  RETURN coalesce((SELECT jsonb_agg(q.item ORDER BY q.item->>'record') FROM (
   SELECT j||jsonb_build_object('company',c.code) AS item FROM app.companies c
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN c.active AND c.shared_brand AND contract_private.department(c.id,actor) IN ('management','contracts')
    THEN contract_private.contract_archive(actor,action,p||jsonb_build_object('company',c.code)) ELSE '[]'::jsonb END) j
   ORDER BY j->>'record' LIMIT 16) q),'[]');
 END IF;
 RETURN contract_private.contract_archive(actor,action,p);
END $$;
REVOKE ALL ON FUNCTION contract_private.contract_archive(uuid,text,jsonb),public.contract_archive(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.contract_archive(uuid,text,jsonb) TO service_role;

-- New requests and design approvals use one queue and one revision head. Keep
-- historical request IDs usable when an administrator opens the merged queue.
ALTER FUNCTION public.contract_review(uuid,text,jsonb) SET SCHEMA contract_private;
CREATE FUNCTION public.contract_review(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE src app.companies; base uuid; req contract_private.approvals; duplicate uuid;
BEGIN
 SELECT * INTO src FROM app.companies WHERE code=p->>'company' AND active;
 IF src.shared_brand IS NOT TRUE THEN RETURN contract_private.contract_review(actor,action,p); END IF;
 SELECT id INTO base FROM app.companies WHERE code='bakheet' AND active;
 IF action='pending' THEN
  IF NOT contract_private.is_admin(base,actor) THEN RAISE insufficient_privilege; END IF;
  RETURN coalesce((SELECT jsonb_agg(j ORDER BY j->>'created') FROM app.companies c
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN c.shared_brand AND c.active AND contract_private.is_admin(c.id,actor)
    THEN contract_private.contract_review(actor,action,jsonb_build_object('company',c.code)) ELSE '[]'::jsonb END) j),'[]');
 END IF;
 IF action NOT IN ('request_access','propose') THEN
  IF NOT contract_private.is_admin(base,actor) THEN RAISE insufficient_privilege; END IF;
  SELECT a.* INTO req FROM contract_private.approvals a JOIN app.companies c ON c.id=a.company_id AND c.shared_brand
   WHERE a.id=(p->>'requestId')::uuid AND a.state='pending' FOR UPDATE OF a;
  IF req.company_id<>base THEN
   IF action IN ('inspect','reject') THEN
    RETURN contract_private.contract_review(actor,action,p||jsonb_build_object('company',(SELECT code FROM app.companies WHERE id=req.company_id)));
   END IF;
   IF req.kind='access' THEN
    SELECT id INTO duplicate FROM contract_private.approvals WHERE company_id=base AND kind='access' AND subject=req.subject AND state='pending' FOR UPDATE;
    IF duplicate IS NOT NULL THEN RAISE EXCEPTION 'Review the existing workspace request first' USING ERRCODE='40001'; END IF;
   END IF;
   UPDATE contract_private.approvals SET company_id=base,payload=CASE WHEN kind='design' THEN payload||'{"company":"bakheet"}' ELSE payload END WHERE id=req.id;
  END IF;
 END IF;
 RETURN contract_private.contract_review(actor,action,p||'{"company":"bakheet"}');
END $$;
REVOKE ALL ON FUNCTION contract_private.contract_review(uuid,text,jsonb),public.contract_review(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.contract_review(uuid,text,jsonb) TO service_role;
