-- PROPOSAL ONLY. Do not execute before approval and disposable-environment review.
BEGIN;
CREATE SCHEMA app;
CREATE SCHEMA contract_private;
REVOKE ALL ON SCHEMA app, contract_private FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA contract_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
CREATE DOMAIN app.iqd AS numeric CHECK (VALUE >= 0 AND VALUE <= 999999999999 AND VALUE = trunc(VALUE));
CREATE TABLE app.companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
 name text NOT NULL, legal_name text NOT NULL, active boolean NOT NULL DEFAULT true,
 address text, phone text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.branches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies,
 code text NOT NULL, name text NOT NULL, address text, phone text,
 active boolean NOT NULL DEFAULT true, UNIQUE(company_id,id), UNIQUE(company_id,code)
);
CREATE TABLE app.employees (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 display_name text NOT NULL, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.company_memberships (
 company_id uuid NOT NULL REFERENCES app.companies, employee_id uuid NOT NULL REFERENCES app.employees,
 role text NOT NULL CHECK(role IN ('administrator','staff')), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(company_id,employee_id)
);
CREATE TABLE app.branch_memberships (
 company_id uuid NOT NULL, branch_id uuid NOT NULL, employee_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('branch_manager','employee')), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(company_id,branch_id,employee_id),
 FOREIGN KEY(company_id,branch_id) REFERENCES app.branches(company_id,id),
 FOREIGN KEY(company_id,employee_id) REFERENCES app.company_memberships(company_id,employee_id)
);
CREATE INDEX branch_memberships_employee ON app.branch_memberships(employee_id,company_id,branch_id) WHERE active;
CREATE INDEX company_memberships_employee ON app.company_memberships(employee_id,company_id) WHERE active;
-- Branch-local identity records deliberately do not leak customer presence between branches.
CREATE TABLE app.customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL,
 full_name text NOT NULL, identity_number text, identity_issuer text, identity_date date,
 phone text, address text, district text, street text, house text,
 UNIQUE(company_id,branch_id,id), FOREIGN KEY(company_id,branch_id) REFERENCES app.branches(company_id,id)
);
CREATE TABLE app.vehicles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL,
 vin text, make text, model_name text, model_year integer CHECK(model_year BETWEEN 1900 AND 2200),
 color text, plate text, mileage bigint CHECK(mileage>=0), keys_count text,
 UNIQUE(company_id,branch_id,id), FOREIGN KEY(company_id,branch_id) REFERENCES app.branches(company_id,id)
);
CREATE INDEX customers_lookup ON app.customers(company_id,branch_id,full_name);
CREATE INDEX vehicles_lookup ON app.vehicles(company_id,branch_id,vin);
-- No global VIN/identity uniqueness: historical sales and incomplete imported values exist.
CREATE TABLE app.company_fields (
 company_id uuid NOT NULL REFERENCES app.companies, field_key text NOT NULL,
 label text NOT NULL, value text NOT NULL DEFAULT '', PRIMARY KEY(company_id,field_key)
);
CREATE TABLE app.company_asset_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies,
 binding_key text NOT NULL, version integer NOT NULL CHECK(version>0),
 object_key text NOT NULL UNIQUE, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 mime_type text NOT NULL, byte_size bigint NOT NULL CHECK(byte_size>0),
 UNIQUE(company_id,id), UNIQUE(company_id,binding_key,version)
);
CREATE TABLE app.vehicle_models (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies,
 model_key text NOT NULL, name text NOT NULL, brand text NOT NULL, aliases text[] NOT NULL DEFAULT '{}',
 UNIQUE(company_id,id), UNIQUE(company_id,model_key)
);
CREATE TABLE app.vehicle_image_bindings (
 company_id uuid NOT NULL, model_id uuid NOT NULL, slot_key text NOT NULL, asset_version_id uuid NOT NULL,
 PRIMARY KEY(company_id,model_id,slot_key),
 FOREIGN KEY(company_id,model_id) REFERENCES app.vehicle_models(company_id,id),
 FOREIGN KEY(company_id,asset_version_id) REFERENCES app.company_asset_versions(company_id,id)
);
CREATE TABLE app.templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies,
 template_key text NOT NULL, name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('installment','cash','exchange','external','letter')),
 UNIQUE(company_id,id), UNIQUE(company_id,template_key)
);
CREATE TABLE app.template_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, template_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), layout jsonb NOT NULL CHECK(jsonb_typeof(layout)='object'),
 field_schema jsonb NOT NULL CHECK(jsonb_typeof(field_schema)='object'),
 renderer_version text NOT NULL, content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES app.employees, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id), UNIQUE(template_id,version),
 FOREIGN KEY(company_id,template_id) REFERENCES app.templates(company_id,id)
);
CREATE TABLE app.template_assets (
 company_id uuid NOT NULL, template_version_id uuid NOT NULL, asset_version_id uuid NOT NULL,
 PRIMARY KEY(template_version_id,asset_version_id),
 FOREIGN KEY(company_id,template_version_id) REFERENCES app.template_versions(company_id,id),
 FOREIGN KEY(company_id,asset_version_id) REFERENCES app.company_asset_versions(company_id,id)
);
CREATE TABLE app.price_catalogs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES app.companies,
 name text NOT NULL, category text NOT NULL, valid_from date NOT NULL, valid_to date,
 CHECK(valid_to IS NULL OR valid_to>=valid_from), UNIQUE(company_id,id)
);
CREATE TABLE app.price_catalog_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, catalog_id uuid NOT NULL,
 model_name text NOT NULL, model_year integer, fuel_type text, specifications text, price app.iqd NOT NULL,
 FOREIGN KEY(company_id,catalog_id) REFERENCES app.price_catalogs(company_id,id), UNIQUE(company_id,id)
);
CREATE TABLE app.contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('installment','cash','exchange','external','letter')),
 letter_key text, created_by uuid NOT NULL REFERENCES app.employees,
 created_at timestamptz NOT NULL DEFAULT now(), voided_at timestamptz, void_reason text,
 number_year integer, number_seq bigint CHECK(number_seq>0), display_number text,
 current_revision_id uuid, UNIQUE(company_id,branch_id,id),
 FOREIGN KEY(company_id,branch_id) REFERENCES app.branches(company_id,id),
 CHECK((kind='letter') = (letter_key IS NOT NULL)),
 CHECK((number_seq IS NULL AND number_year IS NULL AND display_number IS NULL) OR
       (number_seq IS NOT NULL AND number_year IS NOT NULL AND display_number IS NOT NULL)),
 CHECK((voided_at IS NULL) = (void_reason IS NULL)),
 UNIQUE(branch_id,display_number)
);
CREATE TABLE app.revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL,
 contract_id uuid NOT NULL, revision_no integer NOT NULL CHECK(revision_no>0), previous_revision_id uuid,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','finalized')),
 lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version>=0), correction_reason text,
 template_version_id uuid NOT NULL, contract_date date NOT NULL, contract_time time NOT NULL,
 date_manually_set boolean NOT NULL DEFAULT false, time_manually_set boolean NOT NULL DEFAULT false,
 timezone text NOT NULL DEFAULT 'Asia/Baghdad' CHECK(timezone='Asia/Baghdad'),
 branding_company_id uuid, company_snapshot jsonb NOT NULL CHECK(jsonb_typeof(company_snapshot)='object'),
 organizer_snapshot text NOT NULL, notes text NOT NULL DEFAULT '', transfer_note text NOT NULL DEFAULT '',
 warranty_years integer CHECK(warranty_years>=0), no_warranty boolean NOT NULL DEFAULT false,
 custom_fields jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(custom_fields)='object'),
 print_options jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(print_options)='object'),
 legacy_import jsonb, calculation_version text NOT NULL,
 finalized_by uuid REFERENCES app.employees, finalized_at timestamptz, content_sha256 text,
 UNIQUE(company_id,branch_id,id), UNIQUE(contract_id,id), UNIQUE(contract_id,revision_no),
 FOREIGN KEY(company_id,branch_id,contract_id) REFERENCES app.contracts(company_id,branch_id,id),
 FOREIGN KEY(company_id,template_version_id) REFERENCES app.template_versions(company_id,id),
 FOREIGN KEY(contract_id,previous_revision_id) REFERENCES app.revisions(contract_id,id),
 CHECK(branding_company_id IS NULL OR branding_company_id=company_id),
 CHECK((revision_no=1 AND previous_revision_id IS NULL) OR
       (revision_no>1 AND previous_revision_id IS NOT NULL AND length(trim(correction_reason))>0)),
 CHECK((state='draft' AND finalized_by IS NULL AND finalized_at IS NULL AND content_sha256 IS NULL) OR
       (state='finalized' AND finalized_by IS NOT NULL AND finalized_at IS NOT NULL AND content_sha256 ~ '^[a-f0-9]{64}$'))
);
CREATE UNIQUE INDEX one_draft_per_contract ON app.revisions(contract_id) WHERE state='draft';
ALTER TABLE app.contracts ADD CONSTRAINT current_revision_same_contract
 FOREIGN KEY(id,current_revision_id) REFERENCES app.revisions(contract_id,id);
