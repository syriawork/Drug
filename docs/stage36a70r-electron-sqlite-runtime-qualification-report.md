# Stage 36A70R — Actual Electron SQLite Runtime Qualification

**Qualification status:** `STAGE_36A70R_RUNTIME_QUALIFICATION_PASSED`  
**Scope of PASS:** the installed Electron runtime pinned by this repository. The packaged application runtime was not qualified; see Section 8.  
**Implementation readiness:** not assessed or claimed.

## 1. Scope and evidence boundary

This stage tested the Electron runtime actually installed in the repository, not system Node.js. The test ran from Electron's browser/Main process, imported `node:sqlite`, opened temporary SQLite databases, and wrote machine-readable results.

The tests established API availability and observed behavior for this exact installed build. They did not implement the transaction coordinator or any of the five business commands. The incomplete order fixture is intentionally minimal: it proves that connection-local SQLite settings do not enforce an application completeness invariant; it is not the production schema.

The Stage 36A70P design is **technically feasible as a trusted Electron Main-process architecture** on the installed runtime. The authorizer is not a security boundary: it can be replaced or removed by code with access to the connection. SQLite does not prevent another connection from disabling foreign keys and committing invalid rows. The design is feasible only if a future implementation enforces exclusive connection ownership in trusted Main code and qualifies its packaged runtime.

## 2. Documents and source inspected

### Mandatory design evidence

Read completely:

- [docs/stage36a70q-independent-transaction-integrity-validation-report.md](./stage36a70q-independent-transaction-integrity-validation-report.md)
- [docs/stage36a70p-corrected-transaction-integrity-specification.md](./stage36a70p-corrected-transaction-integrity-specification.md)

### Runtime and application evidence

- [package.json](../package.json) — Electron pin, build `electronVersion`, packaging configuration, and application scripts.
- [node_modules/electron/package.json](../node_modules/electron/package.json) — installed Electron package version.
- [node_modules/electron/dist/electron.exe](../node_modules/electron/dist/electron.exe) — installed Electron binary executed by the qualification harness.
- [electron/main.ts](../electron/main.ts) — Main-process composition, IPC registration, existing journal and Firestore wiring.
- [electron/preload.ts](../electron/preload.ts) — exposed renderer API.
- [electron/ipc/handlers/application-handlers.ts](../electron/ipc/handlers/application-handlers.ts) — IPC handlers call application services.
- [electron/window/security.ts](../electron/window/security.ts) — renderer `nodeIntegration`, sandbox, and context-isolation controls.
- [electron/journal/operation-journal.ts](../electron/journal/operation-journal.ts) — current local journal persistence and startup recovery behavior.
- [electron/services/firestore-rest.ts](../electron/services/firestore-rest.ts) — existing Firestore REST transport and write/transaction APIs.
- [electron/repositories/firestore/order-processing-transaction.ts](../electron/repositories/firestore/order-processing-transaction.ts) — existing remote transaction adapter.
- Relevant Firestore repository/factory sources identified by targeted searches, including `users-repository.ts`, `medicines-repository.ts`, `order-repository.ts`, and `inbound-stock-transaction.ts`.
- Existing packaged outputs: [Drug Manager.exe](<../release/win-unpacked/Drug Manager.exe>), [Drug Manager QA.exe](<../release-qa/win-unpacked/Drug Manager QA.exe>), [release app.asar](<../release/win-unpacked/resources/app.asar>), and [QA app.asar](<../release-qa/win-unpacked/resources/app.asar>). They were not altered.

Searches of the application source and package manifest found no SQLite driver, `node:sqlite`, `DatabaseSync`, or SQLite database use in the current application.

## 3. Files created and execution artifacts

Created for this stage:

