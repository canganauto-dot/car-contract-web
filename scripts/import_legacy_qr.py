"""Import prior printed QR records without storing buyer details in migrations."""
import json
import os
import sys
import uuid
from pathlib import Path
from datetime import datetime

import psycopg


def import_records(directory):
    paths = sorted(directory.glob("*/record.json"))
    if not paths:
        raise ValueError("No legacy records found")
    with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as db:
        for path in paths:
            record = json.loads(path.read_text(encoding="utf-8-sig"))
            key = uuid.UUID(record["id"])
            if (key.version != 4 or str(key) != path.parent.name or
                    record.get("type") != "ownership-transfer" or record.get("schema") != 3 or
                    record.get("status") != "approved"):
                raise ValueError(f"Unexpected record: {path.parent.name}")
            values = (key, record["buyer"], record["vin"], datetime.fromisoformat(record["issuedAt"].replace("Z", "+00:00")))
            db.execute("""insert into public.ownership_qr (id,buyer,vin,issued_at,company)
                          values (%s,%s,%s,%s,'legacy') on conflict (id) do nothing""", values)
            saved = db.execute("select buyer,vin from public.ownership_qr where id=%s", (key,)).fetchone()
            if saved != values[1:3]:
                raise ValueError(f"Conflicting record: {key}")
    print(f"Imported or confirmed {len(paths)} legacy records.")


if __name__ == "__main__":
    import_records(Path(sys.argv[1]))
