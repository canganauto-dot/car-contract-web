import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('web_build', SOURCE / 'rebuild.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class WebBuildTests(unittest.TestCase):
    def test_seed_is_public_configuration_only(self):
        seed = json.loads((SOURCE / 'initial-data.json').read_text(encoding='utf-8'))
        self.assertEqual(set(seed), {'config'})
        self.assertNotIn('pin', seed['config'])
        self.assertNotIn('data:image/', json.dumps(seed))
        self.assertNotIn('signedFile', json.dumps(seed))

    def test_manifest_and_asset_references(self):
        output = SOURCE / 'dist'
        manifest = json.loads((output / '.web-build.json').read_text())
        self.assertNotIn('offline.html', manifest['files'])
        self.assertLess((output / 'index.html').stat().st_size, 150000)
        for name, expected in manifest['sha256'].items():
            self.assertEqual(builder.hashlib.sha256((output / name).read_bytes()).hexdigest(), expected, name)
        for script in builder.SCRIPTS:
            self.assertTrue((output / 'assets' / 'js' / script).is_file())

    def test_output_cannot_replace_unrelated_files(self):
        work = SOURCE / 'work'
        work.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=work) as directory:
            target = Path(directory)
            sentinel = target / 'user.txt'
            sentinel.write_text('keep')
            with self.assertRaises(ValueError):
                builder.build(target)
            self.assertEqual(sentinel.read_text(), 'keep')
        with self.assertRaises(ValueError):
            builder.build(SOURCE.parent)


if __name__ == '__main__':
    unittest.main()
