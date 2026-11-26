# Car contract web application

Run these commands from this repository's `development` directory in PowerShell.

```powershell
npm ci --ignore-scripts
py -3 rebuild.py --out dist
py -3 -B serve_contracts.py --port 8088 --preview-port 8091
```

Open http://127.0.0.1:8088 for the project or http://127.0.0.1:8091 for example first pages. Both addresses use one template server.
The application needs HTTP/HTTPS. Its camera and filesystem features require a secure context (localhost is supported).

## Build

`rebuild.py --out dist` is the single supported build command. The output argument is required and must identify a separate directory below `development`.

The builder reads source files and public configuration only. It never reads old HTML, browser records, exports, or backups. A generated manifest identifies files the builder owns. It refuses to overwrite an unrelated directory or file and removes only obsolete files from its previous manifest.

The download button packages the current templates, form, print renderer and embedded Alyamama font into one offline HTML file. The export is built from the current web build when requested.

## Hosted staff workspace

GitHub Pages builds with `CONTRACT_HOSTED=1`. The sign-in screen accepts a username and password. An employee can request an account for a company. Its administrator reviews the request under **الإعدادات ← المستخدمون والصلاحيات**, selects branches and a role, and supplies the initial password. Users can change their own password there. Administrators select their active company in the same panel.

A company administrator may publish a design directly or review a design submitted by staff. Approval checks the previous version and applies to that company. Issuing a document reserves its branch number, records an immutable revision, and saves its PDF. Drafts also reserve branch numbers. Signed uploads and downloads go through the authenticated service and private storage. Managers and employees see only their assigned branches.

The Edge Function and ordered database migrations are in `supabase/`. The function reads its privileged credentials from its server environment. The static site contains its public endpoint only. The login and account-request actions run before sign-in. Each protected operation verifies the session and checks the current memberships. The Pages workflow deploys frontend assets; backend changes are deployed separately.

A local build without the hosted flag runs the local workflow. An exported offline HTML keeps its archive on its own device. Use JSON export and import to bring existing local documents into the hosted workspace.

## Department workspaces

Sales staff save personal forms and publish them to the assigned branch. Finance sees published forms from its authorized branches. A branch manager can mark a published form approved in a managed branch. Administrators may approve within their authorized companies. A contract clerk can convert a published form into one editable private contract draft. Publication and managerial approval are separate events. Converting or editing the contract preserves the submitted form.

Private contract and letter drafts are returned only to their owner. The shared archive lists issued documents. The server also enforces scope on individual reads, contract numbering and PDF access. Company reassignment preserves the number of a private, unissued draft and requires contract access to the same branch in both companies. Staff with management roles receive the selected branch responsibilities across the companies administered by their grantor. The login checkbox stores a renewable session on the device until logout or revocation.

For a hosted release apply the forms migration, deploy the updated contract-access function, then publish the frontend. Existing employees default to the contracts department. The administrator selects sales or finance under staff settings. To verify locally, run the isolated PostgreSQL suite in tests/hosted_postgres.py, build a hosted fixture into work/forms-hosted, and run tests/sales-workspace.cjs. The browser fixture uses test responses and does not write production data.

## Sources

- `editor-shell.html`, `editor-panel.html`, `form-shell.html`, `settings-shell.html`, `menu-shell.html`, `features.html` contain the interface fragments.
- `app-state.js` contains shared state, date helpers, IndexedDB primitives, image validation, and company/vehicle lookup.
- `contract-core.js` contains form definitions, normalization, numbering, local settings backups, and event binding.
- `legacy-templates.js` and `document-renderer.js` preserve compatibility with older saved designs.
- `document-scene.js` renders the A4 pages used by preview, editing, archives and printing. `document-text.js` sanitizes rich text and resolves document variables.
- `editor-clean.js` owns selection, gestures, editing and per-template draft history. `editor-settings.js` defines numeric ranges for typography, page geometry and fill controls. `app.js` starts the application.
- `document-ink.js` uses bundled CanvasKit and the embedded Alyamama font for Arabic shaping, bidirectional text, line breaks and text images. Preview, archived output, print and offline HTML reuse the same artwork. The editable source text stays available in the editor. Page geometry uses hundredths of a millimetre. First-page test examples live in `templates/first-page-examples.json`.
- `cash-contract.js`, `exchange-contract.js`, `external-contract.js`, `transfer-letter.js`, `payment-schedule.js`, `bill-layout.js`, and `paper-layout.js` contain document-specific behavior.
- `archive.js`, `contract-services.js`, `contract-files.js`, and `archive-output.js` manage local archives, contract JSON, signed scans, printing, and PDF output.
- `letters.js`, `workbench.js`, and `smart-tables.js` preserve letters, multiple open contracts, editable tables, and price catalogs. The legacy `standaloneBook` data field identifies a letter and remains compatible with saved JSON.
- `fill-layout.js` applies saved dimensions and positions within each contract or book. `fill-designer.js` manages captions, notes and keyboard traversal. `fill-fields.css` defines the shared field for web and offline.
- CSS remains separated by feature in source stylesheets. The build combines them in the named `documentStyles` element so preview, print frames, and PDF rasterization use identical rules.
- Named deferred scripts preserve the existing shared interfaces and execution order, recorded explicitly in `rebuild.py`.