CREATE TABLE app.revision_parties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL, revision_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('seller','buyer','guarantor','agent','director','witness1','witness2')),
 customer_id uuid, full_name text NOT NULL, legal_capacity text, identity_number text,
 identity_issuer text, identity_date date, address text, district text, street text, house text, phone text, job text,
 UNIQUE(revision_id,role), FOREIGN KEY(company_id,branch_id,revision_id) REFERENCES app.revisions(company_id,branch_id,id),
 FOREIGN KEY(company_id,branch_id,customer_id) REFERENCES app.customers(company_id,branch_id,id)
);
CREATE TABLE app.revision_vehicles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL, revision_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('subject','old','new')), vehicle_id uuid,
 vin text, make text, model_name text, model_year integer, color text, plate text,
 mileage bigint CHECK(mileage>=0), keys_count text, purchase_date date, waiver_date date,
 UNIQUE(revision_id,role), FOREIGN KEY(company_id,branch_id,revision_id) REFERENCES app.revisions(company_id,branch_id,id),
 FOREIGN KEY(company_id,branch_id,vehicle_id) REFERENCES app.vehicles(company_id,branch_id,id)
);
CREATE TABLE app.revision_finance (
 revision_id uuid PRIMARY KEY, company_id uuid NOT NULL, branch_id uuid NOT NULL,
 mode text NOT NULL CHECK(mode IN ('installment','cash','external','exchange_manual')),
 currency text NOT NULL DEFAULT 'IQD' CHECK(currency='IQD'), total app.iqd NOT NULL,
 initial_amount app.iqd NOT NULL DEFAULT 0, initial_date date,
 installment_count integer NOT NULL DEFAULT 0 CHECK(installment_count BETWEEN 0 AND 1200),
 installment_amount app.iqd NOT NULL DEFAULT 0, first_due_date date,
 interval_months integer NOT NULL DEFAULT 1 CHECK(interval_months BETWEEN 1 AND 24),
 phase_count integer NOT NULL DEFAULT 0 CHECK(phase_count BETWEEN 0 AND 1199), phase_amount app.iqd NOT NULL DEFAULT 0,
 cash_split boolean NOT NULL DEFAULT false, balance_due_date date,
 exchange_payer text CHECK(exchange_payer IN ('seller','buyer')), payment_note text NOT NULL DEFAULT '',
 CHECK(initial_amount<=total), CHECK(phase_count=0 OR (phase_amount>0 AND phase_count<installment_count)),
 CHECK(mode='installment' OR (installment_count=0 AND phase_count=0)),
 FOREIGN KEY(company_id,branch_id,revision_id) REFERENCES app.revisions(company_id,branch_id,id)
);
CREATE TABLE app.payment_schedule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL, revision_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>0), kind text NOT NULL CHECK(kind IN ('initial','additional','installment','final','balance')),
 label text NOT NULL, amount app.iqd NOT NULL CHECK(amount>0), due_date date,
 UNIQUE(revision_id,ordinal), UNIQUE(company_id,branch_id,id), UNIQUE(revision_id,id),
 FOREIGN KEY(company_id,branch_id,revision_id) REFERENCES app.revisions(company_id,branch_id,id)
);
CREATE TABLE app.revision_table_rows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL, revision_id uuid NOT NULL,
 table_key text NOT NULL, row_no integer NOT NULL CHECK(row_no>0),
 cells jsonb NOT NULL CHECK(jsonb_typeof(cells)='object'), quantity numeric(12,3) CHECK(quantity>=0),
 unit_price app.iqd, catalog_item_id uuid,
 UNIQUE(revision_id,table_key,row_no), FOREIGN KEY(company_id,branch_id,revision_id) REFERENCES app.revisions(company_id,branch_id,id),
 FOREIGN KEY(company_id,catalog_item_id) REFERENCES app.price_catalog_items(company_id,id)
);
-- Promissory notes are security instruments, NOT additional customer debt.
CREATE TABLE app.promissory_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL, revision_id uuid NOT NULL,
 obligor text NOT NULL CHECK(obligor IN ('buyer','guarantor')), part integer NOT NULL CHECK(part IN (1,2)),
 amount app.iqd NOT NULL CHECK(amount>0), due_date date,
 UNIQUE(revision_id,obligor,part), FOREIGN KEY(company_id,branch_id,revision_id) REFERENCES app.revisions(company_id,branch_id,id)
);
CREATE TABLE app.receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL, contract_id uuid NOT NULL,
 amount app.iqd NOT NULL CHECK(amount>0), received_at timestamptz NOT NULL,
 reverses_receipt_id uuid UNIQUE, reference text, recorded_by uuid NOT NULL REFERENCES app.employees,
 created_at timestamptz NOT NULL DEFAULT now(), idempotency_key uuid NOT NULL,
 UNIQUE(company_id,branch_id,contract_id,id), UNIQUE(company_id,idempotency_key),
 FOREIGN KEY(company_id,branch_id,contract_id) REFERENCES app.contracts(company_id,branch_id,id),
 FOREIGN KEY(company_id,branch_id,contract_id,reverses_receipt_id) REFERENCES app.receipts(company_id,branch_id,contract_id,id),
 CHECK(reverses_receipt_id IS NULL OR reverses_receipt_id<>id)
);
CREATE TABLE app.documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL, revision_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('generated_pdf','signed_pdf','customer_photo','attachment')),
 version integer NOT NULL CHECK(version>0), object_key text NOT NULL UNIQUE,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), byte_size bigint NOT NULL CHECK(byte_size>0),
 mime_type text NOT NULL, page_count integer CHECK(page_count>0),
 created_by uuid NOT NULL REFERENCES app.employees, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(revision_id,purpose,version), FOREIGN KEY(company_id,branch_id,revision_id) REFERENCES app.revisions(company_id,branch_id,id),
 CHECK(purpose NOT IN ('generated_pdf','signed_pdf') OR mime_type='application/pdf')
);
-- Upload workflow is mutable; a verified, published document row is immutable.
CREATE TABLE contract_private.upload_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid NOT NULL, revision_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('generated_pdf','signed_pdf','customer_photo','attachment')),
 actor_id uuid NOT NULL REFERENCES app.employees, request_key uuid NOT NULL,
 expected_sha256 text NOT NULL CHECK(expected_sha256 ~ '^[a-f0-9]{64}$'), expected_bytes bigint NOT NULL CHECK(expected_bytes>0),
 object_key text NOT NULL UNIQUE, state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','uploaded','verified','published','failed')),
 document_id uuid UNIQUE REFERENCES app.documents, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 lease_until timestamptz, expires_at timestamptz NOT NULL, error_code text,
 UNIQUE(company_id,actor_id,request_key), FOREIGN KEY(company_id,branch_id,revision_id) REFERENCES app.revisions(company_id,branch_id,id)
);
CREATE TABLE contract_private.number_counters (
 company_id uuid NOT NULL REFERENCES app.companies, number_year integer NOT NULL,
 last_value bigint NOT NULL CHECK(last_value>0), PRIMARY KEY(company_id,number_year)
);
CREATE TABLE contract_private.operation_requests (
 company_id uuid NOT NULL REFERENCES app.companies, actor_id uuid NOT NULL REFERENCES app.employees,
 request_key uuid NOT NULL, operation text NOT NULL, payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,actor_id,request_key)
);
CREATE TABLE app.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, company_id uuid NOT NULL REFERENCES app.companies,
 branch_id uuid, actor_id uuid REFERENCES app.employees, action text NOT NULL, entity_type text NOT NULL, entity_id text,
 request_id text, occurred_at timestamptz NOT NULL DEFAULT now(), detail jsonb NOT NULL DEFAULT '{}',
 FOREIGN KEY(company_id,branch_id) REFERENCES app.branches(company_id,id)
);
CREATE INDEX contracts_archive ON app.contracts(company_id,branch_id,created_at DESC,id);
CREATE INDEX revisions_archive ON app.revisions(company_id,branch_id,contract_date DESC,contract_id) WHERE state='finalized';
CREATE INDEX revision_parties_search ON app.revision_parties(company_id,branch_id,full_name);
CREATE INDEX revision_vehicles_search ON app.revision_vehicles(company_id,branch_id,vin,plate);
CREATE INDEX documents_archive ON app.documents(company_id,branch_id,revision_id,purpose,version DESC);
CREATE INDEX receipts_contract ON app.receipts(company_id,branch_id,contract_id,received_at);
CREATE INDEX audit_lookup ON app.audit_events(company_id,branch_id,occurred_at DESC);
-- Leading tenant keys support both RLS and branch-scoped joins. Remaining child FK indexes below.
CREATE INDEX revision_assets_template ON app.template_assets(company_id,asset_version_id);
CREATE INDEX revision_table_catalog ON app.revision_table_rows(company_id,catalog_item_id);
CREATE INDEX revisions_template ON app.revisions(company_id,template_version_id);
CREATE INDEX parties_customer ON app.revision_parties(company_id,branch_id,customer_id);
CREATE INDEX revision_vehicle_master ON app.revision_vehicles(company_id,branch_id,vehicle_id);
COMMIT;