- [docs/stage36a70r-runtime-qualification/main.cjs](./stage36a70r-runtime-qualification/main.cjs) — executable test body, run inside Electron.
- [docs/stage36a70r-runtime-qualification/run.ps1](./stage36a70r-runtime-qualification/run.ps1) — stages the test app in a unique temporary directory, invokes the installed Electron binary, and preserves its JSON output.
- [docs/stage36a70r-runtime-qualification/results/installed-runtime-output.json](./stage36a70r-runtime-qualification/results/installed-runtime-output.json) — complete raw runtime output, including SQLite compile options, exposed constants, callback arguments, and fixture state.
- This report.

The harness creates a temporary Electron app manifest and temporary user-data directory outside the repository. It removes those temporary files/directories after the installed-runtime run. The file-backed SQLite fixture is also created under a unique temporary directory and removed after closing both connections. No dependency was installed or changed.

Run the installed-runtime qualification from the repository root with:

```powershell
.\docs\stage36a70r-runtime-qualification\run.ps1
```

The harness verifies that the launched process reports `process.type === "browser"` and that Electron's actual `app.getPath("userData")` matches the unique temporary location before proceeding.

## 4. Exact runtime identification

The repository manifest pins Electron `44.4.5`, and the installed Electron package metadata also reports `44.4.5`. The executed Electron Main process reported:

| Runtime item | Observed value | Evidence |
|---|---:|---|
| Electron package pin | `44.4.5` | `package.json`, installed `node_modules/electron/package.json` |
| `process.versions.electron` | `44.4.5` | R-01 in raw output |
| `process.versions.node` | `24.21.0` | R-01 in raw output |
| `process.versions.sqlite` | `3.53.4` | R-01 and R-03 |
| `SELECT sqlite_version()` | `3.53.4` | R-03 |
| `node:sqlite` import | succeeded | R-02 |
| `DatabaseSync` instantiation and query | succeeded; `SELECT 1` returned `1` | R-02 |
| `DatabaseSync.prototype.setAuthorizer` | function | R-04 |

SQLite compile options were read from that runtime and are preserved in the raw JSON. They include `DEFAULT_RECURSIVE_TRIGGERS` and `DEFAULT_SYNCHRONOUS=2`; these are compile-time defaults, not proof of any connection's active PRAGMA values.

The observed `DatabaseSync` prototype includes `open`, `close`, `prepare`, `exec`, `setAuthorizer`, `enableDefensive`, `enableLoadExtension`, and `loadExtension`, among other methods. It exposes no commit-hook method. This confirms that code holding a handle has multiple native database capabilities; the driver does not make the handle coordinator-only. Extension-loading behavior was not exercised.

Because `node:sqlite` is built into the Electron-shipped Node runtime, this proposal does not require an external native npm addon or an addon ABI rebuild. This statement concerns the installed runtime. It is not a packaged-runtime test result.

## 5. Executed tests and raw outcomes

All six installed-runtime tests passed. The full raw results are in [installed-runtime-output.json](./stage36a70r-runtime-qualification/results/installed-runtime-output.json).

| Test ID | Procedure | Observed result | Status |
|---|---|---|---|
| R-01 | Read Electron, Node, SQLite, process type, and isolated user-data path from Electron Main. | Electron `44.4.5`, Node `24.21.0`, SQLite `3.53.4`, `process.type=browser`; actual user-data path matched the temporary test directory. | PASS |
| R-02 | Import `node:sqlite`, instantiate `DatabaseSync(':memory:')`, execute `SELECT 1`. | Import and construction succeeded; query returned `1`. | PASS |
| R-03 | Read `process.versions.sqlite`, run `SELECT sqlite_version()`, and read `PRAGMA compile_options`. | Both SQLite version sources returned `3.53.4`. | PASS |
| R-04 | Inspect `DatabaseSync.prototype.setAuthorizer`. | Method exists and is callable. | PASS |
| R-05 | Deny DML and controls; observe callback arguments; test pre-/post-authorizer prepared statements; replace and remove authorizer. | Details below. | PASS |
| R-06 | Use two independent connections to one temporary file, with foreign keys enabled on A and disabled on B. | B committed an invalid FK child and an incomplete order-like state; A's authorizer did not affect B. | PASS |

