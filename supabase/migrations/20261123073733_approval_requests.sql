CREATE TABLE contract_private.approvals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies,
 kind text NOT NULL CHECK(kind IN ('access','design')), subject text NOT NULL,
 author uuid REFERENCES app.employees, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','rejected')),
 reviewed_by uuid REFERENCES app.employees, reviewed_at timestamptz);
CREATE UNIQUE INDEX approvals_pending ON contract_private.approvals(company_id,kind,subject) WHERE state='pending' AND kind='access';
CREATE INDEX approvals_queue ON contract_private.approvals(company_id,state,created_at);
ALTER TABLE contract_private.approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contract_private.approvals FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.contract_review(actor uuid, action text, p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE co uuid; a contract_private.approvals; body jsonb; result jsonb;
BEGIN
 SELECT id INTO co FROM app.companies WHERE code=p->>'company' AND active;
 IF co IS NULL THEN RAISE invalid_parameter_value; END IF;
 IF action='request_access' THEN
  IF coalesce(p->>'username','') !~ '^[a-z0-9][a-z0-9_.-]{2,39}$' OR length(trim(coalesce(p->>'name',''))) NOT BETWEEN 1 AND 120 THEN RAISE invalid_parameter_value; END IF;
  PERFORM 1 FROM app.companies WHERE id=co FOR UPDATE;
  IF (SELECT count(*) FROM contract_private.approvals WHERE company_id=co AND kind='access' AND created_at>now()-interval '1 hour')>=60 THEN RAISE EXCEPTION 'Request limit' USING ERRCODE='54000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM contract_private.handles WHERE username=p->>'username') THEN
   INSERT INTO contract_private.approvals(company_id,kind,subject,payload) VALUES(co,'access',p->>'username',jsonb_build_object('name',trim(p->>'name'))) ON CONFLICT DO NOTHING;
  END IF;
  RETURN 'true';
 END IF;
 IF NOT contract_private.is_member(co,actor) THEN RAISE insufficient_privilege; END IF;
 IF action='propose' THEN
  IF coalesce(p->>'scope','') !~ '^(book|contract):[a-zA-Z0-9_-]{1,128}$' OR jsonb_typeof(p->'layout') IS DISTINCT FROM 'object' THEN RAISE invalid_parameter_value; END IF;
  PERFORM 1 FROM app.employees WHERE id=actor FOR UPDATE;
  IF (SELECT count(*) FROM contract_private.approvals WHERE author=actor AND state='pending')>=12 THEN RAISE invalid_parameter_value; END IF;
  INSERT INTO contract_private.approvals(company_id,kind,subject,author,payload) VALUES(co,'design',p->>'scope',actor,
   jsonb_build_object('company',p->>'company','expected',p->>'expected','layout',p->'layout','scope',p->>'scope','baseHash',p->>'baseHash'));
  RETURN 'true';
 END IF;
 IF NOT contract_private.is_admin(co,actor) THEN RAISE insufficient_privilege; END IF;
 IF action='pending' THEN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',q.id,'kind',q.kind,'subject',q.subject,'name',coalesce(q.payload->>'name',e.display_name),'created',q.created_at,
   'pages',jsonb_array_length(coalesce(q.payload#>'{layout,pages}','[]'))) ORDER BY q.created_at)
   FROM contract_private.approvals q LEFT JOIN app.employees e ON e.id=q.author WHERE q.company_id=co AND q.state='pending'),'[]');
 END IF;
 SELECT * INTO a FROM contract_private.approvals WHERE company_id=co AND id=(p->>'requestId')::uuid FOR UPDATE;
 IF a.id IS NULL OR a.state<>'pending' THEN RAISE serialization_failure; END IF;
 IF action='inspect' AND a.kind='design' THEN RETURN a.payload->'layout'; END IF;
 IF action='approve_design' AND a.kind='design' THEN
  result:=contract_private.portal(actor,'publish',a.payload);
 ELSIF action='approve_access' AND a.kind='access' THEN
  result:=contract_private.portal(actor,'create',p||jsonb_build_object('username',a.subject));
 ELSIF action<>'reject' THEN RAISE invalid_parameter_value; END IF;
 UPDATE contract_private.approvals SET reviewed_at=now(),reviewed_by=actor,state=CASE WHEN action='reject' THEN 'rejected' ELSE 'accepted' END WHERE id=a.id;
 INSERT INTO app.audit_events(company_id,actor_id,action,entity_type,entity_id) VALUES(co,actor,action,'approvals',a.id::text);
 RETURN coalesce(result,'true');
END $$;
REVOKE ALL ON FUNCTION public.contract_review(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contract_review(uuid,text,jsonb) TO service_role;
