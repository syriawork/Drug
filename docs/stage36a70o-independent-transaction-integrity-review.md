# Stage 36A70O — Independent Adversarial Review of the Stage 36A70N Transaction-Integrity Specification

**Recommendation:** `ACCEPT_WITH_CORRECTIONS`  
**Review scope:** Independent read-only design review. No SQL, DDL, runtime validation, database file change, dependency change, or implementation work was executed.

## 1. Documents and source files inspected

Read completely:

- [docs/stage36a70n-corrected-transaction-integrity-specification.md](./stage36a70n-corrected-transaction-integrity-specification.md)
- [docs/stage36a70m-independent-design-review.md](./stage36a70m-independent-design-review.md)
- [docs/stage36a70l-transaction-integrity-redesign.md](./stage36a70l-transaction-integrity-redesign.md)
- [docs/stage36a70k-independent-validation-report.md](./stage36a70k-independent-validation-report.md)
- [docs/stage36a70j-corrected-sqlite-ddl-specification.md](./stage36a70j-corrected-sqlite-ddl-specification.md)
- [docs/stage36a70i-independent-validation-report.md](./stage36a70i-independent-validation-report.md)
- [docs/stage36a70h-corrected-sqlite-ddl-specification.md](./stage36a70h-corrected-sqlite-ddl-specification.md)

Additional source/integration evidence inspected:

- [package.json](../package.json)

Unavailable document explicitly recorded:

- Stage 36A70G’s standalone validation report was not present in the workspace and was not reconstructed. Its findings are therefore treated only as they are cited and described by the later H/I/J/K documents. No Stage 36A70G file contents were invented.

## 2. Driver and version verification

### 2.1 Exact driver and SQLite engine specified

Stage 36A70N specifies:

- Driver: Node built-in `node:sqlite`, class `DatabaseSync`.
- Runtime source: Electron `44.4.5`, which pins Node `24.21.0` per Electron `v44.4.5` DEPS.
- Selection rationale: the project manifest pins `electron` to `44.4.5`, and the design cites Node `v24.21.0` documentation for `DatabaseSync` and `setAuthorizer()`.

| Item | As specified in Stage 36A70N | Verification status |
|---|---|---|
| Project dependency pin | `electron` `44.4.5` in [package.json](../package.json) | Verified in manifest |
| Electron Node pin | Electron `v44.4.5` DEPS pins Node `v24.21.0` | Verified by cited Electron source reference |
| Driver API | `node:sqlite` / `DatabaseSync` | Documented in Node `v24.21.0` SQLite API |
| Authorizer API | `DatabaseSync.setAuthorizer()` | Documented by Node `v24.21.0` API and SQLite engine API |
| SQLite engine | SQLite version not directly asserted; runtime version must be qualified at runtime | Not yet runtime-qualified |
| `better-sqlite3` | Evaluated and rejected | Source/documentation reviewed, but not runtime-qualified in this repo |

### 2.2 Authority and evidence quality

The design cites authoritatively:

- Node v24.21.0 SQLite API documentation: `DatabaseSync`, `setAuthorizer()`, connection settings, defensive mode, synchronous behavior.
- Node v24.21.0 SQLite binding source (`node_sqlite.cc` / `node_sqlite.h`) and SQLite engine documentation for `sqlite3_set_authorizer()`, `sqlite3_db_config()`, `sqlite3_commit_hook()`, foreign keys, transactions, and savepoints.
- SQLite docs for `PRAGMA`, `ON CONFLICT`, authorizer action codes, transaction behavior, and savepoints.
- `better-sqlite3` docs/source for API comparison.

This is adequate evidence for the design argument that the selected Node API is a plausible fit for a trusted Main-process architecture. It is not proof that the exact Electron binary used by this project exposes the same API or that the current packaged runtime is an exact match.

### 2.3 Material concerns about the driver selection

The Stage 36A70N document correctly says the driver is not a separate npm dependency and that the design remains conditional on runtime qualification. That is a good boundary statement.

However, the review found two substantial issues:

1. The Stage 36A70N selection is documented as a design decision, but it still reads as more definitive than the evidence allows. It is a strong proposal, not a verified runtime fact.
2. The document does not state a precise acceptance gate for the actual packaged Electron binary, beyond a future runtime test plan. The text says the runtime must be qualified in §11, but the actual packaged binary and SQLite library are still not shown to match the cited sources.

