-- Sellers are selected by employee id. The author column continues to control ownership.
CREATE FUNCTION contract_private.branch_sellers(company uuid, branch uuid)
RETURNS TABLE(id uuid,name text) LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT e.id,e.display_name FROM app.branch_memberships b
 JOIN app.company_memberships m ON m.company_id=b.company_id AND m.employee_id=b.employee_id
 JOIN app.employees e ON e.id=b.employee_id
 WHERE b.company_id=company AND b.branch_id=branch AND b.active AND m.active AND e.active
   AND m.department='sales' AND contract_private.full_staff_name(e.display_name)
$$;
CREATE FUNCTION public.form_sellers(actor uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid; b uuid;
BEGIN
 SELECT co.id,br.id INTO c,b FROM app.companies co JOIN app.branches br ON br.company_id=co.id
 WHERE co.code=p->>'company' AND br.name=p->>'branch' AND co.active AND br.active;
 IF b IS NULL OR NOT contract_private.can_branch(c,b,actor)
    OR contract_private.department(c,actor) NOT IN ('management','sales','contracts') THEN RAISE insufficient_privilege; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name,s.id) FROM contract_private.branch_sellers(c,b) s),'[]');
END $$;

CREATE FUNCTION contract_private.stamp_form_seller() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE seller uuid:=nullif(NEW.data->>'formSellerId','')::uuid;
BEGIN
 IF seller IS NOT NULL THEN
  SELECT s.name INTO NEW.author_label FROM contract_private.branch_sellers(NEW.company_id,NEW.branch_id) s WHERE s.id=seller;
  IF NEW.author_label IS NULL THEN RAISE invalid_parameter_value USING MESSAGE='Choose an active salesperson in this branch'; END IF;
 ELSIF TG_OP='UPDATE' AND nullif(OLD.data->>'formSellerId','') IS NOT NULL THEN
  SELECT e.display_name INTO NEW.author_label FROM app.employees e WHERE e.id=NEW.author;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_form_seller BEFORE INSERT OR UPDATE OF data ON contract_private.sales_forms
FOR EACH ROW EXECUTE FUNCTION contract_private.stamp_form_seller();

CREATE FUNCTION contract_private.contract_form_payload(data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT (data - 'formSellerId' - 'exchangeOldDebt') ||
  CASE WHEN data->>'contractType'='exchange' AND nullif(btrim(data->>'exchangeOldDebt'),'') IS NOT NULL
   THEN jsonb_build_object('notes',concat_ws(chr(10),nullif(data->>'notes',''),'ذمة المركبة القديمة: '||btrim(data->>'exchangeOldDebt')))
   ELSE '{}'::jsonb END
$$;
DO $$ DECLARE src text; marker text:='f.data-''formFees'''; BEGIN
 src:=pg_get_functiondef('contract_private.sales_form_op(uuid,text,jsonb)'::regprocedure);
 IF strpos(src,marker)=0 THEN RAISE EXCEPTION 'Missing contract conversion step'; END IF;
 EXECUTE replace(src,marker,'contract_private.contract_form_payload(f.data)-''formFees''');
END $$;
REVOKE ALL ON FUNCTION contract_private.branch_sellers(uuid,uuid),contract_private.stamp_form_seller(),
 contract_private.contract_form_payload(jsonb),public.form_sellers(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.form_sellers(uuid,jsonb) TO service_role;
