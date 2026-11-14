# Stage 36A70K — Independent Adversarial Validation Report

## 1. Executive determination

**Final status: `STAGE_36A70K_VALIDATION_FAILED`**

The composed Stage H + Stage J SQL executed successfully as one script on a
fresh file-backed SQLite database. Stage J's supplied complete positive
fixtures successfully committed bootstrap, order creation, acceptance,
fulfillment, and a receipt that created a new identity. Under
`PRAGMA foreign_keys=ON`, the tested incomplete-finalization cases were
rejected; `RAISE(ROLLBACK)` rolled back the entire transaction, including a
prior write inside a nested savepoint.

The central architectural claim is conditional, however. SQLite has no
SQL-level `BEFORE COMMIT` trigger. Stage J's completeness trigger is a
`BEFORE UPDATE OF status` row trigger on `commit_records`; it executes only
when SQL updates a commit row from `applying` to `committed`. A deferred
foreign key prevents a plain `COMMIT` with an `applying` commit only while
foreign-key enforcement is enabled.

I reproduced a direct SQL bypass using the ordinary, connection-scoped
`PRAGMA foreign_keys=OFF`: the incomplete Stage J `order.create` fixture then
committed with status `applying`, no revision rows, order projection revision
0, and a reserved balance of 3. This violates the absolute invariant that no
transaction can commit a reservation without revision 1. Stage J documents
that each trusted Main-process connection must enable and verify foreign
keys, so this bypass violates its operational connection contract. But that
configuration is not enforceable by the schema, and the task explicitly asks
whether a transaction can bypass the mechanism. Therefore the design is not
an unconditional SQLite-enforced commit guarantee.

Numerous matrix cases also remain unexecuted because Stage J describes them
without complete SQL fixtures or expected row-by-row setup. No implementation
readiness is claimed.

## 2. Scope, files, and workspace integrity

### Documents inspected

- [stage36a70j-corrected-sqlite-ddl-specification.md](</E:/programs and applications/desktop/drug-manager/docs/stage36a70j-corrected-sqlite-ddl-specification.md>) — read in bounded ranges through its final section.
- [stage36a70i-independent-validation-report.md](</E:/programs and applications/desktop/drug-manager/docs/stage36a70i-independent-validation-report.md>) — read through the final status and matrix.
- [stage36a70h-corrected-sqlite-ddl-specification.md](</E:/programs and applications/desktop/drug-manager/docs/stage36a70h-corrected-sqlite-ddl-specification.md>) — read through the DDL, triggers, transaction protocols, and validation material.
- Stage 36A70G report — searched the workspace; unavailable. No contents have been reconstructed or invented. Stage H/I summaries are treated only as those documents' retrospective descriptions.

### Git/worktree

| Observation | Before validation | After validation |
|---|---|---|
| Branch | `fix/stage36a2-operation-journal-fixture` | `fix/stage36a2-operation-journal-fixture` |
| Existing tracked changes | `electron/application/order-requests.service.ts`; `tests/stage8/helpers/renderer-harness.ts` | Unchanged |
| Existing untracked files | Stage 36A70F/H/I/J documents; `forensic_analysis.txt`; `temp.txt`; `temp_main.txt`; `verify_report.txt` | Same, plus this report |
| Other changes | None made by Stage K | No source/specification/dependency/database changes; only temporary SQLite files outside the repository |

No branch change, commit, push, deployment, or production/Firebase access
occurred.

## 3. Specification identity and full DDL execution

### Input identity

| Item | Value |
|---|---|
| Stage J specification path | `E:\programs and applications\desktop\drug-manager\docs\stage36a70j-corrected-sqlite-ddl-specification.md` |
| File size | 81,883 bytes |
| Decoded character count | 81,809 |
| Line count | 1,254 |
| Raw-file SHA-256 | `0eaf251e9fdedf1f48f22ce92ab8598535e5954ceedd4c2d88e4a8ed05ec241b` |
| Stage I report SHA-256 | `383D5E1FBEDA3AE881AA69A1BDA43165D81A31CB67C815D97DEAA1A1E571F207` |
| Stage H specification SHA-256 | `14B9AD08B5B79556EF41E9243484576D920FCE256E70A3AA6911F022C9CAC3ED` |