This is not a rejectable defect by itself, but it is a real evidence gap that should be corrected before implementation.

## 3. Independent authorizer and connection-control assessment

### 3.1 What the authorizer can and cannot do

The design correctly states that SQLite authorizers are per connection and are invoked at statement preparation time. The review agrees with that reading and with the references cited by Stage 36A70N.

The authorizer can be useful for denying:

- DML against protected tables and columns.
- PRAGMA write statements that change connection settings.
- `ATTACH`/`DETACH`.
- Schema changes.
- Transaction and savepoint statements in a deny-by-default configuration.

The authorizer cannot itself:

- distinguish a trusted Main-process coordinator from another module that has a reference to the same connection;
- prevent a second database connection from being opened by any code with access to the database path or driver;
- prevent an attacker with raw database-file access from altering or replacing the file;
- stop a malicious or compromised Main-process module from removing or replacing the authorizer.

The design is materially correct on this boundary, and it is more honest than earlier designs.

### 3.2 Where the design is still too confident

The design proposes a single authoritative connection and import restrictions, but still leaves a gap between architecture and actual enforcement. Specifically:

- import restrictions and lint rules do not stop arbitrary code in Main from creating a second SQLite connection if that code has access to the driver or a raw file path;
- a two-layer model (“private connection” + “authorizer”) is only as strong as the actual ability to prevent untrusted code from obtaining the connection or raw handle;
- the design repeatedly says this remains a trusted-process model, but it should also say more plainly that the selected driver and authorizer enforce SQL actions only on the specific connection object they are installed on.

This is not a fatal issue because the document clearly states the threat model. It is, however, a correction opportunity: the text should explicitly say that the authorizer is defense in depth, not a permission boundary against a compromised or hostile Main process or a direct file-level adversary.

### 3.3 Prepared statements and replacement/removal

Stage 36A70N correctly notes that `setAuthorizer(null)` clears the callback and a later call replaces it. The review finds that this point is important and correctly captured.

The design also states that prepared statements must not be shared or retained beyond the coordinator. That is a necessary control, but it remains an architectural requirement and has not been proved by runtime qualification. This was correctly labeled as something that must be tested.

## 4. Transaction coordinator and COMMIT-boundary assessment

### 4.1 Strengths of the coordinator protocol

The design’s core architecture is strong and directionally correct:

- one authoritative write connection;
- one coordinator for authoritative business commands;
- no command handler controls its own transaction boundary;
- `COMMIT` is the only durable-success boundary;
- all command validation happens inside the same transaction before commit;
- no partial finalization may be surfaced as success.

This is precisely the correct response to the Stage 36A70K failure and the missing revision 1 problem.

### 4.2 Weaknesses and remaining ambiguities

The design is still somewhat abstract in a few places:

1. It assumes a single-flight queue and a single authoritative connection without proving that no other application path can reach a second raw connection.
2. It treats `BEGIN IMMEDIATE` and `ROLLBACK` as if the coordinator owns the entire connection lifecycle, but it does not specify an actual enforcement mechanism against direct connection creation by other Main code.
3. It says no nested transactions or savepoints are permitted, but the review could not confirm that all downstream code paths and library-use patterns in the app would never reach nested transaction APIs through shared DB helpers or a future migration.
4. The design states “no command-level transaction control,” but it does not specify a precise runtime assertion that all command execution paths pass through one coordinator and no helper function may call `BEGIN` or `COMMIT` on the same connection.

These are architecture-level corrections, not a rejection of the design direction.

### 4.3 COMMIT semantics and ambiguous outcomes

Stage 36A70N is good on the high-level semantics:

- same command and commit ID map to one durable result;
- retry after confirmed commit is a read-only resolution path;
- retry after ambiguous result requires exact reconciliation;
- `first successful COMMIT wins` is preserved.

This is a strong and necessary design improvement relative to earlier stages.

The review did note one material concern: the document explains retry semantics well, but it does not yet describe a concrete durable ledger of “operation state” that persists enough to disambiguate “no commit yet,” “committed but response lost,” and “transaction rolled back before commit” in the exact same process crash/restart scenario. That is not a contradiction, but it is a required operational detail before implementation.

