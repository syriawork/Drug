# Stage 36A70Q — Independent Adversarial Validation of Stage 36A70P

**Final recommendation:** `FAIL`  
**Final status:** `STAGE_36A70Q_VALIDATION_FAILED`

## 1. Scope and evidence boundary

This report is an independent adversarial validation of the corrective design in [docs/stage36a70p-corrected-transaction-integrity-specification.md](./stage36a70p-corrected-transaction-integrity-specification.md). It is not a specification summary and it does not claim implementation readiness. It focuses on whether the Stage 36A70P design is supported by actual SQLite behavior and whether its required controls are capable of satisfying the Stage 36A70O corrections.

This validation used only temporary SQLite databases and temporary file-backed runtime fixtures. No repo application code was modified, no DDL implementation was added to the app, and no package dependency was installed or changed.

## 2. Documents and source files inspected

Read completely:

- [docs/stage36a70p-corrected-transaction-integrity-specification.md](./stage36a70p-corrected-transaction-integrity-specification.md)
- [docs/stage36a70o-independent-transaction-integrity-review.md](./stage36a70o-independent-transaction-integrity-review.md)
- [docs/stage36a70n-corrected-transaction-integrity-specification.md](./stage36a70n-corrected-transaction-integrity-specification.md)
- [docs/stage36a70m-independent-design-review.md](./stage36a70m-independent-design-review.md)
- [docs/stage36a70k-independent-validation-report.md](./stage36a70k-independent-validation-report.md)

Also inspected where available:

- [docs/stage36a70j-corrected-sqlite-ddl-specification.md](./stage36a70j-corrected-sqlite-ddl-specification.md)
- [docs/stage36a70i-independent-validation-report.md](./stage36a70i-independent-validation-report.md)
- [docs/stage36a70h-corrected-sqlite-ddl-specification.md](./stage36a70h-corrected-sqlite-ddl-specification.md)
- [package.json](../package.json)

Unavailable document recorded explicitly:

- Stage 36A70G’s standalone validation report was not present in the workspace, and it was not reconstructed. Its unavailable findings are treated only as they are cited in later reports.

## 3. Driver and authorizer evidence

### 3.1 Version and binding evidence

Stage 36A70P pins the design to:

- Electron `44.4.5` per [package.json](../package.json)
- Node runtime pinned by Electron `v44.4.5` to Node `v24.21.0`
- built-in `node:sqlite` / `DatabaseSync`

This is consistent with the design’s source-based evidence and the runtime notes in the earlier documents. However, the actual packaged runtime in this workspace was not executed to confirm that the exact Electron binary exposes the same API. The Stage 36A70P design remains a proposed contract and not a verified runtime fact.

### 3.2 Actual runtime tests executed

The following test procedures were executed in a temporary SQLite database using Python’s built-in `sqlite3` module, which is not the Electron runtime but is sufficient to validate the underlying SQLite behavior that Stage 36A70P relies on.

#### Test Q-01: second connection with `PRAGMA foreign_keys=OFF` commits an incomplete order-like state

Procedure:

1. Create a temp SQLite file.
2. Create a minimal schema approximating the Stage K critical issue: `commit_records`, `orders`, `order_revisions`, `inventory_balances`.
3. Insert a record with `orders(current_revision=0, current_status='pending')`, balance `(available=7, reserved=3, on_hand=10)`, and no `order_revisions` row.
4. Close connection 1.
5. Open connection 2 with `PRAGMA foreign_keys=OFF` and issue commit.

Observed result:

```text
RESULT_SECOND_CONNECTION_COMMIT=SUCCESS
STATE_AFTER_BYPASS=('ocm', 'applying')
ORDERS=[('o', 0, 'pending')]
ORDER_REVISIONS=[]
BALANCE=[('i', 7, 3, 10)]
```

This is a direct runtime reproduction of the Stage 36A70K core bypass. It confirms that a second connection can commit an incomplete order-like state when foreign-key enforcement is disabled. This is the same mechanism that the Stage 36A70P design is trying to avoid via Main-process ownership and authorizer configuration.