### DDL source and execution

Stage J is not a self-contained schema file: §4.1 requires the two SQL blocks
from Stage H §4 plus Stage J SQL. Stage J says there are “two Stage J SQL
blocks” but §4 actually contains three fenced SQL blocks: the policy trigger,
the owner policy-row insert, and the command-completeness trigger. I executed
all five extracted blocks in document order as one `sqlite3.Connection.executescript`
against a fresh file-backed SQLite database. The policy-row insert was part
of that one-script execution; in subsequent isolated test databases, the same
two triggers were installed and the policy row inserted as fixture
initialization.

| Evidence | Actual result |
|---|---|
| SQLite version | `3.50.4` |
| Full script | 89,924 decoded characters; 1,697 lines |
| Full script SHA-256 | `008190cc04fe0c04f934953283e762f79f23cd75f7ddb09f661d994088070943` |
| Execution | Success; no SQL error |
| `PRAGMA foreign_keys` | `1` |
| `PRAGMA journal_mode` | `wal` |
| `PRAGMA synchronous` | `2` (`FULL`) |
| `PRAGMA foreign_key_check` | Empty result on fresh database |
| `PRAGMA integrity_check` | `ok` |
| Supplemental triggers present | `commit_command_completeness`; `stagej_receipt_policy_guard` |

SQLite compile options were read. Relevant values included
`THREADSAFE=1`, `DEFAULT_SYNCHRONOUS=2`, `DEFAULT_WAL_SYNCHRONOUS=2`,
`ENABLE_FTS5`, and `MAX_VARIABLE_NUMBER=32766`; the full runtime had 43
compile-option rows. No application/Electron driver was tested.

## 4. Trigger and transaction-semantics findings

### 4.1 Not a commit-time trigger

The Stage J trigger is declared:

```sql
CREATE TRIGGER commit_command_completeness
BEFORE UPDATE OF status ON commit_records
WHEN OLD.status='applying' AND NEW.status='committed'
...
```

It fires during the row update statement, before SQLite applies that row's
status transition. It does **not** fire on the SQL `COMMIT` statement, and it
does not run when finalization is omitted. SQLite SQL triggers are associated
with row-level `INSERT`, `UPDATE`, or `DELETE` events; this script defines no
SQL `COMMIT` trigger.

Stage H's cyclic, deferred foreign key from `commit_records` to
`commit_finalizations`, plus the `commit_finalizations` insert guard and
one-way state transition, is the separate commit-time gate when
`foreign_keys=ON`.

### 4.2 Observed behavior with foreign keys enabled

**No finalization.** I executed the supplied complete `order.create` fixture
through its root, line, reservation, and reserve movement, omitted the status
update, and called `COMMIT`. SQLite returned:

```text
IntegrityError: FOREIGN KEY constraint failed
```

The transaction remained open (`in_transaction=True`); its uncommitted order
rows were visible on that connection. Explicit `ROLLBACK` removed them and
restored the committed bootstrap balance to `(10,0)`. Thus the deferred FK
blocks commit, but a failed `COMMIT` does not itself roll back the transaction.

**Incomplete finalization.** The Stage I missing-revision fixture was rerun
with the supplied Stage J baseline. The attempted:

```sql
UPDATE commit_records
SET status='committed', finalized_at='2026-11-12T10:00:00.000Z'
WHERE commit_id='ocm';
```

returned `IntegrityError: order.create incomplete or misbound`. Because the
trigger uses `RAISE(ROLLBACK,...)`, `in_transaction=False`; the order, line,
reservation, movement, manifest and commit effects from that business
transaction were absent, and the pre-existing inventory balance was again
`(10,0,10)`.

**Nested savepoint.** The same incomplete-finalization test was run inside a
savepoint after inserting a sentinel row in the outer transaction. The
finalization error left `in_transaction=False`; the sentinel and all business
rows were absent. This confirms SQLite's `RAISE(ROLLBACK)` conflict action
rolled back the entire transaction, not only the savepoint.