### R-05 — authorizer behavior observed

The callback returned the exported `SQLITE_DENY` value (`1`) for protected actions. Denied statements surfaced as `ERR_SQLITE_ERROR` with message `not authorized`.

| Attempt | Observed callback/action | Result |
|---|---|---|
| `INSERT` | `SQLITE_INSERT=18`; arguments `("target", null, "main", null)` | denied |
| `UPDATE` | `SQLITE_UPDATE=23`; arguments `("target", "value", "main", null)` | denied |
| `DELETE` | `SQLITE_DELETE=9`; arguments `("target", null, "main", null)` | denied |
| `PRAGMA foreign_keys=OFF` | `SQLITE_PRAGMA=19`; `("foreign_keys", "OFF", null, null)` | denied; readback remained `1` |
| `BEGIN`, `COMMIT`, `ROLLBACK` | `SQLITE_TRANSACTION=22`; first argument was the statement operation | denied |
| `SAVEPOINT`, `RELEASE` | `SQLITE_SAVEPOINT=32`; arguments included operation and savepoint name | denied |
| `ATTACH`, `DETACH` | `SQLITE_ATTACH=24`, `SQLITE_DETACH=25` | denied |
| `CREATE TABLE`, `DROP TABLE`, `ALTER TABLE` | the corresponding `SQLITE_CREATE_TABLE=2`, `SQLITE_DROP_TABLE=11`, and `SQLITE_ALTER_TABLE=26` callbacks were observed | denied |

The callback receives five positional values: action code, first argument, second argument, database name, and trigger/view name. The runtime exports named `SQLITE_*` constants, including `SQLITE_OK`, `SQLITE_DENY`, and the tested action codes.

A statement prepared before installing the authorizer was denied when run after installation. A statement prepared after installation was denied during preparation. This is the observed behavior for the tested runtime and statements; production code must still install policy before preparing SQL and retain statement handles privately.

Replacing the authorizer with an allow callback permitted an `INSERT`. Calling `setAuthorizer(null)` also permitted an `INSERT`. Thus the authorizer is mutable/removable by any code with the connection handle; it does not authenticate modules or callers.

### R-06 — two-connection isolation observed

The test created one temporary file-backed SQLite database, then opened two independent `DatabaseSync` handles:

- Connection A read `PRAGMA foreign_keys=1` and had an authorizer denying inserts.
- Connection B read `PRAGMA foreign_keys=0` and had no authorizer.
- An insert through A was denied as `not authorized`.
- An invalid child insert through A, after removing A's authorizer, failed with `FOREIGN KEY constraint failed`.
- B committed an invalid child row and an order-like root row with a missing commit reference, `current_revision=0`, and zero revision rows.
- `PRAGMA foreign_key_check` on B reported both foreign-key violations.
- B's writes succeeded despite A's authorizer and foreign-key setting.

The critical observed result is that a second connection can commit the inconsistent fixture. This reproduces the underlying Stage 36A70Q Q-01/Q-02 risk in Electron's own SQLite runtime, not merely in another language binding.

## 6. Guarantee-layer assessment

| Layer | What was demonstrated | What was not demonstrated |
|---|---|---|
| SQLite engine | A connection with foreign keys enabled rejected a bad child; a connection with the setting disabled committed it. Standard authorizer action decisions are invoked during statement preparation and can deny the tested SQL actions. | SQLite does not enforce foreign keys globally across connections and does not infer business completeness (for example, requiring revision 1). The engine did not prevent the second connection. No direct file-tampering test was run. |
| Per-connection state | `foreign_keys` and authorizer configuration on A did not affect B. Each connection could have distinct settings and behavior. | There is no engine-enforced “only one connection” rule. |
| Electron/Node API | `node:sqlite`, `DatabaseSync`, `setAuthorizer`, SQLite version, callback arguments, and tested authorizer behavior were observed in Electron Main. | The API does not make the handle private or make `setAuthorizer` immutable. `DatabaseSync` exposes SQL, lifecycle, defensive-mode, and extension-loading methods. |
| Trusted Main process | The current app already composes repositories/services in Main and exposes a narrow preload API over named IPC channels. This makes Main-only placement feasible. | No SQLite connection or transaction coordinator exists today. Current code does not prove a future single-connection invariant or block a new Main module from opening another connection. |
| Operational boundary | The design can use OS storage controls and integrity checks as operational mitigations. | A local process with file access or an administrator can act outside the in-process authorizer. No prevention claim is supported. |