## Assets and public seed

`initial-data.json` contains only approved public configuration. It has no contract data, archive, design draft, or PIN. The three confirmed test records and their attachments have been removed. `archive-cleanup.js` also removes those known record IDs from existing browser storage while retaining unrelated entries and referenced template snapshots.

Images are deduplicated by SHA-256 in `assets/media`. JSON and template sources reference their stable paths. Custom images imported by users can still use validated image data URLs. Browser-held images, contracts, and signed scans never become build inputs.

`web-resources.js` loads pdf-lib on demand. PDF.js and its worker load only when a signed PDF needs rendering. All vendor files are local, with their licenses retained. Externalized images are embedded temporarily during PDF creation so the SVG/canvas renderer preserves them and Arabic text.

The source image files are authoritative. Optional historical asset-generation scripts are not part of the application build.

## Local data and design approval

The web application retains the existing IndexedDB database name so existing browser records remain accessible on the same origin. The editor keeps design drafts in that browser. Approval sends the active template to the shared host with its base revision. The host saves the previous configuration in `work/default-backups`, persists the approved layout in `initial-data.json` and rebuilds the distributable. Both ports share the same store and lock. Unapproved sample first pages on the preview port are available for editing. An intentionally empty approved page stays empty on both ports.

Clients use conditional revision requests every five seconds while visible and when returning to the application. Applying a new revision waits for the current field edit, design session or open dialog to finish. A conflicting approval leaves the newer host version and the editor’s local draft available for review. Earlier browser-only approvals with local backup history are retained in the browser settings backups. Compatible versions are also recovered as per-template design drafts.

Run one local host process for both ports. Downloaded offline HTML contains the template snapshot at download time. The development server binds to loopback.

### Optional template service for standalone static hosts

The production Pages site uses the authenticated Supabase deployment described above. This section applies to independent builds without the hosted flag.

For local editing, approve a design on the development host. The approval rebuilds `dist`. Publishing the contents of that directory distributes the approved templates. A visible, idle browser checks the build identifier in `assets/template-sync.json` every five seconds and verifies the downloaded templates against it. An interrupted deployment keeps the previous usable layout until the files match. On an unconfigured static site the editor saves a draft and explains how to publish it.

To allow approvals directly on the hosted site, run `template_service.py` on a persistent host behind HTTPS. Give it a dedicated random approval key of at least 32 random bytes. Distribute the key to authorized layout editors. Set its SHA-256 hex digest as `CONTRACT_TEMPLATE_TOKEN_SHA256` in the service environment. Configure the exact origin of the website and a persistent SQLite path outside the published directory. For example, on the service host:

```powershell
py -3 -B template_service.py --origin https://example.github.io --store D:\private\templates.sqlite --port 8092
```

The HTTPS reverse proxy should forward `/templates` to that loopback port, including OPTIONS, GET, PUT and their authorization/precondition headers. Each authenticated approval writes a new version in one transaction. The public read endpoint serves approved template layouts. Scope the service to this website and keep customer information out of template text.

Set the public API URL in the build environment before preparing the site:

```powershell
$env:CONTRACT_TEMPLATE_API = 'https://templates.example.org/templates'
py -3 -B rebuild.py --out dist
```

The build includes only the public endpoint. The editor asks for the approval key at publish time. Filled records, workstation identity and credentials are excluded from the publication request. Readers can open the current design without the key. If a later static deployment includes a changed base layout for the same template, that layout takes precedence over remote approvals based on the earlier layout. Back up the service database to retain its version history.

The toolbar exports contract JSON. The menu exports settings/design JSON. Existing JSON import, signed PDF/image uploads, camera capture, archive search, Excel export, and local settings backup/restore remain available. Customer records and signed attachments remain in their originating browser.

### Branch numbering

Both local ports use `private/numbers.sqlite`. On a shared site, point all users at the same service and forward POST and OPTIONS requests for the sibling `/numbers` endpoint. Set `CONTRACT_BRANCH_KEY_HASHES` on the service to a JSON object mapping each branch name to its dedicated staff key's SHA-256 hex digest. Give that branch's staff the corresponding random key. The editor approval key is separate. Keep the persistent database and key configuration outside the static site and Git.

Opening a draft immediately reserves the next branch serial in a SQLite write transaction. Workstation prefixes are display labels. Editing the number checks the whole branch and clearing it requests the next available serial. A pre-print check protects the issued number even if the document is subsequently renumbered. Use the print button or Ctrl+P for an online document. Browser-menu printing without a preflight displays an instruction sheet. During initial rollout, open existing workstation archives to register older numbers and choose a starting serial above the highest historical number before issuing new contracts.

