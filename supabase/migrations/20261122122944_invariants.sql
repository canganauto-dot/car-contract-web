-- PROPOSAL ONLY. Owners/service role remain trusted; triggers also protect against ordinary privileged mistakes.
BEGIN;
CREATE FUNCTION contract_private.immutable_row() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'immutable record; append a new version' USING ERRCODE='55000'; END $$;
DO $ddl$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['template_versions','template_assets','company_asset_versions','documents','receipts','audit_events'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION contract_private.immutable_row()',t);
 END LOOP;
END $ddl$;
CREATE FUNCTION contract_private.guard_contract() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'contracts are retained; use void with reason' USING ERRCODE='55000'; END IF;
 IF (NEW.id,NEW.company_id,NEW.branch_id,NEW.kind,NEW.letter_key,NEW.created_by,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.branch_id,OLD.kind,OLD.letter_key,OLD.created_by,OLD.created_at)
 THEN RAISE EXCEPTION 'contract identity/scope cannot change' USING ERRCODE='55000'; END IF;
 IF OLD.number_seq IS NOT NULL AND (NEW.number_seq,NEW.number_year,NEW.display_number)
 IS DISTINCT FROM (OLD.number_seq,OLD.number_year,OLD.display_number)
 THEN RAISE EXCEPTION 'issued number cannot change' USING ERRCODE='55000'; END IF;
 IF NEW.current_revision_id IS DISTINCT FROM OLD.current_revision_id AND NOT EXISTS(
 SELECT 1 FROM app.revisions WHERE id=NEW.current_revision_id AND contract_id=NEW.id AND state='finalized'
 AND previous_revision_id IS NOT DISTINCT FROM OLD.current_revision_id)
 THEN RAISE EXCEPTION 'current revision must be finalized' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_contract BEFORE UPDATE OR DELETE ON app.contracts FOR EACH ROW EXECUTE FUNCTION contract_private.guard_contract();
CREATE FUNCTION contract_private.guard_revision() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.state<>'draft' THEN
 RAISE EXCEPTION 'new revision must start as a draft' USING ERRCODE='23514'; END IF;
 IF TG_OP<>'DELETE' AND NEW.customer_photo_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM app.documents WHERE id=NEW.customer_photo_id AND revision_id=NEW.id AND purpose='customer_photo')
 THEN RAISE EXCEPTION 'photo reference must identify this revision customer photo' USING ERRCODE='23514'; END IF;
 IF TG_OP<>'INSERT' AND OLD.state='finalized' THEN
 RAISE EXCEPTION 'finalized revision is immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'revision history cannot be deleted' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' THEN
 IF (NEW.id,NEW.company_id,NEW.branch_id,NEW.contract_id,NEW.revision_no,NEW.previous_revision_id)
 IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.branch_id,OLD.contract_id,OLD.revision_no,OLD.previous_revision_id)
 THEN RAISE EXCEPTION 'revision identity/scope cannot change' USING ERRCODE='55000'; END IF;
 NEW.lock_version:=OLD.lock_version+1;
 END IF;
 IF NEW.revision_no>1 AND NOT EXISTS(SELECT 1 FROM app.revisions r WHERE r.id=NEW.previous_revision_id
 AND r.contract_id=NEW.contract_id AND r.state='finalized' AND r.revision_no=NEW.revision_no-1)
 THEN RAISE EXCEPTION 'correction must follow preceding finalized revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_revision BEFORE INSERT OR UPDATE OR DELETE ON app.revisions FOR EACH ROW EXECUTE FUNCTION contract_private.guard_revision();
-- Every child change takes the parent lock. Finalization cannot race a child update.
-- Scope/reparenting are prohibited even while draft; a move must explicitly remove/recreate.
CREATE FUNCTION contract_private.guard_revision_child() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r uuid; s text;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
 IF TG_OP='UPDATE' AND (NEW.revision_id,NEW.company_id,NEW.branch_id) IS DISTINCT FROM (OLD.revision_id,OLD.company_id,OLD.branch_id)
 THEN RAISE EXCEPTION 'cannot reparent revision data' USING ERRCODE='55000'; END IF;
 SELECT state INTO s FROM app.revisions WHERE id=r FOR UPDATE;
 IF s IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'revision is not editable' USING ERRCODE='55000'; END IF;
 UPDATE app.revisions SET lock_version=lock_version+1 WHERE id=r;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DO $ddl$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['revision_parties','revision_vehicles','revision_finance','payment_schedule','revision_table_rows','promissory_notes'] LOOP
 EXECUTE format('CREATE TRIGGER guard_child BEFORE INSERT OR UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION contract_private.guard_revision_child()',t);
 END LOOP;
END $ddl$;
CREATE FUNCTION contract_private.guard_template_asset() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 -- Template assembly and first revision creation must serialize on this same row.
 PERFORM 1 FROM app.template_versions WHERE id=NEW.template_version_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM app.revisions WHERE template_version_id=NEW.template_version_id)
 THEN RAISE EXCEPTION 'used template asset manifest is frozen' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_asset_manifest BEFORE INSERT ON app.template_assets FOR EACH ROW EXECUTE FUNCTION contract_private.guard_template_asset();
CREATE FUNCTION contract_private.lock_template_manifest() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM app.template_versions WHERE id=NEW.template_version_id FOR UPDATE;
 RETURN NEW;
END $$;
CREATE TRIGGER lock_template_manifest BEFORE INSERT OR UPDATE OF template_version_id ON app.revisions
 FOR EACH ROW EXECUTE FUNCTION contract_private.lock_template_manifest();
