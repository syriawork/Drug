# Stage 36A70N — Corrective Transaction-Integrity Architecture Specification

**Status:** `STAGE_36A70N_SPECIFICATION_READY_FOR_INDEPENDENT_VALIDATION`  
**Scope:** Design and specification only. No SQL or DDL was executed. No
application source, dependency, prior document, database, or production data
was changed. This document is not runtime validation or implementation
readiness.

## 1. Determination and evidence boundary

Stage 36A70M's recommendation is accepted with corrections. The trusted-writer
architecture is the only supported completeness boundary: SQLite has no
general SQL trigger that runs at `COMMIT`, and a connection authorizer cannot
force every module or process to use one connection. SQLite constraints and
triggers are important defense in depth, but transaction completeness across
the whole operation requires a trusted Electron Main-process coordinator to
own the only authoritative connection and the only `COMMIT` path.

The proposed driver is Node's built-in synchronous `node:sqlite` API, as
provided by the project's pinned Electron release. It exposes SQLite's
authorizer API, has no separate native addon dependency, and provides
synchronous statement execution suitable for a coordinator that does not
yield inside a transaction. The Node API is still marked "Active development";
the selected Electron runtime, native SQLite build, authorizer policy, failure
semantics, and shipped artifacts must pass the qualification plan in §11
before implementation can be approved.

This remains a trusted-process design, not protection against a local actor
with filesystem access, arbitrary native code in Main, or an administrator
able to replace the application or database.

## 2. Documents and evidence inspected

Read completely:

- [stage36a70m-independent-design-review.md](./stage36a70m-independent-design-review.md)
- [stage36a70l-transaction-integrity-redesign.md](./stage36a70l-transaction-integrity-redesign.md)
- [stage36a70k-independent-validation-report.md](./stage36a70k-independent-validation-report.md)
- [stage36a70j-corrected-sqlite-ddl-specification.md](./stage36a70j-corrected-sqlite-ddl-specification.md)

The Stage 36A70G standalone report remains unavailable. Findings attributed to
Stage G below are only the retrospective defect descriptions recorded in the
Stage H/I/J/K documents; this specification does not invent Stage G's
original SQL or results. The exact Stage I missing-revision failure and Stage
K foreign-keys-off bypass are reproduced in the Stage I and K reports,
respectively, and summarized in §3.2.

### 2.1 Authoritative driver and engine sources

The following documentation/source references were checked for this design:

1. [Project `package.json`](../package.json) pins `electron` to `44.4.5`;
   it does not declare `better-sqlite3` or `sqlite3`.
