ALTER TABLE contract_private.sales_forms ADD COLUMN rejected_at timestamptz, ADD COLUMN rejection_note text,
 ADD COLUMN rejected_by uuid REFERENCES app.employees, ADD COLUMN first_release timestamptz;
UPDATE contract_private.sales_forms SET first_release=published WHERE published IS NOT NULL;
CREATE TABLE contract_private.form_history(
 form_id uuid NOT NULL REFERENCES contract_private.sales_forms,version bigint NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 actor uuid NOT NULL REFERENCES app.employees, action text NOT NULL, snapshot jsonb NOT NULL, PRIMARY KEY(form_id,version));
CREATE TABLE contract_private.form_alerts(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,recipient uuid NOT NULL REFERENCES app.employees,
 company_id uuid NOT NULL REFERENCES app.companies,branch_id uuid NOT NULL REFERENCES app.branches,
 form_id uuid NOT NULL REFERENCES contract_private.sales_forms,version bigint NOT NULL,kind text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),seen boolean NOT NULL DEFAULT false, UNIQUE(recipient,form_id,version,kind));
CREATE INDEX form_alerts_recency ON contract_private.form_alerts(recipient,id DESC);
CREATE FUNCTION contract_private.form_notice_audience(c uuid,b uuid,u uuid,kind text,owner_id uuid,seller text)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT contract_private.is_member(c,u) AND (
  (kind='published' AND (contract_private.is_admin(c,u) OR EXISTS(SELECT FROM app.branch_memberships m WHERE m.company_id=c AND m.employee_id=u AND m.active AND m.role='branch_manager')))
  OR (contract_private.can_branch(c,b,u) AND
   ((kind IN ('published','approved') AND contract_private.department(c,u) IN ('contracts','finance'))
     OR (kind IN ('approved','rejected') AND (owner_id=u OR seller=u::text)))))
