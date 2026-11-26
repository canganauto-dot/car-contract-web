"""Build the web application without reading browser archives or old build outputs."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

SOURCE = Path(__file__).resolve().parent
SCRIPTS = [
    'offline-edition.js', 'pages-templates.js', 'shared-defaults.js', 'branch-numbers.js', 'contract-templates.js', 'sheet-library.js', 'document-qr.js', 'entry-dates.js', 'web-resources.js', 'smart-tables.js', 'workbench.js', 'excel-export.js',
    'letters.js', 'appearance-originals.js', 'box-appearance.js',
    'editor-enhancements.js', 'directory-source.js', 'unified-directory.js',
    'company-sheet-data.js', 'contract-files.js', 'print-plan.js', 'company-sheets.js',
    'app-state.js', 'archive-cleanup.js', 'legacy-templates.js', 'contract-core.js', 'bill-layout.js',
    'payment-schedule.js', 'cash-contract.js', 'exchange-contract.js',
    'external-contract.js', 'transfer-letter.js', 'paper-layout.js',
    'image-library.js', 'workspace-ui.js', 'contract-services.js', 'archive.js',
    'archive-output.js', 'editor-settings.js', 'document-text.js', 'document-ink.js', 'document-renderer.js', 'document-scene.js', 'editor-clean.js', 'table-tools.js', 'ui-preferences.js', 'field-studio.js', 'fill-designer.js', 'fill-layout.js', 'staff-console.js', 'cloud.js', 'form-paper.js', 'form-inbox.js', 'sales-forms.js', 'app.js',
]
STYLES = ['document.css', 'editor-clean.css', 'features.css', 'workspace.css',
          'archive.css', 'box-appearance.css', 'workbench.css', 'smart-tables.css', 'ui-refinements.css', 'fill-fields.css']


def read(name):
    return (SOURCE / name).read_text(encoding='utf-8-sig')


def template_endpoint():
    value = os.environ.get('CONTRACT_TEMPLATE_API', '').strip()
    if value:
        url = urlsplit(value)
        if (not url.hostname or url.username is not None or url.password is not None or url.query or url.fragment
                or any(ord(c) <= 32 or c == chr(92) for c in value)
                or not (url.scheme == 'https' or url.scheme == 'http' and url.hostname in {'localhost', '127.0.0.1'})):
            raise ValueError('CONTRACT_TEMPLATE_API must be a public HTTPS endpoint without credentials or query parameters.')
    return value


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
    stamp = SOURCE / 'assets' / 'rejected.png'
    if not stamp.exists():
        stamp = SOURCE.parent / 'rejected.png'
    if stamp.is_file():
        if not stamp.read_bytes().startswith(bytes.fromhex('89504e470d0a1a0a')):
            raise ValueError('rejected.png must be a PNG image.')
        assets['rejectStamp'] = 'assets/media/rejected.png'
    scripts = ['seed.js', 'contract-math.js'] + SCRIPTS
    fragments = {
        '<!--CARDS-->': read('form-shell.html'),
        '<!--EDITOR-->': read('editor-panel.html'),
        '<!--SETTINGS-->': read('settings-shell.html'),
        '<!--MENU-->': read('menu-shell.html'),
        '<!--FEATURES-->': read('features.html'),
        '<!--STYLES-->': '<link id="contractFontStyles" rel="stylesheet" href="assets/css/contract-font.css">\n<style id="documentStyles">\n' + '\n'.join(line.lstrip() for name in STYLES for line in read(name).splitlines()) + '\n</style>\n<link rel="stylesheet" href="assets/css/theme.css">',
        '<!--SCRIPTS-->': '\n'.join(f'<script defer src="assets/js/{name}"></script>' for name in scripts),
    }
    shell = read('editor-shell.html')
    if os.environ.get('CONTRACT_HOSTED') == '1':
        shell = shell.replace('<head>', '<head>\n    <meta name="contract-cloud" content="https://udaylhvskqgsamgbtvbn.supabase.co/functions/v1/contract-access">')
    if os.environ.get('CONTRACT_STAFF_API') == '1':
        shell = shell.replace('<head>', '<head>\n    <meta name="contract-staff-api" content="enabled">')
    for marker_text, content in fragments.items():
        if shell.count(marker_text) != 1:
            raise ValueError(f'Expected exactly one build marker: {marker_text}')
        shell = shell.replace(marker_text, content)
    files = {'index.html': shell.encode('utf-8'),
             'assets/css/theme.css': (read('theme.css') + ('\n' + read('sales-forms.css') if os.environ.get('CONTRACT_HOSTED') == '1' else '')).encode('utf-8')}
    font = base64.b64encode((SOURCE / 'vendor' / 'Alyamama.ttf').read_bytes()).decode('ascii')
    rules = ('/*' + read('vendor/Alyamama-OFL.txt') + '*/\n'
             '@font-face{font-family:"Alyamama";font-style:normal;font-weight:300 900;'
             f'src:url(data:font/ttf;base64,{font}) format("truetype");size-adjust:80%;font-display:block;}}\n')
    files['assets/css/contract-font.css'] = rules.encode('utf-8')
    files['assets/js/seed.js'] = ('const ContractSeed=' + json.dumps(seed, ensure_ascii=False,separators=(",",":"))
                               + ';\nconst ContractAssets=' + json.dumps(assets, ensure_ascii=False) + ';').encode('utf-8')
    files['assets/template-sync.json'] = json.dumps({
        'build': hashlib.sha256(files['assets/js/seed.js']).hexdigest(),
        'endpoint': template_endpoint()
    }).encode('utf-8')
    for name in ['contract-math.js'] + SCRIPTS:
        files['assets/js/' + name] = read(name).encode('utf-8')
    files['assets/js/document-qr.js'] = b'/*' + (SOURCE/'vendor/qrcode-generator-LICENSE').read_bytes() + b'*/\n' + (SOURCE/'vendor/qrcode-generator.js').read_bytes() + b'\n' + files['assets/js/document-qr.js']
    # A newly opened page must load matching code and styles, including on a static host.
    for name, content in files.items():
        if name.startswith(('assets/js/', 'assets/css/')):
            version = hashlib.sha256(content).hexdigest()[:12]
            shell = shell.replace(f'"{name}"', f'"{name}?v={version}"')
    files['index.html'] = shell.encode('utf-8')
    for name in ['pdf-lib-1.17.1.min.js', 'pdfjs-4.10.38.mjs', 'pdfjs-worker-4.10.38.mjs', 'pdf-lib-LICENSE.md', 'pdfjs-LICENSE']:
        files['assets/vendor/' + name] = (SOURCE / 'vendor' / name).read_bytes()
    skia = SOURCE / 'node_modules' / 'canvaskit-wasm'
    for name in ['canvaskit.js','canvaskit.wasm']:
        files['assets/vendor/'+name] = (skia / 'bin' / name).read_bytes()
    files['assets/vendor/canvaskit-LICENSE'] = (skia / 'LICENSE').read_bytes()
    if 'rejectStamp' in assets:
        files[assets['rejectStamp']] = stamp.read_bytes()
    if os.environ.get('CONTRACT_HOSTED') == '1':
        files['reader/decoder.js'] = b'/*' + (SOURCE/'vendor/jsQR-LICENSE').read_bytes() + b'*/\n' + (SOURCE/'vendor/jsQR.js').read_bytes()
        for name in ('index.html','reader.js','manifest.webmanifest'):
            files['reader/'+name] = (SOURCE/'reader'/name).read_bytes()
        for name in ['manifest.webmanifest','sw.js','icon-192.png','icon-512.png']:
            files[name] = (SOURCE / 'pwa' / name).read_bytes()
        files['index.html'] = files['index.html'].replace(b'</head>', b'<link rel="manifest" href="./manifest.webmanifest"><link rel="apple-touch-icon" href="./icon-192.png"><meta name="theme-color" content="#193b49"></head>')
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