### 4.3 Observed bypass with foreign keys disabled

Using the Stage J §7.2 bootstrap fixture to create a committed balance of 10,
I then ran the same `order.create` setup with these exact changes:

```sql
PRAGMA foreign_keys=OFF;
-- Run the supplied Stage J order.create fixture statements through:
-- root at revision 0/pending, line quantity 3, reservation quantity 3,
-- reserve movement from (10,0) to (7,3), and its matching manifests.
-- Omit the order.revision manifest row and order_revisions insert.
-- Omit UPDATE commit_records ... status='committed'.
COMMIT;
```

`COMMIT` succeeded. Observed state:

```text
PRAGMA foreign_keys                         -> 0
commit_records ('ocm','applying')            -> present
orders ('o',0,'pending')                     -> present
order_revisions for 'o'                      -> 0 rows
inventory_balances for 'i'                   -> (available=7,reserved=3,on_hand=10)
PRAGMA foreign_key_check                     -> ('commit_records',2,'commit_finalizations',0)
```

This is a successful partial business commit without revision 1. The
completeness trigger was bypassed by not updating commit status; the deferred
foreign-key gate was disabled on the connection. Stage J requires Main to
enable/read back `foreign_keys=1`, but SQLite cannot enforce that
connection-scoped setting. The operational connection contract is therefore
part of the invariant, not a database-enforced guarantee.

### 4.4 Other state-transition attempts

- A duplicate finalization update after a committed order returned
  `only applying-to-committed is permitted`.
- Direct `orders` projection mutation returned
  `order projection requires matching next revision`.
- Post-commit receipt root rebind returned `receipt identity is immutable`.
- Post-commit manifest insertion returned
  `manifest entries require an applying commit`.
- Post-commit revision insert/update/delete and movement update/delete were
  rejected by their applicable applying-only/append-only guards.
- Direct `COMMIT` without finalization while foreign keys were enabled failed
  at the deferred FK check, not at `commit_command_completeness`.

## 5. Executed positive and adversarial evidence

The fixed Stage J §7.2 SQL fixtures were extracted without changing their
values. The base fixture committed bootstrap and order creation; the next
fixtures committed acceptance, fulfillment and receipt-created identity.
Additional variants were generated only by removing or changing the specific
fixture statement under test; those transformations are stated below.

### Executed test results

