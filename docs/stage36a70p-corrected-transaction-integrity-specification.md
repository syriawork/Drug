# Stage 36A70P — Corrective Transaction-Integrity Specification Following Stage 36A70O Review

**Status:** `STAGE_36A70P_SPECIFICATION_READY_FOR_INDEPENDENT_VALIDATION`  
**Scope:** Design and specification only. No SQL, DDL, database file access, dependency change, application source change, migration, or runtime validation was performed in this stage.

## 1. Purpose and evidence boundary

This document corrects the Stage 36A70O review findings and preserves the approved business decisions. It does not claim implementation readiness, runtime validation, or database enforcement by SQLite alone.

This specification is a trusted-process architecture for the authoritative SQLite database under Electron Main. The design uses SQLite as a relational engine and commit boundary, but the actual completeness boundary is the trusted Main-process transaction coordinator operating a single authoritative connection. SQLite authorizer and schema rules remain important defense-in-depth, not a replacement for trusted process ownership.

The proposal here is intentionally narrow and explicit:

- Selected driver: Node built-in `node:sqlite` / `DatabaseSync`, as shipped with Electron `44.4.5` and the Node runtime pinned by Electron (`v24.21.0`).
- Exact version pin: the repository manifest pins `electron` `44.4.5`; the Electron 44.4.5 DEPS file pins its Node source to `v24.21.0`.
- The design remains conditional on actual runtime qualification before implementation.
- The design does not claim protection against a direct database-file attacker or against malicious code already running in Electron Main with access to the database path or raw connection capability.

## 2. Documents and evidence inspected

Read completely:

- [docs/stage36a70o-independent-transaction-integrity-review.md](./stage36a70o-independent-transaction-integrity-review.md)
- [docs/stage36a70n-corrected-transaction-integrity-specification.md](./stage36a70n-corrected-transaction-integrity-specification.md)
- [docs/stage36a70m-independent-design-review.md](./stage36a70m-independent-design-review.md)
- [docs/stage36a70l-transaction-integrity-redesign.md](./stage36a70l-transaction-integrity-redesign.md)
- [docs/stage36a70k-independent-validation-report.md](./stage36a70k-independent-validation-report.md)

Also read and used where available:

- [docs/stage36a70j-corrected-sqlite-ddl-specification.md](./stage36a70j-corrected-sqlite-ddl-specification.md)
- [docs/stage36a70i-independent-validation-report.md](./stage36a70i-independent-validation-report.md)
- [docs/stage36a70h-corrected-sqlite-ddl-specification.md](./stage36a70h-corrected-sqlite-ddl-specification.md)
- [package.json](../package.json)

Unavailable document explicitly recorded:

- Stage 36A70G’s standalone validation report was not present in the workspace. No Stage 36A70G content was invented. Findings attributed to Stage 36A70G are only those described or referenced in the later H/I/J/K/O documents.

## 3. Stage 36A70O findings and disposition matrix

This section addresses each finding in Stage 36A70O and records the corrective action.

