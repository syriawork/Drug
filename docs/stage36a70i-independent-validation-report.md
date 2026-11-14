# Stage 36A70I — Independent Validation Report

## 1. Executive determination

**Final status: `STAGE_36A70I_VALIDATION_FAILED`**

The Stage 36A70H DDL executed successfully as one script, and the tested
bootstrap, receipt-created-identity, order creation, acceptance, and fulfillment
paths succeeded. Several critical protections also rejected post-finalization
mutation.

However, an adversarial `order.create` transaction was committed with its root
still at revision 0 and with **no order revision at all**. The resulting order
had already reserved inventory. This violates the approved
`pending → accepted → fulfilled` lifecycle and its exact command-to-revision
mapping. Since this is a critical database-integrity failure, the specification
is not ready for implementation.

The owner-approved receipt identity-creation rule was treated as binding and
configured as `receipt_may_create` in positive fixtures. Stage 36A70H still
describes that policy as undecided and retains an `existing_only` option; this
is a specification inconsistency, not an invitation to reopen the decision.

## 2. Workspace and Git integrity

Validation used temporary file-backed SQLite databases under the system
temporary directory. No application source, database, test, configuration, or
specification file was edited. This report is the only file created by this
stage.

| Observation | Result |
|---|---|
| Branch before validation | `fix/stage36a2-operation-journal-fixture` |
| Pre-existing tracked modifications | `electron/application/order-requests.service.ts`; `tests/stage8/helpers/renderer-harness.ts` |
| Pre-existing untracked files | Stage 36A70F and 36A70H specifications; `forensic_analysis.txt`; `temp.txt`; `temp_main.txt`; `verify_report.txt` |
| Post-validation tracked modifications | Unchanged from before validation |
| Post-validation untracked files | Same as before, plus this report |
| Branch after validation | `fix/stage36a2-operation-journal-fixture` |

No branch switch, commit, push, deployment, dependency change, or production
data access occurred.

## 3. Specification identity and runtime

Target: [stage36a70h-corrected-sqlite-ddl-specification.md](</E:/programs and applications/desktop/drug-manager/docs/stage36a70h-corrected-sqlite-ddl-specification.md>)

| Item | Recorded value |
|---|---|
| Specification SHA-256 | `14B9AD08B5B79556EF41E9243484576D920FCE256E70A3AA6911F022C9CAC3ED` |
| SQLite runtime | `3.50.4` (Python `sqlite3` runtime) |
| DDL source | Both SQL code blocks under Stage H §4, concatenated in source order without editing |
| DDL execution | One `executescript` call against a fresh file-backed database; success |
| Executed script characters | `72,716` |
| Executed script lines | `1,375` |
| Executed script SHA-256 | `fc30c0760af772fb7c55d6d0e87cf72b92bcdd67fddbc66af2c76b8e329ef408` |
| `PRAGMA foreign_keys` | `1` |
| `PRAGMA journal_mode` | `wal` |
| `PRAGMA synchronous` | `2` (`FULL`) |
| `PRAGMA foreign_key_check` | Empty result on the clean/reopened validation database |
| `PRAGMA integrity_check` | `ok` |

Compile options returned by `PRAGMA compile_options` (43 rows):

```text
ATOMIC_INTRINSICS=0
COMPILER=msvc-1944
DEFAULT_AUTOVACUUM
DEFAULT_CACHE_SIZE=-2000
DEFAULT_FILE_FORMAT=4
DEFAULT_JOURNAL_SIZE_LIMIT=-1
DEFAULT_MMAP_SIZE=0
DEFAULT_PAGE_SIZE=4096
DEFAULT_PCACHE_INITSZ=20
DEFAULT_RECURSIVE_TRIGGERS
DEFAULT_SECTOR_SIZE=4096
DEFAULT_SYNCHRONOUS=2
DEFAULT_WAL_AUTOCHECKPOINT=1000
DEFAULT_WAL_SYNCHRONOUS=2
DEFAULT_WORKER_THREADS=0
DIRECT_OVERFLOW_READ
ENABLE_FTS3
ENABLE_FTS4
ENABLE_FTS5
ENABLE_MATH_FUNCTIONS
ENABLE_RTREE
MALLOC_SOFT_LIMIT=1024
MAX_ATTACHED=10
MAX_COLUMN=2000
MAX_COMPOUND_SELECT=500
MAX_DEFAULT_PAGE_SIZE=8192
MAX_EXPR_DEPTH=1000
MAX_FUNCTION_ARG=1000
MAX_LENGTH=1000000000
MAX_LIKE_PATTERN_LENGTH=50000
MAX_MMAP_SIZE=0x7fff0000
MAX_PAGE_COUNT=0xfffffffe
MAX_PAGE_SIZE=65536
MAX_SQL_LENGTH=1000000000
MAX_TRIGGER_DEPTH=1000
MAX_VARIABLE_NUMBER=32766
MAX_VDBE_OP=250000000
MAX_WORKER_THREADS=8
MUTEX_W32
OMIT_AUTOINIT
THREADSAFE=1
```

