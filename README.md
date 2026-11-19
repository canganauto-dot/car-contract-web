# Car Contract Management

Arabic workspace for filling, previewing, printing, and archiving vehicle contracts and standalone letters. It can also export a self-contained HTML copy for offline use.

## Run locally

Build the application with Python 3 from the repository root:

```sh
python rebuild.py --out dist
python serve_contracts.py --port 8088
```

Open `http://127.0.0.1:8088/`. On Windows, use `py -3` in place of `python` if needed. The local development server only listens on loopback and supports approving shared template defaults in that checkout.

## Host the web build

GitHub Actions publishes the Python build from `main` to [GitHub Pages](https://canganauto-dot.github.io/car-contract-web/). Set **Settings → Pages → Source** to **GitHub Actions**.

For other static hosts, serve the contents of `dist` over HTTPS and include the hidden `.web-build.json` manifest so users can download the offline edition. On static hosting, documents and edits are saved in the current browser. The local development server is for use on the workstation. A shared archive and cross-user template approval require a separately secured backend.

## Verify

```sh
python rebuild.py --out dist
python -m unittest discover -s tests
```

For the full browser regression suite, use Windows with Microsoft Edge and Python 3:

```powershell
npm ci --ignore-scripts
py -3 rebuild.py --out dist
node tests/run.cjs
```

Preserve the clean seed in `initial-data.json`. Browser records, signed scans, workstation identity, exports, and backups belong outside the source repository.
