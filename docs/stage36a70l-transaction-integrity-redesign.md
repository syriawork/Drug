# Stage 36A70L — Transaction-Integrity Redesign

**Status:** `STAGE_36A70L_DESIGN_READY_FOR_INDEPENDENT_REVIEW`  
**Scope:** Architecture and design only. No DDL, SQL, application code, or
validation was executed for this stage. This is not an implementation-readiness
or validation claim.

## 1. Executive design determination

Stage 36A70K demonstrated a fundamental boundary problem. The Stage J
`commit_command_completeness` trigger fires on an `UPDATE` of
`commit_records.status`, not at SQL `COMMIT`. The deferred finalization
foreign key blocks an unfinalized commit only when the connection has
foreign-key enforcement enabled. In the exact adversarial case, setting
`PRAGMA foreign_keys=OFF`, writing an order root, line, reservation, and
reserve movement, omitting revision 1 and finalization, and issuing `COMMIT`
succeeded.

No DDL-only design can guarantee transaction-wide completeness against every
SQLite connection or an actor able to alter the database file. SQLite has no
general-purpose SQL trigger that runs at transaction commit. Connection
settings are not immutable schema properties, and schema triggers themselves
can be altered by a writer with sufficient database access.

The recommended correction is therefore an explicit **trusted-writer
architecture**:

1. The Electron Main process is the only database-owning process.
2. One private connection manager creates and configures the authoritative
   write connection. No connection handle, SQL executor, path, or general
   database IPC is exposed to renderers or other application modules.
3. One private transaction coordinator is the only code allowed to begin,
   write, finalize, and commit authoritative commands. It validates all
   command completeness invariants before issuing `COMMIT`.
4. SQLite constraints and triggers provide defense in depth on the protected
   connection. An authorizer blocks attempts to change enforcement settings,
   alter schema, or execute arbitrary transaction control through that
   connection.
5. Filesystem ACLs, application packaging, process ownership, backup, and
   recovery controls reduce exposure but do not protect against a local actor
   able to modify the database file directly.

This design distinguishes the database's conditional relational guarantees
from the trusted coordinator's all-or-nothing protocol. It does not claim
that a malicious process with file access, a compromised Main process, or
untrusted code with the raw SQLite handle can be defeated by DDL or an
authorizer.

No further owner decision is needed for the approved business rules. The
receipt-created-identity rule remains binding. Before implementation, the
specific SQLite driver must be shown to support the required authorizer and
connection-hardening controls; that is a technical qualification gate, not a
business-policy question.

## 2. Evidence reviewed and root-cause analysis

### 2.1 Documents inspected

- [stage36a70k-independent-validation-report.md](./stage36a70k-independent-validation-report.md)
- [stage36a70j-corrected-sqlite-ddl-specification.md](./stage36a70j-corrected-sqlite-ddl-specification.md)
- [stage36a70i-independent-validation-report.md](./stage36a70i-independent-validation-report.md)
- [stage36a70h-corrected-sqlite-ddl-specification.md](./stage36a70h-corrected-sqlite-ddl-specification.md)

The Stage 36A70G report was not among the documents requested or found in
Stage 36A70K. Its original evidence is unavailable. Stage G defects below are
identified only where Stage H/I provide retrospective records; no original
Stage G SQL is reconstructed.

### 2.2 Exact Stage 36A70K bypass evidence

Stage K used the deterministic Stage J §7.2 bootstrap fixture to establish
identity `i` with 10 available units, then used the Stage J `order.create`
fixture for command `oc`, commit `ocm`, order `o`, line `ol`, and quantity 3.
It changed the connection state and omitted the revision/finalization writes:

```sql
PRAGMA foreign_keys=OFF;

-- In one transaction, execute the Stage J order.create fixture statements
-- that insert commit 'ocm' in applying state; its authorization and manifest
-- rows for the root, line, reservation and reserve movement; order 'o' at
-- (revision 0, pending); line 'ol' for identity 'i', quantity 3;
-- reservation 'or1' for that exact line, identity and quantity; and reserve
-- movement 'orm' from (available=10,reserved=0) to (7,3).
-- Omit the order.revision manifest row and order_revisions row.
-- Omit UPDATE commit_records ... status='committed'.
COMMIT;
```

Observed result in the Stage K report:

```text
COMMIT                                      -> succeeded
PRAGMA foreign_keys                        -> 0
commit_records('ocm')                       -> status='applying'
orders('o')                                 -> (current_revision=0,
                                                current_status='pending')
order_revisions for 'o'                     -> 0 rows
inventory_balances for 'i'                  -> (available=7,reserved=3,
                                                on_hand=10)
PRAGMA foreign_key_check                    -> missing commit_finalizations row
```

The attempt did not fire `commit_command_completeness`, because it never
updated `commit_records.status`. With foreign keys enabled, a plain `COMMIT`
without its deferred finalization witness failed with
`FOREIGN KEY constraint failed` and left the transaction open. In a separate
test, a status update that did invoke the completeness trigger failed with
`order.create incomplete or misbound`; `RAISE(ROLLBACK,...)` rolled back the
whole transaction, including a nested-savepoint sentinel. These observations
prove that trigger failure handling worked **when the trigger was invoked**;
they do not make the trigger a commit hook.

### 2.3 Root cause

The prior design conflated three distinct mechanisms:

- A row trigger validating a requested state transition.
- A deferred foreign key that is checked at commit only on a connection with
  foreign keys enabled.