No evidence here supports treating an authorizer, trigger, or Main-process ownership as protection from independent filesystem access.

## 7. Existing application architecture and ownership feasibility

### Renderer/Main boundary

The existing application already uses:

- A Main process that constructs application services and repositories in [electron/main.ts](../electron/main.ts).
- Named `ipcMain.handle` routes and application-service handlers.
- A frozen, narrow preload API in [electron/preload.ts](../electron/preload.ts); it exposes typed operations, not `ipcRenderer` or a generic invoke function.
- `nodeIntegration: false`, `sandbox: true`, and context isolation in [electron/window/security.ts](../electron/window/security.ts).

The renderer therefore has no current direct Node or SQLite access path in the inspected configuration. A future SQLite module could be introduced behind the same Main/IPC boundary without exposing a handle to the renderer. This is an architectural feasibility result, not enforcement against compromised Main code.

### Current local persistence and database paths

No SQLite connection or database library is currently present in application source. The `OperationJournal` in Main is local file-based JSON persistence under `app.getPath('userData')`; it is not a SQLite database. Its startup `initialize()` creates/reads the journal directory and may promote temporary records or quarantine corrupt journal files.

The current business repositories and transaction adapters write to Firestore over REST, including [users-repository.ts](../electron/repositories/firestore/users-repository.ts), [medicines-repository.ts](../electron/repositories/firestore/medicines-repository.ts), [order-repository.ts](../electron/repositories/firestore/order-repository.ts), and [inbound-stock-transaction.ts](../electron/repositories/firestore/inbound-stock-transaction.ts), plus order processing. Those are not alternate SQLite connections, but they are existing business write paths. If local SQLite is intended to become authoritative, the next architecture must explicitly decide whether and how these Firestore writes are replaced or separated; otherwise the application could have multiple authoritative persistence paths. No such decision or change was made here.

### Required future connection enforcement

The runtime does not prove single-connection ownership. A future implementation needs at least:

1. One private Main-process database module that alone imports `node:sqlite` and constructs the authoritative handle.
2. No exported `DatabaseSync` instance, statement, raw SQL function, or transaction-control method; command handlers receive only typed operations.
3. Architecture/CI checks restricting imports and handle construction to that module, with tests for every write/IPC path.
4. A single coordinator serializing every authoritative command, controlling `BEGIN`/`COMMIT`/`ROLLBACK`, validation, and all writes.
5. Connection-open/configuration checks and test instrumentation that fail closed on unexpected handles. Such instrumentation is an application control, not a SQLite guarantee.
6. Authorizer installation before application statements are prepared; no reliance on authorizer identity checks, permanence, or protection from code holding the handle.
7. Packaged-runtime qualification against the binary actually shipped before claiming the package supports the required contract.

These are prerequisites, not implemented controls.

## 8. Packaged-runtime qualification

Packaged outputs exist in [release/win-unpacked](../release/win-unpacked) and [release-qa/win-unpacked](../release-qa/win-unpacked). Their build configuration pins Electron `44.4.5`, but this is not executable evidence of API availability or behavior inside the packaged application.

**Packaged test result: NOT EXECUTED.** The packaged executable is the application binary rather than the unpackaged Electron runner. Attempts to use `--version`, `ELECTRON_RUN_AS_NODE`, and a temporary `NODE_OPTIONS` qualification hook did not produce runtime-test output. The executable launched the normal Drug Manager app. In the hook attempt, despite temporary `APPDATA`/`LOCALAPPDATA` values, child-process command lines still reported the default `C:\Users\ALPHA\AppData\Roaming\drug-manager` user-data path. It was therefore unsafe to continue treating this as an isolated package test.

