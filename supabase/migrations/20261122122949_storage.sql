-- PROPOSAL ONLY. Execute after approved storage limits and live-policy review.
BEGIN;
-- No public URLs, no browser Storage permissions, no overwrite. Backend proxies all uploads/downloads.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES
 ('contract-archive','contract-archive',false,15000000,ARRAY['application/pdf']),
 ('contract-assets','contract-assets',false,5000000,ARRAY['image/jpeg','image/png']);
-- Restrictive policy prevents unrelated future permissive policies accidentally opening these buckets.
-- Supabase service_role bypasses RLS: authorization must happen in the trusted backend first.
CREATE POLICY contract_objects_no_browser ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(bucket_id NOT IN ('contract-archive','contract-assets'))
 WITH CHECK(bucket_id NOT IN ('contract-archive','contract-assets'));
CREATE POLICY contract_buckets_no_browser ON storage.buckets AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(id NOT IN ('contract-archive','contract-assets'))
 WITH CHECK(id NOT IN ('contract-archive','contract-assets'));
COMMIT;
