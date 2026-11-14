# Stage 36A70R - Packaged Runtime Isolation Forensic Report

**Decision:** `NO-GO` for launching either packaged application on this host.  
**Packaged-runtime result:** Not tested.  
**Implementation readiness:** Not assessed or claimed.

## 1. Scope and evidence boundary

This follow-up investigated whether a packaged Electron runtime can be tested without exposing the existing host user profile, independently rechecked the six installed-runtime tests, and designed a controlled packaged test. It did not launch a packaged executable, inspect or modify the existing profile, modify application source, install dependencies, or change either packaged archive.

The six installed-runtime results are evidence about the installed Electron executable only. They are not packaged-runtime results. The packaged test is blocked because this host has no demonstrated OS-enforced isolation boundary.

The earlier [Stage 36A70R runtime report](./stage36a70r-electron-sqlite-runtime-qualification-report.md) records an earlier packaged-app probe. It says the normal application was launched, its `OperationJournal.initialize()` could have read, created, or recovered local journal state, and the report could not establish whether that user-data directory already existed or whether startup changed it. This follow-up did not revisit that profile; it cannot retroactively determine the prior probe's side effects.

## 2. Evidence reviewed

Read the complete prior Stage 36A70R report, test source, runner, and raw output:

- [stage36a70r-electron-sqlite-runtime-qualification-report.md](./stage36a70r-electron-sqlite-runtime-qualification-report.md)
- [main.cjs](./stage36a70r-runtime-qualification/main.cjs)
- [run.ps1](./stage36a70r-runtime-qualification/run.ps1)
- [installed-runtime-output.json](./stage36a70r-runtime-qualification/results/installed-runtime-output.json)

Additional read-only evidence:

- Electron 44.4.5 installed API declarations in [electron.d.ts](../node_modules/electron/electron.d.ts), including `app.setPath` and the requirement to set `sessionData` before `ready`.
- Version-matched [Electron 44.4.5 app API documentation](https://www.electronjs.org/docs/v44.4.5/api/app).
- The packaged `package.json` metadata was read directly from each existing ASAR archive without extraction or modification. Both `release/win-unpacked/resources/app.asar` and `release-qa/win-unpacked/resources/app.asar` report `name=drug-manager`, `version=0.3.0`, and `main=dist/electron/main.js`.
- The existing `@electron/asar` command and module are present; no installation was performed.
- Current `electron/main.ts` behavior and the earlier report identify that Main constructs the `OperationJournal` using `app.getPath('userData')` during startup.

The installed Electron declaration documents `app.setPath(name, path)` as an override for a recognized `app.getPath` path, requires the directory to exist, and specifically requires `sessionData` to be overridden before the `ready` event. This is path selection, not an access-control mechanism.

## 3. Independent recheck of installed-runtime results

The six tests were independently rerun in the actual installed Electron Main process using a temporary copy of the runner and test source. The run did not use system Node as a substitute. The existing checked-in-to-worktree raw output file was not overwritten; its SHA-256 remained:

`534F77FA07889D749D89E1D9E4E3E2D7F1C156A95FFCD0877FFBA41E6B42BCB1`

| Test | Independent result | Significance |
|---|---|---|
| R-01 Runtime metadata | PASS: Electron `44.4.5`, Node `24.21.0`, SQLite `3.53.4`, `process.type=browser`; `app.getPath('userData')` matched the test's temporary directory. | Confirms installed-runtime identity and successful test-process path routing. |
| R-02 `node:sqlite` and `DatabaseSync` | PASS: import and instantiation succeeded; `SELECT 1` returned `1`. | Installed Electron runtime exposes the SQLite API. |
| R-03 SQLite engine version | PASS: `process.versions.sqlite` and `SELECT sqlite_version()` both returned `3.53.4`. | Confirms the installed runtime's engine version. |
| R-04 Authorizer API | PASS: `DatabaseSync.prototype.setAuthorizer` is a function. | Confirms installed API exposure only. |
| R-05 Authorizer behavior | PASS: `SQLITE_DENY` denied tested DML/control/schema statements; callback arguments/action codes were observed; replacement and `setAuthorizer(null)` allowed writes; prepared statements were checked before and after installation. | Confirms the authorizer is mutable/removable by code holding the connection. |
| R-06 Connection isolation | PASS: connection A had foreign keys enabled and an INSERT-denying authorizer; connection B had foreign keys disabled and committed an invalid FK child plus an incomplete order-like row. | Confirms controls and PRAGMA state are per connection, not database-wide. |

This rerun does not establish safety of a packaged launch, protection against a second connection, or application-level transaction completeness.

## 4. Correct isolation mechanism and its limits

### Electron path routing

For a future packaged test, a test-only bootstrap must run in Electron's Main process before importing the packaged Main entrypoint:

1. Create a new, empty test root and all target directories.
2. Before `app.whenReady()` and before requiring `dist/electron/main.js`, call `app.setPath('userData', <test-root>\userData)` and `app.setPath('sessionData', <test-root>\sessionData`). Redirect logs, crash dumps, and any other writable Electron paths the harness uses to sibling directories under the same test root.
3. Immediately compare `path.resolve(app.getPath(name))` with the expected path for every redirected name. Abort before importing the packaged Main entrypoint if any path differs.
4. Record `app.isPackaged`, `process.type`, `process.execPath`, the runtime versions, and the verified paths in the output.