CREATE FUNCTION contract_private.guard_document() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s text;
BEGIN
 SELECT state INTO s FROM app.revisions WHERE id=NEW.revision_id FOR UPDATE;
 IF NEW.purpose IN ('generated_pdf','signed_pdf') AND s IS DISTINCT FROM 'finalized'
 THEN RAISE EXCEPTION 'archived PDF must refer to finalized revision' USING ERRCODE='23514'; END IF;
 IF NEW.object_key <> NEW.company_id::text||'/'||NEW.branch_id::text||'/'||NEW.revision_id::text||'/'||NEW.id::text
 THEN RAISE EXCEPTION 'invalid immutable object key' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_document BEFORE INSERT ON app.documents FOR EACH ROW EXECUTE FUNCTION contract_private.guard_document();
CREATE FUNCTION contract_private.guard_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE original app.receipts;
BEGIN
 PERFORM 1 FROM app.contracts WHERE id=NEW.contract_id AND current_revision_id IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'receipt requires finalized contract' USING ERRCODE='23514'; END IF;
 IF NEW.reverses_receipt_id IS NOT NULL THEN
 SELECT * INTO original FROM app.receipts WHERE id=NEW.reverses_receipt_id;
 IF NOT FOUND OR original.reverses_receipt_id IS NOT NULL OR original.amount<>NEW.amount
 THEN RAISE EXCEPTION 'reversal must exactly reverse an original receipt' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_receipt BEFORE INSERT ON app.receipts FOR EACH ROW EXECUTE FUNCTION contract_private.guard_receipt();
-- Audit small metadata only, never raw identities, notes, PDF bytes, tokens, or passwords.
CREATE FUNCTION contract_private.audit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j jsonb; c uuid; b uuid; a uuid;
BEGIN
 j:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 c:=COALESCE((j->>'company_id')::uuid,CASE WHEN TG_TABLE_NAME='companies' THEN (j->>'id')::uuid END);
 b:=(j->>'branch_id')::uuid;
 a:=NULLIF(current_setting('contract.actor_id',true),'')::uuid;
 IF a IS NULL AND (current_setting('role',true)='service_role' OR session_user='service_role') THEN
 RAISE EXCEPTION 'application write requires transaction-local verified employee' USING ERRCODE='42501'; END IF;
 IF c IS NOT NULL THEN INSERT INTO app.audit_events(company_id,branch_id,actor_id,action,entity_type,entity_id,request_id,detail)
 VALUES(c,b,a,TG_OP,TG_TABLE_NAME,COALESCE(j->>'id',j->>'revision_id',j->>'employee_id',j->>'field_key'),
 NULLIF(current_setting('contract.request_id',true),''),jsonb_build_object('source','database'));
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DO $ddl$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['companies','branches','company_memberships','branch_memberships','customers','vehicles',
 'company_fields','company_asset_versions','vehicle_models','vehicle_image_bindings','templates','template_versions','template_assets','price_catalogs','price_catalog_items',
 'contracts','revisions','revision_parties','revision_vehicles','revision_finance','payment_schedule','revision_table_rows','promissory_notes','receipts','documents'] LOOP
 EXECUTE format('CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION contract_private.audit_change()',t);
 END LOOP;
END $ddl$;
ALTER TABLE app.revisions ADD CONSTRAINT hash_required_when_final CHECK(state<>'finalized' OR content_sha256 IS NOT NULL);
ALTER TABLE app.revisions ADD CONSTRAINT correction_reason_required CHECK(revision_no=1 OR correction_reason IS NOT NULL);
ALTER TABLE app.documents ADD CONSTRAINT document_revision_identity UNIQUE(revision_id,id);
-- A published job must reference the verified bytes on exactly its reserved revision and path.
ALTER TABLE app.documents ADD CONSTRAINT document_verified_identity
 UNIQUE(id,revision_id,purpose,object_key,sha256,byte_size);
ALTER TABLE contract_private.upload_jobs ADD CONSTRAINT job_verified_document
 FOREIGN KEY(document_id,revision_id,purpose,object_key,expected_sha256,expected_bytes)
 REFERENCES app.documents(id,revision_id,purpose,object_key,sha256,byte_size);
ALTER TABLE contract_private.upload_jobs ADD CONSTRAINT job_publication_complete
 CHECK((state='published')=(document_id IS NOT NULL));
CREATE FUNCTION contract_private.guard_upload_job() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.state='published' THEN RAISE EXCEPTION 'published upload is immutable' USING ERRCODE='55000'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF (NEW.id,NEW.company_id,NEW.branch_id,NEW.revision_id,NEW.purpose,NEW.actor_id,NEW.request_key,
     NEW.object_key,NEW.expected_sha256,NEW.expected_bytes) IS DISTINCT FROM
    (OLD.id,OLD.company_id,OLD.branch_id,OLD.revision_id,OLD.purpose,OLD.actor_id,OLD.request_key,
     OLD.object_key,OLD.expected_sha256,OLD.expected_bytes)
 THEN RAISE EXCEPTION 'upload reservation identity cannot change' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_upload_job BEFORE UPDATE OR DELETE ON contract_private.upload_jobs
 FOR EACH ROW EXECUTE FUNCTION contract_private.guard_upload_job();
CREATE INDEX upload_job_expiry ON contract_private.upload_jobs(expires_at)
 WHERE state<>'published';
ALTER TABLE app.revisions ADD COLUMN customer_photo_id uuid;
ALTER TABLE app.revisions ADD CONSTRAINT pinned_customer_photo FOREIGN KEY(id,customer_photo_id) REFERENCES app.documents(revision_id,id);
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA contract_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION contract_private.read_company(uuid),contract_private.read_branch(uuid,uuid),contract_private.admin_company(uuid) TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA contract_private TO service_role;
COMMIT;