## 5. Nonce and idempotency protocol assessment

### 5.1 Strengths

Stage 36A70N’s ordered protocol is substantially better than the earlier draft design. It clearly sequences:

1. actor auth;
2. canonicalization and hashing;
3. signed assertion verification;
4. expiry and binding validation;
5. nonce validation;
6. existing operation/commit resolution;
7. conflict detection;
8. nonce reservation;
9. command execution;
10. final validation;
11. atomic commit;
12. durable result return.

This ordering is correct in principle and strongly supports first-successful-COMMIT semantics.

### 5.2 Remaining concerns

The main remaining issue is the same as with the coordinator: the protocol is specification-level but not enforcement-level. It relies on the trusted Main process to enforce the ordering and to persist or recover operation state deterministically. That is acceptable as a design assumption, but it must be stated exactly as a trusted-process guarantee rather than a database or authorizer guarantee.

The design correctly distinguishes cases like:

- retry after confirmed commit;
- retry after ambiguous commit result;
- same commit ID with different payload;
- same nonce with a different operation;
- expired assertion on retry;
- concurrent duplicates.

This is good and adversarial. The review found no obvious logic flaw in the ordering itself; the remaining concern is specification completeness for operational edge cases and durable outcome reconciliation.

## 6. Command completeness assessment for all five command types

### 6.1 `order.create`

The design correctly preserves the required rule: a create command must produce revision 1 and a valid pending order. The earlier Stage 36A70K and Stage 36A70I failures are explicitly reflected in the architecture and the command-specific completeness checks.

Assessment: strong, but still depends on the trusted coordinator and final validation before commit. SQLite alone is not the completeness mechanism.

### 6.2 `order.accept`

This command is defined as an administrative approval with no inventory movement. The design preserves this rule and correctly distinguishes acceptance from fulfillment.

Assessment: generally sound. The command completeness is a trusted Main-process check plus relational constraints, not something SQLite can infer from the business state alone.

### 6.3 `order.fulfill`

The design preserves exact consumption of the accepted reservation. This is consistent with earlier corrected specifications and with the business decisions.

Assessment: sound and coherent as a coordinator-owned validation with exact reservation matching.

### 6.4 `inventory.bootstrap`

The design preserves the requirement for complete physical count, independent count, approval, evidence, and movement. This remains a strong requirement and is the right place to use relational constraints and coordinator checks together.

Assessment: sound but still requires runtime testing of the exact bootstrapping fixtures and the validation matrix.

### 6.5 `inventory.receipt`

The design preserves the rule that a receipt may create a new inventory identity atomically with source evidence, independent approval, movement, and effect manifest.

Assessment: this is consistent with the earlier approved decision. However, it still relies on trusted Main-process enforcement for identity creation, approval verification, and evidence provenance. The database can record the links; it cannot prove the source evidence or the approval is real without Main and operational controls.

### 6.6 Summary of guarantee classification

The design to classify guarantees correctly is one of its major strengths. The review agrees with the principle that these guarantees sit across distinct layers:

- SQLite engine-enforced: uniqueness, foreign keys on an enabled connection, `STRICT` schemas, row-level checks, append-only semantics when assumptions hold.
- Driver/connection-enforced: authorizer installation, connection configuration, readback checks, transactional semantics of a single connection.
- Trusted Main-process enforced: business validation, actor auth, signed assertion verification, nonce ordering, operation idempotency, final completeness checks before commit, and decision-making around approval, evidence, and policy.
- Operationally assumed: OS ACLs, app packaging, process isolation, file security, backups, WAL integrity, and recovery procedures.
- Not preventable in this threat model: a direct database file attacker or malicious compromised Main process with raw database access.

This classification is clear and honest and is a major improvement over earlier drafts.

## 7. Threat-by-threat assessment

### Threat 1: Renderer attempting direct database access

- Attack path: renderer obtains a database connection or raw path via preload, IPC bridge, or malicious page.
- Proposed control: narrow IPC, no SQL/driver exposure to renderer, database path hidden in Main, and typed business commands only.
- Prevention status: assumed by architecture and process boundaries; not SQLite-enforced.
- Residual risk: moderate if the preload bridge or Main exposes an unsafe path.
- Required detection/recovery: strict IPC validation, no renderer-side database imports, runtime instrumentation, and fail-closed logging on unexpected database-opening attempts.

