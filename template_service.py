"""Revisioned layout service for a static website. Run behind HTTPS in production."""
import argparse
import hashlib
import hmac
import json
import os
import re
import sqlite3
import uuid
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from branch_numbers import normalize_branch, reserve

LAYOUT_KEYS = set("approvedLayout pages cashTemplate exchangeTemplate externalPages transferLetter scheduleTemplate companySheets printLayouts contractTemplates variableLabels".split())


def valid_pages(pages):
    return (isinstance(pages, list)
            and all(isinstance(p, dict) and type(p.get("id")) is int
                    and isinstance(p.get("nodes"), list) and all(isinstance(n, dict) for n in p["nodes"])
                    for p in pages)
            and len({p["id"] for p in pages}) == len(pages))


class Templates(BaseHTTPRequestHandler):
    def reply(self, status, payload=None, tag=None):
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Vary", "Origin")
        if self.headers.get("Origin") == self.server.web_origin:
            self.send_header("Access-Control-Allow-Origin", self.server.web_origin)
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match, If-None-Match")
            self.send_header("Access-Control-Expose-Headers", "ETag")
        if tag:
            self.send_header("ETag", '"' + tag + '"')
        data = json.dumps(payload, ensure_ascii=False, separators=(",",":")).encode() if payload is not None else b""
        if data:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        if status != 304:
            self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if data:
            self.wfile.write(data)

    def do_OPTIONS(self):
        self.reply(204 if self.path in {"/templates","/numbers"} and self.headers.get("Origin") == self.server.web_origin else 403)

    def do_POST(self):
        if self.path!="/numbers" or self.headers.get("Origin")!=self.server.web_origin:
            return self.reply(403)
        try:
            size=int(self.headers.get("Content-Length",0))
            if self.headers.get_content_type()!="application/json" or not 0<size<=4096:
                return self.reply(400)
            request=json.loads(self.rfile.read(size))
            expected=self.server.branch_keys.get(normalize_branch(request["branch"]))
            auth=self.headers.get("Authorization","")
            if not expected or not auth.startswith("Bearer ") or not hmac.compare_digest(hashlib.sha256(auth[7:].encode()).hexdigest(),expected):
                return self.reply(401, {"error":"يتطلب حجز العدد رمز الفرع الصحيح."})
            status, data=reserve(self.server.store,request)
            self.reply(status,data)
        except (ValueError,TypeError,KeyError,AttributeError):
            self.reply(400)

    def do_GET(self):
        if self.path != "/templates":
            return self.reply(404)
        # One read snapshot provides both the head and the latest revision of each template.
        with closing(sqlite3.connect(self.server.store)) as db, db:
            db.execute("BEGIN")
            head = current_revision(db)
            if self.headers.get("If-None-Match") == '"' + head + '"':
                return self.reply(304, tag=head)
            rows = db.execute("SELECT scope, base_hash, layout FROM versions WHERE id IN (SELECT MAX(id) FROM versions GROUP BY scope)")
            layouts = {s:{"baseHash":b,"layout":json.loads(l)} for s,b,l in rows}
        self.reply(200, {"revision":head, "layouts":layouts}, head)

    def do_PUT(self):
        if self.path != "/templates" or self.headers.get("Origin") != self.server.web_origin:
            return self.reply(403)
        auth = self.headers.get("Authorization","")
        if not auth.startswith("Bearer ") or not hmac.compare_digest(
                hashlib.sha256(auth[7:].encode()).hexdigest(), self.server.key_hash):
            return self.reply(401)
        try:
            size = int(self.headers.get("Content-Length",0))
            if self.headers.get_content_type() != "application/json" or not 0 < size <= 48_000_000:
                return self.reply(400)
            data = json.loads(self.rfile.read(size))
            if not isinstance(data,dict) or set(data) != {"scope","layout","baseHash"}:
                return self.reply(400)
            scope, layout, base_hash = data["scope"], data["layout"], data["baseHash"]
            if (not isinstance(scope,str) or not re.fullmatch(r"(?:contract|book):[A-Za-z0-9_-]{1,128}",scope)
                    or not isinstance(base_hash,str) or not re.fullmatch(r"[a-f0-9]{64}",base_hash)
                    or not isinstance(layout,dict) or layout.keys()-LAYOUT_KEYS or not valid_pages(layout.get("pages"))
                    or any(not valid_pages(layout[k]) for k in ("externalPages","companySheets") if k in layout)
                    or any(not valid_pages([layout[k]]) for k in ("cashTemplate","exchangeTemplate","scheduleTemplate","transferLetter") if k in layout)):
                return self.reply(400)
            stored = json.dumps({**layout,"approvedLayout":True}, ensure_ascii=False, allow_nan=False, separators=(",",":"))
            with closing(sqlite3.connect(self.server.store, timeout=10)) as db, db:
                db.execute("BEGIN IMMEDIATE")
                if self.headers.get("If-Match") != '"' + current_revision(db) + '"':
                    return self.reply(409)
                revision = uuid.uuid4().hex
                db.execute("INSERT INTO versions (revision,scope,base_hash,layout) VALUES (?,?,?,?)",(revision,scope,base_hash,stored))
            self.reply(200, {"revision":revision}, revision)
        except (ValueError, TypeError, RecursionError):
            self.reply(400)
        except sqlite3.Error:
            self.reply(503)


def current_revision(db):
    row = db.execute("SELECT revision FROM versions ORDER BY id DESC LIMIT 1").fetchone()
    return row[0] if row else "0"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin",required=True, help="Exact HTTPS origin of the static site")
    parser.add_argument("--store",type=Path,required=True, help="Persistent SQLite file outside the web directory")
    parser.add_argument("--port",type=int,default=8092)
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if not origin.hostname or origin.username or origin.password or origin.query or origin.fragment or origin.path or not (
            origin.scheme=="https" or origin.scheme=="http" and origin.hostname in {"127.0.0.1","localhost"}):
        parser.error("Use an exact HTTPS origin, or HTTP loopback for local testing.")
    key_hash = os.environ.get("CONTRACT_TEMPLATE_TOKEN_SHA256","").lower()
    if not re.fullmatch(r"[a-f0-9]{64}",key_hash):
        parser.error("Set CONTRACT_TEMPLATE_TOKEN_SHA256 to the digest of the editor's publishing key.")
    with closing(sqlite3.connect(args.store)) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY, revision TEXT NOT NULL UNIQUE, scope TEXT NOT NULL, base_hash TEXT NOT NULL, layout TEXT NOT NULL, approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        db.execute("CREATE INDEX IF NOT EXISTS version_scope ON versions(scope,id)")
    with ThreadingHTTPServer(("127.0.0.1",args.port),Templates) as server:
        server.branch_keys={normalize_branch(k):v for k,v in json.loads(os.environ.get("CONTRACT_BRANCH_KEY_HASHES","{}")).items()}
        if any(not re.fullmatch("[a-f0-9]{64}",v) for v in server.branch_keys.values()):
            parser.error("Branch keys must be SHA-256 hex digests.")
        server.web_origin, server.store, server.key_hash = args.origin, args.store, key_hash
        print(server.server_port,flush=True)
        server.serve_forever()
