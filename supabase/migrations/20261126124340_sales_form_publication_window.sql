ALTER TABLE contract_private.sales_forms ADD COLUMN republished_at timestamptz, ADD COLUMN removed_at timestamptz;
-- Exclude sales-only metadata when deriving the contract draft.
DO $$ DECLARE src text; marker text:='f.data-''signedFile'''; BEGIN
 src:=pg_get_functiondef('contract_private.sales_form_op(uuid,text,jsonb)'::regprocedure);
 IF strpos(src,marker)=0 THEN RAISE EXCEPTION 'Unexpected form conversion definition'; END IF;
 EXECUTE replace(src,marker,'f.data-''formFees''-''formInstallmentNote''-''signedFile''');
END $$;
CREATE OR REPLACE FUNCTION public.sales_forms(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE src app.companies; f contract_private.sales_forms; res jsonb; note text;
 month_start timestamp; start_at timestamptz; end_at timestamptz;
BEGIN
 SELECT * INTO src FROM app.companies WHERE active AND code=p->>'company';
 IF src.id IS NULL OR NOT contract_private.is_member(src.id,actor) THEN RAISE insufficient_privilege; END IF;
 IF action='forms_list' THEN
  IF nullif(p->>'month','') IS NOT NULL THEN
   IF p->>'month' !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' THEN RAISE invalid_parameter_value; END IF;
   month_start:=((p->>'month')||'-01')::date;
   start_at:=month_start AT TIME ZONE 'Asia/Baghdad';end_at:=(month_start+interval '1 month') AT TIME ZONE 'Asia/Baghdad';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY changed DESC,id) FROM (
   SELECT s.id,s.version,s.changed,s.published,s.approved,s.approval_note,s.republished_at,s.author=actor AS mine,s.approver=actor AS my_approval,
    coalesce(s.published,s.created_at) AS listed_on,c.code AS company,b.name AS branch,
    coalesce(s.author_label,e.display_name) AS author_name,coalesce(s.approver_label,a.display_name) AS approved_by,
    s.contract_key IS NOT NULL AS linked,s.data->>'contractType' AS kind,s.data->>'car' AS car,s.data->>'vin' AS vin,s.data->>'total' AS total,
    coalesce(nullif(s.data->>'buyer',''),nullif(s.data->>'externalBuyer',''),s.data->>'externalSeller','') AS buyer
   FROM contract_private.sales_forms s JOIN app.companies c ON c.id=s.company_id JOIN app.branches b ON b.id=s.branch_id
   JOIN app.employees e ON e.id=s.author LEFT JOIN app.employees a ON a.id=s.approver
   WHERE s.removed_at IS NULL AND c.active AND (c.id=src.id OR (src.shared_brand AND c.shared_brand)) AND contract_private.can_branch(c.id,b.id,actor)
    AND ((s.author=actor AND contract_private.department(c.id,actor)<>'finance')
      OR (s.published IS NOT NULL AND contract_private.department(c.id,actor) IN ('management','contracts','finance')))
    AND (start_at IS NULL OR (coalesce(s.published,s.created_at)>=start_at AND coalesce(s.published,s.created_at)<end_at))
    AND (p->>'before' IS NULL OR s.changed<(p->>'before')::timestamptz OR (s.changed=(p->>'before')::timestamptz AND s.id>(p->>'cursor')::uuid))
   ORDER BY s.changed DESC,s.id LIMIT 100) q),'[]');
 END IF;
 IF p?'id' THEN
  IF action IN ('form_save','form_publish','form_approve','form_convert','form_delete','form_republish') THEN
   PERFORM 1 FROM contract_private.sales_forms s WHERE s.id=(p->>'id')::uuid AND s.company_id=src.id FOR UPDATE;
  END IF;
  IF EXISTS(SELECT FROM contract_private.sales_forms s WHERE s.id=(p->>'id')::uuid AND s.removed_at IS NOT NULL) THEN RAISE insufficient_privilege; END IF;
 END IF;
 IF action IN ('form_delete','form_republish') THEN
  SELECT * INTO f FROM contract_private.sales_forms WHERE id=(p->>'id')::uuid AND company_id=src.id FOR UPDATE;
  IF f.id IS NULL OR f.author<>actor OR f.removed_at IS NOT NULL OR contract_private.department(src.id,actor)='finance' THEN RAISE insufficient_privilege; END IF;
  PERFORM contract_private.authorize_write(src.id,f.branch_id,actor,false);
  IF f.version IS DISTINCT FROM (p->>'version')::bigint THEN RAISE serialization_failure; END IF;
  IF action='form_delete' THEN
   IF f.published IS NOT NULL THEN RAISE insufficient_privilege; END IF;
   UPDATE contract_private.sales_forms SET removed_at=clock_timestamp(),version=version+1 WHERE id=f.id;
  ELSE
   IF f.published IS NULL OR clock_timestamp()>=f.published+interval '30 minutes' OR contract_private.department(src.id,actor)<>'sales' THEN RAISE insufficient_privilege; END IF;
   IF jsonb_typeof(p->'data') IS DISTINCT FROM 'object' OR nullif(trim(concat_ws('',p#>>'{data,buyer}',p#>>'{data,externalBuyer}',p#>>'{data,externalSeller}')),'') IS NULL THEN RAISE invalid_parameter_value; END IF;
   UPDATE contract_private.sales_forms SET data=(p->'data')||jsonb_build_object('companyId',src.code),republished_at=clock_timestamp(),
    approved=NULL,approver=NULL,approver_label=NULL,approval_note=NULL,version=version+1,changed=clock_timestamp() WHERE id=f.id;
  END IF;
  INSERT INTO app.audit_events(company_id,branch_id,actor_id,action,entity_type,entity_id,detail)
   VALUES(src.id,f.branch_id,actor,action,'sales_forms',f.id::text,jsonb_build_object('previousVersion',f.version,'previousApproval',f.approved,'previousApprover',f.approver));
  RETURN jsonb_build_object('version',f.version+1);
 END IF;
 IF action='form_approve' THEN
  SELECT * INTO f FROM contract_private.sales_forms WHERE id=(p->>'id')::uuid AND company_id=src.id FOR UPDATE;
  IF f.id IS NULL OR f.published IS NULL OR NOT contract_private.can_manage(src.id,f.branch_id,actor)
   OR (f.approved IS NOT NULL AND f.approver IS DISTINCT FROM actor) THEN RAISE insufficient_privilege; END IF;
  PERFORM contract_private.authorize_write(src.id,f.branch_id,actor,true);
  IF NOT contract_private.full_staff_name((SELECT display_name FROM app.employees WHERE id=actor)) THEN RAISE invalid_parameter_value USING MESSAGE='Set the approver name first'; END IF;
  note:=btrim(p->>'approval_note',E' \t\r\n');
  IF coalesce(length(note),0) NOT BETWEEN 1 AND 240 THEN RAISE invalid_parameter_value; END IF;
  IF f.version IS DISTINCT FROM (p->>'version')::bigint THEN RAISE serialization_failure; END IF;
  IF f.approved IS NOT NULL THEN
   IF f.approval_note IS NOT DISTINCT FROM note THEN RETURN jsonb_build_object('version',f.version); END IF;
   UPDATE contract_private.sales_forms SET approval_note=note,changed=now(),version=version+1 WHERE id=f.id RETURNING version INTO f.version;
   INSERT INTO app.audit_events(company_id,branch_id,actor_id,action,entity_type,entity_id,detail)
   VALUES(src.id,f.branch_id,actor,'approval_note_update','sales_forms',f.id::text,jsonb_build_object('previous',f.approval_note,'note',note));
   RETURN jsonb_build_object('version',f.version);
  END IF;
 END IF;
 IF action='form_publish' AND contract_private.department(src.id,actor)='sales' AND
  NOT contract_private.full_staff_name((SELECT display_name FROM app.employees WHERE id=actor)) THEN RAISE invalid_parameter_value USING MESSAGE='Set the salesperson name first'; END IF;
 res:=contract_private.shared_sales_forms(actor,action,p);
 IF action='form_approve' THEN UPDATE contract_private.sales_forms SET approval_note=note WHERE id=f.id; END IF;
 IF action='form_read' THEN
  -- Older demo/imported forms sometimes stored a login handle as a signature.
  -- Resolve only those placeholders from the employee who actually signed.
  SELECT res||jsonb_build_object('my_approval',s.approver=actor,
   'author_name',CASE WHEN res->>'author_name'=h.username THEN coalesce(nullif(e.display_name,h.username),'الاسم غير مكتمل') ELSE res->>'author_name' END,
   'approved_by',CASE WHEN res->>'approved_by'=ah.username THEN coalesce(nullif(a.display_name,ah.username),'الاسم غير مكتمل') ELSE res->>'approved_by' END)
  INTO res FROM contract_private.sales_forms s JOIN app.employees e ON e.id=s.author LEFT JOIN contract_private.handles h ON h.employee=e.id
  LEFT JOIN app.employees a ON a.id=s.approver LEFT JOIN contract_private.handles ah ON ah.employee=a.id WHERE s.id=(p->>'id')::uuid;
 END IF;
 RETURN res;
END $$;

-- Only enrich records returned by the authorized archive operation. The sales
-- employee on a converted form may differ from the clerk who created the contract.
ALTER FUNCTION public.contract_archive(uuid,text,jsonb) RENAME TO shared_archive_page;
ALTER FUNCTION public.shared_archive_page(uuid,text,jsonb) SET SCHEMA contract_private;
CREATE FUNCTION public.contract_archive(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result:=contract_private.shared_archive_page(actor,action,p);
 IF action<>'list' THEN RETURN result; END IF;
 RETURN coalesce((SELECT jsonb_agg(j.item||jsonb_build_object('seller',coalesce(f.author_label,s.display_name,e.display_name)) ORDER BY j.pos)
  FROM jsonb_array_elements(result) WITH ORDINALITY j(item,pos)
  JOIN contract_private.reservations r ON r.client_key=j.item->>'record'
  JOIN app.employees e ON e.id=r.assigned_by LEFT JOIN contract_private.sales_forms f ON f.contract_key=r.client_key
  LEFT JOIN app.employees s ON s.id=f.author),'[]');
END $$;
REVOKE ALL ON FUNCTION contract_private.shared_archive_page(uuid,text,jsonb),public.contract_archive(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.contract_archive(uuid,text,jsonb) TO service_role;