### Threat 2: Application module attempting direct writes

- Attack path: another module imports the database driver or gains access to a connection capability.
- Proposed control: one database module, no exported raw SQL/driver handles, and a coordinator-only write path.
- Prevention status: architecture-enforced only when the code boundary is actually maintained.
- Residual risk: moderate to high if a module in Main is compromised or an import path is not sealed.
- Required detection/recovery: code-path audits, dependency graph checks, and runtime connection-open instrumentation.

### Threat 3: A second SQLite connection opened by the application

- Attack path: another `DatabaseSync` object opens the same file with different PRAGMA values or no authorizer.
- Proposed control: connection factory, one authoritative connection, configuration readback, and authorizer enforcement on that connection.
- Prevention status: not guaranteed by SQLite; only prevented by disciplined architecture and by a strict no-second-write-connection policy.
- Residual risk: high if the application includes any second connection or opportunistic helper.
- Required detection/recovery: fail-closed if any unexpected open occurs; maintain a connection ownership registry and verify exact connection count.

### Threat 4: A local process with filesystem access

- Attack path: a local process or same-user process opens or modifies the DB file or WAL sidecar.
- Proposed control: private application data directory, OS ACLs, and locked-down storage location.
- Prevention status: partial at best; not a full prevention guarantee.
- Residual risk: high if same-user or administrator-level access exists.
- Required detection/recovery: file/hash verification, signed artifacts, and database startup integrity checks; stop and require recovery if mismatch is detected.

### Threat 5: An administrator or attacker directly modifying the database file

- Attack path: direct DB-file mutation, WAL replacement, or schema tampering outside the application.
- Proposed control: trusted Main-process ownership, connection checks, WAL checks, and external checkpoint verification; explicitly not claimed as prevention.
- Prevention status: unavailable, not preventable in this model.
- Residual risk: extreme.
- Required detection/recovery: fail-closed on mismatch, preserve forensic evidence, and require manual reconciliation; no silent repair or silent conflict resolution.

## 8. Historical defect traceability matrix

| Confirmed defect / finding from available reports | Stage 36A70N coverage | Assessment |
|---|---|---|
| Missing order revision 1 | Explicitly addressed in command completeness architecture and coordinator validation | Covered |
| Foreign-key enforcement disabled on another connection | Addressed as connection-local settings and second-connection threat boundary | Covered |
| Completeness trigger not executing at actual COMMIT | Correctly identified as a design issue; Stage 36A70N places completeness checks in the coordinator and before `COMMIT` | Covered |
| Post-commit manifest mutation and reassignment | Preserved as immutable/append-only design requirement | Covered |
| Receipt command/commit/effect divergence | Preserved in finalization/integrity checks and trusted-process validation ordering | Covered |
| Incomplete bootstrap | Preserved in command completeness and bootstrap evidence requirements | Covered |
| Invalid or empty `medicine_id` | Preserved in schema and validation requirements | Covered |
| Receipt-created identity consistency | Preserved as approved receipt policy and atomic-creation requirement | Covered |
| Movement arithmetic and balance consistency | Preserved in coordinator validation and command completeness checks | Covered |
| Evidence provenance and independent approval | Preserved as mandatory signed evidence/approval validation | Covered |
| Nonce replay and idempotency ordering | Strongly addressed in ordered protocol and state machine | Covered |
| Stage 36A70G findings unavailable | Explicitly recorded as unavailable | Properly handled |

## 9. Findings and required corrections