| Test ID | Exact SQL/procedure executed | Expected | Actual state/result | Result |
|---|---|---|---|---|
| J01 | Extract both Stage H §4 SQL blocks and all three Stage J §4 code blocks in order; one `executescript` on a fresh file DB. | Full script executes; required triggers exist; clean checks. | Success; `foreign_keys=1`, `wal`, `synchronous=2`; FK check empty; integrity `ok`. | PASS |
| J02 | Execute Stage J §7.2 base fixture verbatim. | Active bootstrap and revision-1 pending order; exact balance. | Batch `('b',1,'active')`; order `('o',1,'pending')`; balance `('i',7,3,10)`. | PASS |
| J03 | From base fixture, remove the `(printf('%064x',12),...,'order.revision',...)` manifest tuple and the `INSERT INTO order_revisions ... 'orv1'` statement. Execute finalization update. | Reject and remove all `ocm` effects. | `order.create incomplete or misbound`; transaction rolled back; only prior bootstrap remained; balance `(10,0,10)`. | PASS |
| J04 | From base fixture, keep revision row but remove only its revision manifest tuple; execute finalization. | Reject missing manifest binding and roll back. | `order.create incomplete or misbound`; no `ocm` rows; balance `(10,0,10)`. | PASS |
| J05 | Change only the revision fixture's request hash from `printf('%064x',10)` to `printf('%064x',11)`. | Reject wrong request binding. | `revision/command/aggregate/hash mismatch`; create transaction absent; balance `(10,0,10)`. | PASS for request-hash subcase; other misbindings not run. |
| J06 | Attempt a second revision-1 insert for committed order `o`; separately attempt revision 3 before revision 2 was not run. | Reject duplicate/skipped revision. | Duplicate insert returned `revision requires applying commit`. | NOT EXECUTED as full test (skipped-revision case absent). |
| J07 | On committed order, attempt duplicate revision insert; `UPDATE order_revisions SET status='fulfilled' WHERE revision_id='orv1'`; `DELETE` same row. | Reject insert/update/delete. | Insert rejected as applying-only; update `order revisions are immutable`; delete `order revisions are retained`. | PASS |
| J08 | `UPDATE orders SET current_status='fulfilled',current_revision=3 WHERE order_id='o';` after valid create. | Root unchanged. | `order projection requires matching next revision`; root remained `(1,'pending')`. | PASS |
| J09 | Remove initial revision/manifest as J03; separately try root `(0,'accepted')`. | Incomplete create rejected; invalid initial status rejected. | J03 rolled back; bad root failed table CHECK for allowed revision/status pairs. | PASS for tested cases |
| J10 | No fixture variant omitting only reservation or only reserve movement was run. | Reject and roll back. | Not executed. Stage J gives expected result but no complete per-case SQL script. | NOT EXECUTED |
| J11 | No quantity/identity substitution fixture was run. | Reject substitution. | Not executed; required second valid identity and per-command rows were not supplied as complete SQL. | NOT EXECUTED |
| J12 | No two-identity 5-unit atomic shortage fixture was run. | Roll back all lines and preserve `(5,0)` balances. | Not executed. Stage J says to clone an identity but provides no exact second-bootstrap SQL or complete order-create statements for this case. | NOT EXECUTED |
| J13 | Execute Stage J acceptance SQL after base. | Revision 2 accepted; zero movements. | Root `(2,'accepted')`; no movement from `oam`. | PASS |
| J14 | Remove both `orv2` revision manifest and revision insert from acceptance fixture, then execute finalization. | Reject; retain pending revision 1. | `order.accept incomplete or has inventory effects`; order remained `(1,'pending')`; `oam` rolled back. | PASS for omission; wrong-field variants not run. |
| J15 | No accept transaction with an injected reserve/fulfill movement or extra effect was run. | Reject and preserve prior state. | Not executed; no complete hostile accept fixture specified. | NOT EXECUTED |
| J16 | Execute Stage J fulfillment fixture after valid acceptance. | Revision 3 fulfilled; exact reservation consumed. | Root `(3,'fulfilled')`; balance `(7,0,7)`. | PASS |
| J17 | Remove the `INSERT INTO inventory_movements ... 'ofm1'` statement from fulfill fixture. | Reject and preserve accepted state/reservation. | `order.fulfill incomplete or misbound`; root remained `(2,'accepted')`; balance remained `(7,3,10)`. | PASS for omission; extra/duplicate/substitution not run. |
| J18 | Run bootstrap fixture with an additional manifest and identity `i-extra` (`med-b`, `lot-b`) but no batch line/evidence/approval/movement; finalize. | Reject and roll back entire bootstrap. | `inventory.bootstrap incomplete or misbound`; no batch, identity, or commit remained. | PASS |
| J19 | Bootstrap missing evidence/approval/movement or extra-line variants not run. | Reject and leave no positive balance. | Not executed; Stage J supplies no distinct complete SQL variant for every omission. | NOT EXECUTED |
| J20 | Wrong origin, wrong allocation, extra movement and duplicate line variants not run. | Reject. | Not executed. | NOT EXECUTED |
| J21 | Execute Stage J receipt fixture after bootstrap/key fixture; creates `ri` in same receipt. | Received revision 1; balance equals 4. | Receipt `(1,'received')`; identity origin `receipt`; balance `(ri,4,0,4)`. | PASS |
| J22 | Remove receipt movement insert from supplied receipt fixture; run after bootstrap, then explicitly `ROLLBACK` after error. | Reject incomplete receipt and remove all transaction rows. | Revision insert returned `receipt lines/evidence/movements incomplete`; before rollback `rcm` applying, receipt pending, `ri` balance `(0,0)`; after rollback no `rcm`, receipt, identity, or movement. | PASS for missing movement; other component omissions not run. |
| J23 | Duplicate/conflicting six-component identity scenarios not run. | Reject duplicate/conflicting identity atomically. | Not executed; complete duplicate receipt SQL fixture absent. | NOT EXECUTED |
| J24 | On fresh schema attempt policy row with `existing_only`; separately valid policy row used for positive receipt fixture. | Reject `existing_only`; permit receipt-create model. | `owner-approved receipt policy requires receipt_may_create`; positive receipt passed with approved value. | PASS |
| J25 | Post-commit `UPDATE inventory_receipts SET command_id='bc',commit_id='bm',effect_key=printf('%064x',1) WHERE receipt_id='r'`; post-commit manifest insert/update. | Reject rebind and manifest mutation. | Root `receipt identity is immutable`; insert requires applying; manifest update `manifest entries are immutable`; original root/manifest retained. | PASS for these attacks; receipt-line mutation/addition not run. |
| J26 | Change receipt line receiver and approver to same value (`'approver','approver'`). | CHECK rejects. | `CHECK constraint failed: receiver_actor_id<>second_approver_actor_id`; full SQL error left transaction open until rollback/close. Bootstrap same-actor variant not run. | PASS for receipt case |
| J27 | Change receipt evidence resource ID from `rl` to `wrong-resource`. | Composite FK rejects. | `FOREIGN KEY constraint failed`; statement rejected. Full resource/commit/actor variants not run. | PASS for resource subcase |
| J28 | Post-commit evidence verification/key history and broad append-only family attacks not all rerun. | Mutations/deletions and late inserts reject. | Not executed as a full table-family sweep. | NOT EXECUTED |
| J29 | Valid applying receipt commit; attempt movement with quantity 1, available delta 1, reserved delta 0, but `on_hand_delta=0`. | Arithmetic CHECK rejects; no ledger change. | `CHECK constraint failed: on_hand_delta=available_delta+reserved_delta`; transaction rolled back; balances unchanged. Unsafe integer variants not run. | PASS for arithmetic subcase |
| J30 | Direct balance-view write and wrong before snapshot were not run in Stage K. | Reject. | Not executed. | NOT EXECUTED |
| J31 | On committed receipt movement attempt quantity UPDATE and DELETE. | Both rejected. | `movements are immutable`; `movements are retained`. | PASS |
| J32 | Missing revision manifest, late manifest insert, and manifest UPDATE attempted. | Reject omissions/orphans/late changes. | Missing revision manifest rejected at finalization; late insert requires applying; update immutable. Wrong target/orphan effects not all run. | PASS for listed subcases |
| J33 | Full anti-join audit of all origin/evidence/movement/manifest sets not run. | Differences empty or finalization rejects. | Not executed. | NOT EXECUTED |
| J34 | With a valid applying receipt commit and matching identity manifest, insert `medicine_id=''`. | CHECK rejects empty ID. | CHECK failure on medicine ID length/grammar. Other identity/date/hash formats not run. | PASS for empty medicine |
| J35 | Alter only revision request hash in create fixture. | Reject wrong binding. | `revision/command/aggregate/hash mismatch`; no create effects. Other wrong-command/revision cases not run. | PASS for hash subcase |
| J36 | Nonce replay after business rollback not run. | Reuse rejected; consumed nonce retained. | Not executed. | NOT EXECUTED |
| J37 | Reuse receipt nonce value under a different nonce ID after successful receipt. | Unique nonce rejects replay. | `UNIQUE constraint failed: nonce_records.nonce_value`. Other replay states not run. | PASS for successful replay |
| J38 | Complete UPDATE/DELETE sweep across every append-only table not run. | All prohibited operations reject. | Not executed. | NOT EXECUTED |
| J39 | After valid commit, direct duplicate INSERT of same `commit_id` and exact identity. | Database rejects duplicate; application retry should read original. | `UNIQUE constraint failed: commit_records.commit_id, commit_records.request_hash`. Main-process exact-result retry was not testable. | PASS for unique-key subcase |
| J40 | Direct conflicting duplicate `commit_id` with changed hash. | Reject without changing winner. | `UNIQUE constraint failed: commit_records.commit_id, commit_records.command_id`; winner unchanged. Conflict-observation behavior not run. | PASS for unique-key subcase |
| J41 | Leave an incomplete business transaction uncommitted, close connection, reopen file. | Partial rows absent; prior bootstrap retained. | On reopen only bootstrap commit remained; order absent; balance `(10,0)`; WAL; FK empty; integrity `ok`. | PASS |
| J42 | Lost response after a successful COMMIT and full-result recovery comparison not simulated. | Exact first result returned; no duplicates/reversal. | Not executed; Main-process recovery/fault injection absent. | NOT EXECUTED |
| J43 | Competing complete reservation transactions / oversubscription not run. | Serialize and reject shortage without negative balance. | Not executed; Stage J lacks complete second-identity and two-connection command SQL. | NOT EXECUTED |
| J44 | Concurrent duplicate commit submissions not run. | One winner, exact retry readback, conflicts rejected. | Not executed; no complete two-connection fixture. | NOT EXECUTED |
| J45 | File-backed WAL and FULL were read on fresh database; interrupted transaction reopened and checked. | WAL/FULL per connection, whole transaction or none. | WAL and `synchronous=2` confirmed on initial DDL connection; WAL and clean integrity/FK state after interrupted reopen. FULL readback on every reopened/test connection and crash fault not run. | NOT EXECUTED as full test |
| J46 | `foreign_key_check`/`integrity_check` run on fresh DB and reopen; complete anti-join/ledger audit not run. | No FK rows, `ok`, exact balances and no missing/extra effects. | Fresh/reopen checks clean; valid fixture balance queries matched. Full schema-wide anti-join audit absent. | NOT EXECUTED as full test |