| Stage 36A70O ID | Stage 36A70O location | Stage 36A70O finding | Technical issue | Corrective action | Guarantee layer | Objective proof |
|---|---|---|---|---|---|---|
| O-01 | §9, rows O-01 | Driver selection is well motivated but not runtime-verified for the packaged Electron runtime. | Documented API is consistent with Node 24.21.0, but the actual Electron binary and SQLite build have not been runtime-qualified. | Freeze exact proposal: Electron 44.4.5 + Node 24.21.0 built-in `node:sqlite` / `DatabaseSync`; require pre-implementation runtime qualification gate. | Driver/connection + trusted Main-process | Assert runtime version, `DatabaseSync` presence, `setAuthorizer` presence, and a disposable authorizer test before implementation. |
| O-02 | §9, row O-02 | Single-connection guarantee is not a demonstrated SQLite enforcement feature. | SQLite cannot prevent a second writable connection if another code path opens one. | Explicitly scope the single-connection rule as a Main-process invariant and add a runtime detection failure if another writable connection opens. | Trusted Main-process + operational assumption | Fail closed when a second writable DB handle is created or when connection-open instrumentation detects unauthorized creation. |
| O-03 | §9, row O-03 | Ambiguous COMMIT recovery needs a durable operation-state model. | Retry logic is logically sound but incomplete without persistent operation-state transitions and reconciliation. | Define a durable operation state machine: `pending`, `reserved`, `executing`, `committed`, `ambiguous`, `rolled_back`, `expired`, `rejected`. | Trusted Main-process | Reconciliation test for committed, ambiguous, and rolled-back states with exact idempotent response behavior. |
| O-04 | §9, row O-04 | Command completeness remains design-level without a test-backed exact invariant checklist. | The completeness logic is correct in intent but still needs per-command exact row/cardinality requirements defined as explicit invariants. | Convert every invariant into precise command-specific completeness statements for the five command types and require validation fixtures for each command. | SQLite engine + trusted Main-process | Deterministic negative fixtures for each command omission/mismatch. |
| O-05 | §9, row O-05 | Commit hooks are a useful mention but should not be part of the correctness boundary. | SQLite C commit hook exists but is not exposed by the selected Node API and is replaceable. | Explicitly prohibit commit hooks as a required integrity mechanism; treat as optional defense-in-depth only if a future qualified driver exposes it. | Driver/connection + trusted Main-process | Document the driver requirements and coded rejection of hook usage in the architecture. |
| O-06 | §9, row O-06 | Direct file tampering boundary should be stated more explicitly. | The architecture is honest but can be clearer that SQLite and authorizers cannot stop direct DB-file attackers. | Add an explicit out-of-scope statement for direct file tampering in the executive boundary and threat model. | Operational assumption + not preventable in model | Startup integrity checks and forensic detection only; no prevention claim. |

## 4. Corrected driver and authorizer architecture

### 4.1 Exact driver proposal and version pin

This specification selects and pins the following runtime contract:

- Driver: built-in `node:sqlite` module, `DatabaseSync`.
- Runtime version: Electron `44.4.5` (as pinned in [package.json](../package.json)).
- Node runtime: Electron `v44.4.5` pins Node `v24.21.0`.
- The design does not add an npm dependency, package installation, or native module. It uses the runtime already present in the Electron application and its bundled Node runtime.

The design treats this as an exact proposed implementation contract, not a proven runtime fact. Before implementation, the following must be checked in the actual packaged Electron runtime:

1. `process.versions.electron` matches `44.4.5`.
2. `process.versions.node` matches `24.21.0`.
3. `node:sqlite` is available.
4. `DatabaseSync` exists.
5. `DatabaseSync.prototype.setAuthorizer` exists and is callable.
6. A disposable test database confirms the authorizer is installed and can reject a protected action.
7. The SQLite engine version and compile options from the shipped binary are recorded.

### 4.2 Authorizer capabilities and limitations

The selected driver exposes SQLite authorizer capability through the Node `DatabaseSync.setAuthorizer()` method, and the engine supports the underlying SQLite authorizer API:

- `sqlite3_set_authorizer()` exists in SQLite.
- A single authorizer is installed per SQLite connection.
- Authorizer callbacks are invoked while SQL is prepared, not as a caller-identity check.
- A later authorizer replacement or `setAuthorizer(null)` disables or replaces the current callback.
- The callback receives SQL action details and object names, not a JavaScript module identity.

Therefore, the correct design is:

- The authorizer is a connection-local defense-in-depth control.
- It restricts SQL actions on the authoritative connection.
- It does not identify the caller and cannot distinguish a trusted coordinator from a different code path using the same connection.
- It does not prevent a second connection or a direct file attacker.

The Stage 36A70P design defines the authorizer scope as follows:

