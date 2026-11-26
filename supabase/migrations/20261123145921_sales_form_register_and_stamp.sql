ALTER TABLE contract_private.sales_forms ADD COLUMN created_at timestamptz,
 ADD COLUMN approval_note text CHECK (length(approval_note) BETWEEN 1 AND 240);
UPDATE contract_private.sales_forms SET created_at=coalesce(published,changed);
ALTER TABLE contract_private.sales_forms ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN created_at SET NOT NULL;
CREATE INDEX sales_forms_register_month ON contract_private.sales_forms(company_id,(coalesce(published,created_at)),branch_id);

CREATE FUNCTION contract_private.full_staff_name(n text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(trim(n) ~ '^[^[:space:]0-9٠-٩]+([[:space:]]+[^[:space:]0-9٠-٩]+)+$',false)
$$;
ALTER FUNCTION public.contract_staff_assignment(uuid,text,jsonb) RENAME TO assign_brand_staff;
ALTER FUNCTION public.assign_brand_staff(uuid,text,jsonb) SET SCHEMA contract_private;
CREATE FUNCTION public.contract_staff_assignment(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n text:=trim(regexp_replace(p->>'name','[[:space:]]+',' ','g')); target uuid:=(p->>'target')::uuid; result jsonb;
BEGIN
 IF (action='create' OR (p->>'active')::boolean) AND (p->>'department'='sales' OR p->>'role' IN ('administrator','branch_manager'))
 AND NOT contract_private.full_staff_name(n) THEN RAISE invalid_parameter_value USING MESSAGE='Enter first and family name'; END IF;
 result:=contract_private.assign_brand_staff(actor,action,p||jsonb_build_object('name',n));
 -- A global display name can only be changed by an administrator of all their memberships.
 IF action='update' AND EXISTS(SELECT FROM app.employees WHERE id=target AND display_name<>n) THEN
  IF EXISTS(SELECT FROM app.company_memberships m WHERE m.employee_id=target AND NOT contract_private.is_admin(m.company_id,actor)) THEN RAISE insufficient_privilege; END IF;
  UPDATE app.employees SET display_name=n WHERE id=target;
 END IF;
 RETURN result;
END $$;

ALTER FUNCTION public.sales_forms(uuid,text,jsonb) RENAME TO shared_sales_forms;
ALTER FUNCTION public.shared_sales_forms(uuid,text,jsonb) SET SCHEMA contract_private;
CREATE FUNCTION public.sales_forms(actor uuid,action text,p jsonb) RETURNS jsonb
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
   SELECT s.id,s.version,s.changed,s.published,s.approved,s.approval_note,s.author=actor AS mine,s.approver=actor AS my_approval,
    coalesce(s.published,s.created_at) AS listed_on,c.code AS company,b.name AS branch,
    coalesce(s.author_label,e.display_name) AS author_name,coalesce(s.approver_label,a.display_name) AS approved_by,
    s.contract_key IS NOT NULL AS linked,s.data->>'contractType' AS kind,s.data->>'car' AS car,s.data->>'vin' AS vin,s.data->>'total' AS total,
    coalesce(nullif(s.data->>'buyer',''),nullif(s.data->>'externalBuyer',''),s.data->>'externalSeller','') AS buyer
   FROM contract_private.sales_forms s JOIN app.companies c ON c.id=s.company_id JOIN app.branches b ON b.id=s.branch_id
   JOIN app.employees e ON e.id=s.author LEFT JOIN app.employees a ON a.id=s.approver
   WHERE c.active AND (c.id=src.id OR (src.shared_brand AND c.shared_brand)) AND contract_private.can_branch(c.id,b.id,actor)
    AND ((s.author=actor AND contract_private.department(c.id,actor)<>'finance')
      OR (s.published IS NOT NULL AND contract_private.department(c.id,actor) IN ('management','contracts','finance')))
    AND (start_at IS NULL OR (coalesce(s.published,s.created_at)>=start_at AND coalesce(s.published,s.created_at)<end_at))
    AND (p->>'before' IS NULL OR s.changed<(p->>'before')::timestamptz OR (s.changed=(p->>'before')::timestamptz AND s.id>(p->>'cursor')::uuid))
   ORDER BY s.changed DESC,s.id LIMIT 100) q),'[]');
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
REVOKE ALL ON FUNCTION contract_private.full_staff_name(text),contract_private.assign_brand_staff(uuid,text,jsonb),contract_private.shared_sales_forms(uuid,text,jsonb),
 public.contract_staff_assignment(uuid,text,jsonb),public.sales_forms(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.contract_staff_assignment(uuid,text,jsonb),public.sales_forms(uuid,text,jsonb) TO service_role;
