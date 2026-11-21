"""Atomic branch sequences for drafts and pre-print checks. Stores no contract contents."""
import re
import sqlite3
import unicodedata
from contextlib import closing


def normalize_branch(value):
    value = " ".join(unicodedata.normalize("NFKC", value).split())
    value = re.sub(r"^فرع\s+", "", value)
    return value.replace("ـ", "").translate(str.maketrans("أإآ", "ااا")).casefold()


def serial(label):
    match = re.fullmatch(r"(?:[^\x00-\x1f/\\]{1,40}-)?([0-9٠-٩۰-۹]{1,9})", label)
    if not match or not 1 <= int(match[1]) <= 999999999:
        raise ValueError("اكتب عدداً موجباً، ويمكن إضافة رمز الجهاز قبله.")
    return int(match[1])


def reserve(store, request):
    try:
        if not isinstance(request, dict) or request.keys() - {"branch","record","mode","label","expected","prefix","start","offline"}:
            raise ValueError("طلب عدد غير صالح.")
        branch = normalize_branch(request["branch"])
        record, mode = request["record"], request["mode"]
        label, prefix = request.get("label","").strip(), request.get("prefix","").strip()
        if not branch or len(branch)>90 or not re.fullmatch(r"[\w. :\-]{1,160}",record) or mode not in {"claim","edit","verify"}:
            raise ValueError("تحقق من الفرع والمستند.")
        if (prefix and not re.fullmatch(r"[^/\\\x00-\x1f]{1,40}",prefix)) or (mode=="verify" and not label):
            raise ValueError("تحقق من العدد ورمز الجهاز.")
        if "\x00" in branch: raise ValueError("اسم الفرع غير صالح.")
        offline=request.get("offline") is True
        branch+=("\x00F" if offline else "")
        if offline and label and not label.endswith("-F"):raise ValueError("عدد نسخة الأوفلاين ينتهي بـ -F.")
        ordinal = serial(label.removesuffix("-F") if offline else label) if label else None
        start = request.get("start",1)
        if type(start) is not int or not 1 <= start <= 999999999:
            raise ValueError("بداية التسلسل غير صالحة.")
        with closing(sqlite3.connect(store,timeout=10)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS branch_sequence (branch TEXT PRIMARY KEY, following INTEGER NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS branch_number (branch TEXT NOT NULL, ordinal INTEGER NOT NULL, record TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY(branch,ordinal), UNIQUE(branch,record))")
            db.execute("CREATE TABLE IF NOT EXISTS issued_number (branch TEXT NOT NULL, ordinal INTEGER NOT NULL, record TEXT NOT NULL, PRIMARY KEY(branch,ordinal))")
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT label FROM branch_number WHERE branch=? AND record=?",(branch,record)).fetchone()
            if row:
                if label==row[0] or mode=="claim" and not label:
                    if mode=="verify":
                        db.execute("INSERT OR IGNORE INTO issued_number VALUES (?,?,?)",(branch,ordinal,record))
                    return 200, {"number":row[0]}
                if mode!="edit" or request.get("expected")!=row[0]:
                    return 409, {"error":"تغيّر عدد هذا المستند. العدد المحجوز له هو "+row[0],"current":row[0]}
            issued=db.execute("SELECT record FROM issued_number WHERE branch=? AND ordinal=?",(branch,ordinal)).fetchone()
            if issued and issued[0]!=record:
                return 409, {"error":"هذا العدد مستخدم في مستند آخر للفرع."}
            seq = db.execute("SELECT following FROM branch_sequence WHERE branch=?",(branch,)).fetchone()
            following = seq[0] if seq else start
            if ordinal is None:
                ordinal = following
                label = (prefix+"-" if prefix else "")+str(ordinal)
                serial(label)
                if offline:label+="-F"
            other=db.execute("SELECT record FROM branch_number WHERE branch=? AND ordinal=?",(branch,ordinal)).fetchone()
            if other and other[0]!=record:
                return 409, {"error":"هذا العدد محجوز لمستند آخر في الفرع. امسح العدد لحجز التالي أو اكتب عدداً آخر."}
            db.execute("DELETE FROM branch_number WHERE branch=? AND record=?",(branch,record))
            db.execute("INSERT INTO branch_number VALUES (?,?,?,?)",(branch,ordinal,record,label))
            if mode=="verify":
                db.execute("INSERT OR IGNORE INTO issued_number VALUES (?,?,?)",(branch,ordinal,record))
            db.execute("INSERT INTO branch_sequence VALUES (?,?) ON CONFLICT(branch) DO UPDATE SET following=excluded.following",
                       (branch,max(following,ordinal+1)))
            return 200, {"number":label}
    except (AttributeError,TypeError,ValueError,KeyError) as error:
        return 400, {"error":str(error) if isinstance(error,ValueError) else "بيانات الحجز غير صالحة."}
    except sqlite3.Error:
        return 503, {"error":"تعذر فتح سجل أعداد الفرع. أعد المحاولة."}