- Deny all `PRAGMA` write actions after initialization.
- Deny transaction-control statements (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`) to ordinary command code.
- Deny `ATTACH` and `DETACH`.
- Deny schema creation, drop, alter, and reindex operations.
- Deny `INSERT`/`UPDATE`/`DELETE` not contained in the exact approved write set of the coordinator and any explicitly allowed trigger path.
- Require a private lifetime and no shared statement cache across command handlers.
- Require a canary check on every open to re-read the settings after connection creation and fail closed if a required setting changes.

### 4.3 Authorizer lifecycle and replacement restrictions

The authoritative connection must be created and configured by a private database module in Electron Main. The following protocol is required:

1. Open the connection only through the private database factory.
2. Set required PRAGMAs and read them back immediately.
3. Install the fail-closed authorizer before any application SQL is prepared.
4. Record a connection ID and a connection-open fingerprint for runtime validation.
5. Prohibit external access to the connection object, statement handles, and internal logger.
6. Reject any attempt to replace or disable the authorizer from outside the private database factory.
7. Fail closed if `setAuthorizer` is called with `null`, a different callback, or any non-private reconfiguration path.

This remains a trusted-process control. It does not protect against compromised Main or direct database-file access.

## 5. Connection lifecycle and transaction ownership

### 5.1 Exclusive ownership by Electron Main

The authoritative database is owned by Electron Main only. The rules are:

- The database module in Main is the only module allowed to import `node:sqlite` or hold a live database connection.
- Renderer and business modules communicate over narrow IPC only.
- No renderer, feature module, or ordinary application service receives a connection handle, statement handle, SQL string, or raw DB method.
- No command handler receives permissions to open or control a transaction.
- The database factory holds one authoritative read/write connection for the application lifetime unless an explicit owner-approved exception is documented and qualified.

### 5.2 Connection initialization and verification

On every connection open, the database factory must verify all required settings before it accepts commands. The required values include:

- `PRAGMA foreign_keys=ON`
- `PRAGMA journal_mode=WAL`
- `PRAGMA synchronous=FULL`
- `PRAGMA busy_timeout=<configured>`
- `recursive_triggers` configured as required by the schema and verified on open
- `extension loading` disabled
- `defensive mode` enabled if available in the selected runtime

The factory must then read each setting back and fail closed if any value differs from the expected value.

### 5.3 Transaction coordinator protocol

Every authoritative command is executed by exactly one transaction coordinator. The coordinator owns:

- `BEGIN IMMEDIATE`
- all business writes
- all invariant validation
- all finalization checks
- the single durable `COMMIT` path
- all `ROLLBACK` paths before a durable success

The coordinator protocol is:

1. Authenticate actor and canonicalize request.
2. Verify signed assertion and expiry.
3. Validate nonce and operation identity.
4. Resolve any existing operation/commit state without mutation.
5. Acquire a single-flight lock keyed by operation ID and command ID.
6. Start one top-level `BEGIN IMMEDIATE` only in the coordinator.
7. Re-read the domain state under the same transaction.
8. Perform all inserts/updates required by the command.
9. Run exact validator checks for required/actual relationships.
10. Finalize only if the full invariant set is satisfied.
11. Issue the single durable `COMMIT`.
12. Read back and compare the exact final result before returning success.

No command path may open an alternate write connection, call `BEGIN`, `COMMIT`, or `ROLLBACK` itself, or use savepoints or nested transactions for production logic.

### 5.4 Savepoints, `REPLACE`, and commit hook policy

The design explicitly forbids:

- nested transactions in production logic;
- `SAVEPOINT`, `RELEASE`, and `ROLLBACK TO` in command handlers;
- `INSERT OR REPLACE`, `REPLACE INTO`, `UPDATE OR REPLACE`, `UPSERT`, `OR IGNORE`, and `OR FAIL` in authoritative business SQL;
- any use of `REPLACE` or conflict-side-effect semantics for inventory or order state.

The coordinator may use SQLite default `ABORT` semantics and whole-transaction rollback after any constraint failure. The document requires `recursive_triggers=ON` on connection initialization as defense in depth, but not as a permission to use `REPLACE`.

The commit hook is not the primary integrity mechanism. The SQLite C commit hook can veto a commit, but the selected Node runtime does not expose a public one. In this specification:

- a commit hook is not required;
- a commit hook is not treated as the correctness boundary;
- a future driver exposing a qualified commit hook could only be treated as defense-in-depth after separate runtime review and explicit approval.

## 6. Nonce and idempotency state machine

### 6.1 Signed request and identity binding

Before any durable write attempt, the trusted Main process must construct a canonical operation envelope. The signed authorization assertion binds at minimum:

- actor identity;
- command type;
- resource identity;
- operation ID;
- command ID;
- commit ID;
- canonical request hash;
- nonce value and nonce ID;
- policy version;
- issued-at and expiry time;
- key ID and signing algorithm.

Main verifies:

- signature and algorithm;
- key validity and revocation status;
- canonicalization and hash;
- actor permission and policy snapshot;
- expiry; and
- exact resource/action binding.

A retry does not generate a new commit ID unless the operation is a new logical request. For exact retry after ambiguous or lost COMMIT response, the stable operation/command/commit IDs and canonical payload must match the original durable work.

### 6.2 Deterministic processing order

The required order is:

1. Authenticate actor.
2. Canonicalize and hash request.
3. Verify signed assertion.
4. Verify expiry and command/resource binding.
5. Validate nonce and nonce binding.
6. Resolve existing operation/command/commit IDs read-only.
7. Detect payload or identity conflicts.
8. Reserve nonce and operation identity if this is a new or retriable operation.
9. Execute the command in the coordinator.
10. Validate all completeness invariants.
11. Commit atomically.
12. Read back durable result and return it.

### 6.3 Required retry semantics

The specification requires these exact outcomes:

| Situation | Required behavior |
|---|---|
| Retry after confirmed COMMIT | Read-only result reconciliation; no second business write; no new nonce consumption; return exact committed result. |
| Retry after ambiguous COMMIT result | Exact read of operation/command/commit IDs; if committed result exists, return it; if no durable result exists, require fresh valid authorization and a fresh nonce; never silently mutate or replace earlier durable state. |
| Same commit ID with different payload | Hard conflict; reject; do not replace durable result. |
| Same nonce with different operation | Reject as replay before any mutation. |
| Expired assertion on legitimate retry | Permit only read-only exact result lookup if a durable record exists; otherwise reject and require renewed authorization and a fresh nonce. |
| Concurrent duplicate submissions | Single-flight lock by operation ID; only one winner executes. Others resolve to the winner’s durable result. |
| Crash before COMMIT | No business success; operation may remain reserved but no durable work exists. |
| Crash after COMMIT before return | Treat as confirmed success on read-only reconciliation; return committed result if stable IDs are found. |
| Same operation ID with different identity | Reject as conflict; no overwrite or mutation. |
| First successful COMMIT followed by conflicting submission | Reject conflicting submission; winner remains durable. |

### 6.4 Durable operation state model

The coordinator must persist or effectively reconstruct the following state machine:

- `pending`: operation received but not reserved.
- `reserved`: nonce and operation identity reserved.
- `executing`: coordinator is inside the write transaction.
- `committed`: durable business success exists.
- `ambiguous`: incomplete/uncertain outcome requires read-only reconciliation.
- `rolled_back`: transaction aborted before commit; no business success.
- `expired`: assertion expired; only read-only lookup allowed if durable result already exists.
- `rejected`: unauthorized or conflicting operation.

The database itself records only durable facts; the trusted Main process uses this state machine to determine whether a retry is allowed or must be rejected.

## 7. Command completeness invariants

This specification preserves the approved business decisions and the release-one command set:

- `order.create`
- `order.accept`
- `order.fulfill`
- `inventory.bootstrap`
- `inventory.receipt`

The required invariants are:

### 7.1 `order.create`

Required invariants:

- exactly one valid initial revision 1 pending row for the order;
- exact root and revision state match the approved business life-cycle;
- exactly one valid reservation row per line;
- exact reserve movement rows match the reservation set;
- every reservation has a matching order line, quantity, identity, and movement;
- no fulfillment or accept movement is present;
- mandatorily linked effect manifest entries and authorization records are present;
- no order can commit without the revision-1 pending row and the complete create manifest chain.

### 7.2 `order.accept`

Required invariants:

- revision 2 accepted exists;
- no inventory movement rows for the command;
- order lifecycle advances from pending to accepted without affecting inventory balance;
- exact authorization, manifest, and child record sets are present;
- the exact reservation set from create remains unmodified.

### 7.3 `order.fulfill`

Required invariants:

- exact fulfillment consumes the accepted order’s reservation;
- no extra reservation movement is created;
- the exact inventory movement corresponds to the reservation and quantity;
- order lifecycle advances to fulfilled with revision 3;
- all effect manifest rows, movement rows, and approval entries are present and bound by commit ID;
- no silent conflict resolution or implicit reversal is allowed.

### 7.4 `inventory.bootstrap`

Required invariants:

- complete physical count exists;
- independent count evidence exists;
- independent approval exists;
- exact opening movement exists;
- created inventory identity and batch/line rows are linked; and
- all child rows are present before the commit can be finalized.

### 7.5 `inventory.receipt`

Required invariants:

- may create a new inventory identity atomically;
- exact source evidence exists;
- independent approval exists;
- exact movement exists;
- effect manifest is complete;
- the receipt-created identity is immutable after finalization; and
- the receipt remains bound to its original created identity and commit, with no post-finalization rebinding.

### 7.6 Layer responsibility for invariants

The command completeness invariants are enforced across layers:

- SQLite engine: uniqueness, foreign keys, checks, append-only restrictions, and immediate structural relationships.
- Driver/connection: authorizer restriction, connection configuration readback, and single-writer execution path.
- Trusted Main-process: exact business validation, approval verification, signed assertion checks, idempotency/reservation logic, operation state transitions, and commit finalization ownership.
- Operational assumption: OS ACLs, filesystem integrity, backups, and external security controls.

## 8. Threat model and residual risk

### Threat 1: Renderer attempting direct database access

- Control: renderer has no SQL, DB path, or connection capability; all writes and reads are via narrow IPC to Main.
- Guarantee layer: trusted Main-process + IPC boundary.
- Residual risk: low if Main is not compromised, but medium if a preload bridge or malicious renderer target exposes a DB path or unsafe IPC message.
- Validation requirement: fail closed if renderer attempts raw DB access via IPC or any direct object exposure.

### Threat 2: Application module bypassing the coordinator

- Control: central database module, no exported connection object, only typed business APIs, and one transaction coordinator.
- Guarantee layer: trusted Main-process architecture.
- Residual risk: moderate if a compromised Main module gains access to the database factory.
- Validation requirement: runtime assertion that only the coordinator path creates writable transactions and that no other module can initiate `BEGIN` or `COMMIT` on the authoritative connection.

### Threat 3: Unauthorized second SQLite connection

- Control: one authoritative connection, factory restriction, and runtime connection-open instrumentation.
- Guarantee layer: driver/connection + trusted Main-process.
- Residual risk: high if a second connection is created by any code path or helper; SQLite itself does not stop this.
- Validation requirement: fail closed on any second writable connection or a mismatched connection owner ID.

### Threat 4: Local process with filesystem access

- Control: private user-data directory, OS ACLs, and strict storage placement.
- Guarantee layer: operational assumption.
- Residual risk: high where same-user or local administrator access exists.
- Validation requirement: startup integrity checks, WAL/file verification, and forensic detection; no prevention claim.

### Threat 5: Direct database-file modification by an administrator or attacker

- Control: database integrity checks, WAL/filer verification, and forensic detection.
- Guarantee layer: operational assumption and detection-only controls.
- Residual risk: cannot be prevented in this model when an attacker controls the database file or the underlying storage medium.
- Validation requirement: fail closed on mismatch and preserve forensic evidence; do not silently repair or rewrite the database.

This document explicitly rejects the claim that SQLite authorizer, trigger, or Main-process ownership prevent direct file tampering by a hostile or privileged filesystem actor.

## 9. Deterministic adversarial validation matrix

This is a design-only validation matrix for future independent runtime validation. It is not a runtime pass claim.

| Test ID | Exact fixture/setup | Attack or operation | Expected result | Required evidence | PASS/FAIL rule |
|---|---|---|---|---|---|
| P-01 | Fresh disposable DB; initialize schema and policy row; open one Main connection. | Connection open under normal factory. | Single connection created; readback of required PRAGMAs matches expected values. | Connection-open log, settings readback, and file identity. | PASS if all values match; otherwise FAIL. |
| P-02 | Same as P-01 but create second writable handle through an application helper. | Unauthorized second connection creation. | Fail closed; no command allowed. | Connection creation log and exception path. | PASS if second open is rejected; otherwise FAIL. |
| P-03 | Authorizer installed on Main connection. | Attempt PRAGMA write `PRAGMA foreign_keys=OFF`. | Authorizer denies or connection rejects. | Error trace and final settings values. | PASS if denied; otherwise FAIL. |
| P-04 | Same as P-01. | Attempt direct SQL transaction control (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`). | Denied by authorizer or rejected by coordinator path. | SQL error and connection state. | PASS if rejected. |
| P-05 | Same as P-01. | Attempt `ATTACH` or `DETACH`. | Rejected. | DB config snapshot and error output. | PASS if rejected. |
| P-06 | Same as P-01. | Attempt schema `CREATE TABLE` or `DROP TABLE` through non-coordinator path. | Rejected. | SQL error and schema metadata snapshot. | PASS if rejected. |
| P-07 | Valid bootstrap and order-create fixtures. | Omit the obligatory revision-1 row and finalize. | Fail before commit; no durable partial reservation. | Finalized commit rows, order revisions, and balance rows. | PASS if all partial business effects are absent. |
| P-08 | Valid order create fixture. | Manually update root status or project revision without coordinator. | Rejected by business validation and/or transaction guard. | Root revision and commit rows before/after. | PASS if rejected. |
| P-09 | Valid acceptance fixture. | Inject inventory movement during acceptance. | Rejected; no movement rows. | Movement table state and order revision state. | PASS if no inventory movement occurs. |
| P-10 | Valid fulfillment fixture. | Try to fulfill without exact reservation. | Rejected. | Reservation and movement rows. | PASS if no fulfillment is committed. |
| P-11 | Valid bootstrap fixture. | Omit evidence or approval. | Rejected before commit. | Evidence and approval tables. | PASS if rejected. |
| P-12 | Valid receipt fixture with new identity creation approval. | Receipt creates a new identity with complete evidence and movement. | Committed atomically; idempotent result preserved. | Receipt identity, movement, evidence, and manifest rows. | PASS if atomic and complete. |
| P-13 | Receipt retry after confirmed commit. | Same operation/command/commit IDs with same payload. | Returns exact durable result; no second effects. | Commit log and response match. | PASS if idempotent result matches. |
| P-14 | Same commit ID different payload. | Conflicting payload under same commit ID. | Rejected. | Operation conflict rows and response. | PASS if rejected as conflict. |
| P-15 | Same nonce different operation. | Replay under different operation ID. | Rejected as replay before mutation. | Nonce and command state rows. | PASS if rejected. |
| P-16 | Expired assertion on exact retry. | Retry after expiry and before a durable result exists. | Reject and require fresh authorization and fresh nonce. | Logs and operation state transition. | PASS if fresh auth is required. |
| P-17 | Two concurrent exact duplicates. | Submit same command twice concurrently. | Exactly one durable winner; all others resolve to same committed result. | Operation state and commit winner logs. | PASS if one winner only. |
| P-18 | Crash just before COMMIT. | Hard kill of process after writes but before commit. | No business success; atomic rollback or no durable commit. | DB state and operation state. | PASS if no partial business-state commit remains. |
| P-19 | Crash immediately after COMMIT but before acknowledgement. | Process exits without response. | Read-only reconciliation returns committed result under same operation IDs. | Durable result rows and state log. | PASS if exact result is returned on recovery. |
| P-20 | Direct DB-file tampering. | Modify the database or WAL outside the app. | Detection only; no silent repair or partial success. | integrity check + forensic logs. | PASS if mismatch is detected and a fail-closed response occurs. |