## 6. Exact failure evidence and defects

| ID | Severity | Defect / impact | Reproduction / evidence | Required corrective consideration |
|---|---|---|---|---|
| K-01 | **Critical** | Stage J's completeness guarantee is not unconditional SQLite enforcement. A direct writer can disable the connection's foreign keys and commit partial order state without invoking finalization. The schema then contains a committed reservation with no revision 1 and an applying commit. | `PRAGMA foreign_keys=OFF;` followed by the Stage J create fixture through the reserve movement, omitting revision manifest, revision row, and status finalization, then `COMMIT;`. Actual state is recorded in §4.3. | If the intended guarantee includes direct SQL writers, the design must not depend solely on a connection pragma that can be disabled. Otherwise scope the guarantee explicitly to connections whose foreign-key pragma is set and verified by an exclusively trusted Main process; treat that as a required operational precondition, not an SQLite constraint. |
| K-02 | High | “Commit-time trigger” terminology is inaccurate and could lead callers to believe omitted finalization is itself intercepted by the trigger. | Trigger definition is `BEFORE UPDATE OF status`; omitted-finalization test instead failed at the deferred FK on `COMMIT`, leaving transaction open. | Name/document it as a finalization-transition trigger plus deferred-FK commit gate. Specify explicit rollback after failed COMMIT and test both paths. |
| K-03 | Medium | Stage J §4.1 says “two Stage J SQL blocks,” but contains three SQL fences, including the policy data insert. Stage J also depends on Stage H's separate DDL file rather than providing a standalone complete script. | Extraction found 2 Stage H blocks and 3 Stage J blocks. The combined script ran successfully only after interpreting the policy INSERT as initialization data. | Clarify exact installation script boundaries and explicitly separate DDL from configuration seed data. |
| K-04 | Medium | The advertised J01–J46 matrix is not a complete executable suite: multiple cases state only conceptual mutations or rely on fixtures not actually included as full SQL. | Many cases in §5 are `NOT EXECUTED`, with exact missing fixture detail per row. | Supply complete valid multi-identity, duplicate, concurrency, mutation, recovery and rollback scripts for each test, or explicitly narrow the mandatory suite. |

