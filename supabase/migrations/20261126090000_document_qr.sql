-- Existing printed UUIDs and their public verification links stay valid.
ALTER TABLE public.ownership_qr
 ADD COLUMN branch_id uuid REFERENCES app.branches,
 ADD COLUMN record_key text, ADD COLUMN sheet_key text,
 ADD COLUMN details jsonb, ADD COLUMN fingerprint text,
 ADD COLUMN approved boolean NOT NULL DEFAULT true,
 ADD COLUMN hidden_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
 ADD COLUMN revision bigint NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX ownership_qr_document_revision ON public.ownership_qr(company,branch_id,record_key,sheet_key,fingerprint);
REVOKE UPDATE,DELETE ON public.ownership_qr FROM service_role;
CREATE FUNCTION public.document_qr(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ownership_qr; c uuid; b uuid; fields jsonb; stamp text; wanted boolean; new_id uuid;
BEGIN
 IF action='issue' THEN
  SELECT co.id,br.id INTO c,b FROM app.companies co JOIN app.branches br ON br.company_id=co.id WHERE co.active AND br.active AND co.code=p->>'company' AND br.name=p->>'branch';
  IF b IS NULL OR NOT contract_private.can_branch(c,b,actor) OR NOT (contract_private.can_manage(c,b,actor) OR contract_private.department(c,actor)='contracts') THEN RAISE insufficient_privilege; END IF;
  fields:=p->'fields';
  IF jsonb_typeof(fields) IS DISTINCT FROM 'array' OR jsonb_array_length(fields)>24
   OR coalesce(length(p->>'record'),0) NOT BETWEEN 1 AND 180 OR coalesce(length(p->>'sheet'),0) NOT BETWEEN 1 AND 180 THEN RAISE invalid_parameter_value; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(fields) x WHERE jsonb_typeof(x)<>'object' OR x-'key'-'label'-'value'<>'{}'::jsonb
   OR coalesce(x->>'key','') !~ '^[A-Za-z][A-Za-z0-9_]{0,64}$' OR jsonb_typeof(x->'label') IS DISTINCT FROM 'string'
   OR length(trim(x->>'label')) NOT BETWEEN 1 AND 80 OR jsonb_typeof(x->'value') IS DISTINCT FROM 'string' OR length(x->>'value')>2000)
   OR (SELECT count(DISTINCT x->>'key') FROM jsonb_array_elements(fields) x)<>jsonb_array_length(fields) THEN RAISE invalid_parameter_value; END IF;
  stamp:=encode(sha256(convert_to(fields::text,'UTF8')),'hex');
  IF p?'reserved' AND (p->>'reserved' IS NULL OR p->>'reserved' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN RAISE invalid_parameter_value; END IF;
  INSERT INTO public.ownership_qr(id,buyer,vin,company,issued_by,branch_id,record_key,sheet_key,details,fingerprint)
   VALUES(coalesce((p->>'reserved')::uuid,gen_random_uuid()),'','',p->>'company',actor,b,p->>'record',p->>'sheet',fields,stamp)
   ON CONFLICT DO NOTHING RETURNING id INTO new_id;
  SELECT * INTO r FROM public.ownership_qr q WHERE q.company=p->>'company' AND q.branch_id=b AND q.record_key=p->>'record' AND q.sheet_key=p->>'sheet' AND q.fingerprint=stamp;
  IF r.id IS NULL OR (p?'reserved' AND r.id<>(p->>'reserved')::uuid) THEN RAISE unique_violation; END IF;
  IF new_id IS NOT NULL THEN
   INSERT INTO app.audit_events(company_id,branch_id,actor_id,action,entity_type,entity_id) VALUES(c,b,actor,'qr_issue','document_qr',new_id::text);
  END IF;
  RETURN jsonb_build_object('id',r.id,'approved',r.approved,'revision',r.revision);
 END IF;
 IF action IN ('review','change','visibility') THEN
  SELECT * INTO r FROM public.ownership_qr WHERE id=(p->>'id')::uuid FOR UPDATE;
  SELECT id INTO c FROM app.companies WHERE code=r.company AND active;
  IF r.id IS NULL OR NOT (contract_private.is_admin(c,actor) OR (r.branch_id IS NOT NULL AND contract_private.can_manage(c,r.branch_id,actor))) THEN RAISE insufficient_privilege; END IF;
  IF action='visibility' THEN
   IF r.revision IS DISTINCT FROM (p->>'revision')::bigint THEN RAISE serialization_failure; END IF;
   IF jsonb_typeof(p->'hidden') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'hidden')>24 THEN RAISE invalid_parameter_value; END IF;
   IF EXISTS(SELECT FROM jsonb_array_elements_text(p->'hidden') h WHERE NOT EXISTS(
      SELECT FROM jsonb_array_elements(coalesce(r.details,'[{"key":"buyer"},{"key":"vin"}]'::jsonb)) f WHERE f->>'key'=h)) THEN RAISE invalid_parameter_value; END IF;
   UPDATE public.ownership_qr SET hidden_keys=ARRAY(SELECT DISTINCT jsonb_array_elements_text(p->'hidden')),revision=revision+1 WHERE id=r.id RETURNING * INTO r;
   INSERT INTO app.audit_events(company_id,branch_id,actor_id,action,entity_type,entity_id,detail)
     VALUES(c,r.branch_id,actor,'qr_visibility','document_qr',r.id::text,jsonb_build_object('hidden',r.hidden_keys,'revision',r.revision));
  END IF;
  IF action='change' THEN
   IF r.revision IS DISTINCT FROM (p->>'revision')::bigint THEN RAISE serialization_failure; END IF;
   IF jsonb_typeof(p->'approved') IS DISTINCT FROM 'boolean' THEN RAISE invalid_parameter_value; END IF;
   wanted:=(p->>'approved')::boolean;
   IF wanted<>r.approved THEN
    UPDATE public.ownership_qr SET approved=wanted,revision=revision+1 WHERE id=r.id RETURNING * INTO r;
    INSERT INTO app.audit_events(company_id,branch_id,actor_id,action,entity_type,entity_id,detail)
      VALUES(c,r.branch_id,actor,'qr_status','document_qr',r.id::text,jsonb_build_object('approved',wanted,'revision',r.revision));
   END IF;
  END IF;
 ELSIF action='verify' THEN
  SELECT * INTO r FROM public.ownership_qr WHERE id=(p->>'id')::uuid;
  IF r.id IS NULL THEN RETURN NULL; END IF;
 ELSE RAISE invalid_parameter_value; END IF;
 fields:=coalesce(r.details,jsonb_build_array(jsonb_build_object('key','buyer','label','المشتري','value',r.buyer),jsonb_build_object('key','vin','label','الشاصي','value',r.vin)));
 IF action='verify' THEN SELECT coalesce(jsonb_agg(f ORDER BY i),'[]') INTO fields FROM jsonb_array_elements(fields) WITH ORDINALITY v(f,i) WHERE NOT(f->>'key'=ANY(r.hidden_keys)); END IF;
 RETURN (CASE WHEN action='verify' THEN '{}'::jsonb ELSE jsonb_build_object('hidden',r.hidden_keys) END)||jsonb_build_object('id',r.id,'approved',r.approved,'revision',r.revision,'fields',CASE WHEN r.approved OR action<>'verify' THEN fields ELSE '[]'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.document_qr(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.document_qr(uuid,text,jsonb) TO service_role;
