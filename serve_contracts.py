"""Local development host. Only the loopback editor may update shared defaults."""
import argparse
from contextlib import ExitStack
import base64
import hashlib
import importlib
import json
import os
import re
import tempfile
import threading
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import rebuild
from branch_numbers import reserve

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
SOURCE = ROOT / "initial-data.json"
LOCK = threading.Lock()
KEYS = set("companies cars assets clauses edits custom content contentOrder extraPages objects design companyFields companyImageSlots formulas vehicleImageSlots vehicleImages vehicleImageHistory imageSeparationVersion printSides bookPriceDefaults deletedCompanyImageSlots frames letterTemplates priceCatalogs requiredFields tables variableLabels".split())


def atomic(path, content):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        tmp = Path(f.name)
        try:
            f.write(content)
        except BaseException:
            f.close()
            tmp.unlink(missing_ok=True)
            raise
    try:
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def media(value):
    if isinstance(value, list):
        return [media(x) for x in value]
    if isinstance(value, dict):
        return {k: media(v) for k, v in value.items()}
    if isinstance(value, str) and value.startswith("data:image/"):
        match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)", value)
        if not match:
            raise ValueError("image")
        data = base64.b64decode("".join(match[2].split()), validate=True)
        ext = "jpg" if match[1] == "jpeg" else match[1]
        name = hashlib.sha256(data).hexdigest() + "." + ext
        path = ROOT / "assets/media" / name
        if not path.is_file():
            atomic(path, data)
        return "assets/media/" + name
    return value


EXAMPLES = json.loads((ROOT / "templates/first-page-examples.json").read_bytes())


def with_examples(config):
    """Supply example first pages only until this template gets an explicit approval."""
    design = config["design"]
    layouts = design.setdefault("documentLayouts", {})
    for kind, example in EXAMPLES.items():
        scope = "contract:" + kind
        layout = layouts.get(scope, {})
        if layout.get("approvedLayout"):
            continue
        key = {"installment": "pages", "external": "externalPages"}.get(kind, kind + "Template")
        pages = layout.get(key, design.get(key))
        face = next((page for page in pages if page["id"] == 1), None) if isinstance(pages, list) else pages
        if face is not None and not face.get("nodes"):
            layouts.setdefault(scope, {})[key] = ([example if page["id"] == 1 else page for page in pages]
                                                if isinstance(pages, list) else example)
    return config


def remove_unapproved_examples(design, previous):
    # Saving another setting on the preview must not approve its sample pages.
    layouts = design.get("documentLayouts", {})
    for kind, example in EXAMPLES.items():
        scope = "contract:" + kind
        layout = layouts.get(scope)
        if not layout or layout.get("approvedLayout"):
            continue
        key = {"installment": "pages", "external": "externalPages"}.get(kind, kind + "Template")
        original = previous.get("documentLayouts", {}).get(scope, {})
        old_pages = original.get(key, previous.get(key))
        pages = layout.get(key)
        if isinstance(pages, list) and isinstance(old_pages, list):
            old_face = next((p for p in old_pages if p["id"] == 1), None)
            if old_face is not None and not old_face.get("nodes"):
                layout[key] = [old_face if p == example else p for p in pages]
        elif pages == example and old_pages is not None and not old_pages.get("nodes"):
            layout[key] = old_pages
        if key not in original and layout.get(key) == previous.get(key):
            layout.pop(key, None)
        if not layout and scope not in previous.get("documentLayouts", {}):
            layouts.pop(scope)


