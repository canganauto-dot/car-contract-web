-- The transfer letter uses the string "0" as its template identifier.
DO $migration$
DECLARE original text; revised text;
BEGIN
 original:=pg_get_functiondef('contract_private.archive_op(uuid,text,jsonb)'::regprocedure);
 revised:=replace(original,$old$coalesce(d->>'standaloneBook','') NOT IN ('','0','false')$old$,
                           $new$coalesce(d->>'standaloneBook','') NOT IN ('','false')$new$);
 IF revised=original THEN RAISE EXCEPTION 'unexpected archive function version'; END IF;
 EXECUTE revised;
END $migration$;