Offline documents use a separate branch series with the suffix `-F`. The JSON export identifies its origin. Import preserves an available number and reserves the next offline serial on a collision. Reimporting the same document uses its existing reservation. Official online numbering requires the service. An unconnected static site can still hold pending drafts.

Never place customer information or credentials in public configuration or static assets. Development screenshots and test files belong in `work`, which is excluded from the build.

## Regression verification

The builder copies the pinned CanvasKit runtime from the installed npm dependencies. The browser runs it locally, including in an exported offline file. The main regression runner requires Edge and Python 3. The parity check also uses Playwright Firefox.

```powershell
py -3 rebuild.py --out dist
node tests/run.cjs
npx playwright install firefox
node tests/browser-paper.cjs
node tests/performance.cjs dist work/after.json
npm audit
```

The supported runner checks build ownership, seed cleanliness, asset integrity, startup, selective test-data cleanup, calculations, JSON round trips, all four contract types, Arabic/A4 PDF output, printing, signed scans, letters, editing/undo, tables, print ordering, cash terms, external parties, exchanges, schedule pagination, camera capture, and company image settings. Tests use isolated browser contexts and dummy records. Generated evidence goes into `work`.

`tests/shared-templates.cjs` runs approvals against a temporary copy of the two-port host. `tests/pages-templates.cjs` simulates a static repository site with a real publishing service on a separate origin and verifies updates across independent browser sessions, service restart, stale revisions and unconfigured hosting.

The performance script records five fresh browser contexts using a loopback HTTP server, including app readiness, resource bytes, and retained JavaScript heap after garbage collection. This measures JavaScript heap rather than total browser process memory. Locally generated results are excluded from Git.

## Hosted form notifications and installation

Build with `CONTRACT_HOSTED=1` and serve the full output on HTTPS or loopback. The manifest and service worker use relative URLs so a GitHub Pages repository subpath works. The worker does not cache authenticated pages or documents. The register shows 25 matching records at a time. “Select all” selects the currently displayed records.

Apply the reviewed database migrations before deploying the matching `contract-access` function and frontend. An active sales author or the attributed salesperson may withdraw an unlinked publication during the first 30 minutes; withdrawing removes it from the published list and clears approval. Rejected forms require management correction. Corrections preserve existing generated contracts. Prior publication snapshots and removal history appear in the management change log for the authorized branch. Pre-upgrade revisions that were never recorded cannot be reconstructed.

The database inbox works without device permissions. To enable encrypted Web Push on deployment, generate a P-256 signing key in a trusted environment and store the private JWK as the Edge Function secret `FORM_VAPID_JWK`. Use a stable `FORM_VAPID_SUBJECT` mailto or HTTPS contact and an independent random `FORM_PUSH_JOB_TOKEN`. Keep the same signing key across builds. Only the public application key is returned to browsers. Each notification contains the event type and event identifier. Device subscriptions are bound to the signed-in employee, and delivery rechecks their current access.

Deliveries are queued with the database transaction. The Edge Function tries delivery after publication and review. Schedule a repeat POST every minute to the function with JSON `{"action":"push_retry"}`, content type `application/json` and the job token as a Bearer credential to handle interrupted deliveries and backlogs. The endpoint performs its own authentication for this job, as it does for the existing pre-login routes. Store the scheduler credential in Vault or the host scheduler’s secret store. Concurrent runs lease separate events. A provider failure retries after five minutes; expired subscriptions are removed. Device events expire after a day; their inbox entries remain available.

Employees can enable device notifications from the notification panel. For browsers without an install dialog use the browser’s installation menu, or Add to Home Screen on iOS. To use the rejection stamp, add `development/assets/rejected.png` and rebuild. Until then the paper and PDF show a red rejection label and the recorded reason.

## Document verification and page templates

The document editor stores inserted sheets inside the destination template. The available sources include approved contract layouts, standalone letters, and sheets already added to the current document. A copy retains its fields and can be edited independently. Each ownership transfer letter includes a verification code. Other sheets opt in from the QR control in the editor.

The public scan URL contains a random ID. The registration records the selected field labels and values at issue time. Reprints reuse that ID. Changed public values create another snapshot. A company administrator or the manager of the issuing branch can hide or reveal fields on an existing code, revoke it, or restore it. The public view of a revoked code returns no field data. Decisions are logged with the employee and revision. Existing ownership codes continue to resolve. The older codes have no recorded branch and can be managed by a company administrator.

For release, apply the document QR migration after the original ownership QR migration, deploy the updated contract-access and ownership-qr functions, and publish both the contract frontend and the QR verifier. The QR project folder contains the verifier. Keep its existing public URL for previously printed documents. The local lab uses its own database and a loopback scan URL. An offline copy reserves a UUID and includes its pending registration in the JSON export. Import that file into the originating environment with an authorized staff account to register the printed code.
