"""Local development host. Only the loopback editor may update shared defaults."""
import argparse
import base64
import hashlib
import importlib
import json
import os
import re
import shutil
import tempfile
import threading
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import rebuild

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


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Contract-Defaults", "1")
        super().end_headers()

    def do_GET(self):
        if self.path != "/_defaults":
            return super().do_GET()
        data = SOURCE.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        authority = f"127.0.0.1:{self.server.server_port}"
        if self.path != "/_defaults" or self.headers.get("Host") != authority or self.headers.get("Origin") != "http://" + authority:
            return self.send_error(403)
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 48_000_000 or self.headers.get_content_type() != "application/json":
                return self.send_error(400)
            incoming = json.loads(self.rfile.read(size))
            with LOCK:
                old = SOURCE.read_bytes()
                saved = json.loads(old)["config"]
                if self.headers.get("If-Match") != saved["sharedRevision"]:
                    return self.send_error(409)
                if not isinstance(incoming, dict) or incoming.keys() - KEYS:
                    return self.send_error(400)
                saved.update(media(incoming))
                if saved["design"]["version"] != 6 or not saved["companies"]:
                    return self.send_error(400)
                backup = ROOT / "work/default-backups"
                backup.mkdir(exist_ok=True, parents=True)
                atomic(backup / (saved["sharedRevision"] + ".json"), old)
                saved["sharedRevision"] = uuid.uuid4().hex
                atomic(SOURCE, json.dumps({"config":saved}, ensure_ascii=False, separators=(",",":")).encode())
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
    args = parser.parse_args()
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
