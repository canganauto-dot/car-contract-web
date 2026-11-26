-- The Edge worker bootstraps one encrypted signing key per deployment.
CREATE FUNCTION public.contract_push_identity(candidate jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved text;
BEGIN
 SELECT decrypted_secret INTO saved FROM vault.decrypted_secrets WHERE name='contract_webpush_identity';
 IF saved IS NULL THEN
  PERFORM pg_advisory_xact_lock(693233091407);
  SELECT decrypted_secret INTO saved FROM vault.decrypted_secrets WHERE name='contract_webpush_identity';
  IF saved IS NULL THEN
   IF candidate IS NULL OR (candidate->>'kty',candidate->>'crv') IS DISTINCT FROM ('EC'::text,'P-256'::text)
     OR coalesce(candidate->>'d','') !~ '^[A-Za-z0-9_-]{43}$' OR coalesce(candidate->>'x','') !~ '^[A-Za-z0-9_-]{43}$' OR coalesce(candidate->>'y','') !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE invalid_parameter_value; END IF;
   saved:=candidate::text;
   PERFORM vault.create_secret(saved,'contract_webpush_identity');
  END IF;
 END IF;
 RETURN saved::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.contract_push_identity(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contract_push_identity(jsonb) TO service_role;