### Method

The SQL blocks were extracted from the unmodified specification and passed
together to SQLite as one script. A temporary file database was used for the
DDL, and separate deterministic fixtures were used for positive transactions,
negative statements, reopen, and writer-lock tests. SQL changes that failed
were recorded as SQLite exceptions and their resulting rows queried where
noted. No static inspection result is represented as an executed test.

## 4. Validation matrix

`PASS` denotes the actual observed result matched the expected result.
`FAIL` denotes an invariant violation reproduced. `NOT EXECUTED` is not a pass.
All fixture timestamps below were fixed to
`2026-11-12T10:00:00.000Z`.

| Test | Exact procedure / decisive SQL | Expected | Actual | Result |
|---|---|---|---|---|
| Complete DDL | Extract both §4 SQL blocks; execute as one script on a fresh file database. | Script completes. | Completed; 72,716 chars, 1,375 lines; hash above. | PASS |
| Runtime settings | `PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;` then read each pragma. | `1`, `wal`, `2`. | `(1)`, `('wal')`, `(2)`. | PASS |
| Clean relational/integrity checks | `PRAGMA foreign_key_check; PRAGMA integrity_check;` on fresh/reopened clean fixture DB. | No FK rows; `ok`. | No FK rows; `ok`. | PASS |
| Bootstrap positive | Applying `inventory.bootstrap` for `batch-a`; one `identity-a` (`med-a`, `each`, tracked, `lot-a`, expiry none); two count evidence records from distinct counters; distinct approval; itemized count/allocation 10; exact zero-to-10 movement; active revision; finalize. | Commit active with count/evidence/approval/movement all linked. | Commit succeeded; batch `(active,1)`; opening balance 10. | PASS |
| Bootstrap extra identity | In the same fixture, add manifest and an additional `inventory_identity` (`identity-extra`) with `origin_id=batch-a`, but no count line/evidence/approval/movement; attempt `UPDATE commit_records SET status='committed', finalized_at=? WHERE commit_id='boot-commit'`. | Finalization rejected; no commit. | `IntegrityError: bootstrap identity and count-line sets differ`; query before rollback: 2 identities, 1 count line, commit still `applying`. | PASS |
| Receipt creates a new identity | With policy `receipt_may_create`, create `receipt-a`, new `identity-new` (`med-b`, `each`, tracked, `new-lot`, date `2027-01-31`), source evidence, distinct receiver/approver, one line quantity 4, exact movement, manifest and received revision; finalize. | All receipt-linked rows commit atomically; balance 4. | Commit succeeded. Receipt `(received,1)`, identity origin `receipt`, quantity 4, balance `(available=4,reserved=0)`. FK/integrity checks clean. | PASS |
| Receipt rollback on incomplete set | Not run as a fully observed transaction rollback for every omitted receipt component. Receipt finalization code was inspected, but inspection is not execution evidence. | Any missing mandatory item aborts and outer rollback leaves no partial receipt identity/effect. | No complete matrix of omissions and post-rollback queries was run. | NOT EXECUTED |
| Receipt duplicate/conflicting identity | No second full receipt fixture attempted with a duplicate six-part identity or conflicting ID. | Unique identity constraints reject duplicate/conflicting identity and transaction leaves no partial effects. | Not executed. | NOT EXECUTED |
| Order create positive | After bootstrap, create one line for `identity-a`, qty 3; exact reservation and reserve movement from `(10,0)` to `(7,3)`; insert revision 1 pending; finalize. | Revision 1 pending; exact reservation; balance `(7,3)`. | Commit succeeded; order `(1,pending)`; balance `(7,3)`. | PASS |
| Order accept positive | Expected revision 1; create revision 2 accepted with explicit authorization; no movement rows. | Accepted revision 2, zero inventory movement. | Commit succeeded; order `(2,accepted)`; accept movement count 0. | PASS |
| Order fulfill positive | Expected revision 2; consume exact reservation qty 3 with before `(7,3)`, after `(7,0)`; create revision 3 fulfilled. | Revision 3 fulfilled; reservation consumed exactly once. | Commit succeeded; order `(3,fulfilled)`; balance `(7,0)`. | PASS |
| Order create omits revision | Deterministic fixture: bootstrap 10 units; applying `order.create` (`oc`, `ocm`, order `o`); root `(current_revision=0,current_status='pending')`; one line `l` qty 3; matching reservation `r`; reserve movement `rm` from `(10,0)` to `(7,3)`; manifest entries only for root, line, reservation, movement; valid create assertion; **no `order_revisions` row and no revision manifest**; execute `UPDATE commit_records SET status='committed',finalized_at='2026-11-12T10:00:00.000Z' WHERE commit_id='ocm'`. | Must reject: release-one `order.create` maps to revision 1 pending. | Update succeeded. Query: `commit_records.status='committed'`; `orders=(current_revision 0,current_status 'pending')`; revision count `0`; balance `(7,3)`. | **FAIL — Critical** |
| Post-commit manifest insert | `INSERT INTO effect_manifest ... commit_id='receipt-commit', command_id='receipt-cmd', target_type='inventory_identity', target_id='late' ...`. | Reject. | `IntegrityError: manifest entries require an applying commit`. | PASS |
| Post-commit receipt root rebind | `UPDATE inventory_receipts SET command_id='boot-cmd',commit_id='boot-commit',effect_key=<other key> WHERE receipt_id='receipt-a';` | Reject; root/revision binding unchanged. | `IntegrityError: receipt identity is immutable`; queried root retained original `receipt-cmd`, `receipt-commit`, and effect key. | PASS |
| Post-commit movement insert | Insert a receipt movement under finalized `receipt-commit`. | Reject. | `IntegrityError: movement requires applying commit`. | PASS |
| Evidence verification UPDATE/DELETE | `UPDATE evidence_verifications SET result='failed' WHERE verification_id='source-evidence-verified';` and corresponding `DELETE`. | Both reject. | `verification history is immutable`; `verification history is retained`. | PASS |
| Nonce event UPDATE/DELETE | Update/delete `nonce_events` for `nonce-receipt-main`. | Both reject. | `nonce history is immutable`; `nonce history is retained`. | PASS |
| Authority key event UPDATE/DELETE | After inserting a key event, update then delete it. | Both reject. | `key history is immutable`; `key history is retained`. | PASS |
| Authority key event insertion | Insert `authority_key_events(key_event_id='ke1', key_id='test-key', event_type='revoked', event_at=timestamp, event_json='{}')` after a business commit. | No out-of-protocol event should be mistaken for verified external revocation; trusted writer is operational boundary. | Insert was accepted. This is not treated as proof of revocation; no database trust in writer is claimed. | PASS — operational boundary only |
| Empty medicine ID | During an applying bootstrap fixture, insert an otherwise syntactically valid identity with `medicine_id=''`. | Reject. | `IntegrityError: CHECK constraint failed` for the nonempty lowercase medicine ID format. | PASS |
| Nonce replay after durable consumption | Insert and commit command `n1cmd`; insert nonce `n1` with value `replay-value-0123456789-abcdefgh`; transition presented→reserved→consumed and commit. Create `n2cmd`; attempt a second nonce row with the same nonce value. | Reject replay after business rollback/success. | `IntegrityError: UNIQUE constraint failed: nonce_records.nonce_value`. | PASS |
| Duplicate `commit_id` | Within a savepoint, insert `dcmd` and an applying `dup-id`; attempt same commit ID with identical identity then conflicting request hash; roll savepoint back. | Both duplicates rejected. | Both rejected by unique constraints (`commit_id,request_hash` and `commit_id,command_id`). | PASS — uniqueness only |
| Interrupted uncommitted transaction / reopen | Insert command and applying commit in a transaction; close without commit; reopen file and query commit row, checks, and WAL. | Uncommitted rows absent; DB reopens cleanly. | `interrupted_rows=0`; WAL persisted; FK check empty; integrity `ok`. | PASS — connection-close rollback, not power-loss test |
| Competing writers | Connection A executes `BEGIN IMMEDIATE`; connection B executes `BEGIN IMMEDIATE` with zero timeout. | Second writer waits or receives transient busy; no oversubscription. | B raised `OperationalError: database is locked`; no competing business writes were run. | PASS — lock behavior only |
| Exact receipt identity policy conformance | Set policy row to approved `receipt_may_create` for positive path. | Receipt-new-identity must not require prior bootstrap identity. | Positive test passed under that setting; specification still permits `existing_only` and calls the owner decision unresolved. | FAIL — specification mismatch |

