# Stage 36A70M — Independent Adversarial Review of Stage 36A70L

**Recommendation: `ACCEPT_WITH_CORRECTIONS`**  
**Review scope:** Read-only design review. No SQL or DDL was executed; no
application runtime behavior was validated.

## 1. Executive assessment

Stage 36A70L correctly identifies the Stage 36A70K failure as an architectural
boundary flaw: SQLite has no SQL `COMMIT` trigger, foreign-key enforcement is
per connection, and the Stage J finalizer runs only when a caller updates the
commit state. It appropriately makes its strong completeness claim
conditional on a trusted Electron Main process, a guarded connection, and one
transaction coordinator. It also correctly excludes direct database-file
tampering from the protection claim.

The proposed controls are not yet sufficiently specified to support the
assertion that unauthorized operations on the authoritative connection are
prevented. Stage 36A70L names **no SQLite driver or binding** and provides no
driver source or compatibility evidence. SQLite's authorizer can authorize
SQL actions on one connection, including table reads/writes, schema actions,
PRAGMAs, transaction actions and savepoints. However, the callback runs while
statements are compiled, not as an execution-time caller check. Any later
`sqlite3_set_authorizer()` call replaces the one existing callback; a NULL
callback disables it. The callback has no application-module identity. A
second connection has a separate authorizer and settings. Native C APIs such
as `sqlite3_db_config()` are outside SQL authorizer mediation.

Stage 36A70L also omits SQLite's `sqlite3_commit_hook()` from its control
analysis. SQLite does expose a per-connection commit hook: a nonzero callback
result turns COMMIT into ROLLBACK. This is not a SQL trigger and cannot query
the database from the callback, but—if the chosen driver exposes it—it could
be a supplemental guard requiring the coordinator to arm a commit. It too
can be replaced or disabled and is not a defense against a raw-handle or
file-level attacker.

The coordinator model is a sound trusted-process pattern, but its guarantees
are architectural, not imposed by SQLite. Stage 36A70L needs explicit
corrections on authorizer scope and prepared statements, single-connection
enforcement, transaction/savepoint ownership, SQLite `REPLACE` behavior,
commit-hook qualification, and exact-retry/nonce ordering. The report
therefore recommends **accepting the design direction only with these
corrections**; this is not implementation approval.

## 2. Documents and source evidence inspected

### 2.1 Workspace documents

Read in full:

- [stage36a70l-transaction-integrity-redesign.md](./stage36a70l-transaction-integrity-redesign.md)
- [stage36a70k-independent-validation-report.md](./stage36a70k-independent-validation-report.md)
- [stage36a70j-corrected-sqlite-ddl-specification.md](./stage36a70j-corrected-sqlite-ddl-specification.md)
- [stage36a70i-independent-validation-report.md](./stage36a70i-independent-validation-report.md)
- [stage36a70h-corrected-sqlite-ddl-specification.md](./stage36a70h-corrected-sqlite-ddl-specification.md)

The standalone Stage 36A70G validation report was unavailable in the
workspace and was not reconstructed. Its findings are cited only through the
later H/I/K documents and the reproduced K evidence.

| Document | SHA-256 at review start |
|---|---|
| Stage L redesign | `3302651FDFFBB072E69097D417615DCD9A1C7A1AA5F70921FBB09ACFBFDEC9D1` |
| Stage K validation report | `AF1294C276CCD7928109044A3DBC54C135B42D4754D8D24DA82987BC319CBD6B` |
| Stage J specification | `0EAF251E9FDEDF1F48F22CE92AB8598535E5954CEEDD4C2D88E4A8ED05EC241B` |
| Stage I validation report | `383D5E1FBEDA3AE881AA69A1BDA43165D81A31CB67C815D97DEAA1A1E571F207` |
| Stage H specification | `14B9AD08B5B79556EF41E9243484576D920FCE256E70A3AA6911F022C9CAC3ED` |

### 2.2 Driver and project source

Stage 36A70L does not name `better-sqlite3`, `sqlite3`, Node's
`node:sqlite`, or another driver. It states only that a driver with required
authorizer and connection-hardening support must be selected and qualified
before implementation. Stage 36A70K executed SQLite through Python's
`sqlite3` runtime, version 3.50.4; its report expressly says no Electron
driver was tested. A search of package manifests and TypeScript/JavaScript
files for common SQLite binding/import names returned no matches. Thus there
is **no exact application driver, binding version, or binding source file to
inspect**. The design has not passed driver qualification.

### 2.3 Authoritative SQLite references

The following official SQLite documentation was consulted:

