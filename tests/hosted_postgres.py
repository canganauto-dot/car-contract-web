"""Run only against a fresh, temporary cluster created by this process (psycopg 3).
Set PG_TEST_BIN to a native PostgreSQL bin directory. No external DSN is accepted.
Auth and Storage here are schema fixtures, not Supabase HTTP services.
"""
import os
import secrets
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

import psycopg

HERE = Path(__file__).resolve().parent
BIN = Path(os.environ['PG_TEST_BIN'])
BOOTSTRAP = """
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT (nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub')::uuid
$$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets,name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA storage TO anon,authenticated;
-- A broad permission on unrelated buckets tests the restrictive policy's composition.
CREATE POLICY fixture_permit ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
CREATE POLICY fixture_permit ON storage.buckets FOR ALL TO authenticated USING(true) WITH CHECK(true);
"""
def invoke(program,*args):
    subprocess.run([str(BIN / program),*map(str,args)],check=True,
                   creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))

def main():
    with tempfile.TemporaryDirectory(prefix='contracts-postgres-') as tmp:
        base=Path(tmp)
        data=base/'data'
        password=secrets.token_hex(24)
        password_file=base/'password'
        password_file.write_text(password,encoding='ascii')
        invoke('initdb','-D',data,'-U','review_owner','--encoding=UTF8','--locale=C',
               '--auth=scram-sha-256','--pwfile',password_file)
        password_file.unlink()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            port=sock.getsockname()[1]
        invoke('pg_ctl','-D',data,'-l',base/'postgres.log','-o',f'-h 127.0.0.1 -p {port}','-w','start')
        try:
            dsn=f'postgresql://review_owner@127.0.0.1:{port}/postgres'
            os.environ['PGPASSWORD']=password
            with psycopg.connect(dsn,autocommit=True) as db:
                print(db.execute('select version()').fetchone()[0],flush=True)
                db.execute(BOOTSTRAP)
                for path in sorted((HERE.parent/'supabase'/'migrations').glob('*.sql')):
                    db.execute(path.read_text(encoding='utf-8-sig'))
                    print('PASS migration', path.name,flush=True)
                db.execute((HERE/'hosted-roles.sql').read_text(encoding='utf-8-sig'))
                db.execute((HERE/'sales-workflow.sql').read_text(encoding='utf-8-sig'))
                db.execute((HERE/'document-qr.sql').read_text(encoding='utf-8-sig'))
                print('PASS QR visibility, authorization, revocation, legacy lookup and duplicate issue',flush=True)
                print('PASS private drafts, sales publication, finance access, approvals and contract conversion',flush=True)
                print('PASS company administration, template approval, numbering and role checks',flush=True)
        finally:
            invoke('pg_ctl','-D',data,'-m','fast','-w','stop')

if __name__=='__main__':
    main()