## 10. Stage 36A70O finding-by-finding resolution summary

| Stage 36A70O finding | Resolution status |
|---|---|
| O-01 Driver not runtime-qualified | Resolved by exact runtime pin and qualification gate definition |
| O-02 Single connection not guaranteed by SQLite | Resolved by explicit Main-process invariant and runtime detection |
| O-03 Ambiguous COMMIT recovery missing durable state machine | Resolved by explicit state machine and recovery semantics |
| O-04 Command completeness still design-only | Resolved by explicit per-command invariants and validation fixtures |
| O-05 Commit hook not required and not primary boundary | Resolved by explicit policy: not required, optional only if future qualified |
| O-06 Direct file tampering is not prevented by SQLite or authorizer | Resolved by explicit detection-only threat boundary |

## 11. Implementation prerequisites and explicitly unverified claims

This corrective specification is design-only. The following remain prerequisites and must be qualified before implementation:

- actual packaged Electron runtime version and SQLite build;
- existence and semantics of `node:sqlite` `DatabaseSync.setAuthorizer()` in that runtime;
- actual readback of required PRAGMA values on the live connection;
- absence of a second writable connection in the application code path;
- proof that the authorizer denies the required actions in the real runtime;
- proof that no command path can execute `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, or `RELEASE` outside the coordinator;
- full validation matrix execution on a disposable test database;
- no direct file-tamper prevention claim.

The following are explicitly not proven by this document and must not be asserted as valid runtime claims:

- SQLite guarantees complete business correctness by itself.
- The authorizer is a security boundary against any hostile or compromised Main module.
- Direct file tampering is prevented.
- The selected driver is implementation-ready until the runtime qualification gate is passed.

## 12. Final status

`STAGE_36A70P_SPECIFICATION_READY_FOR_INDEPENDENT_VALIDATION`
