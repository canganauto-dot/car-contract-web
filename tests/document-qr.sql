-- Run after hosted-roles and sales-workflow in the disposable database.
DO $test$
DECLARE manager uuid; seller uuid; admin_id uuid; row_id uuid; legacy_id uuid:=gen_random_uuid(); q jsonb; v jsonb; alt text;
BEGIN
 SELECT employee INTO manager FROM contract_private.handles WHERE username='newuser';
 SELECT employee INTO seller FROM contract_private.handles WHERE username='sales';
 SELECT employee INTO admin_id FROM contract_private.handles WHERE username='admin';
 q:='{"company":"bakheet","branch":"الدورة","record":"dummy-qr","sheet":"book:0/0","fields":[{"key":"buyer","label":"المشتري","value":"مثال"},{"key":"vin","label":"الشاصي","value":"DEMO1234"}]}';
 BEGIN PERFORM public.document_qr(seller,'issue',q);RAISE EXCEPTION 'sales issued QR';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 v:=public.document_qr(manager,'issue',q);row_id:=(v->>'id')::uuid;
 ASSERT public.document_qr(manager,'issue',q)=v;
 q:=q||jsonb_build_object('id',row_id,'revision',1);
 BEGIN PERFORM public.document_qr(seller,'change',q||'{"approved":false}');RAISE EXCEPTION 'sales revoked QR';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 v:=public.document_qr(manager,'visibility',q||'{"hidden":["buyer"]}');
 ASSERT jsonb_array_length(public.document_qr(NULL,'verify',q)->'fields')=1;
 BEGIN PERFORM public.document_qr(manager,'change',q||'{"approved":false}');RAISE EXCEPTION 'stale decision';EXCEPTION WHEN serialization_failure THEN NULL;END;
 v:=public.document_qr(manager,'change',q||'{"approved":false,"revision":2}');
 ASSERT public.document_qr(NULL,'verify',q)->'fields'='[]' AND NOT (v->>'approved')::boolean;
 ASSERT public.document_qr(manager,'issue',q)->>'approved'='false';
 v:=public.document_qr(admin_id,'change',q||'{"approved":true,"revision":3}');
 ASSERT public.document_qr(NULL,'verify',q)#>>'{fields,0,key}'='vin';
 ASSERT EXISTS(SELECT FROM app.audit_events WHERE entity_id=row_id::text AND action='qr_status');
 SELECT b.name INTO STRICT alt FROM app.branches b JOIN app.companies c ON c.id=b.company_id WHERE c.code='bakheet' AND b.active AND b.name<>'الدورة' LIMIT 1;
 v:=public.document_qr(admin_id,'issue',q||jsonb_build_object('branch',alt));
 BEGIN PERFORM public.document_qr(manager,'review',v);RAISE EXCEPTION 'manager accessed another branch QR';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 q:=q||jsonb_build_object('record','offline-test','reserved',gen_random_uuid());
 v:=public.document_qr(admin_id,'issue',q);ASSERT v->>'id'=q->>'reserved';
 ASSERT public.document_qr(admin_id,'issue',q)=v;
 BEGIN PERFORM public.document_qr(admin_id,'issue',q||'{"record":"different"}');RAISE EXCEPTION 'rebound printed UUID';EXCEPTION WHEN unique_violation THEN NULL;END;
 INSERT INTO public.ownership_qr(id,buyer,vin,company) VALUES(legacy_id,'مثال','LEGACY','bakheet');
 ASSERT public.document_qr(NULL,'verify',jsonb_build_object('id',legacy_id))#>>'{fields,1,value}'='LEGACY';
 ASSERT NOT has_function_privilege('authenticated','public.document_qr(uuid,text,jsonb)','execute');
END $test$;
