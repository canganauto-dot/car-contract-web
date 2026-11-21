import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from branch_numbers import reserve


class BranchNumbersTest(unittest.TestCase):
    def test_concurrent_drafts_manual_edits_preprint_and_offline_series(self):
        with tempfile.TemporaryDirectory() as temp:
            store=Path(temp)/"numbers.sqlite"
            def call(i,**extra):
                return reserve(store,{"branch":"فرع الدورة","record":f"document-{i}","mode":"claim","prefix":"R",**extra})
            with ThreadPoolExecutor(max_workers=12) as pool:
                result=list(pool.map(call,range(25)))
            self.assertEqual({status for status,_ in result},{200})
            self.assertEqual(sorted(int(reply["number"][2:]) for _,reply in result),list(range(1,26)))
            original=result[0][1]["number"]
            self.assertEqual(call(0,branch="الدورة")[1]["number"],original)
            self.assertEqual(call(88,mode="verify",label=original)[0],409)
            self.assertEqual(call(0,mode="verify",label=original)[0],200)
            self.assertEqual(call(0,mode="edit",label="50",expected=original)[0],200)
            self.assertEqual(call(0,mode="edit",label="55",expected=original)[0],409)
            self.assertEqual(call(88,mode="edit",label=original)[0],409)
            self.assertEqual(call(89,prefix="S")[1]["number"],"S-51")
            self.assertEqual(call(12,branch="البياع")[1]["number"],"R-1")
            self.assertEqual(call(100,offline=True,label="R-1-F")[0],200)
            self.assertEqual(call(101,offline=True,label="R-1-F")[0],409)
            self.assertEqual(call(101,offline=True)[1]["number"],"R-2-F")
            self.assertEqual(call(101,offline=True,mode="verify",label="R-2-F")[0],200)
            self.assertEqual(call(110,offline=False,label="1-F")[0],400)


if __name__=="__main__":
    unittest.main()