#### Test Q-02: authorizer denies writes, but `set_authorizer(None)` removes the protection

Procedure:

1. Create an in-memory SQLite connection.
2. Install a custom authorizer that denies `INSERT`, `UPDATE`, and `DELETE`.
3. Attempt a write.
4. Clear the authorizer via `set_authorizer(None)`.
5. Attempt another write.

Observed result:

```text
AUTHORIZER_INSERT=DENIED:not authorized
AUTHORIZER_AFTER_CLEAR=ALLOWED
AFTER_CLEAR_ROWS=2
```

This confirms the Stage 36A70P design point that the authorizer is a per-connection, replaceable callback and is not a security boundary against code that can call `set_authorizer(None)` or install a different authorizer.

#### Test Q-03: `PRAGMA foreign_keys=OFF` on a second connection allows a child row to violate a foreign-key relation

Procedure:

1. Create a parent table and child table with a foreign key from child.parent_id to parent.id.
2. Insert a parent row.
3. On one connection with `PRAGMA foreign_keys=ON`, insert a child row with a missing parent and see it fail.
4. On a second connection with `PRAGMA foreign_keys=OFF`, insert the same invalid child row and commit.

Observed result:

```text
FK_ON_INSERT=DENIED:FOREIGN KEY constraint failed
FK_OFF_INSERT=COMMITTED
```

This reproduces the direct second-connection bypass in the simplest form and confirms the fundamental SQLite limitation the design calls out.

## 4. Stage 36A70P finding-by-finding validation matrix

| Stage 36A70P finding | Validation outcome | Evidence |
|---|---|---|
| O-01 runtime qualification gap | Confirmed as unresolved design prerequisite | The design requires runtime qualification, but the runtime is not the actual Electron binary in this repository. |
| O-02 second writable connection not prevented by SQLite | Confirmed as a real SQLite behavior | Q-01 and Q-03 directly reproduce the bypass. |
| O-03 ambiguous COMMIT recovery missing durable state model | Partially addressed in the spec, but not proven by runtime validation | The design has a state model written down, but no implementation exists to test it. |
| O-04 command completeness still design-only | Confirmed as not runtime-validated | The application does not implement the required coordinator, so tests remain design-only. |
| O-05 commit hook not primary boundary | Confirmed as accurate | The engine has a C commit hook, but it is not exposed by the selected Node API and the spec properly notes that it is not required. |
| O-06 direct file-tampering prevention out of scope | Confirmed as correct | Observed direct bypasses are connection-scoped and not file-level attacks; direct file tampering remains outside SQLite authorizer guarantees. |

## 5. Transaction architecture assessment

### 5.1 Exclusive ownership by Electron Main

The Stage 36A70P design correctly places the authoritative database under Electron Main only. However, this is an architectural requirement and not a runtime guarantee. The validation cannot confirm that no second writable connection exists in the actual application because there is no implementation of the database module in the repo. The design therefore remains a requirement, not a validated fact.

### 5.2 Single trusted transaction coordinator

The coordinator design is structurally sound and consistent with the Stage 36A70O correction: a single write path, one logical coordinator, no nested transaction logic, no direct command-layer transaction control. Yet the validation has not executed the implementation, so there is no proof that every application path is forced through that one coordinator. This remains an unverified implementation prerequisite.

### 5.3 Connection initialization and PRAGMA verification

The Stage 36A70P design correctly calls out the critical requirement to verify `foreign_keys`, `journal_mode`, `synchronous`, etc. That requirement is valid and necessary. However, actual runtime evidence confirms the underlying SQLite limitation: these settings are connection-scoped and can be changed to unsafe values by a second connection. It is precisely because of that connection-locality that the design must rely on Main-process architecture and runtime enforcement.

### 5.4 Alternate write and COMMIT path prevention

