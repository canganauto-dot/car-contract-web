-- PROPOSAL ONLY. Separate from application/public schemas; explicitly expose app only after review.
BEGIN;
CREATE FUNCTION contract_private.is_member(c uuid, u uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM app.employees e JOIN app.company_memberships m ON m.employee_id=e.id
 JOIN app.companies co ON co.id=m.company_id
 WHERE e.id=u AND e.active AND m.company_id=c AND m.active AND co.active)
$$;
CREATE FUNCTION contract_private.is_admin(c uuid, u uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT contract_private.is_member(c,u) AND EXISTS(SELECT 1 FROM app.company_memberships
 WHERE company_id=c AND employee_id=u AND role='administrator' AND active)
$$;
CREATE FUNCTION contract_private.can_branch(c uuid,b uuid,u uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT contract_private.is_member(c,u) AND EXISTS(SELECT 1 FROM app.branches WHERE id=b AND company_id=c)
 AND (contract_private.is_admin(c,u) OR EXISTS(SELECT 1 FROM app.branch_memberships
 WHERE company_id=c AND branch_id=b AND employee_id=u AND active))
$$;
-- Inactive branches remain readable to already-authorized staff; writes require active branches.
CREATE FUNCTION contract_private.can_manage(c uuid,b uuid,u uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT contract_private.can_branch(c,b,u) AND (contract_private.is_admin(c,u) OR EXISTS(
 SELECT 1 FROM app.branch_memberships WHERE company_id=c AND branch_id=b AND employee_id=u
 AND active AND role='branch_manager'))
$$;
-- RLS never takes a caller-supplied identity: policies use these zero-actor wrappers.
CREATE FUNCTION contract_private.read_company(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
 AS $$ SELECT contract_private.is_member(c,auth.uid()) $$;
CREATE FUNCTION contract_private.read_branch(c uuid,b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
 AS $$ SELECT contract_private.can_branch(c,b,auth.uid()) $$;
CREATE FUNCTION contract_private.admin_company(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
 AS $$ SELECT contract_private.is_admin(c,auth.uid()) $$;
DO $ddl$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['companies','branches','employees','company_memberships','branch_memberships',
 'customers','vehicles','company_fields','company_asset_versions','vehicle_models','vehicle_image_bindings','templates','template_versions','template_assets',
 'price_catalogs','price_catalog_items','contracts','revisions','revision_parties','revision_vehicles','revision_finance',
 'payment_schedule','revision_table_rows','promissory_notes','receipts','documents','audit_events'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC, anon, authenticated',t);
  EXECUTE format('GRANT SELECT ON app.%I TO authenticated',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['customers','vehicles','contracts','revisions','revision_parties','revision_vehicles',
 'revision_finance','payment_schedule','revision_table_rows','promissory_notes','receipts','documents'] LOOP
  EXECUTE format('CREATE POLICY scoped_read ON app.%I FOR SELECT TO authenticated USING (contract_private.read_branch(company_id,branch_id))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['company_fields','company_asset_versions','vehicle_models','vehicle_image_bindings','templates','template_versions','template_assets','price_catalogs','price_catalog_items'] LOOP
  EXECUTE format('CREATE POLICY company_read ON app.%I FOR SELECT TO authenticated USING (contract_private.read_company(company_id))',t);
 END LOOP;
END $ddl$;
CREATE POLICY company_read ON app.companies FOR SELECT TO authenticated USING(contract_private.read_company(id));
CREATE POLICY branch_read ON app.branches FOR SELECT TO authenticated USING(contract_private.read_branch(company_id,id));
CREATE POLICY employee_self ON app.employees FOR SELECT TO authenticated USING(id=auth.uid() AND active);
CREATE POLICY membership_read ON app.company_memberships FOR SELECT TO authenticated USING(
 contract_private.read_company(company_id) AND (employee_id=auth.uid() OR contract_private.admin_company(company_id)));
CREATE POLICY membership_read ON app.branch_memberships FOR SELECT TO authenticated USING(
 contract_private.read_company(company_id) AND (employee_id=auth.uid() OR contract_private.admin_company(company_id)));
CREATE POLICY audit_admin_read ON app.audit_events FOR SELECT TO authenticated USING(contract_private.admin_company(company_id));
-- No direct INSERT/UPDATE/DELETE policy or grant for authenticated, even administrators.
GRANT USAGE ON SCHEMA app,contract_private TO authenticated;
GRANT USAGE ON SCHEMA app,contract_private TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA app,contract_private FROM service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA app,contract_private TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA contract_private FROM PUBLIC,anon,authenticated;
DO $ddl$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['upload_jobs','number_counters','operation_requests'] LOOP
 EXECUTE format('ALTER TABLE contract_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE contract_private.%I FORCE ROW LEVEL SECURITY',t);
 END LOOP;
END $ddl$;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA contract_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION contract_private.read_company(uuid),contract_private.read_branch(uuid,uuid),contract_private.admin_company(uuid) TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA contract_private TO service_role;
COMMIT;