This ordering matters because the packaged Main entrypoint constructs its journal from `app.getPath('userData')` during startup. The existing Stage 36A70R runner demonstrates `setPath` in its installed Electron test app, but it does not prove that the packaged application's path has been redirected.

`--user-data-dir`, `APPDATA`, `LOCALAPPDATA`, and `app.setPath` are not security boundaries. The previous report records that its packaged probe still showed the default user-data location in child-process command lines and did not verify a safely redirected `app.getPath('userData')`. Even a successful `app.getPath` comparison would only prove Electron's selected path; code running as the same host user could still open other profile files directly.

### Required OS-enforced boundary

The required containment mechanism is a disposable Windows Sandbox or disposable VM with no host profile, home directory, or writable host drive mounted. Only the packaged app input may be mapped read-only. If result export is needed, use a newly created, empty, stage-specific output directory; do not map any existing user-data location. Disable network and other host-sharing channels not required by the test. The test process must run inside the guest, and its own temporary user-data/database files must remain in guest-local temporary storage.

Before any packaged launch, verify the isolation configuration and guest-visible mounts. The package path, `userData`, `sessionData`, logs, crash dumps, SQLite files, and outputs must all resolve to guest-local paths or the explicitly read-only package input. If any check fails or an unexpected host path is observed, abort without loading the packaged Main entrypoint.

The current host check found no `WindowsSandbox.exe`. The Windows Sandbox optional-feature state remains unverified because its query requires elevation. No disposable VM or other OS boundary was available and demonstrated in this investigation. Therefore the required boundary has not been established.

## 5. Deterministic packaged-runtime test design

Do not run this procedure on the current host unless a disposable VM/Sandbox is first available and its isolation is verified. Test the two existing package artifacts separately because both are present:

- `release/win-unpacked`
- `release-qa/win-unpacked`

For each package:

1. Copy the full package into guest-local temporary storage from a read-only input mapping. Keep the original package untouched.
2. In the copy only, use the already-installed ASAR tooling to add a test bootstrap and the existing qualification test source, and set the copied `package.json` entrypoint to the bootstrap. Preserve the original `dist/electron/main.js`; the bootstrap must set and verify paths before it requires that original entrypoint. Do not modify the source tree, original ASAR, or dependencies.
3. Fail closed if `app.isPackaged !== true`, `process.type !== 'browser'`, the executable is not the copied package, or any redirected Electron path does not resolve under the guest-local test root.
4. Run the tests from the packaged Electron Main process and save raw JSON under guest-local temporary storage. Capture process exit status and logs. Export only the resulting report through the dedicated empty output directory, if required.
5. After the process exits, verify all expected files are confined to the guest test root/output directory. Do not inspect or clean the host user profile.

| Case | Procedure | Expected result / evidence |
|---|---|---|
| P-01 Runtime and packaging identity | Record `process.versions`, `process.type`, `process.execPath`, `app.isPackaged`, and all redirected `app.getPath()` values. | Packaged Electron identity is present; process is Main/browser; `app.isPackaged=true`; every writable path matches the pre-created guest test directory. Any mismatch aborts before loading app Main. |
| P-02 SQLite initialization | Import `node:sqlite`, instantiate `DatabaseSync`, execute `SELECT 1`, create a file-backed DB in the guest test root, and verify `SELECT sqlite_version()`. | Import/query succeed; database path is guest-local; engine version is recorded. |
| P-03 Authorizer API and behavior | Repeat R-04/R-05 against the packaged runtime: deny INSERT/UPDATE/DELETE and tested controls; capture callback arguments; verify replacement and `setAuthorizer(null)` behavior. | Raw results show the actual packaged runtime behavior. Expected denial and mutability outcomes match R-05; any difference is a test failure requiring investigation. |
| P-04 Foreign-key enforcement and invalid fixture | On connection A, enable and read back `foreign_keys=1`, then attempt an invalid child write. | A rejects the child with a foreign-key error. Record the statement error and `foreign_key_check`. |
| P-05 Connection isolation | Open connection B to the same temporary file, verify `foreign_keys=0`, and commit the same invalid child with B. Check whether A's authorizer affects B. | The known behavior is that B commits the child and A's authorizer does not apply. This is a demonstration of the residual second-connection risk, not a passing security control. |
| P-06 Incomplete order-like fixture | Using only the minimal fixture from R-06, commit an order-like root with no revision and a missing referenced commit, then query its rows and `foreign_key_check`. | Record whether it commits. The known R-06 result is that this unconstrained fixture commits on B; do not represent it as a production completeness-trigger test. |
| P-07 Confinement and output | Inventory the test root and output directory after process exit; inspect the guest sandbox configuration and mount list. | All created database, journal, cache, log, and result files are confined to the guest test root/output. No host profile or writable host profile mount is present. Any unexpected path is FAIL and stops further tests. |