- The application protocol that is expected to perform finalization and
  commit in the correct order.

Only the latter can control the whole transaction on an authorized connection.
The deferred FK is a useful second line of defense but not an unconditional
integrity boundary. The earlier order-revision omission was also a completeness
gap: before Stage J, the finalizer did not require a create revision at all.
Stage J added that check but still depended on reaching its finalization
`UPDATE` and on FK enforcement not being disabled.

### 2.4 Classification of prior Stage K evidence

| Classification | Evidence and consequence |
|---|---|
| Confirmed critical defect | FK-off, no-finalization order creation committed a reservation with no revision 1. |
| Confirmed architectural limitation | The command-completeness trigger is `BEFORE UPDATE OF status`, not an SQLite `COMMIT` trigger. |
| Confirmed conditional protection | With foreign keys on, an omitted finalization failed the deferred-FK commit check; a finalization update invoking the trigger raised rollback for tested omissions. |
| Confirmed `RAISE(ROLLBACK)` behavior | The tested trigger failure rolled back prior writes and nested-savepoint work. This says nothing about a transaction that skips the trigger. |
| Unexecuted tests | Stage K lists J-matrix cases not run, including broad cross-binding, multi-line shortage/substitution, complete append-only sweeps, nonce replay after rollback, competing reservations, full uncertain-COMMIT recovery, and crash/power-loss cases. They remain unverified, not failed. |
| Design limitation | SQLite cannot authenticate a trusted writer, determine whether distinct actor IDs belong to distinct people, verify signatures or online authorization, or stop a direct filesystem writer from replacing/modifying the database. |

## 3. SQLite capabilities and limitations

### 3.1 What SQLite can enforce

On a live connection with an intact schema and enforcement settings, SQLite
can enforce:

- `NOT NULL`, `CHECK`, primary/unique keys, and relational foreign keys.
- Row-level `INSERT`, `UPDATE`, and `DELETE` triggers.
- A one-way applying-to-committed state transition and immutable journal
  records, subject to the writer not altering schema or enforcement settings.
- Exact unique-index properties such as one reservation per order line and
  at most one reserve/fulfillment movement per reservation.
- Deferred foreign-key checks at the end of a transaction when foreign-key
  enforcement is enabled for that connection.
- Writer serialization through SQLite's locking and transaction mechanism.
- Rollback of the active transaction when a trigger explicitly uses
  `RAISE(ROLLBACK,...)`.

These are relational and transaction-engine properties. They do not prove
that an actor, evidence source, permission, medicine, signature, request
hash, or policy assertion is truthful.

### 3.2 What SQLite does not provide

- **No general commit trigger:** SQL triggers run for row-level table
  operations. A `BEFORE UPDATE` finalizer runs during that `UPDATE`, before
  the SQL statement completes. It does not run automatically at `COMMIT`.
- **Foreign keys are connection-scoped:** they must be enabled per connection
  and can be turned off outside a transaction. If disabled, FK definitions
  do not provide a commit-time guard.
- **Checks have a connection control too:** `PRAGMA
  ignore_check_constraints=ON` disables `CHECK` enforcement. Required
  settings must therefore be protected, not merely initialized.
- **Triggers and schema are not tamper-proof:** a connection with sufficient
  SQL/schema access can drop or replace triggers, change tables, use schema
  manipulation features, or write a different database file.
- **No writer identity:** SQLite does not know whether SQL came from Main,
  another module, a renderer, or a local process.
- **No transaction protocol ownership:** SQLite cannot force a caller to
  invoke a particular application-level validation routine before it issues
  `COMMIT`.

Thus, DDL supplies defense in depth; the coordinator is the completeness
boundary for the application's supported writer. An authorizer can constrain
SQL on a particular live connection but does not secure the database file
from other connections or processes.

## 4. Threat model and trust boundaries

| Threat actor / path | Required control | Protection and limitation |
|---|---|---|
| Renderer attempts unauthorized DB access | Database file and driver stay in Main; narrow IPC exposes named business commands only; validate every IPC payload and actor permission in Main. Do not expose SQL, file paths, connection objects, or generic query endpoints. | Prevents ordinary renderer code from obtaining a supported DB interface. Does not protect against a compromised Main process, unsafe preload bridge, OS-level debugging, or a local process with file access. |
| Other application modules attempt direct writes | Only a private persistence module owns the connection. Modules depend on typed command/query interfaces, not the driver or raw handle. Enforce import boundaries and code review/lint rules; no exported `execute`, `prepare`, or connection getter. | Architectural and tooling boundary, not a security sandbox inside one process. Any code able to import/reflect into the owner module or compromise Main can bypass it. |
| Second SQLite connection opened by application | Central connection factory only; no direct driver imports elsewhere; serialize all authoritative writes through one coordinator/connection. If read-only connections are required, use the same factory and hardening, set `query_only=ON`, and deny writes. | Each connection must be configured separately. An unregistered connection does not inherit the writer's authorizer/settings. Query-only is itself connection-specific and not a file security mechanism. |
| Local process with database-file access | Store in the app's private user-data location; apply least-privilege OS ACLs; avoid shared/network writable locations; protect backups and WAL/SHM sidecars; use signed application distribution and managed update practices. | ACLs protect against other OS principals only. A process running as the same user may be able to read or alter the database and sidecars. |
| Administrator, malware, or attacker able to modify the DB file directly | Explicitly out of scope for SQLite DDL/authorizer prevention. Detect some damage through startup checks, signed external checkpoints/backups, schema identity and audit verification; stop writes and require recovery/adjudication on inconsistency. | Cannot prevent direct modification or prove all file content authentic when the attacker controls the file and process. No automatic repair, deletion, reversal, or silent conflict resolution. |
| Compromised/trusted Main or arbitrary code with raw handle | Minimize code/handle exposure; use authorizer and defensive settings; restrict enabled extensions and schema operations; monitor unexpected SQL errors and schema drift. | These are defense-in-depth measures. Malicious code with control of the connection or process can remove/replace controls or use lower-level APIs. |