$$;
ALTER FUNCTION public.sales_forms(uuid,text,jsonb) RENAME TO sales_prior_review;
ALTER FUNCTION public.sales_prior_review(uuid,text,jsonb) SET SCHEMA contract_private;
REVOKE ALL ON FUNCTION contract_private.sales_prior_review(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sales_forms(actor uuid,action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE src app.companies;f contract_private.sales_forms; cur contract_private.sales_forms;res jsonb; msg text;reason text;
 month_start timestamp; start_at timestamptz; end_at timestamptz; mgr boolean;admin_ok boolean;
BEGIN
 SELECT * INTO src FROM app.companies WHERE active AND code=p->>'company';
 IF src.id IS NULL OR NOT contract_private.is_member(src.id,actor) THEN RAISE insufficient_privilege; END IF;
 IF action='forms_list' THEN
  IF nullif(p->>'month','') IS NOT NULL THEN
   IF p->>'month' !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' THEN RAISE invalid_parameter_value; END IF;
   month_start:=((p->>'month')||'-01')::date;
   start_at:=month_start AT TIME ZONE 'Asia/Baghdad';end_at:=(month_start+interval '1 month') AT TIME ZONE 'Asia/Baghdad';
  END IF;
  IF p->>'scope'='history' THEN
   -- A withdrawn form can have new private edits. Only project the saved publication.
   RETURN coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY changed DESC,id) FROM (
    SELECT f0.id,h.recorded_at AS changed,h.recorded_at AS listed_on,h.version,h.action AS last_action,true AS history_only,
     c.code AS company,b.name AS branch,h.snapshot->>'published' AS published,h.snapshot->>'author_name' AS author_name,
     h.snapshot#>>'{data,contractType}' AS kind,h.snapshot#>>'{data,vin}' AS vin,h.snapshot#>>'{data,total}' AS total,
     coalesce(nullif(h.snapshot#>>'{data,buyer}',''),nullif(h.snapshot#>>'{data,externalBuyer}',''),h.snapshot#>>'{data,externalSeller}') AS buyer
    FROM contract_private.sales_forms f0 JOIN app.companies c ON c.id=f0.company_id JOIN app.branches b ON b.id=f0.branch_id
    CROSS JOIN LATERAL(SELECT h0.snapshot,h0.recorded_at,h0.action,h0.version FROM contract_private.form_history h0 WHERE h0.form_id=f0.id ORDER BY h0.version DESC LIMIT 1) h
    WHERE c.active AND (c.id=src.id OR (src.shared_brand AND c.shared_brand)) AND contract_private.can_manage(c.id,b.id,actor)
     AND (start_at IS NULL OR h.recorded_at>=start_at AND h.recorded_at<end_at)
     AND (p->>'before' IS NULL OR h.recorded_at<(p->>'before')::timestamptz OR h.recorded_at=(p->>'before')::timestamptz AND f0.id>(p->>'cursor')::uuid)
    ORDER BY changed DESC,id LIMIT 100) q),'[]');
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY changed DESC,id) FROM (
   SELECT s.id,s.version,s.changed,s.published,s.approved,s.approval_note,s.rejected_at,s.removed_at,s.first_release,s.author=actor AS mine,s.approver=actor AS my_approval,
    coalesce(s.published,s.created_at) AS listed_on,c.code AS company,b.name AS branch,
    coalesce(s.author_label,e.display_name) AS author_name,coalesce(s.approver_label,a.display_name) AS approved_by,
    s.contract_key IS NOT NULL AS linked,s.data->>'contractType' AS kind,s.data->>'car' AS car,s.data->>'vin' AS vin,s.data->>'total' AS total,
    coalesce(nullif(s.data->>'buyer',''),nullif(s.data->>'externalBuyer',''),s.data->>'externalSeller','') AS buyer
   FROM contract_private.sales_forms s JOIN app.companies c ON c.id=s.company_id JOIN app.branches b ON b.id=s.branch_id
   JOIN app.employees e ON e.id=s.author LEFT JOIN app.employees a ON a.id=s.approver
   WHERE (CASE WHEN p->>'scope'='removed' THEN s.removed_at IS NOT NULL AND s.first_release IS NOT NULL AND contract_private.can_manage(c.id,b.id,actor) ELSE s.removed_at IS NULL END) AND c.active AND (c.id=src.id OR (src.shared_brand AND c.shared_brand)) AND contract_private.can_branch(c.id,b.id,actor)
    AND ((s.author=actor AND contract_private.department(c.id,actor)<>'finance')
      OR (s.removed_at IS NOT NULL AND p->>'scope'='removed' AND contract_private.can_manage(c.id,b.id,actor)) OR (s.published IS NOT NULL AND contract_private.department(c.id,actor) IN ('management','contracts','finance','sales')))
    AND (start_at IS NULL OR (coalesce(s.published,s.created_at)>=start_at AND coalesce(s.published,s.created_at)<end_at))
    AND (p->>'before' IS NULL OR s.changed<(p->>'before')::timestamptz OR (s.changed=(p->>'before')::timestamptz AND s.id>(p->>'cursor')::uuid))
   ORDER BY s.changed DESC,s.id LIMIT 100) q),'[]');
 END IF;

 IF action='form_republish' THEN RAISE insufficient_privilege; END IF;
 IF action IN ('alerts','alerts_seen') THEN
  IF action='alerts_seen' THEN UPDATE contract_private.form_alerts n SET seen=true WHERE n.recipient=actor AND n.id<=(p->>'through')::bigint
   AND (n.company_id=src.id OR (src.shared_brand AND EXISTS(SELECT FROM app.companies c WHERE c.id=n.company_id AND c.shared_brand))); END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY id DESC) FROM (
   SELECT n.id,n.kind,n.created_at,n.seen,b.name AS branch,c.code AS company,
    CASE WHEN contract_private.can_branch(c.id,b.id,actor) AND s.published IS NOT NULL AND s.removed_at IS NULL THEN s.id END AS form_id
   FROM contract_private.form_alerts n JOIN app.companies c ON c.id=n.company_id JOIN app.branches b ON b.id=n.branch_id JOIN contract_private.sales_forms s ON s.id=n.form_id
   WHERE n.recipient=actor AND (c.id=src.id OR (src.shared_brand AND c.shared_brand)) AND contract_private.form_notice_audience(c.id,b.id,actor,n.kind,s.author,s.data->>'formSellerId')
   ORDER BY n.id DESC LIMIT 100) q),'[]');
 END IF;
 IF action='move_contract' THEN RETURN contract_private.sales_prior_review(actor,action,p); END IF;
 SELECT * INTO f FROM contract_private.sales_forms WHERE id=(p->>'id')::uuid FOR UPDATE;
 mgr:=contract_private.can_manage(src.id,f.branch_id,actor);admin_ok:=contract_private.is_admin(src.id,actor);
 IF f.id IS NOT NULL AND ((f.company_id<>src.id AND (action<>'form_save' OR f.first_release IS NOT NULL)) OR
  NOT contract_private.can_branch(f.company_id,f.branch_id,actor)) THEN RAISE insufficient_privilege; END IF;
 IF action='form_history' THEN
  IF f.id IS NULL OR NOT mgr THEN RAISE insufficient_privilege; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('version',h.version,'at',h.recorded_at,'action',h.action,'by',e.display_name,'snapshot',h.snapshot) ORDER BY h.version DESC)
  FROM contract_private.form_history h JOIN app.employees e ON e.id=h.actor WHERE h.form_id=f.id),'[]');
 END IF;
 IF f.removed_at IS NOT NULL THEN RAISE insufficient_privilege; END IF;
 IF action='form_publish' AND f.published IS NULL AND f.first_release IS NOT NULL
  AND clock_timestamp()>=f.first_release+interval '30 minutes' THEN
  RAISE EXCEPTION USING ERRCODE='P3001',MESSAGE='Republication window expired';
 END IF;
 IF action='form_read' AND f.published IS NOT NULL THEN
  RETURN (to_jsonb(f)-'author'-'approver'-'rejected_by'-'contract_key'-'company_id'-'branch_id'-'republished_at')||jsonb_build_object(
  'mine',actor=f.author,'my_approval',actor=f.approver,'linked',f.contract_key IS NOT NULL,'company',src.code,'branch',(SELECT name FROM app.branches WHERE id=f.branch_id),
  'author_name',coalesce(f.author_label,(SELECT display_name FROM app.employees WHERE id=f.author)),'approved_by',f.approver_label,
  'can_withdraw',contract_private.department(src.id,actor)='sales' AND (f.author=actor OR f.data->>'formSellerId'=actor::text) AND f.rejected_at IS NULL AND f.contract_key IS NULL AND clock_timestamp()<f.first_release+interval '30 minutes');
 END IF;
 IF f.rejected_at IS NOT NULL AND action IN ('form_approve','form_convert','form_publish','form_save') THEN RAISE insufficient_privilege; END IF;
 IF action IN ('form_withdraw','form_correct','form_reject','form_remove_published') THEN
  IF f.id IS NULL OR f.published IS NULL THEN RAISE insufficient_privilege; END IF;
  PERFORM contract_private.authorize_write(src.id,f.branch_id,actor,false);
  IF action='form_withdraw' THEN
   IF contract_private.department(src.id,actor)<>'sales' OR (f.author<>actor AND coalesce(f.data->>'formSellerId','')<>actor::text)
    OR f.rejected_at IS NOT NULL OR f.contract_key IS NOT NULL OR clock_timestamp()>=f.first_release+interval '30 minutes' THEN RAISE insufficient_privilege; END IF;
  ELSIF action='form_remove_published' AND NOT admin_ok THEN RAISE insufficient_privilege;
  ELSIF action='form_correct' AND NOT(admin_ok OR (mgr AND f.rejected_at IS NOT NULL)) THEN RAISE insufficient_privilege;
  ELSIF action='form_reject' AND (NOT mgr OR f.rejected_at IS NOT NULL) THEN RAISE insufficient_privilege; END IF;
  IF f.version IS DISTINCT FROM (p->>'version')::bigint THEN RAISE serialization_failure; END IF;
  IF action='form_withdraw' THEN
   UPDATE contract_private.sales_forms SET published=NULL,author=actor,approved=NULL,approver=NULL,approver_label=NULL,approval_note=NULL,changed=now(),version=version+1 WHERE id=f.id;
  ELSIF action='form_remove_published' THEN
   UPDATE contract_private.sales_forms SET removed_at=now(),changed=now(),version=version+1 WHERE id=f.id;
  ELSIF action='form_correct' THEN
   IF jsonb_typeof(p->'data') IS DISTINCT FROM 'object' OR nullif(trim(concat_ws('',p#>>'{data,buyer}',p#>>'{data,externalBuyer}',p#>>'{data,externalSeller}')),'') IS NULL THEN RAISE invalid_parameter_value; END IF;
   UPDATE contract_private.sales_forms SET data=p->'data'||jsonb_build_object('companyId',src.code),rejected_at=NULL,rejection_note=NULL,rejected_by=NULL,
    approved=NULL,approver=NULL,approval_note=NULL,approver_label=NULL,changed=now(),version=version+1 WHERE id=f.id;
   msg:='published';
  ELSE
   reason:=trim(p->>'note');IF coalesce(length(reason),0) NOT BETWEEN 1 AND 240 THEN RAISE invalid_parameter_value; END IF;
   UPDATE contract_private.sales_forms SET rejected_at=now(),rejection_note=reason,rejected_by=actor,
    approved=NULL,approver=NULL,approver_label=NULL,approval_note=NULL,changed=now(),version=version+1 WHERE id=f.id;
   msg:='rejected';
  END IF;
  res:=jsonb_build_object('version',f.version+1);
  INSERT INTO app.audit_events(company_id,branch_id,actor_id,action,entity_type,entity_id) VALUES(src.id,f.branch_id,actor,action,'sales_forms',f.id::text);
 ELSE
  res:=contract_private.sales_prior_review(actor,action,p);
  IF action='form_publish' AND f.published IS NULL THEN
   UPDATE contract_private.sales_forms SET first_release=coalesce(first_release,published) WHERE id=f.id;
   msg:='published';
  ELSIF action='form_approve' AND f.approved IS NULL THEN msg:='approved'; END IF;
 END IF;
 IF action IN ('form_publish','form_approve','form_correct','form_withdraw','form_reject','form_remove_published') THEN
  SELECT * INTO cur FROM contract_private.sales_forms WHERE id=f.id;
  IF cur.version<>f.version AND (f.published IS NOT NULL OR (action='form_publish' AND f.first_release IS NOT NULL)) THEN
   INSERT INTO contract_private.form_history VALUES(f.id,f.version,now(),actor,CASE WHEN action='form_publish' THEN 'form_republish' ELSE action END,
    (CASE WHEN action='form_publish' THEN jsonb_set(to_jsonb(f),'{data}',cur.data) ELSE to_jsonb(f) END)||
    jsonb_build_object('company',src.code,'branch',(SELECT name FROM app.branches WHERE id=f.branch_id),
    'author_name',coalesce(CASE WHEN action='form_publish' THEN cur.author_label ELSE f.author_label END,(SELECT display_name FROM app.employees WHERE id=f.author)),'approved_by',f.approver_label));
  END IF;
  IF msg IS NOT NULL THEN INSERT INTO contract_private.form_alerts(recipient,company_id,branch_id,form_id,version,kind)
   SELECT m.employee_id,src.id,cur.branch_id,cur.id,cur.version,msg FROM app.company_memberships m WHERE m.company_id=src.id AND m.active
    AND contract_private.form_notice_audience(src.id,cur.branch_id,m.employee_id,msg,cur.author,cur.data->>'formSellerId') ON CONFLICT DO NOTHING; END IF;
 END IF;
 RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.sales_forms(uuid,text,jsonb),contract_private.form_notice_audience(uuid,uuid,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sales_forms(uuid,text,jsonb) TO service_role;

-- Queue each event separately, including two different decisions on the same document.
CREATE TABLE contract_private.form_devices(
 endpoint text PRIMARY KEY,recipient uuid NOT NULL REFERENCES app.employees,auth_key text NOT NULL,p256dh text NOT NULL);
CREATE INDEX form_devices_recipient ON contract_private.form_devices(recipient);
CREATE TABLE contract_private.form_push_queue(
 endpoint text NOT NULL REFERENCES contract_private.form_devices(endpoint) ON DELETE CASCADE,
 alert_id bigint NOT NULL REFERENCES contract_private.form_alerts ON DELETE CASCADE,
 lease uuid,retry_after timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
 PRIMARY KEY(endpoint,alert_id));
CREATE INDEX form_push_due ON contract_private.form_push_queue(retry_after,alert_id);
CREATE FUNCTION contract_private.queue_form_alert() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 INSERT INTO contract_private.form_push_queue(endpoint,alert_id)
 SELECT endpoint,NEW.id FROM contract_private.form_devices WHERE recipient=NEW.recipient;
 RETURN NEW;
END $$;
CREATE TRIGGER queue_alert AFTER INSERT ON contract_private.form_alerts FOR EACH ROW EXECUTE FUNCTION contract_private.queue_form_alert();
CREATE FUNCTION public.form_devices(actor uuid,action text,p jsonb) RETURNS jsonb
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
  SELECT coalesce(jsonb_agg(jsonb_build_object('endpoint',j.endpoint,'id',j.alert_id,'lease',j.lease,'kind',a.kind,'auth',d.auth_key,'p256dh',d.p256dh)),'[]') INTO result
  FROM jobs j JOIN contract_private.form_alerts a ON a.id=j.alert_id JOIN contract_private.form_devices d ON d.endpoint=j.endpoint; RETURN result;
 ELSIF action='finish' THEN
  IF p->>'outcome'='gone' THEN DELETE FROM contract_private.form_devices d WHERE d.endpoint=dest AND EXISTS(
    SELECT FROM contract_private.form_push_queue q WHERE q.endpoint=d.endpoint AND q.alert_id=(p->>'id')::bigint AND q.lease=(p->>'lease')::uuid);
  ELSIF p->>'outcome'='sent' THEN DELETE FROM contract_private.form_push_queue WHERE endpoint=dest AND alert_id=(p->>'id')::bigint AND lease=(p->>'lease')::uuid;
  ELSE UPDATE contract_private.form_push_queue SET retry_after=now()+interval '5 minutes',lease=NULL WHERE endpoint=dest AND alert_id=(p->>'id')::bigint AND lease=(p->>'lease')::uuid; END IF;
 ELSE RAISE invalid_parameter_value; END IF;
 RETURN 'true';
END $$;
REVOKE ALL ON FUNCTION public.form_devices(uuid,text,jsonb),contract_private.queue_form_alert() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.form_devices(uuid,text,jsonb) TO service_role;