The existing R-01 through R-06 source is the baseline for P-01 through P-06. A test result must distinguish an expected demonstration of bypass (P-05/P-06) from a control expected to reject an invalid fixture (P-04). Passing these tests would qualify the packaged runtime/API and verify test confinement; it would not prove that SQLite prevents another connection or that arbitrary host filesystem access is impossible outside the VM boundary.

## 6. Findings and residual risks

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| ISO-01 | Critical | No OS-enforced isolation boundary was demonstrated on this host; a packaged launch cannot be shown safe from the existing profile. | NO-GO. Do not launch either package here. |
| ISO-02 | High | Electron `app.setPath` changes path selection but does not restrict filesystem access by the same-user process. | Use only as a test configuration inside an OS-isolated guest; never claim it provides confinement. |
| ISO-03 | High | Installed-runtime tests do not establish packaged-runtime SQLite availability or behavior. | Packaged qualification remains unexecuted and is a prerequisite before claiming package support. |
| ISO-04 | Medium | Two packaged artifacts exist and both identify the same app version and Main entrypoint; artifact-specific behavior could still differ. | Qualify both archives independently or explicitly designate one release artifact and justify excluding the other. |
| ISO-05 | Informational | The prior Stage 36A70R report records a packaged probe whose startup may have interacted with the default journal path. | This follow-up did not access the profile; prior side effects remain unknown and are not represented as cleared. |

Residual risks even after a successful VM/Sandbox test include sandbox configuration mistakes, explicitly shared folders, virtualization/sandbox escape vulnerabilities, host administrator access, and differences between the test-copy bootstrap and final shipped package. The test copy must preserve and load the exact packaged Main code after setting test paths; the final release artifact must still be checked for identity and hash before/after testing.

## 7. Repository integrity

Baseline and final HEAD are expected to remain:

- Branch: `fix/stage36a2-operation-journal-fixture`
- HEAD: `d7255f0ae3c78e2761c0e90fbd2c664c1dd32478`

At baseline, tracked modifications were:

- `electron/application/order-requests.service.ts`
- `tests/stage8/helpers/renderer-harness.ts`

Pre-existing untracked paths were:

- `docs/stage36a70f-corrected-sqlite-ddl-specification.md`
- `docs/stage36a70h-corrected-sqlite-ddl-specification.md`
- `docs/stage36a70i-independent-validation-report.md`
- `docs/stage36a70j-corrected-sqlite-ddl-specification.md`
- `docs/stage36a70k-independent-validation-report.md`
- `docs/stage36a70l-transaction-integrity-redesign.md`
- `docs/stage36a70m-independent-design-review.md`
- `docs/stage36a70n-corrected-transaction-integrity-specification.md`
- `docs/stage36a70o-independent-transaction-integrity-review.md`
- `docs/stage36a70p-corrected-transaction-integrity-specification.md`
- `docs/stage36a70q-independent-transaction-integrity-validation-report.md`
- `docs/stage36a70r-electron-sqlite-runtime-qualification-report.md`
- `docs/stage36a70r-runtime-qualification/`
- `forensic_analysis.txt`
- `temp.txt`
- `temp_main.txt`
- `verify_report.txt`

This investigation created only this report. It did not change tracked modifications, previous untracked files, the installed-runtime raw JSON, application sources, package manifests, dependencies, or packaged archives. The final status must show the same baseline entries plus this report.

## 8. Recommendation

**NO-GO:** Do not launch the packaged application on the current host for qualification. The installed-runtime tests are independently confirmed, but a temporary Electron path override and command-line/environment overrides cannot prove that the packaged process cannot access the existing host profile. No disposable OS isolation boundary was established.

Proceed with packaged qualification only in a verified disposable Windows Sandbox/VM with the package supplied read-only, no host profile or writable host drives mounted, and all test data routed to guest-local temporary storage. Do not interpret that future test as implementation readiness or as proof against filesystem access by a privileged host actor.