The packaged processes launched by these probes were stopped by specific process IDs; a final process check found none running. The app's Main startup calls `OperationJournal.initialize()` against its user-data directory. We cannot establish from this run whether that default directory already existed or whether startup created/read/recovered any journal state. We did not inspect, delete, or clean up that user profile. This is an execution caveat and potential local-profile side effect. No SQLite database was used by the packaged app, and no Firebase/Firestore mutation was intentionally invoked.

Packaged qualification remains a release prerequisite. It needs a controlled launch mechanism that proves the packaged app's data directory is isolated before startup; this stage did not establish one.

## 9. Findings

### R-01 — Second connection bypasses connection-local integrity controls

- **Severity:** Critical
- **Evidence:** R-06 committed an invalid foreign-key child and an order-like root without a referenced commit or revision through connection B while connection A had foreign keys enabled and an authorizer denying inserts.
- **Impact:** Any unauthorized second connection can bypass the first connection's foreign-key and authorizer policy and commit incomplete state. This is a demonstrated SQLite behavior, not a hypothetical driver flaw.
- **Required correction:** Preserve the Stage 36A70P trusted-Main design; enforce a single private connection and a single coordinator through module boundaries and architecture tests. Do not describe SQLite as preventing a second connection.
- **Owner decision:** Needed before implementation if Firestore remains a separate write store or if any other application module is to access SQLite.

### R-02 — Authorizer is replaceable/removable, not a caller or module boundary

- **Severity:** High
- **Evidence:** R-05 showed that replacement with an allow callback permits writes and `setAuthorizer(null)` permits writes. Main-process action callbacks receive SQL action details, not caller identity.
- **Impact:** Code that obtains the authoritative handle can disable or replace the callback and execute SQL. The authorizer cannot protect against that code.
- **Required correction:** Treat the authorizer only as defense in depth. Keep the handle and statements private to the database module/coordinator; do not pass them to ordinary command code.
- **Owner decision:** No new decision if Stage 36A70P's Main-only ownership and defense-in-depth interpretation remains binding.

### R-03 — Packaged application runtime remains unqualified

- **Severity:** High
- **Evidence:** Packaged outputs exist, but safe test injection did not produce runtime output; attempts started the normal app and reported the default user-data path.
- **Impact:** `node:sqlite` availability, the API surface, and behavior in the shipped packaged process have not been independently demonstrated. The installed Electron result must not be presented as a packaged-app test.
- **Required correction:** Establish a safe packaged test entrypoint/profile isolation and run the same runtime checks before release. Do not claim package qualification until that evidence exists.
- **Owner decision:** Required if qualification must be incorporated into packaging or release CI.

### R-04 — Existing Firestore paths are separate business write routes

- **Severity:** Medium
- **Evidence:** The current Main application has Firestore REST repository writes and transaction adapters; no SQLite path exists.
- **Impact:** If SQLite is to be authoritative, keeping these writes without an explicit separation could undermine the “one authoritative writer” model even though they are not SQLite connection bypasses.
- **Required correction:** Decide and document the persistence authority and command ownership before implementing a local database path; do not silently dual-write or create a second success boundary.
- **Owner decision:** Yes; the intended relationship between Firestore persistence and any new SQLite store must be decided.

### R-05 — Commit hook and extension APIs are not the coordinator boundary

- **Severity:** Informational
- **Evidence:** The observed `DatabaseSync` methods include extension-control methods but no commit-hook API. No extension was loaded and no commit-hook behavior was tested.
- **Impact:** A commit hook cannot be assumed available through this API; extension loading is an exposed method family requiring explicit policy when a connection is implemented.
- **Required correction:** Continue to treat final validation and COMMIT ownership as coordinator responsibilities. Explicitly disable extension loading and qualify its configuration in the eventual connection factory.
- **Owner decision:** No, consistent with the Stage 36A70P decision that hooks are optional defense-in-depth only.