The guarantee in this design is scoped to the supported Electron application
execution path: an intact database file, a trusted Main process, connections
created through the private factory, and every authoritative write executed
by the single transaction coordinator. The design makes no claim against a
host-level attacker who can write the database file.

## 5. Recommended connection architecture

### 5.1 Ownership and access

1. A private `DatabaseConnectionManager` in Electron Main is the only
   component allowed to import or instantiate the SQLite driver.
2. It creates one authoritative read/write connection for the application
   lifetime. All write requests are placed on a single serialized command
   queue. Do not open a second write connection for a service, window, test
   helper, or background task.
3. The raw connection, statement objects, authorizer callbacks, and database
   path remain private implementation details. No public method accepts
   arbitrary SQL or returns driver objects.
4. `TransactionCoordinator` is the only component with the private capability
   to enter a write transaction and commit it. Command services supply typed,
   validated command data and receive a result; they do not own transaction
   boundaries.
5. Renderer IPC contains only named operations for the five approved
   commands and narrow read models. It must not expose SQLite, SQL, raw
   filesystem operations, arbitrary aggregate mutations, or a “generic
   execute” escape hatch.
6. Tests may use a test-only factory and disposable databases. Production
   module boundaries must not expose the test facility.

TypeScript `private`, naming conventions, and dependency-injection structure
are not cryptographic or OS security barriers. They reduce accidental access
and make bypasses reviewable; process isolation and filesystem controls cover
different threats.

### 5.2 Initialization and connection guard

For every new connection, perform the following before accepting requests:

1. Open the expected database path with the expected read/write/create flags.
   Verify canonical path, application ownership, and expected database
   identity/schema version. Do not fall back silently to a new or alternate
   database.
2. Set and read back required settings on that connection:

   ```sql
   PRAGMA foreign_keys=ON;
   PRAGMA journal_mode=WAL;
   PRAGMA synchronous=FULL;
   PRAGMA busy_timeout=5000;
   PRAGMA foreign_keys;
   PRAGMA journal_mode;
   PRAGMA synchronous;
   ```

   Required values are `1`, `wal`, and `2`; any mismatch prevents the
   connection from serving writes. `busy_timeout` is also read back using
   the driver's supported API or pragma. Initialization errors are surfaced;
   there is no success-shaped fallback.
3. Where the selected SQLite binding exposes the C API, enable defensive
   mode, disable extension loading, and set `trusted_schema=OFF`. Verify the
   result and qualify each behavior with that exact SQLite build/driver.
   Defensive mode is a hardening aid, not a substitute for the authorizer or
   file access boundary.