K-01 is sufficient for `STAGE_36A70K_VALIDATION_FAILED`. It demonstrates an
actual partial commit; it is not merely an unexecuted scenario. The
`foreign_keys=OFF` connection violates the documented runtime connection
contract, but the schema itself cannot enforce that contract and the
specification claims a database-enforced no-partial-commit invariant.

## 7. Trigger coverage and first-successful-COMMIT boundary

The Stage J finalizer successfully detects the tested omitted create revision,
omitted revision manifest, wrong revision request hash, omitted accept
revision, and omitted fulfill movement. Bootstrap's extra unitemized identity
was rejected. The supplied positive receipt fixture created a new identity
atomically. These results validate those tested paths under the required
foreign-key-enabled connection.

They do **not** prove all J01–J46 invariants. First-successful-COMMIT behavior
has two separable parts:

- SQLite uniqueness rejects a duplicate command or commit row. This was
  observed for identical and conflicting direct INSERT attempts.
- Returning an existing successful result only after comparing its complete
  manifest/effect set is Main-process behavior and was not executed.

SQLite has no way to authenticate that retry logic or ensure the caller
consults it. No test was described as proving application-level recovery.

## 8. Stage G/I/J traceability

| Requirement/finding | Stage J control | Stage K result |
|---|---|---|
| Stage G: finalized receipt root rebind | Root identity update trigger and revision/manifest relations | Rebind rejected in executed test |
| Stage G: post-commit manifest/effect append | Applying-only insert and immutable manifest/effects | Manifest insert rejected; update rejected |
| Stage G: bootstrap identity not itemized | Bootstrap identity/line equality and command completeness | Extra identity rejected; whole bootstrap rolled back |
| Stage G: empty `medicine_id` | Identity format CHECK | Empty ID rejected in valid applying context |
| Stage G: receipt cannot create identity | Approved receipt-create design, identity origin and receipt line linkage | Positive receipt-created identity succeeded |
| Stage I: create commits reservation without revision 1 | `commit_command_completeness` plus deferred commit-finalization FK | Rejected and fully rolled back with FK enabled; **bypassed and committed with FK disabled** |
| Stage I: receipt policy contradicts owner decision | `stagej_receipt_policy_guard` | `existing_only` rejected |
| Stage I: other negative tests incomplete | J01–J46 procedures | Many remained unexecuted; see §5 |
| Stage J: every command needs exact complete result | Command-specific finalization branch | Positive paths and selected omissions tested; complete coverage not achieved |