## 10. Unexecuted tests and limits

The following were not executed and are not passed:

- Packaged application `node:sqlite` import/API/authorizer tests; the packaged launch could not be safely isolated as described in Section 8.
- Runtime authorizer extension-loading enable/disable behavior.
- SQLite file-level modification or local-process attacks.
- Application-level coordinator, command completeness, nonce/idempotency, ambiguous-COMMIT recovery, crash, concurrency, or all-five-command tests. No SQLite integration/coordinator/business commands exist in the repository.
- ABI/package loading checks for an external native addon. No such addon was added or tested.
- Any production database, migration, Firebase, or Firestore mutation test.

These limits do not invalidate the installed Electron runtime observations; they constrain what those observations can support.

## 11. Repository integrity and preserved state

| State | Branch | HEAD |
|---|---|---|
| Before | `fix/stage36a2-operation-journal-fixture` | `d7255f0ae3c78e2761c0e90fbd2c664c1dd32478` |
| After | `fix/stage36a2-operation-journal-fixture` | `d7255f0ae3c78e2761c0e90fbd2c664c1dd32478` |

Pre-existing tracked modifications preserved:

- [electron/application/order-requests.service.ts](../electron/application/order-requests.service.ts)
- [tests/stage8/helpers/renderer-harness.ts](../tests/stage8/helpers/renderer-harness.ts)

Pre-existing untracked files preserved:

- [docs/stage36a70f-corrected-sqlite-ddl-specification.md](./stage36a70f-corrected-sqlite-ddl-specification.md)
- [docs/stage36a70h-corrected-sqlite-ddl-specification.md](./stage36a70h-corrected-sqlite-ddl-specification.md)
- [docs/stage36a70i-independent-validation-report.md](./stage36a70i-independent-validation-report.md)
- [docs/stage36a70j-corrected-sqlite-ddl-specification.md](./stage36a70j-corrected-sqlite-ddl-specification.md)
- [docs/stage36a70k-independent-validation-report.md](./stage36a70k-independent-validation-report.md)
- [docs/stage36a70l-transaction-integrity-redesign.md](./stage36a70l-transaction-integrity-redesign.md)
- [docs/stage36a70m-independent-design-review.md](./stage36a70m-independent-design-review.md)
- [docs/stage36a70n-corrected-transaction-integrity-specification.md](./stage36a70n-corrected-transaction-integrity-specification.md)
- [docs/stage36a70o-independent-transaction-integrity-review.md](./stage36a70o-independent-transaction-integrity-review.md)
- [docs/stage36a70p-corrected-transaction-integrity-specification.md](./stage36a70p-corrected-transaction-integrity-specification.md)
- [docs/stage36a70q-independent-transaction-integrity-validation-report.md](./stage36a70q-independent-transaction-integrity-validation-report.md)
- [forensic_analysis.txt](../forensic_analysis.txt)
- [temp.txt](../temp.txt)
- [temp_main.txt](../temp_main.txt)
- [verify_report.txt](../verify_report.txt)

The only repository additions from Stage 36A70R are the qualification source/runner, installed-runtime JSON output, and this report. Application source, [package.json](../package.json), lockfiles, Firebase configuration, and packaged files were not changed. The default local user-data caveat from the unsuccessful packaged-app probe is separately disclosed in Section 8.

## 12. Recommendation and final status

**Recommendation:** The pinned installed Electron runtime supports the Stage 36A70P `node:sqlite` / `DatabaseSync` foundation, including `setAuthorizer`. The design is technically feasible only with exclusive ownership enforced by trusted Main-process code; SQLite and the authorizer do not enforce that ownership. Before implementation, resolve the Firestore authority boundary, implement the private Main connection/coordinator architecture, and qualify the packaged runtime using a demonstrably isolated profile.

`STAGE_36A70R_RUNTIME_QUALIFICATION_PASSED`
