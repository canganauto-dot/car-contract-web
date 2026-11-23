CREATE TABLE contract_private.reservations (
 client_key text PRIMARY KEY CHECK(length(client_key) BETWEEN 1 AND 100), company_id uuid NOT NULL, branch_id uuid NOT NULL,
 assigned_by uuid NOT NULL REFERENCES app.employees, branch_name text NOT NULL, ordinal integer NOT NULL CHECK(ordinal>0),
 offline boolean NOT NULL, label text NOT NULL, issued boolean NOT NULL DEFAULT false,
 FOREIGN KEY(company_id,branch_id) REFERENCES app.branches(company_id,id), UNIQUE(branch_name,offline,ordinal)
);
CREATE TABLE contract_private.branch_serials (
 branch_name text NOT NULL, offline boolean NOT NULL, following bigint NOT NULL DEFAULT 1, PRIMARY KEY(branch_name,offline)
);
ALTER TABLE contract_private.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_private.branch_serials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contract_private.reservations,contract_private.branch_serials FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION contract_private.number_request(actor uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE br app.branches; rr contract_private.reservations; key text:=p->>'record'; mode text:=p->>'mode';
 label text:=coalesce(p->>'label',''); prefix text:=coalesce(p->>'prefix',''); n bigint;
 disconnected boolean:=coalesce((p->>'offline')::boolean,false);
BEGIN
 SELECT b.* INTO br FROM app.branches b JOIN app.companies c ON c.id=b.company_id WHERE c.code=p->>'company' AND b.name=p->>'branch' AND b.active;
 IF br.id IS NULL OR actor IS NULL THEN RAISE insufficient_privilege; END IF;
 PERFORM contract_private.authorize_write(br.company_id,br.id,actor,false);
 IF mode IS NULL OR mode NOT IN ('claim','edit','verify') OR coalesce(length(key),0) NOT BETWEEN 1 AND 100 THEN RAISE invalid_parameter_value; END IF;
 INSERT INTO contract_private.branch_serials(branch_name,offline) VALUES(br.name,disconnected) ON CONFLICT DO NOTHING;
 SELECT following INTO n FROM contract_private.branch_serials s WHERE s.branch_name=br.name AND s.offline=disconnected FOR UPDATE;
 SELECT * INTO rr FROM contract_private.reservations r WHERE r.client_key=key FOR UPDATE;
 IF FOUND THEN
  IF rr.company_id<>br.company_id OR rr.branch_id<>br.id OR rr.offline<>disconnected THEN RAISE insufficient_privilege; END IF;
  IF mode='claim' OR (mode='verify' AND label=rr.label) OR (mode='edit' AND label=rr.label) THEN RETURN jsonb_build_object('number',rr.label); END IF;
  IF mode<>'edit' OR rr.issued OR rr.label IS DISTINCT FROM p->>'expected' THEN RAISE serialization_failure; END IF;
  IF rr.assigned_by<>actor AND NOT contract_private.can_manage(br.company_id,br.id,actor) THEN RAISE insufficient_privilege; END IF;
 ELSIF mode='verify' THEN RAISE serialization_failure; END IF;
 IF label='' THEN
  WHILE EXISTS(SELECT 1 FROM contract_private.reservations r WHERE r.branch_name=br.name AND r.offline=disconnected AND r.ordinal=n) LOOP n:=n+1; END LOOP;
  IF length(prefix)>40 OR prefix~'[[:cntrl:]/\\]' THEN RAISE invalid_parameter_value; END IF;
  label:=CASE WHEN prefix='' THEN '' ELSE prefix||'-' END||n::text||CASE WHEN disconnected THEN '-F' ELSE '' END;
  UPDATE contract_private.branch_serials s SET following=n+1 WHERE s.branch_name=br.name AND s.offline=disconnected;
 ELSE
  IF length(label)>54 OR label~'[[:cntrl:]/\\]' OR (right(label,2)='-F')<>disconnected THEN RAISE invalid_parameter_value; END IF;
  n:=substring(regexp_replace(label,'-F$','') from '(?:^|-)([0-9]{1,9})$')::bigint;
  IF n IS NULL OR n<1 THEN RAISE invalid_parameter_value; END IF;
 END IF;
 INSERT INTO contract_private.reservations(client_key,company_id,branch_id,assigned_by,branch_name,ordinal,offline,label)
 VALUES(key,br.company_id,br.id,actor,br.name,n,disconnected,label)
 ON CONFLICT(client_key) DO UPDATE SET ordinal=EXCLUDED.ordinal,label=EXCLUDED.label
 WHERE contract_private.reservations.branch_id=EXCLUDED.branch_id AND NOT contract_private.reservations.issued;
 IF NOT FOUND THEN RAISE serialization_failure; END IF;
 RETURN jsonb_build_object('number',label);
END $$;
CREATE FUNCTION public.contract_number(actor uuid,p jsonb) RETURNS jsonb LANGUAGE sql SET search_path=''
 AS $$SELECT contract_private.number_request(actor,p)$$;
REVOKE ALL ON FUNCTION public.contract_number(uuid,jsonb),contract_private.number_request(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contract_number(uuid,jsonb),contract_private.number_request(uuid,jsonb) TO service_role;

ALTER TABLE app.contracts ADD COLUMN client_key text UNIQUE;
ALTER TABLE app.documents ADD CHECK (
 CASE WHEN purpose IN ('signed_pdf','generated_pdf') THEN byte_size<=15000000
 WHEN purpose='customer_photo' THEN byte_size<=5000000 AND mime_type IN ('image/png','image/jpeg') ELSE true END
);
REVOKE INSERT,UPDATE,DELETE ON app.receipts FROM service_role;
