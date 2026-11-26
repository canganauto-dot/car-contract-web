ALTER FUNCTION public.sales_forms(uuid,text,jsonb) RENAME TO sales_before_inbox;
ALTER FUNCTION public.sales_before_inbox(uuid,text,jsonb) SET SCHEMA contract_private;
REVOKE ALL ON FUNCTION contract_private.sales_before_inbox(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sales_forms(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE src app.companies;f contract_private.sales_forms; cur contract_private.sales_forms;res jsonb; msg text;reason text;
 month_start timestamp; start_at timestamptz; end_at timestamptz; mgr boolean;admin_ok boolean;
BEGIN
 SELECT * INTO src FROM app.companies WHERE active AND code=p->>'company';
 IF src.id IS NULL OR NOT contract_private.is_member(src.id,actor) THEN RAISE insufficient_privilege; END IF;
 IF action IN ('alerts','alerts_seen') THEN
  IF action='alerts_seen' THEN UPDATE contract_private.form_alerts n SET seen=true WHERE n.recipient=actor AND n.id<=(p->>'through')::bigint
   AND (n.company_id=src.id OR (src.shared_brand AND EXISTS(SELECT FROM app.companies c WHERE c.id=n.company_id AND c.shared_brand))); END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY id DESC) FROM (
   SELECT n.id,n.kind,n.created_at,n.seen,b.name AS branch,c.code AS company,
    CASE WHEN s.published IS NOT NULL AND s.removed_at IS NULL AND contract_private.can_branch(c.id,b.id,actor) THEN jsonb_build_object('publisher',(SELECT display_name FROM app.employees WHERE id=s.author),'car',s.data->>'car','model',s.data->>'model','price',s.data->>'total') END AS details,
    CASE WHEN contract_private.can_branch(c.id,b.id,actor) AND s.published IS NOT NULL AND s.removed_at IS NULL THEN s.id END AS form_id
   FROM contract_private.form_alerts n JOIN app.companies c ON c.id=n.company_id JOIN app.branches b ON b.id=n.branch_id JOIN contract_private.sales_forms s ON s.id=n.form_id
   WHERE n.recipient=actor AND (c.id=src.id OR (src.shared_brand AND c.shared_brand)) AND contract_private.form_notice_audience(c.id,b.id,actor,n.kind,s.author,s.data->>'formSellerId')
   AND (p->>'beforeId' IS NULL OR n.id<(p->>'beforeId')::bigint) ORDER BY n.id DESC LIMIT 25) q),'[]');
 END IF;
 RETURN contract_private.sales_before_inbox(actor,action,p);
END $$;
REVOKE ALL ON FUNCTION public.sales_forms(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_forms(uuid,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.form_devices(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dest text:=p->>'endpoint'; token uuid:=gen_random_uuid(); result jsonb;
BEGIN
 IF action IN ('subscribe','unsubscribe') THEN
  IF NOT EXISTS(SELECT FROM app.company_memberships m WHERE m.employee_id=actor AND contract_private.is_member(m.company_id,actor)) THEN RAISE insufficient_privilege; END IF;
  IF action='unsubscribe' THEN DELETE FROM contract_private.form_devices WHERE endpoint=dest AND recipient=actor;
  ELSE
   IF coalesce(length(dest),0) NOT BETWEEN 20 AND 2048 OR coalesce(p->>'auth','') !~ '^[A-Za-z0-9_-]{22}$'
    OR coalesce(p->>'p256dh','') !~ '^[A-Za-z0-9_-]{87}$' THEN RAISE invalid_parameter_value; END IF;
   INSERT INTO contract_private.form_devices(endpoint,recipient,auth_key,p256dh) VALUES(dest,actor,p->>'auth',p->>'p256dh')
   ON CONFLICT(endpoint) DO UPDATE SET auth_key=EXCLUDED.auth_key,p256dh=EXCLUDED.p256dh WHERE form_devices.recipient=actor;
   IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  END IF;
 ELSIF action='claim' THEN
  DELETE FROM contract_private.form_push_queue WHERE expires_at<=now();
  WITH pending AS (
   SELECT q.endpoint,q.alert_id FROM contract_private.form_push_queue q JOIN contract_private.form_alerts n ON n.id=q.alert_id
   JOIN contract_private.sales_forms f ON f.id=n.form_id JOIN contract_private.form_devices d ON d.endpoint=q.endpoint AND d.recipient=n.recipient
   WHERE q.retry_after<=now() AND NOT n.seen AND contract_private.form_notice_audience(n.company_id,n.branch_id,n.recipient,n.kind,f.author,f.data->>'formSellerId')
   ORDER BY q.retry_after,q.alert_id LIMIT 40 FOR UPDATE OF q SKIP LOCKED
  ), jobs AS (UPDATE contract_private.form_push_queue q SET lease=token,retry_after=now()+interval '90 seconds' FROM pending n
   WHERE q.endpoint=n.endpoint AND q.alert_id=n.alert_id RETURNING q.endpoint,q.alert_id,q.lease)
  SELECT coalesce(jsonb_agg(jsonb_build_object('endpoint',j.endpoint,'id',j.alert_id,'lease',j.lease,'kind',a.kind,'details',CASE WHEN f.published IS NOT NULL AND f.removed_at IS NULL AND contract_private.can_branch(a.company_id,a.branch_id,a.recipient) THEN jsonb_build_object('publisher',left(e.display_name,100),'car',left(f.data->>'car',100),'model',left(f.data->>'model',30),'price',left(f.data->>'total',40)) END,'auth',d.auth_key,'p256dh',d.p256dh)),'[]') INTO result
  FROM jobs j JOIN contract_private.form_alerts a ON a.id=j.alert_id JOIN contract_private.sales_forms f ON f.id=a.form_id JOIN app.employees e ON e.id=f.author JOIN contract_private.form_devices d ON d.endpoint=j.endpoint; RETURN result;
 ELSIF action='finish' THEN
  IF p->>'outcome'='gone' THEN DELETE FROM contract_private.form_devices d WHERE d.endpoint=dest AND EXISTS(
    SELECT FROM contract_private.form_push_queue q WHERE q.endpoint=d.endpoint AND q.alert_id=(p->>'id')::bigint AND q.lease=(p->>'lease')::uuid);
  ELSIF p->>'outcome'='sent' THEN DELETE FROM contract_private.form_push_queue WHERE endpoint=dest AND alert_id=(p->>'id')::bigint AND lease=(p->>'lease')::uuid;
  ELSE UPDATE contract_private.form_push_queue SET retry_after=now()+interval '5 minutes',lease=NULL WHERE endpoint=dest AND alert_id=(p->>'id')::bigint AND lease=(p->>'lease')::uuid; END IF;
 ELSE RAISE invalid_parameter_value; END IF;
 RETURN 'true';
END $$;