4. Install a SQLite authorizer before exposing the connection. Deny
   transaction-control statements (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`,
   `RELEASE`) except when the private coordinator capability is active; deny
   `ATTACH`/`DETACH`, schema DDL, trigger/index/table changes, writes outside
   the coordinator's statement path, and all unknown actions. Deny all PRAGMA
   writes after initialization, in particular changes to `foreign_keys`,
   `ignore_check_constraints`, `writable_schema`, `recursive_triggers`,
   `defer_foreign_keys`, `journal_mode`, `synchronous`, `trusted_schema`,
   `query_only`, and locking settings. Permit only required, read-only
   inspection pragmas.
5. The authorizer callback must fail closed. It must not approve a statement
   because a SQL string resembles a known statement. The coordinator uses
   fixed prepared statements and bound parameters. If the driver cannot
   install and preserve a SQLite authorizer on the connection, this design's
   hardening requirement is unmet; select or qualify a driver that can.
6. Keep the authorizer installed for the connection's lifetime. Do not expose
   a method to remove or replace it. Test required policy checks against the
   exact SQLite library and binding in an isolated file-backed test.
7. If a reader connection is later justified, create it through the same
   private manager, verify its settings independently, apply a read-only
   authorizer, and deny all transaction writes. It is not an alternate
   command path.

The authorizer sees prepared SQL actions on its connection. It does not see
another process opening the same file, and it cannot prevent trusted native
code that has the raw handle from resetting the authorizer or invoking
connection APIs. Accordingly, connection encapsulation and Main-process
ownership remain necessary.

## 6. Atomic transaction coordinator

### 6.1 Sole authoritative writer protocol

The coordinator implements one non-overridable protocol for all five
commands. The sequence is:

1. **Validate request before writes.** Validate the closed input schema,
   canonical representation, command type, aggregate ID/revision, safe
   integer quantities, medicine/unit catalog classification, actor and
   authorization policy, evidence provenance, signature and key status, and
   required independent actors. Unknown or incomplete inventory
   classification blocks the operation. Do not inherit new permissions for
   existing roles.
2. **Preserve identities.** Resolve or create the stable `command_id`,
   `commit_id`, and request hash before attempting the business commit. An
   exact retry uses these same identifiers and canonical request. A mismatch
   is an explicit conflict; never silently mint a replacement ID to make a
   retry succeed.
3. **Durably consume nonce(s).** Persist each nonce identity/state in the
   approved nonce protocol before the business attempt. A later business
   rollback does not free or reset a consumed nonce. Replays after rollback
   and after success are rejected. Keep this durable nonce operation distinct
   from the business transaction so an aborted command does not erase replay
   protection.
4. **Acquire the only write transaction.** The coordinator requests
   `BEGIN IMMEDIATE` through the private connection capability. If SQLite
   returns `SQLITE_BUSY`, the operation is transient and not a definitive
   business rejection; bounded retry uses the same IDs and request.
5. **Resolve idempotency before writing effects.** Look up the stable
   `commit_id` and `command_id`. If a matching commit is already durably
   committed, compare the complete command identity, all expected effects,
   manifest rows, revisions, and resulting projections/balances, then return
   the original result. A conflicting identity is recorded/reported as a
   conflict and never overwrites the first successful commit.
6. **Write a single applying unit.** Insert the applying commit and every
   command-specific row in the same transaction: roots, children, effects,
   evidence, approvals, revisions, projections, and complete manifest. No
   durable business effect is allowed outside this transaction.
7. **Validate completeness before finalization.** The coordinator runs the
   command-specific invariant set in §8 against the same transaction
   connection. It checks both directions of every relation, exact cardinality
   and bindings, expected effect kinds, request/command/commit identity,
   root projection and derived balance. Main-process checks supplement—not
   replace—DDL constraints.
8. **Finalize exactly once.** Only after every check succeeds, update the
   commit's state through the one permitted transition and insert its
   finalization witness if the schema uses one. Finalization triggers provide
   another validation layer. If any statement, check, trigger, or deferred
   constraint fails, the coordinator issues `ROLLBACK` if the transaction is
   still active. It never catches an error and proceeds to commit.
9. **Commit once.** The coordinator alone sends `COMMIT`. A successful
   `COMMIT` is the sole point at which the operation may be reported as
   durably successful. A prior successful finalization update is not success.
10. **Read back and return.** After a successful commit, read the stable
    result by the same `commit_id`; compare the whole effect/manifest set and
    resulting aggregate/balance before responding. If readback detects
    inconsistency, report an integrity incident and stop further writes; do
    not automatically repair or reverse.

All commands use this coordinator; there is no alternate service, migration,
background job, test helper, renderer, or “admin SQL” commit path. Schema
migrations are a separate restricted maintenance operation, not a command
writer and not available to routine feature code.

### 6.2 Failure, rollback, and uncertain outcome

- On every statement or validation error before `COMMIT`, coordinator
  explicitly rolls back if the connection reports an active transaction.
  `RAISE(ROLLBACK)` may already have rolled it back; the coordinator handles
  that state without attempting to commit. A failed `COMMIT` caused by a
  deferred constraint must likewise be followed by explicit rollback, unless
  the coordinator is deliberately retrying a transient `SQLITE_BUSY` commit
  on the still-active transaction.
- `SQLITE_BUSY` remains transient. Retry commit/transaction according to the
  driver contract with the same IDs; do not report a definitive business
  rejection solely from busy/locked.
- If process/IPC/OS failure makes the result uncertain, do not issue a new
  command identity or reverse anything. Reopen through the guarded connection
  manager, query the same `commit_id`, and compare the immutable request,
  finalization state, complete manifest/effect membership, revisions and
  resulting balance. If the exact committed result exists, return that
  original result. If no business commit exists, retry only with the same
  command/commit identities and nonce policy. If the state is partial,
  contradictory, or cannot be proven, stop and require explicit recovery
  adjudication.
- The first successful SQLite `COMMIT` for a `commit_id` wins. A duplicate
  exact retry returns the prior committed result; a conflicting retry never
  updates or replaces it.
- SQLite atomic transactions and WAL recovery are expected to leave a
  transaction wholly committed or wholly absent after ordinary process
  interruption, subject to SQLite, filesystem and storage guarantees. The
  particular driver/device/power-loss behavior must be independently tested;
  this document makes no validation claim.
- No automatic journal deletion, reservation timeout, reversal, correction,
  or silent conflict resolution is introduced.

## 7. Database-level defense strategy

The existing Stage H/J schema is a design input, not a certified invariant
set. A revised implementation DDL must be reviewed and tested against this
strategy; no existing DDL is modified here.

### 7.1 Constraints and triggers

Retain or provide:

- `STRICT` tables, exact `NOT NULL` and `CHECK` constraints, canonical
  identifier/hash/date/quantity syntax checks, and unique keys for logical
  identity, revision numbers, effect keys, command IDs, commit IDs, nonce
  values and child cardinalities.
- Composite foreign keys for command/commit/request-hash/aggregate binding,
  root/revision/effect binding, exact order-line/reservation identity and
  quantity, evidence-to-resource/commit/actor binding, approval-to-line,
  movement-to-reservation/line, and inventory-origin-to-creating operation.
- Row triggers that require an applying owning commit for effect insertion,
  reject invalid root transitions, reject immutable binding updates, verify
  movement before-state/arithmetic and command-kind correspondence, and
  reject updates/deletes to every append-only journal family.
- Manifest target validation and bidirectional equality: every manifest
  entry identifies exactly one actual effect row with matching key/kind/
  target/command/commit, and every effect has exactly one manifest entry.
  Exact allowed effect-kind cardinality is command-specific.
- Command-specific finalization triggers as defense in depth. They are
  explicitly named **finalization-transition triggers**, not commit triggers.
  Their failure does not substitute for coordinator validation or rollback.
- Deferred foreign keys/finalization witness only as an extra commit guard
  while foreign keys are enabled. Do not state that this mechanism is
  sufficient by itself.
- Insert-only `applying` state and immutable committed journal identity.
  Deny schema change and enforcement-setting changes on the authoritative
  connection so ordinary application SQL cannot remove the triggers or
  disable `CHECK`/FK controls.

`CHECK`/unique/trigger logic remains susceptible to direct schema/file
tampering and certain per-connection controls. Constraints alone also cannot
prove hashes were computed over the right canonical bytes, online
authorization, real distinct-person identity, evidence authenticity, or
catalog membership.

### 7.2 Exact data invariants at finalization

These are required database and coordinator checks. The coordinator must
check each item before commit even if a trigger repeats it:

1. Commit row exactly matches immutable command type, aggregate type/ID,
   expected revision, request hash, and commit ID.
2. Commit is applying before finalization and transitions exactly once.
3. Exactly one required root/revision projection exists for the command.
4. Every effect has one manifest row and every manifest row has one effect;
   keys and target IDs/types match, and there are no extra kinds.
5. Every evidence/approval reference is same-resource and same-commit; actor
   separation rules hold; required evidence has successful verification.
6. Every movement's identity, quantity, deltas and before/after snapshots
   match the exact source line/reservation and the inventory ledger.
7. All values are in safe-integer bounds; inventory balance is nonnegative;
   no duplicate, omitted, substituted, or extra movement exists.
8. No record can be attached after finalization or have its immutable
   command/commit/effect identity changed.

## 8. Required completeness invariants for the five commands

| Command | Atomic result required before coordinator permits `COMMIT` |
|---|---|
| `order.create` | Exactly one new order root and revision 1 `pending`, bound to the create command, commit and request hash. The root projection is exactly `(1,pending)`. There is at least one order line. Each line maps bijectively to exactly one reservation and one `reserve` movement with the same order, identity and quantity. The movement snapshot/arithmetic is exact and the balance reflects the reservation. Manifest contains precisely the root, revision, line, reservation and movement effects; no revision omission, unrelated effect or orphan is allowed. |
| `order.accept` | Exactly one revision 2 `accepted`, bound to the accept command/commit/hash, and root projection `(2,accepted)`. It requires the preceding revision 1 pending state and explicit administrative authorization. It produces no inventory movement and no other inventory effect; the manifest is exactly the required revision effect. |
| `order.fulfill` | Exactly one revision 3 `fulfilled`, bound to the fulfill command/commit/hash, and root projection `(3,fulfilled)`. There is exactly one fulfillment movement per committed reservation and none extra; each consumes the exact reserved quantity for the same identity and reservation. Resulting reserved/on-hand balances and movement snapshots reconcile exactly. |
| `inventory.bootstrap` | One batch root and active revision 1. The set of identities created by that commit equals the set of batch lines in both directions. Each identity has exactly one complete canonical identity and one itemized count/allocation line; each line has two distinct count evidence records/actors, verified evidence, an independent approval actor, and one exact movement from zero matching counted quantity and allocation. Manifest is exact; no unitemized identity or positive opening balance can commit. |
| `inventory.receipt` | One receipt root and received revision 1. Every line references exact source evidence/provenance, receiver and independent second approver; actors differ. A receipt may create a new canonical inventory identity inside this same transaction; a new identity is linked by origin, command, commit and the receipt line. Every line has exactly one positive receipt movement and matching manifest entry. No extra identity, line, evidence, approval or movement may commit. The resulting balance equals the receipt effects. A receipt does not require bootstrap pre-creation. |

For every command, nonce replay protection, immutable command/commit/request
cross-binding, first-successful-commit handling, and complete manifest
verification apply. Acceptance remains inventory-neutral. No new
business-transition command is introduced.

## 9. Enforcement classification

| Requirement | Primary enforcement | Classification / limitation |
|---|---|---|
| Row value formats, safe bounds, primary/unique keys | `CHECK`, `NOT NULL`, PK/unique constraints | SQLite-enforced only on an intact schema with check enforcement active; authorizer must deny `ignore_check_constraints`. |
| Cross-table command/revision/effect relationships | Composite FKs and triggers plus coordinator completeness queries | SQLite DDL on the protected connection; deferred FK behavior requires `foreign_keys=ON`. Coordinator independently verifies before commit. |
| Exact command completeness and no omitted revision/effect | Coordinator finalizer plus redundant command-specific triggers | Trusted transaction-coordinator invariant; SQLite has no automatic commit trigger. |
| Connection foreign keys/checks/journal/synchronous/busy settings | Connection manager initialization/readback; authorizer denies later SQL changes | Connection-configuration invariant, not a database-file property. C-level access by trusted code can still subvert it. |
| Sole transaction and COMMIT path | Private connection ownership, coordinator-only capability, authorizer transaction-control policy | Trusted Main-process invariant. SQLite cannot identify which application module issued SQL. |
| Request canonicalization and content-derived hashes | Main canonicalizer and hash implementation; SQL checks syntax only | Application-level validation. DDL cannot establish that a syntactically valid hash corresponds to canonical request/effect contents. |
| Catalog membership/classification | Trusted Main-process catalog and policy service | Application/service invariant; unknown classification blocks operations. |
| Evidence provenance/authenticity and digital signatures | Trusted acquisition path, cryptographic verification, key policy | Main/service invariant; SQLite can store bytes and references but not prove truth. |
| Independent human approver/counter | Main identity provider and policy checks; SQL actor-ID inequality as defense | Actor-ID inequality is a DB check, not proof of distinct humans. |
| Nonce no-reuse | Unique nonce identity/value plus durable nonce protocol | SQLite uniqueness plus coordinator ordering; local file rewrite is out of scope. |
| First successful `COMMIT` wins | Unique stable IDs, SQLite atomic commit, exact coordinator readback/retry | Database uniqueness plus trusted recovery logic. BUSY is transient, not rejection. |
| Process/file protection | Main-only ownership, narrow IPC, OS ACLs, protected backups/WAL/SHM | Operational assumptions; same-user or administrator file access can bypass them. |

## 10. Deterministic independent adversarial validation plan

This is a future validation plan only. No test below was run for Stage 36A70L.
It is deliberately split between a SQLite integration harness (for live
connection/DDL behavior) and a Main-process coordinator harness (for trusted
protocol behavior). A design reviewer must reject any report that treats
`integrity_check`, `foreign_key_check`, or DDL installation as proof of
business completeness.

### 10.1 Fixed fixture data

Use a fresh file-backed DB and fixed UTC time
`2026-11-12T10:00:00.000Z`; install the proposed schema and the approved
receipt policy `receipt_may_create`. The fixture catalog contains medicine
`med-a`, canonical unit `each`, tracking state `tracked`. Actors are:
`buyer`, `admin-acceptor`, `receiver`, `counter-a`, `counter-b`,
`approver`, and `evidence-verifier`; each has a distinct authenticated test
identity. Key ID is `test-key`; all signatures/evidence are deterministic
test values accepted only by the test verifier. All request hashes/effect
keys are computed by the same canonicalization/hash implementation under
test, not hand-entered unchecked values.

Create these committed baselines through the coordinator:

1. Bootstrap command `boot-cmd`, commit `boot-commit`, batch `boot-batch`,
   identity `id-a` = (`med-a`,`each`,`tracked`,`lot-a`, expiry `none`),
   counted/opening quantity 10 available, 0 reserved. Two evidence IDs
   `boot-e1`, `boot-e2`, counters `counter-a` and `counter-b`, distinct
   approver `approver`, one movement, one revision 1.
2. Order-create command `create-cmd`, commit `create-commit`, order `order-a`,
   line `line-a`, identity `id-a`, quantity 3, reservation `reserve-a`, one
   reserve movement, revision 1 pending. Expected post-commit balance for
   `id-a`: `(available=7,reserved=3,on_hand=10)`.
3. For lifecycle tests, accept via `accept-cmd`/`accept-commit` with revision
   2 and no movement, then fulfill via `fulfill-cmd`/`fulfill-commit` using
   exact reservation `reserve-a`, revision 3. Expected final balance:
   `(7,0,7)`.
4. For receipt tests, use a fresh baseline with the bootstrap above and
   receipt `receipt-a`/`receipt-cmd`/`receipt-commit`, new identity `id-r`
   = (`med-a`,`each`,`tracked`,`lot-r`, expiry date `2027-01-31`), line
   `receipt-line-a`, quantity 4, evidence `receipt-e1`, receiver `receiver`,
   second approver `approver`, one receipt movement and revision 1. Expected
   balance for `id-r`: `(4,0,4)`.
5. For two-line tests, create another independently valid bootstrap identity
   `id-b` with 5 available, same catalog/unit, `lot-b`, zero reserved.
   Orders `shortage-a` with lines `(id-a,3)` and `(id-b,6)` are expected to
   fail atomically because `id-b` has only 5. Do not create balances by direct
   SQL.

The harness must record each input, generated IDs/hash, SQL result/error,
whether the coordinator still owns an active transaction, and queried rows
after recovery. Any failed command fixture is retried only with the same
command ID, commit ID and canonical request.

### 10.2 Adversarial case matrix

For every command case, start from a fresh deterministic baseline unless the
case explicitly tests a retry. Expected errors below are semantic; exact
SQLite error strings may vary by supported driver/version.

| ID | Procedure / exact adversarial action | Expected observable outcome |
|---|---|---|
| L01 | Open authoritative connection via factory; read `foreign_keys`, `journal_mode`, `synchronous`, `busy_timeout`; attempt `PRAGMA foreign_keys=OFF;`, `PRAGMA ignore_check_constraints=ON;`, and `PRAGMA writable_schema=ON;` through its SQL interface. | Readback is `1`, `wal`, `2`, configured timeout; authorizer denies setting changes; settings remain unchanged. |
| L02 | Through same connection try `DROP TRIGGER`, `ALTER TABLE`, `ATTACH DATABASE`, generic `BEGIN`/`COMMIT`, and arbitrary INSERT into an effect table outside coordinator capability. | Authorizer denies all attempts. No schema/object or business row changes. |
| L03 | Renderer invokes a generic SQL IPC shape, passes database path/connection object, or calls an unsupported command. | IPC rejects; renderer receives no database handle/path or generic SQL response. DB state unchanged. |
| L04 | Attempt to create a second read/write connection by importing driver outside connection manager. | Static module-boundary check and runtime factory instrumentation reject or identify it. No alternate writer is accepted. |
| L05 | Through test-only raw SQLite connection, reproduce Stage K exactly: `PRAGMA foreign_keys=OFF`; create applying `order.create` root/line/reservation/reserve movement for `id-a` qty 3; omit revision and finalization; `COMMIT`. | This is explicitly an out-of-boundary raw-connection test. It demonstrates that SQLite/file access alone can violate invariants; do not report it as preventable by authorizer on the separate protected connection. Document state and threat limitation. |
| L06 | Supported coordinator order.create with exact fixture. | One revision 1 pending, root `(1,pending)`, one exact reservation and movement, exact manifest, balance `(7,3,10)`. |
| L07 | Inject failure after reservation/movement writes but before revision insert; return error through coordinator. | Coordinator rolls back entire order transaction; no `create-commit` business rows or order projection; balance remains `(10,0,10)`. |
| L08 | Test-only coordinator fault tries to omit revision, manifest row, or misbind revision command/commit/hash; separately tries extra manifest/effect and incorrect projection. | Coordinator validation/finalizer refuses commit and rolls back; no partial business state; unchanged balance. Trigger rejection is supplementary. |
| L09 | Direct SQL through protected handle tries a second revision 1, revision 3 before revision 2, wrong command/revision/hash, and post-commit revision insert/update/delete. | Authorizer denies out-of-coordinator writes; DDL uniqueness/guards reject any allowed fixture path; committed root and revisions unchanged. |
| L10 | Submit order.accept with exact expected revision 1. Then inject a movement or omit/misbind revision 2. | Valid accept advances root to `(2,accepted)` with exactly zero movements. Invalid case rolls back, retaining pending revision 1 and reservation. |
| L11 | Submit order.fulfill against exact reservation. Variants omit, duplicate, substitute quantity/identity, or add movement. | Valid case creates revision 3 and consumes exact reservation once, balance `(7,0,7)`. Each invalid case rolls back; root stays accepted and balance `(7,3,10)`. |
| L12 | Submit the fixed two-line order `(id-a,3),(id-b,6)` where `id-b` has only 5; allow first line writes before shortage. | Entire command transaction rolls back; no root/line/reservation/movement/revision/manifest for that commit; both identities retain their pre-command balances. |
| L13 | Bootstrap with fixed valid evidence/count/approval/movement; then variants omit line, evidence, verification, independent approval, movement, or manifest; introduce extra identity, duplicate identity, wrong origin, wrong allocation, or extra movement. | Valid batch commits exact identity/line bijection and balance. Every invalid variant refuses COMMIT and leaves no batch-created identities or positive opening balances. |
| L14 | Receipt valid fixture creates new `id-r` atomically. Variants omit source evidence, verification, independent approval, receipt line, movement, revision, identity manifest; add an unlinked identity; use same receiver/approver; reuse a conflicting identity. | Valid case commits all related rows and balance `(4,0,4)`. Invalid cases leave no receipt-created identity/receipt/evidence/effect for that commit. Same identity cannot be rebound or duplicated. |
| L15 | For each command, bind one child/effect/evidence row to a different command ID, commit ID, aggregate ID, resource ID, request hash, or manifest key. | Coordinator rejects each mismatch; state remains the committed baseline. Cross-FKs/triggers reject SQL-level variants where applicable. |
| L16 | Update/delete each append-only family (commands, commits/finalizations, manifests, revisions, order lines, reservations, movements, identities, batch/receipt records, evidence, verification history, authorization, keys/events, nonces, recovery records). Attempt late insert under finalized commit. | Protected connection rejects mutation; no stored bytes, identity, approval, effect, or balance changes. Test every table family by catalog enumeration. |
| L17 | Replay nonce once after a business rollback and once after successful commit; try same nonce under another ID/command/hash. | Every replay rejected by durable nonce identity/uniqueness; failed business transaction does not restore nonce. |
| L18 | Retry exact successful commit IDs and then conflicting request/hash under the same command/commit identity. | Exact retry returns the first committed result after full comparison; conflict is explicit, never overwrites or reverses winner. |
| L19 | Two coordinator requests contend for a balance, each requests more than remaining stock in aggregate. Use two coordinator clients but one protected writer queue; repeat with separate read connections only. | No oversubscription or negative balance. BUSY/locked is transient; retry preserves IDs. One winner/shortage result only after serialized state is known. |
| L20 | Inject process termination before BEGIN, after each write stage, during finalization, immediately before COMMIT, immediately after COMMIT but before response; reopen the same file through connection factory. | Before successful COMMIT, no partial business command. After successful COMMIT, exactly one complete result. Unknown response is resolved by same commit ID and full result comparison; no new ID or automatic reversal. |
| L21 | On every test database run `foreign_key_check`, `integrity_check`, command-scoped bidirectional manifest/effect queries, and movement/balance reconciliation. | FK list empty, integrity `ok`, exact effect bijections, expected balances. These checks supplement but do not replace case-specific outcomes. |
| L22 | Copy the DB file to a separate test directory and directly drop/alter triggers or commit malformed data using an unrestricted local SQLite process. | Expected to demonstrate the threat-boundary limitation, not a protection pass. Record which startup integrity/schema/signature checks detect the alteration; document that SQLite cannot prevent the write. |

The validation report must distinguish test-fixture/harness defects from
product failures, record all unexecuted cases, and never describe the L05 or
L22 threat-boundary demonstrations as attacks prevented by SQLite DDL.

## 11. Traceability to previous defects and decisions

### 11.1 Defect traceability

| Prior finding | Evidence availability | Proposed control | Required independent test |
|---|---|---|---|
| Stage 36A70G: finalized receipt root command/commit/effect binding diverged from immutable revision | Stage G report unavailable; Stage H/I retrospective description; K tested root rebind rejection | Immutable root/revision identities, composite command/commit/hash FKs, post-finalization append-only controls, coordinator readback | L14-L16: root and receipt child rebind, plus revision/effect cross-bind attempts |
| Stage 36A70G: effects/manifest could be appended after finalization | Stage G original report unavailable; H/I retrospective; K late manifest insert rejected | Applying-only effect insertion, immutable manifest, coordinator exact-set check, authorizer/schema protection | L08, L14, L16: late and orphan effect/manifest insertion/update/delete |
| Stage 36A70G: bootstrap allowed extra unitemized identity | Stage G original report unavailable; I/J/K record finalizer rejection | Two-way identity↔count-line completeness, evidence/approval/movement checks, coordinator finalization | L13: extra/omitted identity, line, evidence, approval, movement and manifest variants |
| Stage 36A70G: empty medicine ID accepted | Stage G original report unavailable; I/J/K tested empty ID rejection | SQLite canonical-format CHECK plus trusted catalog existence validation | L13-L15 include empty/malformed/unknown medicine cases; ensure unknown catalog item blocked by Main |
| Stage 36A70G: receipt could not create a new identity | Stage G original report unavailable; owner decision later explicitly approved receipt creation | Receipt-created identity and all evidence/approval/movement/effect rows in one command transaction | L14 positive new identity and each missing-component rollback |
| Stage 36A70I: order.create reservation committed without revision 1 | Exact reproduced SQL/procedure and output in K §4.3; see §2.2 above | Sole coordinator owns transaction/commit; required revision 1 in precommit finalizer and DDL transition trigger; protected connection settings | L05 reproduces out-of-boundary limitation; L06-L09 verify supported path and rollback |
| Stage 36A70I: receipt policy text allowed `existing_only` contrary to owner approval | Recorded in I/J/K; owner decision is binding | Encode only receipt-may-create policy; no fallback or unresolved setting | L14 valid receipt-created identity; startup/configuration rejects contrary policy |
| Stage 36A70K: no actual COMMIT trigger; deferred FK depended on foreign_keys | Exact K architecture analysis | Explicitly treat schema trigger as transition guard; coordinator is the only COMMIT path; authorizer protects connection pragma | L01-L02 and L05 |
| Stage 36A70K: incomplete command matrix tests | Exact unexecuted matrix entries in K | Deterministic fixture set and exhaustive command/append-only/concurrency/crash matrix | L06-L22, including recording NOT EXECUTED rather than inferring |

### 11.2 Approved-decision traceability

| Approved decision | Preserved by this design |
|---|---|
| Five release-one commands only | Coordinator accepts only `order.create`, `order.accept`, `order.fulfill`, `inventory.bootstrap`, `inventory.receipt`. |
| Receipt may create new identity atomically | §8 and L14 require receipt-created identity with evidence, independent approval, movement, manifest and receipt revision in one transaction. |
| Order lifecycle `pending → accepted → fulfilled` | Revisions 1/2/3 are mandatory and command-bound in §8. |
| Acceptance is administrative and has no inventory movement | Exact zero-movement invariant for `order.accept`. |
| Fulfillment consumes exact reservation | Identity, reservation, quantity and movement bijection required. |
| No automatic journal deletion | Append-only controls and L16; no retention/cleanup command. |
| No automatic reversal or silent conflict resolution | Conflict/uncertain state stops for same-ID verification or adjudication. |
| First successful COMMIT for a commit ID wins | Unique stable identity, exact-result retry and readback. |
| Main-only ownership through narrow IPC | §4/§5 connection and IPC boundary. |
| No automatic permission inheritance | Main authorization is explicit per command and actor/role policy; no role inheritance added. |
| `SQLITE_BUSY` is not definitive rejection | Coordinator classifies as transient and retries/reconciles using same IDs. |
| No legacy stock conversion or other inventory operations | No such command or transition added. |
| Missing classification blocks operations | Catalog validation is a mandatory precondition; unknown/incomplete classification fails closed. |
| Pending reservations may remain indefinitely | No timeout, release, cancellation, or expiry path is introduced. |

## 12. Workspace preservation and final status

Baseline before authoring:

- Branch: `fix/stage36a2-operation-journal-fixture`.
- Pre-existing tracked modifications: `electron/application/order-requests.service.ts`
  and `tests/stage8/helpers/renderer-harness.ts`.
- Pre-existing untracked files included Stage 36A70F/H/I/J/K documents and
  `forensic_analysis.txt`, `temp.txt`, `temp_main.txt`, and `verify_report.txt`.

This stage creates only this design document. It does not modify previous
specifications/reports, source, tests, configuration, dependencies, databases,
or branch state. Final Git status is to be checked after creating this
document. No SQL or DDL was executed and no validation result is claimed.

`STAGE_36A70L_DESIGN_READY_FOR_INDEPENDENT_REVIEW`