The design requires a single coordinator and forbids alternate write paths, but this remains unvalidated without the implementation. The test evidence demonstrates that a second raw connection can bypass connection-local checks; thus the design relies on architectural discipline rather than SQLite engine enforcement.

### 5.5 Savepoints, `REPLACE`, and writer control

The design’s rules against nested transactions and `REPLACE` are sound. However, the validation did not execute a production implementation of those rules; the runtime evidence only confirms the underlying SQLite behaviors. The design must still be implemented in code and tested. At present, those are requirements, not evidence.

## 6. Nonce and idempotency assessment

The Stage 36A70P state machine is logically coherent and materially improved relative to earlier drafts. It defines the required ordering and distinguishes confirmed commit, ambiguous commit, rollback, expired assertion, and conflict states. It preserves the first-successful-COMMIT semantics in principle.

However, the design was not implemented and therefore cannot be validated end to end. The actual runtime evidence confirms only two necessary truths:

- SQLite authorizer and `PRAGMA foreign_keys` are per-connection and replaceable.
- A second connection can bypass the main connection’s settings.

These facts directly raise the importance of the design’s trusted-process ordering and durable state machine, but they do not prove that the implementation will preserve correctness in production.

## 7. Command completeness assessment

The command completeness rules in Stage 36A70P are more explicit than earlier drafts and properly classify the enforcement layers. In principle, the invariants are consistent with the approved business decisions:

- `order.create` requires revision 1 and complete reservation chain
- `order.accept` is inventory-neutral
- `order.fulfill` consumes the exact reservation
- `inventory.bootstrap` requires evidence, approvals, and movement
- `inventory.receipt` may create a new identity atomically with evidence, independent approval, movement, and manifest

But these are still design-level rules and cannot be considered proven. The repository does not contain the actual implementation, DDL, or runtime database classes that would allow end-to-end validation of the command invariants.

### Enforcement-layer classification

The report agrees with the design’s classification:

- SQLite engine: unique constraints, FK checks, `STRICT`, checks, and append-only semantics when enabled on the active connection.
- Driver/connection: authorizer, PRAGMA verification, connection ownership, and config enforcement.
- Trusted Main process: actor auth, assertion verification, nonce ordering, exact business validation, and transaction ownership.
- Operational assumption: filesystem ACLs, OS access control, and direct-file tampering detection.

This is still correct as a classification, not as a runtime proof.

## 8. Executed adversarial tests

The following adversarial tests were executed in temporary SQLite databases and produced concrete results.

| ID | Procedure | Result | Interpretation |
|---|---|---|---|
| Q-01 | second connection with `PRAGMA foreign_keys=OFF` commits incomplete order-like row set | `RESULT_SECOND_CONNECTION_COMMIT=SUCCESS` | Critical bypass confirmed. |
| Q-02 | authorizer denies writes, then `set_authorizer(None)` allows insert | `AUTHORIZER_AFTER_CLEAR=ALLOWED` | Authorizer is replaceable/removable; not a security boundary. |
| Q-03 | second connection with foreign keys off writes invalid FK child row | `FK_OFF_INSERT=COMMITTED` | Connection-local settings are bypassable. |

These tests directly validate the architectural assumptions behind the earlier Stage 36A70K findings and confirm that the controlling issue is real and not merely theoretical.

## 9. Unexecuted tests and reasons

The following tests in Stage 36A70P are not executed because the implementation required to support them does not exist in this workspace:

- P-01 through P-20 as full app-level fixtures
- actual coordinator path and connection ownership enforcement in Electron Main
- actual authorizer enforcement in the packaged Electron runtime
- actual `node:sqlite` connection factory implementation
- actual nonce reservation, retry, and recovery state tables in the real app
- all five command-type finalization and manifest validation paths in a real database schema
- direct crash-recovery and ambiguous COMMIT replay tests in the app runtime
- real DB-file tamper detection under actual filesystem conditions

These are not marked as passed; they are explicitly recorded as `NOT EXECUTED — IMPLEMENTATION ABSENT`.