No Stage G report was available; the first four Stage G descriptions in this
table are sourced only to Stage H/I retrospectives and Stage K reproductions
where explicitly noted.

## 9. Unexecuted tests and limits

The `NOT EXECUTED` entries in §5 are not passes or failures. In particular,
there is no executed complete SQL fixture for multi-line atomic shortage,
reservation substitution, fulfillment extras/duplicates, every bootstrap and
receipt omission, all evidence cross-bindings, all append-only table families,
nonce replay after business rollback, competing transactions,
oversubscription, uncertain successful COMMIT recovery, or crash/power-loss
behavior.

Stage J's matrices give expected behavior for these cases, but do not provide
complete, independently reproducible SQL and fixture values in every row.
The Stage J base fixture provides only one bootstrapped identity and one order
line; its text says to “clone” for a second identity without including that
second complete bootstrap SQL. Those cases were not improvised.

Tests ran with Python's SQLite 3.50.4 runtime, not the production Electron
driver, and no storage power-loss claim is made. SQLite does not independently
verify signatures, trusted provenance, actor identity, external authorization
or key revocation.

## 10. Final determination

The composed DDL is syntactically executable. Its commit-completeness
trigger is a row-update trigger, and the deferred FK gate prevents an
unfinalized commit only when foreign-key enforcement is enabled. `RAISE(ROLLBACK)`
was observed to roll back the complete transaction when the finalization
trigger actually fires, including nested savepoint work. A plain `COMMIT`
without finalization instead fails its deferred FK and leaves the transaction
open. Disabling the connection's foreign keys allowed an incomplete order
reservation to commit.

Therefore the claimed unconditional SQLite-enforced completeness property is
not established; one direct bypass was reproduced. Numerous mandatory
adversarial tests also remain unexecuted.

`STAGE_36A70K_VALIDATION_FAILED`