def encode(config):
    return json.dumps({"config":config}, ensure_ascii=False, separators=(",",":")).encode()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Contract-Defaults", "1")
        super().end_headers()

    def defaults(self, head=False):
        with LOCK:
            stamp = SOURCE.stat().st_mtime_ns
            cached = getattr(self.server, "defaults_cache", None)
            if not cached or cached[0] != stamp:
                data = SOURCE.read_bytes()
                config = json.loads(data)["config"]
                revision = config["sharedRevision"]
                if self.server.preview:
                    data = encode(with_examples(config))
                cached = self.server.defaults_cache = (stamp, '"' + revision + '"', data)
        _, etag, data = cached
        same = self.headers.get("If-None-Match") == etag
        self.send_response(304 if same else 200)
        self.send_header("ETag", etag)
        if not same:
            self.send_header("Content-Type","application/json; charset=utf-8")
            self.send_header("Content-Length",str(len(data)))
        self.end_headers()
        if not same and not head:
            self.wfile.write(data)

    def do_HEAD(self):
        if self.path == "/_defaults":
            return self.defaults(head=True)
        return super().do_HEAD()

    def do_GET(self):
        if self.path == "/_defaults":
            return self.defaults()
        return super().do_GET()

    def do_POST(self):
        authority = self.headers.get("Host", "").lower()
        trusted = {f"{host}:{self.server.server_port}" for host in ("127.0.0.1", "localhost")}
        if (self.path not in {"/_defaults","/_numbers"} or authority not in trusted or self.client_address[0] != "127.0.0.1"
                or self.headers.get("Origin") != "http://" + authority):
            return self.send_error(403)
        try:
            size = int(self.headers.get("Content-Length", 0))
            if self.path == "/_numbers":
                if not 0 < size <= 4096 or self.headers.get_content_type()!="application/json":
                    return self.send_error(400)
                store=ROOT / "private" / "numbers.sqlite"
                store.parent.mkdir(exist_ok=True)
                status, reply=reserve(store,json.loads(self.rfile.read(size)))
                self.send_response(status)
                self.send_header("Content-Type","application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps(reply).encode())
                return
            if not 0 < size <= 48_000_000 or self.headers.get_content_type() != "application/json":
                return self.send_error(400)
            incoming = json.loads(self.rfile.read(size))
            with LOCK:
                old = SOURCE.read_bytes()
                saved = json.loads(old)["config"]
                if self.headers.get("If-Match") not in {saved["sharedRevision"], '"' + saved["sharedRevision"] + '"'}:
                    return self.send_error(409)
                if not isinstance(incoming, dict) or incoming.keys() - KEYS:
                    return self.send_error(400)
                if self.server.preview and "design" in incoming:
                    remove_unapproved_examples(incoming["design"], saved["design"])
                saved.update(media(incoming))
                if saved["design"]["version"] != 6 or not saved["companies"]:
                    return self.send_error(400)
                backup = ROOT / "work/default-backups"
                backup.mkdir(exist_ok=True, parents=True)
                atomic(backup / (saved["sharedRevision"] + ".json"), old)
                saved["sharedRevision"] = uuid.uuid4().hex
                atomic(SOURCE, encode(saved))
                try:
                    importlib.reload(rebuild).build(DIST)
                except Exception:
                    atomic(SOURCE, old)
                    importlib.reload(rebuild).build(DIST)
                    raise
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"revision":saved["sharedRevision"]}).encode())
        except (KeyError, ValueError, TypeError):
            self.send_error(400)
        except OSError:
            self.send_error(500)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8088)
    parser.add_argument("--preview-port", type=int, help="Serve example first pages using the same approved templates and write lock")
    args = parser.parse_args()
    with ExitStack() as servers:
        main = servers.enter_context(ThreadingHTTPServer(("127.0.0.1", args.port), Handler))
        main.preview = False
        if args.preview_port is not None:
            preview = servers.enter_context(ThreadingHTTPServer(("127.0.0.1", args.preview_port), Handler))
            preview.preview = True
            threading.Thread(target=preview.serve_forever, daemon=True).start()
            servers.callback(preview.shutdown)
        print(json.dumps({"main":main.server_port, "preview":preview.server_port if args.preview_port is not None else None}), flush=True)
        main.serve_forever()