### Specifically not executed

The following requested negative or cross-binding cases were not executed as
complete fixtures and therefore remain unverified:

- Direct order projection updates; repeated, skipped, wrong-command, wrong-hash,
  wrong-aggregate, and wrong-request lifecycle revisions.
- Multi-line reservation, shortage atomic rollback, reservation identity or
  quantity substitution, and duplicate/omitted/extra fulfillment movements.
- Invalid movement snapshot arithmetic, unsafe integer boundaries, and
  movement UPDATE/DELETE.
- Receipt missing-component rollback for each required component; evidence
  resource/commit mismatches; duplicate/conflicting receipt identity.
- Same-person receiver/approver attempts; altered or omitted receipt approvals.
- Invalid expiry/sentinel combinations, unknown classifications, malformed
  hashes, invalid general identifiers, and zero/negative/overflow quantities.
- Orphan effect/manifest variants beyond the post-commit manifest insertion
  attempt; broad UPDATE/DELETE sweep over every append-only table.
- Duplicate commit ID after an actually finalized business commit, full
  first-successful-COMMIT retry comparison, and contradictory retry response.
- Recovery of true uncertain COMMIT outcomes, abrupt process/power loss, and
  crash/reopen with concurrent readers/writers.
- Multiple competing reservation transactions that attempt to oversubscribe a
  shared balance.