1. [Compile-Time Authorization Callbacks](https://www.sqlite.org/c3ref/set_authorizer.html)
2. [Authorizer Action Codes](https://www.sqlite.org/c3ref/c_alter_table.html)
3. [Database Connection Configuration Options](https://www.sqlite.org/c3ref/c_dbconfig_defensive.html)
4. [Configure Database Connections](https://www.sqlite.org/c3ref/db_config.html)
5. [Commit And Rollback Notification Callbacks](https://www.sqlite.org/c3ref/commit_hook.html)
6. [Foreign Key Support](https://www.sqlite.org/foreignkeys.html)
7. [SQLite PRAGMA statements](https://www.sqlite.org/pragma.html)
8. [The ON CONFLICT Clause](https://www.sqlite.org/lang_conflict.html)
9. [Transaction Control](https://www.sqlite.org/lang_transaction.html)
10. [Compiling An SQL Statement](https://www.sqlite.org/c3ref/prepare.html)

These are engine-level references, not evidence that a specific language
binding exposes or correctly wraps those APIs.

## 3. Findings

| ID | Severity | Finding |
|---|---|---|
| M-01 | **High** | No driver/binding is selected or evidenced. The main proposed control—the SQLite authorizer—cannot be relied upon until the exact Electron binding, SQLite build, and API surface are qualified. |
| M-02 | **High** | The authorizer is connection-local and prepare-time, not a runtime caller-identity check. It cannot itself distinguish the coordinator from another module, and a prepared statement authorized once may later be stepped without a new authorization decision. |
| M-03 | **High** | A second connection or direct file writer bypasses the primary connection's authorizer and pragmas. The design acknowledges this boundary, but module/import restrictions are not a SQLite-enforced ban on opening a second connection. |
| M-04 | **Medium** | Stage 36A70L does not discuss SQLite's C `sqlite3_commit_hook()`. This hook may be an additional fail-closed guard if the binding exposes it; its limitations must be specified. |
| M-05 | **Medium** | Nested transaction/savepoint policy is not sufficiently constrained. SQLite savepoints do not independently commit the outer transaction; a helper can catch an inner error and leave prior writes in the outer transaction unless the sole coordinator aborts the whole operation. |
| M-06 | **Medium** | The protocol consumes nonce(s) before resolving an existing successful commit. An exact retry after a lost COMMIT response must be a read/compare path and must not require consuming an already-used nonce again. Current step ordering leaves that behavior ambiguous. |
| M-07 | **Medium** | The connection initialization list does not set or verify `recursive_triggers=ON` and does not expressly forbid `INSERT OR REPLACE`. SQLite documents that REPLACE deletes conflicting rows and fires delete triggers only when recursive triggers are enabled, which matters to append-only guards. |
| M-08 | **Medium** | Detection of direct database-file tampering is described only generally (e.g. signed external checkpoints). No trust anchor, checkpoint cadence, WAL treatment, verification point, or failure response is defined. Detection is not prevention and may be impossible if the attacker controls both database and verification keys. |
| M-09 | **Low** | Authorization replay needs an explicit signed-message contract: signatures must bind command ID, commit ID, actor, action/resource, request hash, nonce, expiry and relevant policy version; unique nonce storage alone does not validate what was signed. |
| M-10 | **Informational** | Stage 36A70L is an architecture and invariant list, not a complete revised DDL or a validation result. It correctly labels its fixtures and checks as future work. |

## 4. Authorizer and driver assessment

### 4.1 What SQLite's authorizer can do

`sqlite3_set_authorizer()` installs a callback on a particular `sqlite3*`
connection. SQLite calls it while SQL is compiled by `sqlite3_prepare()` and
variants. Returning `SQLITE_DENY` rejects a statement. The authorizer action
codes include:

- `SQLITE_READ`, `SQLITE_INSERT`, `SQLITE_UPDATE`, and `SQLITE_DELETE` for
  table/column access;
- `SQLITE_PRAGMA` for pragma actions;
- `SQLITE_CREATE_*`, `SQLITE_DROP_*`, and `SQLITE_ALTER_TABLE` for schema
  operations;
- `SQLITE_ATTACH` and `SQLITE_DETACH`;
- `SQLITE_TRANSACTION` and `SQLITE_SAVEPOINT`;
- `SQLITE_FUNCTION` for SQL function use.

Therefore, a correctly installed fail-closed authorizer on the authoritative
connection can deny ordinary SQL attempts to change `foreign_keys`,
`ignore_check_constraints`, `writable_schema`, or other PRAGMAs; deny SQL
transaction/savepoint statements; deny schema modification and attachment;
and restrict reads/writes to an allowlist of tables/actions. The callback
receives trigger/view source context as one of its arguments, allowing
different rules for top-level SQL and trigger-originated access.

This is useful defense in depth against arbitrary SQL submitted to that
connection. It does **not** make the connection a capability-secure boundary
between modules.

### 4.2 Limitations material to Stage 36A70L

1. **Compile-time timing.** SQLite's documentation says authorizer callbacks
   are invoked during statement preparation, not normal statement execution,
   except when a statement is reparsed after schema change. It cannot decide
   anew at each `sqlite3_step()` who is using a statement. Any design that
   flips an in-memory “coordinator active” flag around preparation must ensure
   the prepared statement is never exposed or executed later by another path.
2. **No caller identity.** The callback receives a database connection,
   action code, object/column details, database name, and trigger/view source.
   It does not receive a JavaScript module identity, IPC caller, stack
   identity, or coordinator capability token. If a module can submit the same
   permitted SQL actions on the same connection, SQLite cannot distinguish
   that module from the coordinator. The actual boundary is private
   connection/statement ownership in trusted Main code.
3. **Replaceable/removable callback.** SQLite allows only one authorizer per
   connection. A later `sqlite3_set_authorizer(db, otherCallback, ...)`
   replaces the prior callback; passing NULL disables it. Any native code
   with the raw handle can replace or remove it. This cannot be prevented by
   that callback itself.
4. **Connection locality.** Installing the callback on connection A says
   nothing about connection B. B needs independent setup. A direct
   `sqlite3_open()` in another module or process creates a route around A's
   rules.
5. **Native API bypass.** The authorizer is for SQL statement actions. The
   SQLite `sqlite3_db_config()` C API can enable/disable foreign-key
   enforcement with `SQLITE_DBCONFIG_ENABLE_FKEY`, and the same option list
   includes trigger enablement and defensive/writable-schema controls. These
   calls are not SQL PRAGMA actions for the authorizer to deny. A binding
   exposing the raw native handle may expose these bypasses.
6. **Prepared statement/caching risk.** A statement compiled while a
   permissive coordinator phase is active may be retained by a caller or
   driver statement cache. The authorizer documentation's prepare-time
   behavior means the callback is not an execution-time policy guard.
   Qualification must test the actual binding's statement cache, lifecycle,
   reset/reprepare behavior, and whether statement objects leak across
   module boundaries.
7. **Extensions/native code.** SQLite extension loading is disabled by
   default, but the C API can enable it, and an extension/native module can
   operate with capabilities beyond a SQL authorizer. The selected binding
   must expose no extension-loading or raw-native escape to untrusted
   modules; direct database-file access remains outside this control.
8. **PRAGMA edge cases.** SQLite warns that PRAGMAs are SQLite-specific,
   unknown PRAGMAs may be silently ignored, and some take effect at compile
   time. The authorizer must deny every non-allowlisted PRAGMA by action code
   and verify all settings after open; checking a SQL return without checking
   the readback is not enough.

### 4.3 Driver qualification conclusion

The engine supports an authorizer. Stage 36A70L has not identified an
Electron driver that exposes `sqlite3_set_authorizer()`, keeps its callback
alive, supports reliable denial of all listed actions, hides raw handles,
or prevents another module from opening a connection. No claim that these
controls work in the application's runtime is justified.

Before any implementation, select an exact driver/version/build and prove in
a disposable integration test that:

- an authorizer can be installed before any application SQL and remains
  installed;
- denied DML, `ATTACH`, schema DDL, PRAGMA writes, `BEGIN`/`COMMIT`/
  `ROLLBACK`, and `SAVEPOINT`/`RELEASE` fail;
- trigger-internal writes required by the schema remain allowed without
  granting arbitrary top-level writes;
- it is impossible through the normal application API to replace/remove the
  authorizer, obtain the raw handle, or open an unguarded connection;
- prepared statements cannot be prepared in a privileged phase and stepped
  later from a less-privileged path;
- no SQL extension, unsafe native API, or unrestricted driver method is
  exposed to renderer or feature modules.

This test would qualify the selected implementation path; it still would not
protect against compromised Main/native code or a file-level attacker.

## 5. Trusted transaction coordinator review

### 5.1 What is sound

- One private connection manager and one serialized authoritative write path
  are appropriate for SQLite's single-writer model.
- `BEGIN IMMEDIATE` before inventory reads/writes avoids a competing writer
  passing the same stale balance check.
- Complete pre-COMMIT command validation and explicit whole-transaction
  rollback address the missing-revision class of failure on the supported
  application path.
- The design makes successful `COMMIT`, not the finalization row update, the
  success boundary.
- Stable command/commit IDs plus exact result comparison preserve
  first-successful-COMMIT semantics and prohibit a silent replacement
  transaction.

### 5.2 What remains architectural

SQLite cannot force every module to use this coordinator. The coordinator is
effective only if raw connection/driver imports are confined to one Main
module and all other code is actually unable to reach the connection or
prepare/step statements. TypeScript `private`, import discipline and lint
rules reduce accidental bypass; they do not resist arbitrary code already
running inside Main.

The authorizer cannot tell which module made a request, so the phrase
“deny writes outside the coordinator's statement path” needs a concrete
capability design. The safe claim is: **only trusted code holds the
connection/statement capability, and the coordinator serializes its use**.
The authorizer is a secondary SQL-action filter, not an independent module
authorization system.

### 5.3 Transaction and savepoint requirements

Stage 36A70L says the coordinator owns transaction boundaries but does not
explicitly prohibit nested transaction helpers. Require that:

- authoritative command handlers cannot call `BEGIN`, `COMMIT`, `ROLLBACK`,
  `SAVEPOINT`, or `RELEASE` themselves;
- only the coordinator starts and ends the outer transaction;
- command handlers return failure to the coordinator rather than catching an
  exception and continuing;
- savepoints are forbidden for production command execution unless one
  documented coordinator implementation owns them and any failure still
  causes rollback of the outermost transaction;
- nested `COMMIT` semantics are not assumed: releasing a savepoint does not
  make its changes durable independently of the outer transaction.

An authorizer may reject SQL transaction/savepoint actions except while a
private coordinator call is synchronously executing. Because authorization
is at prepare time, no prepared transaction-control statement may escape that
call boundary. If this cannot be proven for the driver, do not rely on the
authorizer for this separation.

### 5.4 Commit hook omitted from the design

SQLite provides `sqlite3_commit_hook()` on a connection. Its callback runs
when a transaction is about to commit; returning nonzero converts COMMIT to
ROLLBACK. The callback is not reentrant and must not run SQL or otherwise
modify that connection. A subsequent hook registration replaces the prior
one, and registering NULL disables it.

If the selected driver exposes it, use it only as a **supplementary gate**:
the coordinator arms a private one-shot “expected commit” state after its
precommit checks; the hook permits only that COMMIT and otherwise vetoes it.
Clear the state after completion/rollback and test every error path. This
does not validate database rows from inside the hook, does not replace the
coordinator, and is bypassable by code that can replace the hook or manipulate
its private state. If the driver does not expose it, document that and rely
on the trusted coordinator, not on a nonexistent SQL commit trigger.

## 6. Database invariants and trust dependencies

Stage 36A70L presents required invariants rather than a new complete DDL. The
following assessment distinguishes what can be enforced in a protected,
intact database from what still depends on Main/process trust.

| Invariant | SQLite defense described or available | Trusted-process dependency / review conclusion |
|---|---|---|
| Order create requires revision 1 pending | Unique revision number, revision insert guard, finalization-transition trigger and deferred-FK witness in H/J; L adds coordinator completeness query before COMMIT. | No automatic commit trigger. Omission is prevented on the supported path only because coordinator owns COMMIT and is correct. With FK/triggers disabled or schema altered, SQLite does not guarantee completeness. |
| Order projection equals revision history | Root projection trigger allows matching next revision; immutable revisions and unique `(order,revision)`. | Requires triggers enabled and coordinator to reject any inconsistent precommit projection. Main also validates expected revision/stale command behavior. |
| Exact effect manifest | Composite keys/FKs, target checks, bidirectional finalizer checks and exact command grammar. | Deferred FK requires enforcement; trigger finalization must run; coordinator must independently compare both directions before COMMIT. Direct SQL/file writer can bypass. |
| Reservation and reserve movement completeness | Line/reservation composite identity/quantity, partial unique reserve index, movement arithmetic/balance trigger and create finalizer. | Correct catalog classification, quantity safety, and no missing movement are coordinator-finalizer checks; all DDL depends on intact active triggers and checks. |
| Acceptance has no inventory movement | Command-specific finalizer prohibits movement effects and requires revision 2. | Coordinator must not commit an alternate acceptance path; no effect guarantee if triggers are bypassed. |
| Fulfillment consumes exact reservation | Composite FKs and unique movement per reservation; exact line/identity/quantity finalizer and ledger snapshots. | Trigger and FK enforcement plus precommit coordinator audit. DB cannot authenticate physical handoff or correct actor. |
| Bootstrap identity completeness | Origin composite FKs, identity↔line checks, exact dual evidence/approval/movement and manifest cardinalities. | Evidence truth and real human independence are Main/identity-provider checks; transaction completeness requires coordinator. |
| Receipt-created identity completeness | Origin identity, same-commit receipt line, evidence, independent approval, movement, manifest and revision checks. Receipt identity creation remains binding. | Same trusted-process dependencies; SQLite cannot establish source provenance authenticity or distinct human identities. |
| Evidence provenance | Evidence rows and resource/commit/actor composite relationships; append-only verification history. | Hash derivation, authenticity, trusted acquisition, signature, key state and latest/valid verification semantics require Main/service checks. A row labeled verified is not proof by itself. |
| Independent approval | SQL `receiver_actor_id <> second_approver_actor_id`, distinct actor fields and FKs to an assertion. | Main must map identities to humans and verify signatures/permissions. Distinct strings alone are insufficient. |
| Post-finalization immutability | UPDATE/DELETE triggers, applying-only insert guards, immutable IDs/manifests, unique keys. | Depends on triggers/checks/foreign keys and no `REPLACE` loophole; direct schema/file tampering bypasses these controls. |
| Duplicate commands/revisions/commit IDs | PK/UNIQUE keys for command ID, aggregate revision, commit ID and command binding. | Exact retry, winner result comparison, conflict reporting and stable-ID generation are coordinator responsibilities. |
| Nonce replay | Unique nonce value, nonce state, assertion FK/binding. | Nonce issuance, signature validity, durable consumption order, retry behavior and human identity remain trusted-process responsibilities. File tampering can remove evidence. |
| No record deletion | Append-only triggers and private write API. | `INSERT OR REPLACE` can delete a conflicting row; SQLite documents delete triggers fire for REPLACE only if recursive triggers are enabled. Require `recursive_triggers=ON` and deny/never generate REPLACE, then test. Direct file writes remain out of scope. |
| First successful COMMIT wins | Atomic transaction plus stable UNIQUE commit IDs. | Main must identify a prior exact result, distinguish a conflicting retry, handle uncertain outcome and avoid a new commit ID or automatic reversal. |

## 7. Concrete adversarial scenarios and outcomes

“Prevented” below means prevented only within the trusted supported
application path, not by SQLite against a local raw-file writer.

| Scenario | Attack | Stage L control | Assessment |
|---|---|---|---|
| M-A1: disable FK on a second connection | A module opens connection B, runs `PRAGMA foreign_keys=OFF`, writes an applying order with a reservation/movement but no revision/finalization, and commits. | One private factory; every connection configured; authorizer on each; deny direct driver imports. | **Vulnerable if B can be opened outside the factory.** Authorizer on connection A does not protect B. A trusted-module boundary can prevent the supported code path from opening B, but SQLite cannot enforce a process-wide “one connection” rule. Direct-file L05 is explicitly acknowledged by L. |
| M-A2: bypass the coordinator | A feature module imports the binding, opens the same DB, or obtains the raw connection/statement and issues direct inserts/COMMIT. | Private connection ownership, no generic SQL IPC/API, import-boundary lint. | **Conditionally prevented within trusted source architecture; otherwise vulnerable.** L correctly notes TypeScript privacy is not a security barrier. Test for import/build/runtime bypass and expose no connection capability. |
| M-A3: remove/replace the authorizer | Native code with `sqlite3*` calls `sqlite3_set_authorizer(db,NULL,NULL)` or installs a permissive callback, then writes an incomplete command. | Hide raw handle; no method to reset callback; authorizer installed for lifetime. | **Not prevented by the authorizer itself.** SQLite documents replacement and NULL disablement. Connection encapsulation prevents routine module access; compromised Main/native code can remove it. |
| M-A4: direct transaction control | Submit `COMMIT`, `ROLLBACK`, or `SAVEPOINT` directly, or prepare a transaction statement during an allowed phase and retain it. | Deny `SQLITE_TRANSACTION`/`SQLITE_SAVEPOINT` except coordinator capability. | **Ordinary SQL can be denied on that connection.** Callback is compile-time and has no caller identity, so retained prepared statements and raw-handle access remain risks. The coordinator must own statements and reject all nested boundaries. |
| M-A5: direct schema/trigger change | `DROP TRIGGER`, `ALTER TABLE`, `ATTACH`, `PRAGMA writable_schema=ON`, or a native API modifies connection settings. | Authorizer denies schema action codes, ATTACH, PRAGMA writes; defensive mode. | **SQL-level prevention on the protected connection if correctly implemented.** No guarantee against C `sqlite3_db_config`, a new connection, authorizer replacement, or direct file edits. |
| M-A6: replay a previously authorized command | Resubmit a previously signed request with same IDs; alternatively copy signed assertion into a new command/commit identity. | Immutable IDs, request-hash check, unique nonce, authorization verification. | **Same-ID exact retry should be read/compare only.** New-ID replay must fail unless signature validation proves the authorization binds all IDs, resource, action, hash, nonce, expiry and policy. Stage L needs to make that signed-message contract explicit. |
| M-A7: reuse a nonce | Reinsert same nonce value under a new nonce ID, command, or actor, including after a failed business transaction. | Durable nonce transaction and UNIQUE nonce value. | **Prevented on an intact DB** by unique key and coordinator consumption; after business rollback the nonce remains consumed. **Vulnerable to file/schema tampering.** Exact retry must not try to consume it again. |
| M-A8: mutate finalized rows | Update/delete root, revision, movement, evidence or manifest, or append late effects; use `INSERT OR REPLACE` on a unique key. | Append-only triggers, applying-only insert guards and authorizer. | **Ordinary UPDATE/DELETE/late INSERT rejected on protected path.** REPLACE is a material gap unless recursive triggers are enabled and verified, and the coordinator uses no REPLACE statement. Raw connection/file tampering remains possible. |
| M-A9: crash before COMMIT | Terminate Main after several inserts/finalization but before COMMIT. | One SQLite transaction; explicit rollback on known errors; WAL recovery tests planned. | **Expected atomic rollback** under SQLite transaction semantics and the selected VFS/storage guarantees, but not runtime-validated. On restart, reapply connection controls and verify integrity/invariants. |
| M-A10: crash after COMMIT, response lost | COMMIT reaches storage, but response/IPC is lost; caller retries. | Same command/commit IDs, query prior commit and compare full effect/result. | **Sound in principle.** Must perform idempotency lookup before consuming a nonce or attempting a fresh write. If result is ambiguous/inconsistent, halt/adjudicate; no automatic reversal. |
| M-A11: local process with file access | Open DB/WAL/SHM with another SQLite library, disable FK/triggers, alter schema or rows. | Private app-data directory, OS ACLs, backup/checkpoint verification. | **Not preventable by authorizer or coordinator.** ACLs may deter other OS identities; same-user and administrator access can bypass. External signed checkpoints can detect some tampering only if their signing key and storage are outside the attacker's control. |
| M-A12: administrator/attacker modifies file | Replace DB, WAL, or backup and fabricate rows after application closes. | Schema identity, integrity checks, signed external checkpoints and manual adjudication. | **Not preventable by this architecture.** Detection is possible only for tampering covered by an independently protected integrity anchor; ordinary `integrity_check` detects structural corruption, not valid-looking malicious edits. |

## 8. Required corrections to Stage 36A70L

Before treating the design as implementation-ready, revise or supplement it
with these explicit requirements:

1. **Name and qualify the exact driver.** Include package name/version,
   SQLite library version/build flags, binding source/API documentation, and
   tests for authorizer installation, transaction action denial, statement
   caching, callback lifetime, authorizer replacement, raw-handle exposure,
   and all connection-opening paths. Until then authorizer support is
   unresolved technically.
2. **Narrow the authorizer claim.** State that it filters SQL actions during
   statement preparation on one connection; it is not caller authentication,
   an execution-time gate, or a process-wide connection restriction. Never
   describe “coordinator-only” writes as an authorizer guarantee unless the
   only entity able to prepare/step statements is the coordinator.
3. **Define immutable connection capability.** Expose only typed operations,
   no raw handles or prepared-statement objects; no arbitrary SQL; one
   connection factory; deny direct driver imports by build-time rules and
   test that rule. A second connection must be independently authorized and
   not an alternate writer. Explain this remains trusted-process enforcement.
4. **Handle native settings.** If the binding exposes `sqlite3_db_config`,
   wrap it in the connection manager and expose no caller access. Explicitly
   account for `SQLITE_DBCONFIG_ENABLE_FKEY`, trigger enablement and
   defensive/writable-schema settings; a SQL authorizer cannot intercept
   those C API calls.
5. **Add optional commit-hook defense.** If supported by the selected driver,
   install and test a private `sqlite3_commit_hook` that vetoes COMMIT unless
   a validated coordinator transaction is armed. Document that it cannot
   query SQL, can be replaced, and is defense in depth only. If unavailable,
   state the coordinator is the sole commit guard.
6. **Specify transaction nesting.** Forbid nested transaction ownership and
   production savepoints, or give one exact nested protocol that always
   aborts the outer transaction on any child failure. Explicitly deny
   transaction/savepoint statements from command services and tests.
7. **Close append-only conflict paths.** Set/read back
   `PRAGMA recursive_triggers=ON` before schema use, deny changes, and
   prohibit `REPLACE`/`INSERT OR REPLACE` in the fixed statement set.
   Add regression tests for conflicts against immutable PKs and unique
   columns. SQLite's conflict documentation says REPLACE deletes the
   conflicting row and delete triggers fire only when recursive triggers
   are enabled.
8. **Reorder exact retry handling.** On an incoming retry, first perform a
   read-only lookup using the same stable command/commit IDs and hash. If a
   matching successful result exists, compare and return it without
   re-consuming nonce. Only a genuinely new attempt should enter nonce
   consumption and business-write steps. Specify behavior for a partial or
   contradictory record as stop/adjudicate.
9. **Define signed authorization binding.** Verify that signed bytes bind
   nonce, actor, action, resource, command ID, commit ID, request hash,
   expiry and policy version; reject stale, altered, cross-command or
   cross-commit assertions. Keep actual human distinctness in the identity
   provider.
10. **Define tamper detection precisely.** If external checkpoints are used,
    document canonical contents, signing/MAC key custody outside the
    database, coverage of WAL/SHM and backup/restore, frequency, verification
    at startup/recovery, and fail-closed incident handling. Do not promise
    detection for an attacker who controls the verification trust anchor.
11. **Keep the invariant matrix as requirements, not proof.** A later
    independent validation must execute all five command paths and negative
    variants with the chosen driver, including a second-connection attempt,
    statement cache, savepoint/error handling, REPLACE, authorizer reset,
    nonce retry, and crash-before/after-COMMIT fault injection. No test result
    is claimed in this review.

## 9. Threat-by-threat disposition

| Threat | Proposed control | Residual risk | Prevention vs detection |
|---|---|---|---|
| Renderer attempts unauthorized DB access | Main-only connection; narrow typed IPC; no SQL/path/handle exposure; IPC validation. | Compromised Main, unsafe preload bridge, local same-user access. | Prevent ordinary renderer access by architecture; no SQLite-level guarantee. |
| Application module attempts direct writes | Private connection owner/coordinator; import boundaries; authorizer. | Same-process module can bypass if it obtains driver or handle; authorizer has no module identity. | Prevent accidental/supported bypass with code architecture; authorizer blocks unauthorized SQL actions on its connection; not a sandbox against compromised code. |
| Second application connection | One connection factory, import boundary, per-connection settings/authorizer, one writer queue. | Another binding/native module can open an unguarded connection; primary authorizer is not inherited. | Prevent only within controlled Main code; detect through instrumentation/static checks, not SQLite engine. |
| Local process with DB file access | OS ACLs, private directory, protect sidecars/backups. | Same user/admin can open/replace DB and WAL/SHM. | Deter other principals; direct write is not prevented. External integrity anchor can detect a subset. |
| Administrator/attacker direct DB modification | Explicit out-of-scope boundary; external signed checkpoints and integrity checks; stop/adjudicate. | Attacker controlling file and application/key environment can fabricate state or remove history. | No prevention by SQLite; only conditional detection if a separate trusted anchor survives. |

## 10. Traceability to Stage 36A70L requirements

| Stage L requirement | Review evidence | Assessment |
|---|---|---|
| Trusted SQLite connection created/owned by Main | L §5 architecture; SQLite authorizer API is connection-specific | Sound conditional design; exact driver and connection factory not yet selected. |
| Set/read back `foreign_keys=ON`, WAL, synchronous, timeout | L §5.2; SQLite foreign-key docs say enforcement is per connection and off by default absent compile default | Necessary but not sufficient; apply to every connection, deny setting changes, and account for native `sqlite3_db_config`. |
| Prevent/detect changes to settings; evaluate authorizer | L §5.2; SQLite authorizer docs and action codes; db_config API | Incomplete: authorizer is prepare-time and replaceable, native db_config is outside it. |
| Deny arbitrary SQL and renderer access | L §§4–5; narrow IPC | Good threat reduction. No runtime tests; no protection if Main itself exposes a generic call. |
| One coordinator owns BEGIN/write/validate/finalize/COMMIT | L §6.1 | Correct trust boundary, but cannot be imposed on arbitrary code by SQLite. Need module boundary and no raw handle; savepoints/nesting must be prohibited or specified. |
| No alternate write path / no second connection | L §5.1 | Expressed as intent, not engine enforcement. Test static imports and instrument every connection; direct file access remains open. |
| Precommit completeness and rollback | L §§6–8 | Correct for trusted coordinator; incomplete if caller can bypass coordinator or mutate schema/settings. Stage K's actual bypass proves why this cannot be DDL-only. |
| First successful COMMIT wins / uncertain recovery | L §6.2 | Conceptually sound, but exact retry lookup must precede nonce consumption; no crash or ambiguity validation was performed. |
| Order create/revisions/projection | L §8 | Required invariant is stated; it depends on coordinator and active guards; no new DDL or validation evidence. |
| Reservation/movement consistency | L §§7–8 | SQL constraints/triggers can enforce on protected, correctly configured connection; coordinator must audit completeness. |
| Acceptance no movement | L §8 | Correct explicit invariant; trusted finalizer/coordinator must enforce. |
| Fulfillment exact reservation | L §8 | Correct invariant; relies on relational controls plus precommit audit. |
| Bootstrap/receipt completeness | L §8 | Correctly preserves dual count and receipt-created identity; evidence authenticity and independent-human properties remain outside SQLite. |
| Evidence provenance and approval independence | L §§7–9 | SQLite stores/binds references and can compare actor IDs; Main/identity provider verifies truth, signatures and real-person separation. |
| Post-finalization immutability | L §7 | Trigger defenses are conditional; add REPLACE/recursive-trigger controls and retain explicit file-tamper boundary. |
| Duplicate command/revision/commit/nonce | L §§6 and 8 | Unique constraints are useful; replay semantics and nonce retry ordering require clarification. |
| Crash/reopen and commit success boundary | L §6.2 | Correctly says COMMIT alone means success; all WAL/device/driver behavior awaits runtime validation. |
| Direct tampering threat boundary | L §4 | Honest exclusion. Detection/checkpoint proposal needs a trust anchor and operational specification. |
| Preserve approved decisions | L §§1, 8, 11 | Receipt may create identity; lifecycle and acceptance/fulfillment invariants preserved; no reversal/deletion/permission inheritance introduced. |

## 11. Sources and interpretation notes

- SQLite authorizer behavior, callback timing, replace/disable semantics, and
  callback limitations: [sqlite3_set_authorizer()](https://www.sqlite.org/c3ref/set_authorizer.html).
- SQL action types including table access, schema changes, PRAGMA,
  transaction, savepoint, attach and detach:
  [authorizer action codes](https://www.sqlite.org/c3ref/c_alter_table.html).
- Per-connection DB configuration includes foreign-key enforcement,
  trigger enablement, defensive mode and writable-schema control:
  [SQLite database configuration options](https://www.sqlite.org/c3ref/c_dbconfig_defensive.html)
  and [`sqlite3_db_config()`](https://www.sqlite.org/c3ref/db_config.html).
- Commit hook behavior, replacement/disable semantics, rollback-on-nonzero,
  and prohibition on reentrant SQL:
  [sqlite3_commit_hook()](https://www.sqlite.org/c3ref/commit_hook.html).
- Foreign-key requirements and per-connection enforcement:
  [SQLite Foreign Key Support](https://www.sqlite.org/foreignkeys.html).
- SQLite documents that the REPLACE conflict algorithm deletes conflicting
  rows and fires delete triggers only if recursive triggers are enabled:
  [ON CONFLICT](https://www.sqlite.org/lang_conflict.html).
- Transaction/savepoint semantics:
  [SQLite Transaction](https://www.sqlite.org/lang_transaction.html).

No material conclusion in this report is based on executing a driver,
authorizer, DDL, or application transaction. The assessment is documentary
and architectural only.

## 12. Workspace integrity and final recommendation

Before review, Git reported branch
`fix/stage36a2-operation-journal-fixture`, tracked modifications to
`electron/application/order-requests.service.ts` and
`tests/stage8/helpers/renderer-harness.ts`, and the existing untracked Stage
F/H/I/J/K/L documents plus `forensic_analysis.txt`, `temp.txt`,
`temp_main.txt`, and `verify_report.txt`.

The review creates only this report. It does not modify prior documents,
application files, tests, configuration, dependencies, databases, or branch
state. The final worktree is checked after report creation.

**Recommendation: `ACCEPT_WITH_CORRECTIONS`** — accept the trusted-writer
architecture as the right design direction, but resolve M-01 through M-09
and independently validate the exact selected driver before implementation.
No implementation or runtime validation is approved by this review.

`STAGE_36A70M_REVIEW_ACCEPTED_WITH_CORRECTIONS`