| ID | Severity | Stage 36A70N section | Finding | Evidence and reasoning | Impact | Required correction | Owner decision? |
|---|---|---|---|---|---|---|---|
| O-01 | **High** | §4, §5, §11 | Driver selection is well motivated but not runtime-verified for this exact packaged Electron runtime. | Stage 36A70N cites Electron 44.4.5 and Node 24.21.0 docs, but it does not show actual runtime evidence from the shipped app binary or from a runtime-in-the-loop test. | Medium risk of implementation mismatch and invalid API assumptions. | Add a precise runtime qualification gate: assert Electron and Node version, SQLite library version, `DatabaseSync` existence, `setAuthorizer` availability, and the exact authorizer behavior against a disposable test database before implementation. | No |
| O-02 | **High** | §5, §6 | The design still relies on architecture and import discipline to prevent a second connection, but the document does not make that enforcement method explicit enough to count as a demonstrated protection. | SQLite itself does not prevent a second database connection; a second connection is a valid bypass if any module can open it. | High operational risk if a second connection is created by a helper or future code path. | State more explicitly that the “single connection” guarantee is a trusted Main-process invariant, not a SQLite guarantee, and add a runtime instrumentation check that fails if a second writable connection is opened. | No |
| O-03 | **Medium** | §7 | The order of nonce reservation and operation resolution is logical, but the design still needs an explicit durable state model for ambiguous COMMIT recovery. | The design handles retries in principle, but it does not define the exact persisted state transitions for “pending reservation,” “commit winner,” “ambiguous,” and “rolled back without commit.” | Medium risk of inconsistent retry recovery or stale nonce state. | Specify a persisted operation-state machine and recovery procedure with exact states and transitions for pending, committed, ambiguous, rolled back, and expired. | No |
| O-04 | **Medium** | §8 | The command completeness layer is correct in intent, but it still reads as a design-and-validation requirement rather than a fully specified, test-backed final invariant set. | The document preserves the right invariants but preserves some text that implies future implementation qualification. | Medium risk of later drift or partial implementation. | Add a tighter explicit “must satisfy exact set of rows and cardinalities” checklist per command, plus a deterministic validation matrix for each command against fixtures. | No |
| O-05 | **Low** | §5.3, §6.4 | The document correctly rejects commit hooks as the primary mechanism, but it should be even more explicit that they are not part of the trusted correctness boundary for this system. | The selected Node API does not expose a public commit-hook method; SQLite does support a per-connection commit hook in native C. | Low risk of confusion or future misimplementation. | State plainly: commit hooks are not part of the required architecture and must not be treated as a correctness or security boundary unless a future driver explicitly exposes and qualifies one. | No |
| O-06 | **Informational** | §5.1, §5.2 | The document correctly says this is not protection against direct file tampering, but it can be made even clearer that no SQLite authorizer, trigger, or connection-only policy can stop a local file-level attacker. | This is already documented, but it merits being restated in the summary section for operational clarity. | Low informational risk. | Add an explicit “Out of scope: direct database-file attacker” summary near the executive determination. | No |

## 10. Claims that remain unverified without runtime testing

The review found the following claims remain unverified without runtime qualification and should not be treated as proven:

- The actual packaged Electron build contains the `node:sqlite` API and `DatabaseSync.setAuthorizer()`.
- `setAuthorizer()` is installed on the authoritative connection and remains installed through all application statement uses.
- No other module or helper obtains a second writable SQLite connection.
- There is no accidental `exec`/`prepare` path that bypasses the coordinator.
- The selected driver exposes no unsafe native extension or raw-handle escape.
- Transaction boundaries and savepoint behavior are exactly as assumed for the actual runtime.
- `PRAGMA foreign_keys`, `journal_mode`, `synchronous`, and `recursive_triggers` read back exactly as required on the shipped runtime.
- The first successful COMMIT semantics survive actual process crash, lock contention, retry, and ambiguous commit outcomes.
- The authorizer denies all required action codes under the actual schema and trigger behavior.
- The design prevents a direct file-level attacker, which is explicitly outside its claim boundary.

## 11. Recommendation

The Stage 36A70N specification is a credible and materially improved architecture that correctly rejects the earlier trigger-only assumptions and correctly frames SQLite as a connection-scoped engine with limits. It also correctly distinguishes SQLite-enforced invariants from trusted-process invariants and operational assumptions.

The review therefore recommends:

`ACCEPT_WITH_CORRECTIONS`

The required corrections are limited and focused: clarify the runtime qualification gate, tighten the second-connection enforcement statement, define the exact durable operation-state model for ambiguous commit recovery, and make the direct-file-tamper boundary even more explicit.

This is not an implementation approval and not a claim of runtime validation.

## 12. Final status

`STAGE_36A70O_REVIEW_ACCEPTED_WITH_CORRECTIONS`