2. Electron [`v44.4.5` DEPS](https://raw.githubusercontent.com/electron/electron/v44.4.5/DEPS)
   pins its Node source to `v24.21.0`.
3. Node's versioned [SQLite API documentation for v24.21.0](https://nodejs.org/download/release/v24.21.0/docs/api/sqlite.html)
   documents `DatabaseSync`, `setAuthorizer`, extension controls, defensive
   mode, transaction-state access, and synchronous database operations.
   `setAuthorizer` was added in Node `v24.10.0`; therefore Node `v24.21.0`
   includes that documented API.
4. Node's [`v24.21.0` SQLite C++ binding source](https://github.com/nodejs/node/blob/v24.21.0/src/node_sqlite.cc)
   and [header](https://github.com/nodejs/node/blob/v24.21.0/src/node_sqlite.h)
   show the binding to SQLite's `sqlite3_set_authorizer()` and the native
   connection's encapsulation inside `DatabaseSync`.
5. The [`better-sqlite3` v13.0.3 API documentation](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/docs/api.md)
   and [v13.0.3 source](https://github.com/WiseLibs/better-sqlite3/tree/v13.0.3/src)
   were used to assess its API and native design.
6. The [SQLite authorizer API](https://www.sqlite.org/c3ref/set_authorizer.html),
   [authorizer action codes](https://www.sqlite.org/c3ref/c_alter_table.html),
   [connection configuration API](https://www.sqlite.org/c3ref/c_dbconfig_defensive.html),
   [commit-hook API](https://www.sqlite.org/c3ref/commit_hook.html),
   [foreign-key documentation](https://www.sqlite.org/foreignkeys.html),
   [conflict-resolution documentation](https://www.sqlite.org/lang_conflict.html),
   [transaction documentation](https://www.sqlite.org/lang_transaction.html),
   and [savepoint documentation](https://www.sqlite.org/lang_savepoint.html)
   were consulted.

These are documentary/source findings, not tests of the installed Electron
binary, an actual SQLite database, an authorizer callback, native behavior,
or packaging.

## 3. Stage 36A70M finding-by-finding resolution

| Stage M finding | Corrective resolution in this specification | Remaining condition |
|---|---|---|
| M-01 — No driver selected or evidenced | Select built-in `node:sqlite` / `DatabaseSync` from Node `v24.21.0`, bundled by Electron `44.4.5`. Compare it with `better-sqlite3@13.0.3` in §4. | Runtime must prove that the packaged Electron `process.versions.node` is `24.21.0`, that the required SQLite features/build are present, and that all tests in §11 pass. Node marks this API Active development. |
| M-02 — Authorizer is prepare-time and has no module identity | Define the exact authorizer scope and prohibit shared connection/statement capabilities in §5. | The callback is not a same-process sandbox. Any code obtaining `DatabaseSync` can replace/remove the callback. |
| M-03 — Additional connections bypass connection-local settings | One connection factory, one authoritative connection, one write queue, build-time import restrictions and connection-open instrumentation in §§5–6. | SQLite cannot prevent another trusted-process module or local process from opening the file. |
| M-04 — Commit hook omitted | Do not select or claim a commit hook: Node `node:sqlite` exposes no public commit-hook method. Keep precommit validation and private `COMMIT` ownership as the actual gate; document native hook as unavailable defense in depth. | A future binding change requires requalification; a raw native extension could register/replace hooks but is excluded from the supported design. |
| M-05 — Savepoint policy unspecified | Forbid nested transactions and all savepoints in authoritative command execution. Only the coordinator controls `BEGIN IMMEDIATE`, `COMMIT`, and whole-transaction `ROLLBACK`. | Tests may use savepoints only in isolated test harness cases; they cannot be used to salvage a production command after an error. |
| M-06 — Nonce/idempotency ordering ambiguous | Define ordered protocol and spent-nonce retry branches in §7. | A pending operation whose prior nonce was consumed needs a fresh authorization assertion and fresh nonce to retry a write. |
| M-07 — `REPLACE` and recursive triggers gap | Set/read back `recursive_triggers=ON`; prohibit `REPLACE`, `INSERT OR REPLACE`, all `OR IGNORE/FAIL`, and UPSERT in authoritative statements; permit default `ABORT`, and explicit `ROLLBACK` only for coordinator-owned fail-closed paths (§8). | SQL source lint and authorizer tests are not proof against malicious raw-file writers. |
| M-08 — Tamper detection unspecified | Specify canonical checkpoints, external trust anchor, WAL treatment, verification, and fail-closed forensic response in §10. | Checkpoints detect only changes covered by an independently protected anchor; a same-privilege attacker controlling the anchor can evade detection. |
| M-09 — Signed authorization binding unspecified | Specify canonical signed fields, policy/key checks, nonce binding, retry treatment, and identity-provider dependency in §7. | A database cannot prove real-person identity or signature truth without trusted Main/key services. |
| M-10 — Architecture is not DDL or validation | Label all invariants as requirements, and provide deterministic fixture/test procedures and acceptance evidence in §§9 and 11. | No DDL/runtime test result is claimed here; the precise production schema still requires independent design and runtime qualification. |

## 4. Driver decision and exact version

### 4.1 Selected proposal

**Selected:** Node built-in `node:sqlite`, class `DatabaseSync`, from Node
`v24.21.0`, bundled with the repository's pinned Electron `v44.4.5`.
`node:sqlite` is a runtime module, not an npm dependency. No package is to be
installed or added for this proposal.

The project manifest pins Electron `44.4.5`; Electron's tagged source pins
Node `24.21.0`. Node's versioned documentation says `DatabaseSync` is
synchronous and its authorizer method was added in `v24.10.0`. The binding
source implements the method by calling SQLite's authorizer API. Its public
connection options include foreign-key enablement, defensive mode, timeout,
and extension-loading policy. The public `DatabaseSync` API does **not**
document a commit-hook registration method.

The selected API is therefore a fit for an Electron Main-process design with
private connection ownership and explicit SQL transaction control. It does
not make the authorizer immutable, provide a module capability system, or
expose SQLite's commit hook. Node documents the module as "Active
development." Keep the Electron version pinned; every Electron/Node upgrade
must requalify the API surface, SQLite library version, build options, and
tests before shipping.

### 4.2 Alternative evaluation

| Candidate | Verified strengths | Material gaps for this design | Decision |
|---|---|---|---|
| `better-sqlite3@13.0.3` | Synchronous transactions; documented transaction wrapper and nested savepoint behavior; v13 switched to Node-API, which is intended to improve ABI portability across Node/Electron versions. Active source/release history exists. | Its documented `Database` API exposes no authorizer setter, and its v13 public binding source does not export `sqlite3_set_authorizer()` or a commit-hook API. It exposes extension loading. It would require trusting private typed SQL without the selected SQL-action filter, or maintaining a custom native fork. Node-API compatibility is not proof that this exact release is correctly packaged or works in this exact Electron target. | Not selected. Stronger transaction ergonomics do not compensate for the absent required authorizer control. |
| `node:sqlite` / Node `24.21.0` built into Electron `44.4.5` | Public `setAuthorizer()` wraps the engine authorizer; connection is synchronous; constructor exposes foreign-key, defensive, timeout and extension settings; exact Electron-to-Node pin is visible in tagged source; no separate native addon to ABI-build. | Authorizer is replaceable/removable by any holder of the connection; `exec` and `prepare` permit arbitrary SQL to a holder; module is Active development; no commit-hook API; not yet tested in the packaged app or against the chosen schema. | **Selected proposal**, conditional on all prerequisites in §12. |
| `sqlite3` npm binding | Mature asynchronous binding with broad platform use and direct SQLite API coverage. | Public JS API does not expose a connection authorizer or commit-hook registration; async callbacks increase risk of yielding across coordinator boundaries; exact packaged Electron/native behavior would need qualification. | Not selected; no advantage over the built-in authorizer API for this workload. |

The exact package metadata is evidence only for the current workspace pin.
Before implementation, assert at runtime that `process.versions.electron`
and `process.versions.node` equal the qualified pair; fail closed if not.
Also record `SELECT sqlite_version()` and `PRAGMA compile_options` at
qualification time. The tagged Node version alone does not establish which
SQLite version, compile options, or vendor patches are present in the shipped
Electron binary.

### 4.3 Capabilities versus assumptions

**Documented/source-verified:**

- `DatabaseSync.setAuthorizer(callback)` exists in Node `24.21.0`; `null`
  clears it.
- The authorizer wraps `sqlite3_set_authorizer()`.
- SQLite invokes an authorizer while compiling/preparing SQL, with a possible
  re-prepare during execution after schema change; it is not called for every
  normal statement step.
- SQLite supports action codes for reads/writes, PRAGMAs, transaction
  controls, savepoints, schema operations, functions, and attach/detach.
- `DatabaseSync` runs its calls synchronously, and exposes transaction
  state.
- SQLite's commit-hook API is present in the engine, but no hook-registration
  method appears in the selected Node public binding API.
- SQLite `REPLACE` may delete conflicting rows; delete triggers for that
  operation fire only when recursive triggers are enabled.

**Not established until runtime qualification:**

- The packaged Electron binary has precisely the expected runtime version and
  offers the complete documented Node API.
- The exact SQLite version/build meets the inherited schema's required
  features and security settings.
- Every action code and trigger-origin context behaves as expected through
  the callback in this build.
- The authorizer remains installed over schema reprepare and every statement
  cache path used by application code.
- Native packaging, signing, supported Windows OS versions, crash behavior,
  WAL/FULL behavior, and actual storage durability are correct.
- Main-process import boundaries prevent unsupported connection creation.

## 5. Corrected connection, authorizer, and trust architecture

### 5.1 Ownership and IPC

1. A private Main-process database module is the only module permitted to
   import `node:sqlite`, instantiate `DatabaseSync`, or hold a database path.
2. Only a private transaction coordinator receives the connection capability.
   It does not expose `DatabaseSync`, `StatementSync`, `SQLTagStore`, generic
   `exec`, `prepare`, arbitrary SQL, or callback access to any command service.
3. All other Main modules receive named typed operations or read-model
   functions. Renderer IPC exposes only narrow business requests and safe
   result models; it never exposes SQL, database paths, query strings,
   statement handles, or generic database methods.
4. Enforce the import boundary in architecture tests/lint and inspect the
   packaged dependency graph. Runtime instrumentation in qualification must
   fail on every connection open except the database factory.
5. One authoritative read/write connection serves the application. Do not
   introduce a separate reader connection unless an owner-approved need
   exists; any later reader must be created by the same factory and be
   independently configured, authorizer-guarded, and read-only.
6. Use Electron's single-instance mechanism or an equivalent OS-level
   application lock to prevent ordinary second application instances. This
   reduces accidental multi-writer startup; it does not stop another local
   process opening the database file.

TypeScript privacy, import lint, narrow IPC, and a single-instance lock are
trusted-application architecture, not process isolation from malicious code
already executing in Main.

### 5.2 Connection creation and configuration

On every connection open, before exposing the connection:

1. Verify exact Electron/Node runtime versions, expected canonical database
   path, database UUID/schema version, and file ownership. Never silently
   create or switch to an alternate database after an unexpected open or
   identity failure.
2. Open `DatabaseSync` with foreign keys enabled, defensive mode enabled,
   extension loading disabled, and the specified busy timeout. Do not enable
   `allowExtension`.
3. Set required connection-local settings before installing the authorizer:
   `journal_mode=WAL`, `synchronous=FULL`, `recursive_triggers=ON`,
   `trusted_schema=OFF` if the exact schema/build supports it, and the
   chosen busy timeout. Read each setting back and fail closed on mismatch.
4. Read back `foreign_keys=1`, `recursive_triggers=1`, `journal_mode=wal`,
   `synchronous=2`, defensive mode if available, and the runtime SQLite
   version/compile options. If `trusted_schema=OFF` breaks a required schema
   operation, do not silently turn it off; revise and qualify schema use.
5. Install the fail-closed authorizer before application queries or prepared
   statements are created. No production statement cache or SQL tag store is
   permitted in v1. A coordinator may keep fixed prepared statements only if
   they are private, created under the permanent policy, and never shared.
6. Once installed, no ordinary initialization path changes PRAGMAs, database
   configuration, extension policy, or authorizer. On reopen, repeat every
   check. Any mismatch means the connection does not serve commands.

The Node wrapper configures some settings through native connection options.
SQLite's C `sqlite3_db_config()` calls are not SQL PRAGMA authorizer events.
The selected wrapper does not expose a raw native handle through its
documented JavaScript API; trusted code still can change settings via public
configuration methods or SQL if it has the connection. Therefore the
connection object must stay private, and qualification must inspect all
reachable public methods and test unsupported changes. No claim is made
against native code in Main.

### 5.3 Exact authorizer policy

The callback is an SQL-action filter for **one connection**, evaluated
primarily at statement preparation. It receives SQLite action details and
trigger/view source context; it receives no JavaScript caller identity,
module identity, IPC sender identity, or coordinator capability.

After schema installation and connection initialization, the policy is:

- **DML:** permit only the fixed table/action combinations required by the
  private coordinator and required triggers/views. Deny every unexpected
  action, table, database name, top-level target, and unknown action code.
  Trigger-origin actions are permitted only for the exact known trigger/view
  paths; a broad "all trigger writes allowed" exception is not acceptable.
- **Transaction control:** deny `SQLITE_TRANSACTION` and `SQLITE_SAVEPOINT`
  by default. Permit only fixed `BEGIN IMMEDIATE`, `COMMIT`, or whole
  `ROLLBACK` statements through a private, synchronous coordinator boundary
  that compiles and executes the fixed statement without exposing it.
  The exception cannot be a general flag exposed to command handlers.
  The callback's prepare-time nature means the fixed statement must not be
  retained, cached, or made available outside that private call.
- **PRAGMAs:** after initialization, deny all `SQLITE_PRAGMA` write actions
  and permit only explicitly listed read-only diagnostic pragmas. Deny
  setting changes to `foreign_keys`, `ignore_check_constraints`,
  `recursive_triggers`, `defer_foreign_keys`, `writable_schema`,
  `trusted_schema`, `journal_mode`, `synchronous`, `query_only`, and all
  unknown PRAGMAs. Readback is also performed through a fixed allowlist.
- **Schema:** deny `CREATE`, `ALTER`, `DROP`, `REINDEX`, `ANALYZE`, virtual
  table, trigger, view, index, and temporary-schema actions during ordinary
  runtime. Schema migration is an offline, separately authorized maintenance
  operation, not a command path.
- **Attach/detach:** deny `SQLITE_ATTACH` and `SQLITE_DETACH` unconditionally.
- **Functions/extensions:** allow only required built-in and explicitly
  registered safe functions. Extension loading is disabled in constructor
  options; SQL load-extension calls, any extension API, and unreviewed
  user-defined functions are denied.
- **Non-SQL native methods:** do not expose or call changeset/session APIs
  such as `applyChangeset()` or `createSession()` on the authoritative
  connection. They are not ordinary prepared SQL statements and must not be
  treated as covered merely because an SQL authorizer is installed. Exclude
  them from the coordinator capability and test that no application path
  invokes them. The same restriction applies to any newly added native
  connection method in a future Node version until separately qualified.
- **Reads:** permit only expected database/table/column access, including
  trigger reads needed for invariant checks. Do not expose generic SQL reads
  to IPC or command services.
- **Replacement/removal:** Node's public `setAuthorizer(null)` clears the
  callback, and another `setAuthorizer` call replaces it. SQLite has one
  authorizer per connection. The authorizer cannot prevent its own
  replacement. Encapsulation, narrow module imports, and tests are the
  protection against ordinary application code; compromised Main remains
  outside the assurance.
- **Other connections/native code:** no callback is inherited by a second
  connection. The authorizer cannot prevent direct filesystem access,
  direct native SQLite calls, or changes made by code that holds the
  connection and can remove/replace the callback.

The driver must test these rules through actual calls, not merely inspect the
callback function. No statement may be prepared while an authorization
exception is temporarily active and then passed elsewhere.

## 6. Trusted transaction coordinator

### 6.1 Sole transaction protocol

Every authoritative command type uses the same coordinator entry point and
the same ordered transaction skeleton:

1. Complete authentication, request canonicalization, authorization,
   idempotency resolution, and durable nonce/operation reservation as
   specified in §7.
2. Acquire the coordinator's single-flight lock for the stable operation
   identity. No `await`, callback into other application code, event-loop
   yield, renderer IPC, network request, or user prompt occurs while a SQLite
   business transaction is open.
3. Begin one top-level `BEGIN IMMEDIATE`. If it fails busy/locked, classify
   as transient; preserve identifiers, release no nonce, and apply bounded
   retry rules.
4. Read the current domain state and the operation/commit identity again
   inside this write transaction. Reject stale expected revisions and
   conflicts before effects.
5. Write the applying commit and every required root, revision, projection,
   child, evidence reference, approval assertion, movement, and effect
   manifest row. All business state and finalization must be in this one
   transaction.
6. Run command-specific precommit audits in both directions: required-to-
   actual and actual-to-required. Validate exact keys/cardinality, command,
   commit, aggregate, request hash, manifests, evidence, approval,
   reservations, movements, projections, and derived balances. These checks
   execute on the same connection and transaction snapshot.
7. Perform one finalization transition and any required witness insert.
   Re-read the finalized command and repeat exact-set checks if finalization
   changes state relied upon by a constraint. Finalization state is not
   success.
8. The coordinator alone issues `COMMIT`. Only confirmed successful COMMIT
   establishes durable operation success.
9. After confirmed COMMIT, query by stable commit ID and compare the complete
   immutable command/result set before returning a success response. On
   discrepancy, stop subsequent writes and surface an integrity incident;
   never repair, reverse, delete, or silently resolve.

Every error before COMMIT escapes the command handler. The coordinator checks
`database.isTransaction`; if a transaction remains active it issues whole
`ROLLBACK`, then verifies no operation business rows/effects remain. It must
not catch a child error and continue to finalization or commit.

### 6.2 Savepoint/nesting policy

- Production command handlers cannot own `BEGIN`, `COMMIT`, `ROLLBACK`,
  `SAVEPOINT`, `ROLLBACK TO`, or `RELEASE`.
- Nested transactions and savepoints are forbidden in the production command
  coordinator. No child helper may begin a nested transaction.
- A failed sub-operation fails the entire command. No partial salvage or
  catch-and-continue.
- Authorizer denies all savepoint actions. Test-only savepoints may be used
  in an isolated test connection solely to verify rollback semantics; those
  tests do not represent a production feature.
- SQLite's `RELEASE` of an inner savepoint is not a durable commit. No
  protocol treats it as one.

### 6.3 Conflict algorithms and `REPLACE`

- Ordinary inserts/updates use SQLite's default `ABORT` on constraint error.
  The coordinator then rolls back the complete transaction.
- `RAISE(ROLLBACK,...)` may be used in a schema invariant trigger where the
  whole transaction must abort; caller verifies transaction state.
- Prohibit `INSERT OR REPLACE`, `REPLACE INTO`, `UPDATE OR REPLACE`, every
  `OR IGNORE`, `OR FAIL`, `OR ROLLBACK` conflict modifier in generated
  business SQL, and all `ON CONFLICT DO NOTHING/DO UPDATE` UPSERT syntax.
  No `REPLACE` or UPSERT is needed for journal insertion or idempotency.
- Keep `recursive_triggers=ON` and verify on every connection to close the
  documented REPLACE delete-trigger caveat as defense in depth. This is not
  permission to use REPLACE.
- On identity/nonce/command uniqueness conflict, select and compare the
  existing immutable row; return the exact committed result only where the
  idempotency rules permit. Never overwrite the winner.

### 6.4 Commit hook

The SQLite engine offers `sqlite3_commit_hook()`, which can veto an imminent
commit by returning nonzero. Its callback cannot execute SQL on the same
connection, and subsequent hook registration replaces or disables it. The
selected Node `node:sqlite` public API exposes no commit-hook method and does
not provide the needed callback lifecycle. Therefore **no commit hook is
selected and no commit-hook guarantee is claimed**. Do not reach into Node
internals or add an unreviewed native shim for this stage. The coordinator's
precommit validator and sole COMMIT capability remain the only supported
completeness gate. If a future driver exposes a hook, it can only be
considered supplemental and must be re-reviewed/tested.

## 7. Authentication, nonce, and idempotency state machine

### 7.1 Stable signed operation envelope

Before any durable write, Main constructs a closed, canonical operation
envelope and request hash. The signed authorization assertion binds, at
minimum:

- authenticated actor's immutable principal ID;
- action/command type and canonical resource ID/type;
- operation ID, command ID, and commit ID;
- canonical request hash and canonicalization/schema version;
- nonce value/ID and audience/application ID;
- policy version and role/permission snapshot or verifiable policy reference;
- issuance and expiry timestamps; key ID and signing algorithm.

Main verifies signature bytes, allowed algorithm, key registration/status at
the relevant policy check, assertion format and binding, current actor
permissions, and application audience. It rejects altered, stale, cross-
actor, cross-resource, cross-command, cross-commit, and cross-payload
assertions. Distinct actor strings alone do not prove distinct people; the
trusted identity provider must establish principal identity and independence.

For version 1, `operation_id`, `command_id`, and `commit_id` are stable,
one-to-one immutable identifiers for a logical operation. They may be
different opaque values but their mapping is recorded once and never changed.
An exact retry reuses all three identifiers and the exact canonical payload.
There is no "mint a fresh commit ID" retry shortcut.

### 7.2 Deterministic order

1. **Authenticate actor.** Main authenticates the current caller/session and
   obtains an immutable principal ID. Renderer-supplied actor IDs are not
   trusted.
2. **Canonicalize and hash the request.** Validate the closed input schema,
   normalize it deterministically, compute the request hash and derive the
   expected command/resource binding. Reject malformed/ambiguous inputs
   before database writes.
3. **Verify the signed assertion.** Verify signature, signing algorithm,
   issuer/audience and key state using the trusted authorization service/key
   policy.
4. **Check expiry and full binding.** Verify the signed actor, action,
   resource, operation/command/commit IDs, request hash, policy version,
   issued-at and expiry values against the authenticated request. Classify
   the assertion as currently valid or expired. Expiry is never ignored for
   a new write.
5. **Validate nonce.** Verify nonce syntax, issuer, signed binding, audience,
   and whether it is unspent or already durably associated with this exact
   operation/hash. A spent nonce associated with a different operation is an
   immediate replay rejection. A spent nonce associated with the same
   operation is eligible only for read-only outcome resolution; it cannot
   authorize another mutation attempt.
6. **Resolve existing commit/operation IDs read-only.** Query the stable
   operation, command, and commit IDs before any nonce or business write.
   For an exact, complete committed match, return the original result, subject
   to current read authorization for sensitive result data. For an expired
   assertion, this is the only allowed path: exact committed-result lookup;
   no mutation, nonce reservation, or new work. If no committed result exists,
   an expired assertion is rejected and must be renewed.
7. **Detect payload or identity conflicts.** If any existing operation,
   command, or commit ID maps to a different actor, command type, resource,
   canonical request/hash, expected revision, or ID mapping, fail closed with
   an explicit conflict. Do not update the existing row. A contradictory,
   partial, or malformed record is an integrity incident requiring
   adjudication, not a successful retry.
8. **Reserve nonce and operation identity durably.** For a new operation, or
   an uncommitted exact operation retry with a fresh assertion, use a short
   coordinator-owned reservation transaction. Re-read all operation,
   command, commit and nonce keys under this transaction's write lock; repeat
   the identity/hash comparisons from steps 6–7 to close the race between
   read-only lookup and reservation. Insert immutable operation
   identity/hash mapping, nonce use, and signed authorization-attempt record
   atomically. Unique nonce and identity constraints reject reuse. If the
   operation mapping already exists and exactly matches, append a new
   authorization attempt with a fresh nonce; do not replace the operation
   identity or erase prior nonce history. This durable reservation is not a
   business success.
9. **Execute the command.** Run the business transaction in §6 with the same
   operation/command/commit IDs and request hash. No alternate writer path.
10. **Finalize and validate.** Verify all command invariants in §8 and all
    cross-table/effect bindings before the coordinator's finalization
    transition.
11. **Commit atomically and return.** Coordinator issues `COMMIT`; only
    confirmed success can create a success response. Read back and compare
    the full result, then return it.

The durable reservation transaction intentionally commits nonce consumption
and operation identity separately from business effects. Thus a failed or
interrupted business attempt does not make a nonce available again. No
business effect may be written in that reservation transaction.

### 7.3 Required retry/concurrency behavior

| Situation | Required behavior |
|---|---|
| Retry after confirmed COMMIT | Same operation/command/commit IDs and same hash. Read-only compare the entire committed result, then return it; never consume the nonce again or execute effects. |
| Retry after ambiguous COMMIT result | Reopen through the guarded factory and resolve the same IDs read-only. If exact complete commit exists, return it. If no commit exists and recovery confirms the old transaction is closed/rolled back, require current valid authorization and a fresh unused nonce, then retry with same stable IDs/hash. If state is partial/contradictory or still ambiguous, stop and adjudicate. |
| Same commit ID, different payload or identity | Hard conflict; no update, replacement, reversal, or new commit under that ID. |
| Same nonce, different operation | Reject as replay before mutation. Preserve original nonce association. |
| Same nonce, exact operation after commit | Permit only read-only exact result lookup; no second authorization or mutation. |
| Same nonce, exact operation but no commit | Reject a new write. Require fresh authorization and a fresh nonce tied to the same stable operation identity and exact payload. |
| Expired assertion on exact committed retry | Verify signature/binding and caller authentication, then allow only a read-only exact result/status lookup. Apply current read authorization before returning sensitive details. |
| Expired assertion with no committed result | Reject; obtain fresh signed authorization/nonce; retain stable operation/command/commit IDs and request hash. |
| Concurrent exact duplicates in one Main process | Per-operation single-flight queue: one submission reserves and executes; waiters resolve the committed result after winner completes. No second business transaction. |
| Concurrent conflicting payloads for same IDs | First operation identity reservation wins; second is rejected by exact comparison. No silent conflict resolution. |
| Process crash before nonce/operation reservation commit | Reservation transaction is absent; the assertion/nonce can be retried subject to expiry and policy. |
| Crash after reservation commit but before business `BEGIN` | Operation remains pending and nonce remains consumed. A fresh authorization and nonce may retry exact same operation identity/hash. |
| Crash during business writes or before `COMMIT` | SQLite recovery must leave business transaction wholly absent. Pending operation reservation/consumed nonce remain. Reconcile by stable IDs; fresh auth/nonce required for a new write attempt. |
| Crash after successful `COMMIT`, before response | Same-ID read-only reconciliation returns exact committed winner. It does not replay the nonce or effects. |

`SQLITE_BUSY`/`SQLITE_LOCKED` is transient, not a definitive business
rejection. Bounded retries preserve all stable operation IDs and payload hash.
No retry path changes the commit ID or silently reverses a winner.

## 8. Command completeness and database defenses

The schema design inherited from Stages H/J must be revised/implemented only
after a separate DDL review. Requirements below are not claims that the
Stage J DDL has been corrected or validated.

### 8.1 Shared SQLite constraints and triggers

Subject to an intact schema and configured connection, require:

- `STRICT` tables, exact `NOT NULL`, `CHECK`, primary/unique keys, and
  canonical IDs/hashes/quantities; safe-integer and nonnegative balance rules.
- Composite foreign keys binding command, commit, command type, aggregate,
  request hash, effect, evidence, approval, movement, identity origin, and
  line/reservation ownership.
- Applying-only inserts; one-way finalization; append-only journal/evidence/
  approval/manifest/revision/movement records. Only documented nonce state
  transitions and operation state transitions are mutable, and those must be
  monotonic and audited.
- Row triggers validating legal order revisions/projections and movement
  arithmetic, before/after snapshots, quantity, ownership, and balance.
- Exact two-way effect-manifest ↔ effect-row equality and per-command allowed
  effect-kind sets. Validate no missing or extra manifest targets and bind
  each target to the exact command, commit, aggregate and request hash.
- Unique idempotency keys and immutable mappings for operation ID, command
  ID, commit ID, and nonce value; no replacement/upsert semantics.
- A durable operation-identity record (for example
  `operation_requests`) binds operation ID, command ID, commit ID, actor,
  command/resource, canonical request hash and canonicalization version.
  Its initial reservation is committed atomically with nonce use. The
  business transaction may transition its state only from `reserved` to
  `committed`; the latter update is in the same transaction as the business
  effects. No transition makes a failed/incomplete attempt look successful.
  Retry authorization attempts are separate append-only records with fresh
  nonce values and the same exact operation binding.
- Command-specific finalization-transition triggers as redundant checks, not
  commit triggers. The trusted coordinator repeats all checks before
  `COMMIT`.
- Deferred foreign keys only as extra defense with foreign keys enabled.
  They are not a replacement for coordinator validation.

SQLite cannot establish that a hash is correctly derived from canonical
request bytes, that evidence is genuine, that an approval is signed by a real
independent human, or that a catalog item is valid. Those are trusted
application/provider invariants.

### 8.2 Per-command atomic result

| Command | Complete state required before COMMIT |
|---|---|
| `order.create` | One new order root and exactly one revision 1 `pending`, bound to the exact create command/commit/request hash; projection exactly `(1,pending)`. At least one line. Each line maps one-to-one to one reservation and one `reserve` movement with exact order/line/identity/quantity. Movement arithmetic/snapshot and derived balance reconcile. Manifest has exactly root, revision 1, lines, reservations, and reserve movements; no missing/extra effect. |
| `order.accept` | Existing pending revision 1 advances only to revision 2 `accepted`, exact command/commit/hash and projection `(2,accepted)`. It requires an authorized administrative decision. Zero inventory movement and no other inventory effect; exact revision-only manifest. |
| `order.fulfill` | Existing accepted revision 2 advances only to revision 3 `fulfilled`, exact command/commit/hash and projection `(3,fulfilled)`. Every reservation is consumed exactly once by one fulfillment movement with identical reservation/identity/quantity. No omitted, duplicated, substituted, or extra movement; balances reconcile; exact manifest. |
| `inventory.bootstrap` | One batch root/revision 1 active. Identity set equals batch-line identity set in both directions. Each line has one complete identity, itemized count/allocation, two verified count evidence records from distinct principals, an independent approval, and one exact movement from zero. No extra identity, line, evidence, approval or movement; exact effect manifest. |
| `inventory.receipt` | One receipt root/revision 1 received. At least one line. Each line binds source evidence/provenance, receiver, distinct second approver, verified evidence, and one exact positive receipt movement. Receipt may create a new canonical inventory identity inside this same transaction; every identity created by the commit maps to exactly one receipt line, and no unrelated identity is created. Exact manifest and balances. |

Order lifecycle remains `pending → accepted → fulfilled`. Acceptance moves no
inventory; fulfillment consumes the exact reservation. Receipt-created
identity remains permitted. No automatic journal deletion, reversal, silent
conflict resolution, permission inheritance, or other command type is added.

## 9. Threat model and guarantee classification

### 9.1 Threat dispositions

| Threat | Control | Residual risk / disposition |
|---|---|---|
| Renderer attempts unauthorized DB access | Main-only connection; narrow typed IPC; sender/payload validation; no database path, SQL or handle crosses IPC. | Prevents the supported renderer route. A compromised Main/preload or local filesystem principal is not defeated by the authorizer. |
| Other application module attempts direct writes | Private connection ownership; import boundary; static architecture test; no public executor/statement; authorizer filters SQL. | Prevents accidental/ordinary module access if boundaries hold. Same-process malicious code can bypass architectural restrictions if it obtains/imports driver or object. |
| Second connection opened by application | Exactly one factory/connection; runtime open instrumentation; main single-instance lock; every approved connection independently configured. | SQLite cannot enforce "one connection per process." A module bypassing the factory, or another process, can open its own connection. |
| Authorizer removed/replaced | Connection object private; import restrictions; no method exposing it; runtime integrity tests. | `DatabaseSync.setAuthorizer(null)` or replacement works for a holder. Not protected against compromised Main/native code. |
| Local process with DB file access | Private app-data directory, least-privilege ACLs, protected backups/WAL/SHM, external checkpoints. | Same-user/administrator file modification is not prevented. Checkpoints detect only if trust anchor remains separate and secure. |
| Administrator/attacker alters database file/schema | Startup schema/hash/ledger checks and external signed checkpoints; read-only fail-closed response and forensic preservation. | No SQLite authorizer/coordinator prevention. A privileged attacker controlling both data and verification key/anchor may evade detection. |

### 9.2 Guarantee classes

Each claim is classified as one of the five required classes; none are
interchangeable.

| Guarantee | Class | Exact scope |
|---|---|---|
| Row types, `CHECK`, unique keys, trigger checks, and transaction atomicity for writes on a connection | **1. SQLite engine enforced** | Only if schema is intact, required constraints/triggers enabled, and connection actually commits/rolls back as specified. |
| Foreign-key enforcement, recursive-trigger setting, WAL/synchronous mode, busy timeout, defensive mode, and installed authorizer | **2. Driver/connection enforced** | Initialized/read back per connection by the private factory; SQLite does not inherit these settings to other connections. |
| One connection owner, narrow IPC, signed-assertion verification, nonce/idempotency order, command completeness audits, sole `COMMIT`, exact retry and result comparison | **3. Trusted Main-process enforced** | True only for the supported application path and uncompromised Main process. |
| OS ACLs, secure installation/update, protected backups/sidecars, external checkpoint cadence/key custody, single-instance lock, storage flush semantics | **4. Operationally assumed** | Must be configured and independently audited for supported deployments. |
| Preventing direct file/sidecar edits by same-user/admin; authenticating an honest physical count from SQLite alone; proving distinct humans from distinct strings; automatic true `COMMIT` completeness through DDL alone | **5. Not preventable within the proposed threat model** | Excluded or dependent on an external trusted identity/integrity mechanism; do not state as SQLite guarantees. |

## 10. Auditability, checkpointing, and forensic recovery

SQLite's `integrity_check` detects structural corruption, not every malicious
but structurally valid edit. `foreign_key_check` only reports FK consistency
when run and cannot prove a missing business effect in a schema that permits
it. Both are diagnostics, not the integrity boundary.

If tamper detection is enabled operationally:

1. Define a canonical ordered serialization of database UUID, schema
   fingerprint, highest committed sequence/commit ID, command IDs/hashes,
   complete effect manifests, immutable journal rows, and prior checkpoint
   digest. Exclude volatile page bytes; the logical WAL-visible database view
   is authoritative.
2. Sign each checkpoint with a key not stored in the database or beside its
   writable files. Store checkpoint sequence/digest in an independently
   controlled append-only anchor (for example a separately administered
   remote append-only audit service). A sibling file in the same writable
   directory is not an independent trust anchor.
3. Define cadence and acknowledge its exposure: periodic checkpoints can
   only detect tampering in covered committed history; a database tail newer
   than the last checkpoint is not yet externally anchored.
4. At startup/recovery, open through the guarded factory, verify schema and
   database identity, run integrity/FK diagnostics and command/ledger audits,
   compare the logical checkpoint chain to the external anchor, and prevent
   authoritative writes on any mismatch.
5. Preserve the original DB, WAL, SHM, checkpoint metadata and logs
   read-only for forensic review; record application/runtime versions and
   exact error. Do not auto-repair, delete journal rows, reverse a command, or
   resolve conflicting records silently.
6. If attacker privileges include the external anchor or signing key, the
   corresponding detection guarantee no longer applies. Report that boundary
   honestly.

This is a threat-boundary and operations requirement, not a claim that such
an external service or key store already exists in the project.

## 11. Independent adversarial validation plan

This is a future plan, not an executed suite. A report must record exact
runtime/SQLite versions, Electron package, schema identity, test input,
expected and actual rows/errors, transaction state, and database checks.
`PASS` requires the specified behavior and evidence; test omissions are
`NOT EXECUTED`, never inferred passes. Raw file/second-connection cases that
demonstrate the threat limit must not be presented as protections.

### 11.1 Deterministic test fixtures

Use temporary file-backed databases only, one clean installation per
independent case. Fix clock to `2026-11-12T10:00:00.000Z`, canonicalization
version `1`, test policy version `test-v1`, and test signing key ID `k-test`.
Generate a deterministic test-only signing keypair and stable signatures
inside the harness; do not use production credentials. Fixed actors:
`buyer`, `admin-acceptor`, `fulfiller`, `receiver`, `counter-a`, `counter-b`,
`approver`, `verifier`. The identity provider fixture maps each actor string
to a distinct immutable principal; separate negative cases deliberately map
two actor strings to the same principal.

Use the Stage J §7.2 exact bootstrap and order-create positive fixture as the
base fixture F0 without changing its values:

- Bootstrap: command `bc`, commit `bm`, batch `b`, identity `i` (`med-a`,
  `each`, `tracked`, `lot-a`, expiry `none`), line `bl`, evidence `e1/e2`,
  movement `m`, revision `br`; counted/on-hand quantity 10, available 10,
  reserved 0.
- Order create: command `oc`, commit `ocm`, order `o`, line `ol`,
  reservation `or1`, movement `orm`, revision `orv1`, quantity 3. Expected
  post-create balance for `i`: `(available=7,reserved=3,on_hand=10)`.
- Acceptance: command `oa`, commit `oam`, revision `orv2`; no movement.
- Fulfillment: command `of`, commit `ofm`, movement `ofm1`, revision
  `orv3`; consumes `or1` quantity 3. Expected final balance `(7,0,7)`.
- Receipt-created identity fixture: command `rc`, commit `rcm`, receipt `r`,
  new identity `ri` (`med-b`, `each`, `tracked`, `new-lot`, expiry
  `2027-01-31`), line `rl`, evidence `re`, movement `rm`, revision `rr`,
  quantity 4, receiver `receiver`, approver `approver`. Expected balance
  `(4,0,4)`.

For competition/shortage tests, prepare identity `i2` only through a valid
receipt command based on the fully specified Stage J receipt fixture with
these fixed substitutions: `rc/r...` IDs become `r2c`, `r2cm`, `r2`,
`i2`, `r2l`, `r2e`, `r2m`, `r2r`; quantity 5; identity
(`med-c`,`each`,`tracked`,`lot-c`, expiry `none`); receiver `receiver`,
approver `approver`; nonce values are unique `r2-*` values; effect keys are
the Stage J fixture's `51`–`55` values via `printf('%064x',n)`. Its resulting
balance is `(5,0,5)`. This is a real receipt fixture, not direct identity or
balance insertion.

For each invalid command variant, clone the appropriate already committed
baseline into a new disposable DB, alter exactly the one named operation,
and record all command/commit/manifest/revision/evidence/approval/movement
rows and derived balances before and after. Use the fixed request hashes and
effect-key construction in the Stage J fixture; cryptographic tests use
deterministic ephemeral keys and do not claim production identity assurance.

### 11.2 Connection and authorizer cases

| ID | Exact fixture/procedure | Expected result | Required evidence |
|---|---|---|---|
| N01 | Start packaged Electron `44.4.5`; record `process.versions.electron`, `.node`, `SELECT sqlite_version()`, compile options and all configured connection readbacks. | Runtime `44.4.5`/`24.21.0`; supported SQLite feature set; `foreign_keys=1`, WAL, synchronous FULL, recursive triggers on, extension loading disabled, expected timeout/defensive mode. Any mismatch is startup failure. | Version/readback output and startup failure capture if mismatch. |
| N02 | Open an attempted second connection through any app module other than the private factory; instrument every `DatabaseSync` constructor and module import. | Static/build rule rejects bypass; runtime instrumentation reports no unauthorized open. A raw test-created connection is explicitly marked out of threat boundary. | Import-boundary report and complete connection-open trace. |
| N03 | On guarded connection attempt `PRAGMA foreign_keys=OFF`, `ignore_check_constraints=ON`, `writable_schema=ON`, `recursive_triggers=OFF`, and `journal_mode=DELETE`. | Authorizer denies each write; readbacks unchanged; no schema/data changes. | Exact SQL, callback action/args, errors, readbacks. |
| N04 | Attempt SQL `BEGIN`, `COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT s`, `ROLLBACK TO s`, `RELEASE s` from a command-service test capability. | Denied; transaction state unchanged. Coordinator's fixed boundary operations still work only in the coordinator test. | Exact action codes and transaction-state queries. |
| N05 | Through a non-coordinator test capability, execute in separate attempts: `CREATE TABLE attacker(x)`, `DROP TRIGGER commit_command_completeness`, `ALTER TABLE orders ADD COLUMN attacker TEXT`, `CREATE TRIGGER attacker AFTER INSERT ON orders BEGIN SELECT 1; END`, `DROP INDEX` for a known index, `CREATE TEMP TABLE attacker(x)`, `ATTACH DATABASE ':memory:' AS aux`, `DETACH DATABASE aux`, and `VACUUM`. | Every action denied; schema fingerprint and attached-database list unchanged. Offline migration is not part of this test. | Exact statement/error for each, authorizer callback arguments, schema fingerprint and `PRAGMA database_list` before/after. |
| N06 | Attempt `loadExtension()` and SQL load-extension function while database was opened with extension loading disabled. | API/action denied. No native library load. | API error and OS/module-load trace. |
| N07 | Prepare a fixed statement, induce schema change through an isolated maintenance connection, then execute/reprepare under the guard. Attempt to retain a transaction statement prepared under coordinator privilege and invoke it elsewhere. | No statement escapes; reprepare remains denied under permanent policy; transaction statement cannot be reused outside coordinator. | Authorizer callback log for prepare/reprepare and object-ownership trace. |
| N08 | Through a *test-only raw reference* call `setAuthorizer(null)` and then install a permissive callback. | Demonstrates that a holder can remove/replace it; production module-boundary test proves no application service obtains the reference. Do not claim callback prevents its own removal. | Raw test result plus static/runtime encapsulation evidence. |
| N09 | On a second raw SQLite connection, set `foreign_keys=OFF` and issue an incomplete order-create transaction without revision 1/finalization, then commit. | Expected to reproduce the Stage K bypass on that unguarded connection. This is a threat-boundary failure demonstration, not an app-path pass; production controls prove no second writer is exposed. | Second-connection pragmas, exact SQL, commit result, order/revision/reservation/balance rows. |
| N10 | Verify commit-hook capability by enumerating selected driver public API and attempting any documented hook API; inspect binding source surface. | Report `NOT AVAILABLE` for selected driver; no commit-hook claim or substitute implementation. | API/source inventory with Node version and no-hook conclusion. |
| N11 | Submit all five business commands through IPC with generic SQL, database path, connection-like object, unknown fields, wrong sender, or unsupported command type. | Narrow IPC rejects all; no DB state changes and no path/handle returned. | IPC request/response and before/after state. |

### 11.3 Transaction, conflict, idempotency, and recovery cases

| ID | Exact fixture/procedure | Expected result | Required evidence |
|---|---|---|---|
| N12 | Run F0 `order.create`; inject a deterministic exception after each ordered write stage (root, line, reservation, movement, revision, manifest, finalization) before COMMIT. | Whole business transaction absent; bootstrap remains; balance `i=(10,0,10)`. Durable operation reservation/nonce may remain by design. | Fault point, `isTransaction` before/after rollback, all affected rows and balances. |
| N13 | Order-create fault deliberately omits revision 1, omits its manifest, misbinds revision command/commit/hash, sets projection incorrectly, omits/adds line effects, or inserts extra effect; run final validation. | Coordinator refuses COMMIT and whole business transaction rolls back. | For each subcase: exact injected mismatch, validation query output, no `ocm` business rows, baseline balance. |
| N14 | Inject `RAISE(ROLLBACK)` after multiple successful writes; repeat while a test-only nested savepoint and sentinel are present. | Complete transaction (including sentinel and savepoint work) is rolled back; coordinator observes no active transaction and does not commit. Savepoints remain forbidden in production. | SQLite error, transaction state, all rows before/after. |
| N15 | Attempt default constraint `ABORT` during middle of a multi-write business transaction; attempt caller catch-and-continue. | Command service propagates error; coordinator rolls back entire transaction, not merely failed statement. | Error and transaction state; no business rows or balance delta. |
| N16 | Execute direct `INSERT OR REPLACE`, `REPLACE INTO`, `UPDATE OR REPLACE`, `INSERT OR IGNORE`, `OR FAIL`, and UPSERT against each immutable key family. | SQL policy/static checks reject statements before release; in isolated schema test, recursive trigger behavior is also recorded. No immutable row is deleted/replaced or silently skipped. | Source scan/build result, authorizer log, row IDs/counts before/after. |
| N17 | Complete F0, then attempt post-commit UPDATE/DELETE of order root, revision, line, reservation, movement, evidence, verification, approval, manifest, identity, commit, and command; attempt late inserts under finalized commit. | DML denied or DB guards reject; all immutable rows remain byte/logically identical. | Table-by-table mutation result and canonical row digest before/after. |
| N18 | Retry exact `ocm` after confirmed successful commit using same IDs/hash and already-consumed nonce. | Read-only full comparison returns first result; no second effect, nonce insertion, movement, or revision. | Queries for exact commit/result/effect set and unchanged row counts. |
| N19 | Retry same `commit_id` with different request hash, resource, command type, actor, expected revision, or operation mapping. | Explicit conflict; winner unchanged. | Conflict classification and before/after winner digest. |
| N20 | Reuse nonce under a different operation/command/commit; reuse nonce value under a different nonce ID; try same spent nonce on uncommitted exact operation. | Reject all new writes. Same-operation/committed request may only take exact read-only result path. | Nonce association table and no new business rows. |
| N21 | Expire assertion then retry already committed exact operation; retry a pending/no-commit operation with same expired assertion; retry after new valid assertion/fresh nonce. | Exact committed lookup is read-only and allowed subject to current read permission; pending write with expired assertion is rejected; fresh authorization/fresh nonce may retry same stable IDs/hash. | Assertion fields/clock, lookup query, nonce history, result and write counts. |
| N22 | Two in-process submissions with same IDs/hash concurrently; then two submissions with same IDs but conflicting hashes. | Single-flight winner commits once; exact waiter reads winner; conflicting submission fails. | Coordinator queue trace, unique rows, one manifest/effect set. |
| N23 | From F0, submit two valid order-create operations for `i`, each requesting quantity 6 (combined 12 > available 10); then repeat from a valid `i2` receipt baseline with two requests of quantity 3 (combined 6 > available 5). Submit through separate normal API callers to the one coordinator connection. | Exactly one 6-unit request succeeds for `i`, the other is a shortage; `i` ends `(4,6,10)`. Exactly one 3-unit request succeeds for `i2`, the other is a shortage; `i2` ends `(2,3,5)`. No negative balance or partial loser effects. Busy/locked is transient. | Request IDs/hashes, coordinator order, commit outcomes, exact reservations/movements, before/after balances. |
| N24 | Crash process before nonce reservation, after nonce reservation, during each business write, immediately before COMMIT, immediately after COMMIT but before response. Reopen through factory. | Before business COMMIT: no partial business effects; durable nonce/operation reservations remain only if their reservation transaction committed. After COMMIT: exact complete result. | Fault point, WAL/DB recovery, all related rows, integrity/FK checks and nonce state. |
| N25 | Force a COMMIT response ambiguity after it reaches SQLite. Reconnect and query exact operation/command/commit IDs. | Exact committed winner returns after complete comparison. If absent after recovery, retry requires fresh valid assertion/nonce and same stable IDs/hash. Partial/contradictory state stops for adjudication. | Fault instrumentation, SQLite transaction state, exact result anti-joins, retry IDs/nonces. |
| N26 | Same-ID duplicate from two test processes/SQLite connections with identical payload; repeat with conflict payload. | Unique operation/commit mappings and SQLite writer serialization preserve one winner; exact duplicates read it; conflict never overwrites. Concurrent second app startup is blocked by single-instance control where applicable. | Process lock, connection instrumentation, both results, all commit/effect rows. |
| N27 | Close connection with active transaction, reopen same file, and run diagnostics. | Uncommitted business writes absent; prior commits intact; required connection settings reinitialized; no automatic recovery mutation. | `foreign_key_check`, `integrity_check`, transaction/effect queries and pragma readbacks. |

### 11.4 All command types and prior-defect regressions

| ID | Exact fixture/procedure | Expected result | Required evidence |
|---|---|---|---|
| N28 | F0 positive `order.create` with exact revision 1, projection, reservation/movement bijection, manifest and balance. | One pending revision 1; balance `(7,3,10)`. | Complete rows by command/commit; anti-joins empty; movement ledger. |
| N29 | F0 positive `order.accept`, then omit/misbind revision 2 or add an inventory movement/effect. | Valid acceptance creates revision 2 and zero movement. Every invalid variant rolls back and preserves pending order/reservation. | Revision/projection state, movement count exactly zero, rollback state. |
| N30 | Positive fulfillment after valid acceptance; variants omit, duplicate, substitute identity, reservation or quantity, or add movement. | Exactly one movement per exact reservation; valid result revision 3, balance `(7,0,7)`; invalid variants preserve accepted order and `(7,3,10)`. | Reservation↔movement anti-joins, revisions, balances and manifest. |
| N31 | Positive bootstrap F0; variants omit a batch line, either count evidence, verification, independent approval, movement, revision or manifest; add an unitemized identity/line/movement; use mismatched origin/count allocation. | Valid identity-line bijection and exact opening balance; invalid cases cannot commit or leave positive balance/partial identity. | Two-way set differences, evidence/approval actors, movement snapshots, identity origins. |
| N32 | Positive receipt-created identity `ri` using §11.1 fixture; variants omit evidence/verification/approval/line/movement/revision/manifest, add extra identity, conflict identity tuple, or bind wrong command/commit/effect. | Valid identity, evidence, approval, movement, revision, manifest commit atomically; each invalid variant leaves no partial receipt-created identity/effect. | Full receipt child rows and origin mapping; exact anti-joins and balance `(4,0,4)`. |
| N33 | Cross-bind receipt root, revision, evidence, movement, approval, command, commit, resource ID, effect key and manifest target one field at a time; then try post-commit root rebinding and late effect append. | Each mismatch rejected or coordinator rollback; immutable winner unchanged. | Exact SQL/API mutation, error, row digests and manifest/effect bijection. |
| N34 | Try empty/malformed `medicine_id`, unit, tracking state, lot, expiry, quantity/hash; try syntactically valid but nonexistent catalog item. | SQLite rejects malformed values; Main rejects unknown/disabled catalog items. | Exact constraints/errors and Main catalog decision; don't claim SQLite verifies catalog truth. |
| N35 | Verify acceptance has no inventory movement and fulfillment consumes exact reservation; attempt acceptance movement and fulfillment extra/missing movement. | Acceptance inventory-neutral; fulfillment exact reservation; invalid transition rolls back. | Movement sets per commit, status/revision chain and balances. |
| N36 | In separate F0-derived databases, attempt UPDATE and DELETE by known primary key, then a late insert under a finalized commit, for each applicable family: `commands`, `commit_records`, `commit_finalizations`, `operation_requests`, authorization-attempt records, `effect_manifest`, `orders`, `order_revisions`, `order_lines`, `reservations`, `inventory_batches`, `inventory_batch_revisions`, `inventory_batch_lines`, `inventory_identity`, `inventory_receipts`, `inventory_receipt_revisions`, `inventory_receipt_lines`, `inventory_movements`, `evidence_records`, `evidence_verifications`, `authorization_assertions`, `authority_keys`, key-history/event records, and `nonce_records`. For `nonce_records` and `operation_requests`, test only documented monotonic state transitions in addition to prohibited rewrites. | No journal/evidence/manifest/revision/movement deletion or mutation; only exact documented monotonic states may advance; no automatic deletion/reversal. | Schema inventory, primary key and statement for every table, operation outcome, transaction state, canonical row digests before/after. |
| N37 | Test two actor IDs mapping to one identity-provider principal for bootstrap counters, receipt receiver/approver, and independent approval. | Main rejects same real principal even if string IDs differ; valid distinct principals pass. | Identity-provider fixture mapping and authorization result; SQL actor inequality is not considered proof. |
| N38 | Stage 36A70G receipt root command/commit/effect divergence and post-finalization manifest/effect append regressions. | All immutable binding and late append attempts rejected on supported connection; raw-file tampering separately remains out of scope. | Record exact reconstructed variant source from Stage H/I/K only; mark unavailable original Stage G script. |
| N39 | Stage 36A70G bootstrap extra unitemized identity, empty medicine ID, and receipt-created identity regressions. | Extra identity/malformed ID rejected; approved atomic receipt-created identity succeeds with all evidence/approval/movement/effect children. | Exact schema/Main error or committed complete child rows, with original G report availability limitation. |
| N40 | Stage 36A70I critical `order.create` missing revision 1 while reservation and reserve movement are present; run through supported coordinator and separately raw second connection with FK disabled. | Supported coordinator refuses and rolls back. Raw second connection may reproduce K bypass, demonstrating exclusion; report as threat boundary, not a failed coordinator test. | Supported-path exact state and raw path exact state; no false claim that DDL blocks the raw path. |
| N41 | Stage 36A70K no-finalization, incomplete-finalization, `RAISE(ROLLBACK)` after multiple writes, and FK-off bypass procedures. | No supported-path partial business commit; exact trigger error rolls back whole txn; raw FK-off case remains possible outside trusted connection. | Compare with exact Stage K report procedure and outputs; distinguish report evidence from new test execution. |
| N42 | Stage M direct transaction control, authorizer removal/replacement, second connection, statement reprepare/cache, `REPLACE`, commit-hook, nonce retry, crash recovery and threat classes. | Outcomes match §§5–7 and N02–N27; no unqualified "prevented" claim. | Callback/action logs, driver API inventory, all result states, `NOT EXECUTED` reasons. |
| N43 | External checkpoint tamper cases: mutate a logical row, alter/drop trigger/schema, truncate WAL, restore stale backup, alter checkpoint, and compromise test trust anchor. | Protected anchor detects covered mismatch and app fails read-only; same-trust-anchor compromise may evade detection and is recorded as limitation. No auto-repair. | Signed checkpoint sequence, DB/WAL logical view, anchor verification, fail-closed mode and preserved forensic copies. |
| N44 | On every valid/invalid database run `foreign_key_check`, `integrity_check`, complete command-scoped manifest/effect anti-joins, revision/projection checks, and movement/balance reconciliation. | Valid paths have no discrepancies; invalid commands leave unchanged baseline or are explicitly classified as out-of-boundary raw writer demonstrations. | Exact queries/results and test-specific assertions. Clean PRAGMAs alone never establish business completeness. |

The independent validator must map every Stage 36A70G retrospective defect,
Stage 36A70I confirmed defect, Stage 36A70K confirmed finding/unexecuted
category, and Stage 36A70M M-01 through M-10 finding to at least one test
above. Where a prior report lacks exact SQL, the validator must cite that
limitation and use only the described fixture; it must not claim to have
replayed unavailable original bytes.

## 12. Exact prerequisites for implementation

Do not begin implementation until all of these are met:

1. Independent review accepts the Stage N corrections and the threat boundary.
2. Runtime qualification in a disposable, packaged Electron `44.4.5` build
   confirms `process.versions.node === '24.21.0'`, actual SQLite version and
   compile options, `node:sqlite` API surface, supported `STRICT`/JSON/date/
   foreign-key/deferred-FK features, and platform-specific packaging.
3. Independent tests prove authorizer filtering for DML, protected tables,
   all transaction/savepoint operations, PRAGMA writes, schema changes,
   ATTACH/DETACH, functions/extensions, triggers, prepared statement
   reprepare, and every allowed coordinator path.
4. Main source/import/build checks prove no renderer, command handler,
   background module, migration or test helper can obtain a production
   connection, statement, arbitrary SQL executor, or alternate write path.
5. The complete DDL must be reviewed as one schema artifact and independently
   validated against all five command invariants. Stage J's current DDL is
   not presumed correct or validated by this architecture document.
6. All §11 test cases are executed or individually recorded `NOT EXECUTED`
   with concrete reasons. No implementation approval if a mandatory
   invariant lacks evidence.
7. Define and approve the external checkpoint service/key custody, backup/WAL
   operations, retention and incident procedure before claiming tamper
   detection beyond SQLite integrity diagnostics.
8. Review Node `node:sqlite`'s Active-development status and Electron/Node
   security support at the implementation date; pin the accepted artifact
   versions and rerun this qualification on every runtime/driver update.
9. Confirm nonce issuance semantics, signing authority, actual human
   independence, permission checks, catalog authority and result-read
   authorization with their owners. No approved business decision listed in
   §8 is reopened by these technical prerequisites.

No unresolved business-owner decision is introduced. Technical prerequisites
are intentionally open until an independent implementation qualification;
they are not assumed satisfied by this specification.

## 13. Workspace integrity and final status

Before authoring, Git reported branch
`fix/stage36a2-operation-journal-fixture`, tracked modifications to
`electron/application/order-requests.service.ts` and
`tests/stage8/helpers/renderer-harness.ts`, and the existing untracked Stage
F/H/I/J/K/L/M documents plus `forensic_analysis.txt`, `temp.txt`,
`temp_main.txt`, and `verify_report.txt`.

This stage adds only this specification. It does not alter any of those
pre-existing files, prior reports, application code, configuration,
dependencies, databases, production data, or branch state. Final status must
be verified after file creation. No SQL or DDL was executed, and no
implementation readiness or validation success is claimed.

`STAGE_36A70N_SPECIFICATION_READY_FOR_INDEPENDENT_VALIDATION`