These are not inferred to pass from the successful DDL execution, integrity
checks, or the positive-path fixtures.

## 5. Defect register

| ID | Severity | Specification object | Evidence / violated invariant | Required correction |
|---|---|---|---|---|
| I-01 | **Critical** | §5.1 finalization completeness; `finalization_completeness`; `orders`; `order_revisions` | Exact reproducer is the “Order create omits revision” fixture above. SQLite committed a root at revision 0 with a reserved balance and zero revision rows. The order.create finalization branch checks line/reservation/reserve membership but does not require the revision-1 pending row or root projection `(0,pending)` before finalization. Violates approved `order.create`→revision 1 `pending` mapping and atomic command completeness. | Finalization must require exactly one revision 1 pending for each `order.create`, bound to the create command/commit/request hash; require the root projection to be the correct post-revision state before commit. Include a negative fixture proving omission and invalid initial root status are rejected. |
| I-02 | High | §§3.1, 4 policy row, 7 receipt identity models, 8 `inventory.receipt`, 9 policy boundary | The owner has approved that receipt may create an identity and must not require bootstrap pre-creation. Stage H still says the owner decision is unresolved, offers `existing_only`, and requires a separately selected policy row. The positive test succeeds only after choosing `receipt_may_create`. This leaves a configuration that contradicts the binding decision. | Revise the design to encode the approved receipt-create rule, remove the obsolete alternative/unresolved-decision text, and provide executable tests showing a receipt can create a new identity. |
| I-03 | Medium | §8 transaction protocol; recovery/uncertain-outcome procedures | The connection-close test only covers rollback of an uncommitted transaction. No true uncertain successful COMMIT or process/power interruption was induced. | Independent validation must execute the recovery cases with a reproducible fault-injection method before implementation readiness. |

I-01 is sufficient for the failed final status. I-02 is a separate
specification-conformance failure to the binding owner decision.

## 6. Stage 36A70G defect-to-Stage 36A70H resolution

| Stage 36A70G finding | Stage H response | Stage I evidence | Determination |
|---|---|---|---|
| Committed receipt root could be rebound to another command/commit/effect. | Root identity update guard and immutable manifest/effect rows. | Rebinding rejected; root values unchanged. | Resolved in tested path |
| Effects/manifests could be added after finalization. | Applying-only insert guards and immutable manifest. | Late manifest and movement inserts rejected. | Resolved in tested path |
| Bootstrap could finalize with an unitemized identity. | Bidirectional identity/count-line finalization check. | Extra identity finalization rejected with explicit mismatch error. | Resolved in tested path |
| Empty medicine ID accepted. | Format/nonempty CHECK on `inventory_identity.medicine_id`. | Empty ID rejected. | Resolved for tested empty case |
| Receipt could not create a new identity. | Model A receipt-origin identity insert guarded by policy. | New identity receipt committed atomically when policy was `receipt_may_create`. | Mechanism works; Stage H policy text is stale against binding decision |
| Incomplete validation fixtures and lifecycle proof. | Stage H contains proposed protocols and tests. | A missing order revision still finalized; many requested adversarial cases remain unexecuted. | Not resolved; critical defect I-01 |

## 7. Approved-decision traceability

