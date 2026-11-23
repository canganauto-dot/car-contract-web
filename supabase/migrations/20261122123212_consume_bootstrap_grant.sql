CREATE OR REPLACE FUNCTION contract_private.portal(actor uuid, action text, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c app.companies; m app.company_memberships; target uuid; b uuid; v_role text; h text;
 enabled boolean; old_version bigint; result jsonb; allowed text[]; token uuid; tpl uuid; next_version integer;
BEGIN
 IF action='identity' THEN
  RETURN to_jsonb((SELECT u.email FROM auth.users u JOIN contract_private.handles h ON h.employee=u.id JOIN app.employees e ON e.id=h.employee
    WHERE h.username=lower(payload->>'username') AND e.active));
 END IF;
 IF action='bootstrap_check' OR action='bootstrap' THEN
  SELECT companies INTO allowed FROM contract_private.initial_access
   WHERE digest=encode(sha256(convert_to(payload->>'secret','UTF8')),'hex') AND expires_at>now() FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM contract_private.handles) THEN RAISE insufficient_privilege; END IF;
  IF action='identity' THEN
  RETURN to_jsonb((SELECT u.email FROM auth.users u JOIN contract_private.handles h ON h.employee=u.id JOIN app.employees e ON e.id=h.employee
    WHERE h.username=lower(payload->>'username') AND e.active));
 END IF;
 IF action='bootstrap_check' THEN RETURN 'true'; END IF;
  target:=(payload->>'target')::uuid;
  INSERT INTO app.employees(id,display_name) VALUES(target,'مدير النظام');
  INSERT INTO contract_private.handles VALUES(target,'admin');
  PERFORM set_config('contract.actor_id',target::text,true);
  INSERT INTO app.company_memberships(company_id,employee_id,role) SELECT id,target,'administrator' FROM app.companies WHERE code=ANY(allowed);
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid bootstrap scope'; END IF;
  DELETE FROM contract_private.initial_access WHERE singleton; RETURN 'true';
 END IF;
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM app.employees WHERE id=actor AND active) THEN RAISE insufficient_privilege; END IF;
 PERFORM set_config('contract.actor_id',actor::text,true);
 IF action='session' THEN
  SELECT jsonb_build_object('name',e.display_name,'userId',e.id,'username',h.username,'companies',COALESCE((
   SELECT jsonb_agg(contract_private.staff_row(cm)||jsonb_build_object('id',co.code,'name',co.name,'memberId',actor,'branches',
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',br.id,'name',br.name) ORDER BY br.name)
    FROM app.branches br WHERE br.company_id=co.id AND br.active AND contract_private.can_branch(co.id,br.id,actor)),'[]')) ORDER BY co.code)
   FROM app.company_memberships cm JOIN app.companies co ON co.id=cm.company_id
   WHERE cm.employee_id=actor AND cm.active AND co.active),'[]')) INTO result FROM app.employees e JOIN contract_private.handles h ON h.employee=e.id WHERE e.id=actor;
  RETURN result;
 END IF;
 SELECT * INTO c FROM app.companies WHERE code=payload->>'company' AND active;
 IF c.id IS NULL OR NOT contract_private.is_member(c.id,actor) THEN RAISE insufficient_privilege; END IF;
 IF action='layouts' THEN
  SELECT jsonb_build_object('revision',COALESCE((SELECT revision::text FROM contract_private.layout_heads WHERE company_id=c.id),'0'),
   'layouts',COALESCE((SELECT jsonb_object_agg(t.template_key,jsonb_build_object('layout',v.layout,'baseHash',v.renderer_version))
   FROM app.templates t CROSS JOIN LATERAL (SELECT layout,renderer_version FROM app.template_versions WHERE template_id=t.id ORDER BY version DESC LIMIT 1) v
   WHERE t.company_id=c.id),'{}')) INTO result; RETURN result;
 END IF;
 IF NOT contract_private.is_admin(c.id,actor) THEN RAISE insufficient_privilege; END IF;
 PERFORM 1 FROM app.companies WHERE id=c.id FOR UPDATE;
 IF NOT contract_private.is_admin(c.id,actor) THEN RAISE insufficient_privilege; END IF;
 IF action='members' THEN
  RETURN COALESCE((SELECT jsonb_agg(contract_private.staff_row(cm) ORDER BY cm.employee_id) FROM app.company_memberships cm WHERE cm.company_id=c.id),'[]');
 ELSIF action='can_create' THEN RETURN 'true';
 ELSIF action='publish' THEN
  IF COALESCE(payload->>'expected','')<>COALESCE((SELECT revision::text FROM contract_private.layout_heads WHERE company_id=c.id),'0') THEN RAISE serialization_failure; END IF;
  IF COALESCE(payload->>'scope','') !~ '^(contract|book):[a-zA-Z0-9_-]{1,128}$' OR COALESCE(payload->>'baseHash','') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(payload->'layout') IS DISTINCT FROM 'object' THEN RAISE invalid_parameter_value; END IF;
  INSERT INTO app.templates(company_id,template_key,name,kind) VALUES(c.id,payload->>'scope',payload->>'scope',
    CASE WHEN payload->>'scope' LIKE 'book:%' THEN 'letter' WHEN split_part(payload->>'scope',':',2) IN ('cash','exchange','external') THEN split_part(payload->>'scope',':',2) ELSE 'installment' END)
    ON CONFLICT(company_id,template_key) DO NOTHING;
  SELECT id INTO tpl FROM app.templates WHERE company_id=c.id AND template_key=payload->>'scope';
  SELECT COALESCE(max(version),0)+1 INTO next_version FROM app.template_versions WHERE template_id=tpl;
  INSERT INTO app.template_versions(company_id,template_id,version,layout,field_schema,renderer_version,content_sha256,created_by)
  VALUES(c.id,tpl,next_version,(payload->'layout')||'{"approvedLayout":true}'::jsonb,'{}',payload->>'baseHash',encode(sha256(convert_to((payload->'layout')::text,'UTF8')),'hex'),actor);
  token:=gen_random_uuid();
  INSERT INTO contract_private.layout_heads VALUES(c.id,token) ON CONFLICT(company_id) DO UPDATE SET revision=EXCLUDED.revision;
  RETURN jsonb_build_object('revision',token);
 END IF;
 target:=(payload->>'target')::uuid;
 IF target IS NULL OR target=actor THEN RAISE insufficient_privilege; END IF;
 IF action='reset_check' THEN
  IF NOT EXISTS(SELECT 1 FROM app.company_memberships WHERE company_id=c.id AND employee_id=target)
    OR EXISTS(SELECT 1 FROM app.company_memberships x WHERE x.employee_id=target AND NOT contract_private.is_admin(x.company_id,actor))
    THEN RAISE insufficient_privilege; END IF;
  RETURN 'true';
 END IF;
 IF action NOT IN ('create','update') THEN RAISE invalid_parameter_value; END IF;
 h:=lower(payload->>'username'); v_role:=payload->>'role'; enabled:=(payload->>'active')::boolean;
 IF v_role IS NULL OR v_role NOT IN ('employee','branch_manager','administrator') OR enabled IS NULL OR length(trim(COALESCE(payload->>'name',''))) NOT BETWEEN 1 AND 120 THEN RAISE invalid_parameter_value; END IF;
 IF action='create' THEN
  INSERT INTO app.employees(id,display_name) VALUES(target,trim(payload->>'name'));
  INSERT INTO contract_private.handles VALUES(target,h);
 ELSE
  SELECT * INTO m FROM app.company_memberships WHERE company_id=c.id AND employee_id=target FOR UPDATE;
  IF NOT FOUND OR m.version IS DISTINCT FROM (payload->>'version')::bigint THEN RAISE serialization_failure; END IF;
  IF NOT EXISTS(SELECT 1 FROM contract_private.handles WHERE employee=target AND username=h) THEN RAISE invalid_parameter_value; END IF;
  IF NOT EXISTS(SELECT 1 FROM app.company_memberships x WHERE x.employee_id=target AND x.company_id<>c.id) THEN
   UPDATE app.employees SET display_name=trim(payload->>'name') WHERE id=target;
  END IF;
 END IF;
 PERFORM contract_private.set_company_membership(actor,c.id,target,CASE WHEN v_role='administrator' THEN v_role ELSE 'staff' END,enabled);
 UPDATE app.company_memberships SET version=version+1 WHERE company_id=c.id AND employee_id=target;
 UPDATE app.branch_memberships SET active=false WHERE company_id=c.id AND employee_id=target AND active;
 IF v_role<>'administrator' THEN
  IF jsonb_typeof(payload->'branchRoles') IS DISTINCT FROM 'object' OR payload->'branchRoles'='{}'::jsonb THEN RAISE invalid_parameter_value; END IF;
  FOR b,h IN SELECT key::uuid,value FROM jsonb_each_text(payload->'branchRoles') LOOP
   IF h NOT IN ('branch_manager','employee') OR (v_role='employee' AND h<>'employee') OR NOT EXISTS(SELECT 1 FROM app.branches WHERE id=b AND company_id=c.id AND active) THEN RAISE invalid_parameter_value; END IF;
   PERFORM contract_private.set_branch_membership(actor,c.id,b,target,h,true);
  END LOOP;
 END IF;
 RETURN 'true';
END $$;