## 10. Historical defect traceability

| Historical defect from available reports | Stage 36A70P correction | Validation status |
|---|---|---|
| Missing order revision 1 | Explicitly addressed in command completeness definitions | Design-level only; not runtime-validated |
| Foreign keys disabled on second connection | Explicitly acknowledged as connection-local and bypassable | Confirmed by Q-01 and Q-03 |
| Completeness trigger not at actual COMMIT | Correctly framed as a trusted process + coordinator requirement | Not runtime-validated |
| Post-commit manifest mutation and reassignment | Included as invariants and append-only rules | Not runtime-validated |
| Receipt command/commit/effect divergence | Preserved as exact atomicity requirement | Not runtime-validated |
| Incomplete bootstrap | Included in command completeness rules | Not runtime-validated |
| Invalid or empty `medicine_id` | Preserved in schema and invariant requirements | Not runtime-validated |
| Receipt-created identity consistency | Preserved as atomic new-identity receipt path | Not runtime-validated |
| Movement arithmetic and balance consistency | Preserved in business invariants | Not runtime-validated |
| Evidence provenance and independent approval | Preserved as signed/evidence requirements | Not runtime-validated |
| Nonce replay and idempotency ordering | Formal state machine added | Design-level only; no implementation |

## 11. Findings classified by severity

| ID | Severity | Finding | Evidence | Required correction |
|---|---|---|---|---|
| Q-01 | **Critical** | A second SQLite connection with `PRAGMA foreign_keys=OFF` can bypass the critical completeness requirement. | Q-01 and Q-03 | This must be treated as a real implementation risk; the architecture must enforce a single connection and a no-second-writable-connection rule in code and runtime checks. |
| Q-02 | **Critical** | `set_authorizer(None)` removes the protection and permits writes. | Q-02 | The authorizer cannot be treated as a security boundary without connection ownership and runtime enforcement. |
| Q-03 | **High** | The design remains unimplemented; actual runtime proof is absent. | No app implementation and no real DB module exist in the repo. | All critical runtime checks must be executed on the actual packaged Electron runtime before implementation readiness is claimed. |
| Q-04 | **Medium** | The state machine for ambiguous COMMIT and recovery is logically sound but not implemented/tested. | Stage 36A70P defines the machine in text but no runtime state tables or execution path exist. | Require implementation and runtime tests for every state transition. |
| Q-05 | **Low** | Direct file tampering is correctly acknowledged as out of scope, but it still needs operational detection and recovery definitions. | Stage 36A70P clearly says direct file attacks are out of scope. | Add a formal detection and fail-closed response design. |
| Q-06 | **Informational** | Runtime qualification and driver API existence are still a required precondition. | Stage 36A70P documents this as a requirement, but it does not yet satisfy it in the repo. | Runtime qualification is required before any implementation claim. |

## 12. Unverified claims and implementation prerequisites

The following Stage 36A70P claims remain unverified:

- actual packaged Electron runtime includes and exports `node:sqlite` / `DatabaseSync`; 
- the actual driver exposes `setAuthorizer()` in the exact packaged runtime;
- the authorizer denies all required action codes in that runtime;
- no second writable connection exists in the application; 
- all command handlers are forced through a single coordinator; 
- all incoming requests pass through the exact nonce/idempotency order; 
- the database file is protected from direct tampering; 
- any implementation using this design will pass the stage’s validation matrix.

## 13. Final recommendation

The design in Stage 36A70P addresses the earlier review findings in a materially better way, but the critical SQLite facts demonstrated in this validation still block any claim that the design is ready for implementation or runtime validation.

Recommendation: `FAIL`

The root cause is simple and confirmed by execution: SQLite enforces authorizers and foreign keys on a connection, and a second connection can directly bypass them. The architecture therefore remains dependent on trusted Main-process enforcement and runtime implementation discipline, which is not yet demonstrated in the actual application runtime.

## 14. Final status

`STAGE_36A70Q_VALIDATION_FAILED`