| Approved decision | Evidence / trace |
|---|---|
| Release-one commands are `order.create`, `order.accept`, `order.fulfill`, `inventory.bootstrap`, `inventory.receipt`. | All five appear in the DDL command-type constraints; bootstrap, receipt, and all three order positive paths were exercised. |
| `pending → accepted → fulfilled`, exact command-to-revision mapping. | Positive path observed revisions 1/2/3 correctly. I-01 proves the required revision-1 mapping is not mandatory at finalization. |
| Acceptance has zero inventory effect. | Executed acceptance; movement count for its command was zero. |
| Creation reserves inventory atomically. | Positive create reserved 3. But the no-revision create defect proves finalization can succeed without its lifecycle record. |
| Fulfillment consumes exact reservation. | Positive one-line fulfillment consumed qty 3; balance changed from `(7,3)` to `(7,0)`. Multi-line and substitution negatives not executed. |
| Bootstrap requires itemized count, independent count, separate approval. | Positive one-line fixture used distinct counters and approver; extra identity failed finalization. Other omissions not exhaustively tested. |
| Receipt requires source evidence, receiver, independent second approver. | Positive new-identity receipt included evidence and distinct actors; same-person/omission negatives not executed. |
| Receipt may create a new identity atomically. | Binding decision applied; positive receipt-created identity succeeded. Stage H still contradicts decision textually/configurationally (I-02). |
| No legacy stock conversion. | No migration/import path was executed; release-one commands exclude conversion. |
| No release/cancellation/rejection/expiry/correction/reversal/return inventory command. | Command constraints contain only the five approved commands; no such operation exercised. |
| No automatic deletion of journal records. | Representative evidence verification and nonce/key history deletions rejected. Full table-family sweep not executed. |
| `SQLITE_BUSY` is not definitive rejection. | Competing writer observed `database is locked`; application retry behavior is Main-process responsibility and was not executed. |
| First successful COMMIT for a `commit_id` wins. | Duplicate-key uniqueness tested, but successful finalized retry comparison and uncertain COMMIT not executed. |
| No silent conflict resolution or automatic reversal. | No positive application recovery implementation exists in this DDL-only test; remains Main-process/operational. |
| Missing inventory classification blocks operations. | No unknown-classification fixture was executed. |
| Main-process-only DB ownership through narrow IPC. | Not testable through SQLite DDL; operational boundary. |
| Pending reservations may remain indefinitely. | Schema has no release/timeout path; no aging test executed. |

## 8. Enforcement boundary

| Invariant | Stage I classification |
|---|---|
| DDL syntax and table/view/trigger creation | **PASS — SQLite-executed** |
| Foreign keys, unique keys, tested medicine ID syntax, tested finalized effect insert protection, tested bootstrap set equality | **PASS — SQLite-enforced for tested cases** |
| Receipt root identity immutability and tested append-only UPDATE/DELETE | **PASS — SQLite-enforced for tested cases** |
| Order creation must create revision 1 pending | **FAIL — SQLite finalization permits omission** |
| Receipt-new-identity policy must comply with binding owner decision | **FAIL — Stage H leaves `existing_only` and the decision unresolved** |
| Catalog membership, canonical request/effect digest computation, cryptographic signature validity, online authorization/key revocation, actual actor identity | **Main-process/service-enforced; not independently verified by SQLite** |
| Trusted writer, narrow IPC, retries for `SQLITE_BUSY`, first-COMMIT result comparison, uncertain outcome adjudication | **Operational/Main-process; not verified by DDL execution** |
| WAL power-loss durability and actual driver/filesystem behavior | **NOT VERIFIED** |

SQLite was not treated as able to identify a trusted writer or independently
verify signatures, external authorization, or key revocation.

## 9. Unverified assumptions and limitations

- Tests used Python's SQLite `3.50.4`; no Electron SQLite driver was available
  or tested.
- `synchronous=FULL` and WAL were read back, but actual power-loss durability
  cannot be concluded from this test.
- A connection closed with an open transaction was used for interrupted
  transaction recovery; no process kill or storage fault was induced.
- The database file was isolated under the OS temporary directory; no
  production or Firebase data was accessed.
- A direct SQL writer can submit syntactically valid but false actor, evidence,
  assertion, or key-event data. This is outside SQLite's trusted-writer
  capability and requires the documented Main-process/operational boundary.
- Stage H is a design document that states its receipt policy decision is
  unresolved. The owner decision supplied for Stage I supersedes that status,
  but the specification itself has not been silently edited.

## 10. Final readiness determination

The whole DDL executes and the successful normal transaction paths establish
that several intended workflows are expressible. They do not overcome I-01:
SQLite accepted and committed an order with a reservation but no lifecycle
revision. Numerous mandated negative and recovery tests also remain
unexecuted. The specification therefore **must not be treated as ready for
implementation**.

`STAGE_36A70I_VALIDATION_FAILED`
