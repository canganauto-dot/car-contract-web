"""Build the web application without reading browser archives or old build outputs."""
import argparse
import hashlib
import json
from pathlib import Path

SOURCE = Path(__file__).resolve().parent
SCRIPTS = [
    'offline-edition.js', 'shared-defaults.js', 'contract-templates.js', 'entry-dates.js', 'web-resources.js', 'smart-tables.js', 'workbench.js', 'excel-export.js',
    'letters.js', 'appearance-originals.js', 'box-appearance.js',
    'editor-enhancements.js', 'directory-source.js', 'unified-directory.js',
    'company-sheet-data.js', 'contract-files.js', 'print-plan.js', 'company-sheets.js',
    'app-state.js', 'archive-cleanup.js', 'legacy-templates.js', 'contract-core.js', 'bill-layout.js',
    'payment-schedule.js', 'cash-contract.js', 'exchange-contract.js',
    'external-contract.js', 'transfer-letter.js', 'paper-layout.js',
    'image-library.js', 'workspace-ui.js', 'contract-services.js', 'archive.js',
    'archive-output.js', 'document-renderer.js', 'editor-clean.js', 'table-tools.js', 'ui-preferences.js', 'field-studio.js', 'fill-designer.js', 'fill-layout.js', 'app.js',
]
STYLES = ['document.css', 'editor-clean.css', 'features.css', 'workspace.css',
          'archive.css', 'box-appearance.css', 'workbench.css', 'smart-tables.css', 'ui-refinements.css']


def read(name):
    return (SOURCE / name).read_text(encoding='utf-8-sig')


def build(output):
    output = output.resolve()
    if SOURCE not in output.parents or output == SOURCE / 'assets':
        raise ValueError('Build output must be a separate directory below development.')
    marker = output / '.web-build.json'
    if output.exists() and not marker.exists() and any(output.iterdir()):
        raise ValueError('Refusing to overwrite an existing directory without a web build manifest.')
    previous = json.loads(marker.read_text())['files'] if marker.exists() else []
    seed = json.loads(read('initial-data.json'))
    if set(seed) != {'config'} or 'pin' in seed['config']:
        raise ValueError('The build seed must contain only public configuration, without a PIN or archive.')
    assets = {'headers': json.loads(read('stock-first-headers.json')), 'logos': json.loads(read('header-logos.json'))}
    scripts = ['seed.js', 'contract-math.js'] + SCRIPTS
    fragments = {
        '<!--CARDS-->': read('form-shell.html'),
        '<!--EDITOR-->': read('editor-panel.html'),
        '<!--SETTINGS-->': read('settings-shell.html'),
        '<!--MENU-->': read('menu-shell.html'),
        '<!--FEATURES-->': read('features.html'),
        '<!--STYLES-->': '<style id="documentStyles">\n' + '\n'.join(line.lstrip() for name in STYLES for line in read(name).splitlines()) + '\n</style>\n<link rel="stylesheet" href="assets/css/theme.css">',
        '<!--SCRIPTS-->': '\n'.join(f'<script defer src="assets/js/{name}"></script>' for name in scripts),
    }
    shell = read('editor-shell.html')
    for marker_text, content in fragments.items():
        if shell.count(marker_text) != 1:
            raise ValueError(f'Expected exactly one build marker: {marker_text}')
        shell = shell.replace(marker_text, content)
    files = {'index.html': shell.encode('utf-8'),
             'assets/css/theme.css': read('theme.css').encode('utf-8')}
    files['assets/js/seed.js'] = ('const ContractSeed=' + json.dumps(seed, ensure_ascii=False,separators=(",",":"))
                               + ';\nconst ContractAssets=' + json.dumps(assets, ensure_ascii=False) + ';').encode('utf-8')
    for name in ['contract-math.js'] + SCRIPTS:
        files['assets/js/' + name] = read(name).encode('utf-8')
    for name in ['pdf-lib-1.17.1.min.js', 'pdfjs-4.10.38.mjs', 'pdfjs-worker-4.10.38.mjs', 'pdf-lib-LICENSE.md', 'pdfjs-LICENSE']:
        files['assets/vendor/' + name] = (SOURCE / 'vendor' / name).read_bytes()
    for image in sorted((SOURCE / 'assets' / 'media').iterdir()):
        files['assets/media/' + image.name] = image.read_bytes()
    for name in set(previous) | files.keys():
        target = (output / name).resolve()
        if output not in target.parents:
            raise ValueError('Invalid path in build manifest.')
        if target.exists() and name not in previous:
            raise ValueError(f'Refusing to overwrite unowned file: {name}')
    output.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    for name in set(previous) - files.keys():
        (output / name).unlink(missing_ok=True)
    manifest = {'files': sorted(files), 'sha256': {name: hashlib.sha256(content).hexdigest() for name, content in files.items()}}
    marker.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'files': len(files), 'bytes': sum(map(len, files.values())), 'html_bytes': len(files['index.html'])}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path, help='Explicit output directory below development')
    build(parser.parse_args().out)
