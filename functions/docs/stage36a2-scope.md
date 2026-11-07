# Stage 36A2 — Server-Side Transactional Persistence Foundation Scope

## 1. Purpose

This document defines the formal scope for Stage 36A2. It is documentation only. It does not implement Stage 36A2.

Stage 36A2 is intended to establish a reusable, testable, transactional Firestore persistence foundation for later business-operation stages. It must use the accepted Stage 36A1 domain modules directly and must not duplicate their validation logic.

## 2. Authoritative decisions preserved

### Order lifecycle

The order lifecycle is:

`pending → accepted → fulfilled`

- `pending`: submitted and awaiting administrative decision.
- `accepted`: administratively approved but not physically handed over.
- `fulfilled`: physical handoff has actually occurred.

Administrative approval and physical fulfillment are separate operations. Approval is not fulfillment and does not consume reserved inventory. Fulfillment is the event that consumes reserved stock.

### Inventory accounting

The target model distinguishes:

- Available stock.
- Reserved stock.
- Derived on-hand stock (`availableStock + reservedStock`).

The legacy `stock` field does not have a consistent meaning across existing workflows. No automatic legacy stock conversion is authorized in Stage 36A2. Legacy values must not be silently reinterpreted or migrated.

### Operation identity

- Stable operation IDs.
- Server-side canonical payload validation.
- SHA-256 payload hash verification.
- Exact retry returns the original result without duplicate effects.
- Reusing an operation ID with a different operation type or payload must be rejected.

### Inventory movements and reversals

- Every movement must identify its medicine.
- Movement semantics and exact stock deltas must be validated.
- Reversal must reference its source movement.
- Reversal guard verification and creation must be atomic.
- A movement and its associated operation record must be persisted atomically.

### Authorization

Trusted server-side authorization must verify:

- Authenticated caller.
- Approved user profile.
- Explicit enabled Firebase Authentication account state.

A profile-only `approved` classification is not sufficient authorization. Client-supplied roles, approval flags, account states, or actor UIDs must not be trusted.

### Return and cancellation

- Return evidence must be authoritative and verified server-side.
- Cumulative returned quantities and event uniqueness must be enforced transactionally.
- Full-versus-partial return cancellation policy remains unresolved and must not be invented.

## 3. Relationship to Stage 36A1

### Already implemented in Stage 36A1

The following are domain validation/accounting capabilities and are already accepted:

- Canonical operation payload validation and canonicalization.
- Stable operation identity and payload hash recomputation.
- Stored operation record validation.
- Exact retry and conflict detection helpers.
- Inventory state validation.
- Inventory movement calculation and validation.
- Reversal movement validation.
- Reversal guard state validation.
- Order lifecycle transition validation.
- Physical return evidence structure validation.
- Profile classification and combined authorization classification.

These modules are pure validation/accounting and do not read or write Firestore.

### To be implemented in Stage 36A2

- Reusable server-side transaction integration layer.
- Atomic persistence of canonical operation records and associated business writes.
- Exact idempotent retry and operation conflict handling against Firestore.
- Transactional inventory state reads and validated movement persistence.
- Atomic source-movement reversal guard enforcement.
- Trusted authorization boundary suitable for Cloud Functions.
- Consistent Firestore transaction read-before-write discipline.
- Focused unit and emulator integration tests.
- Explicit error behavior for conflicts, missing records, invalid state, and authorization failures.

### Belong to later stages

- Full order submission workflow implementation.
- Order approval, rejection, fulfillment, cancellation, and returns workflows.
- Business policies for full versus partial return.
- Legacy inventory reconciliation and stock-field conversion.
- Production deployment and Firestore Rules deployment.

## 4. Scope definition

Stage 36A2 is defined as:

**Server-Side Transactional Persistence Foundation**

Its purpose is to establish reusable and testable Firestore transaction infrastructure for subsequent business-operation stages.

It must distinguish:

1. Domain validation already implemented in Stage 36A1.
2. Transactional persistence infrastructure to be implemented in Stage 36A2.
3. Business workflows that belong to later stages.
4. Production deployment and legacy migration, which are outside this stage unless separately approved.

## 5. Required deliverables

Subject to repository compatibility review, Stage 36A2 is expected to deliver:

- A reusable server-side transaction integration layer.
- Atomic persistence of canonical operation records and associated business writes.
- Exact idempotent retry and operation conflict handling.
- Transactional inventory state reads and validated movement persistence.
- Atomic source-movement reversal guard enforcement.
- A trusted authorization boundary suitable for Cloud Functions.
- Consistent Firestore transaction read-before-write discipline.
- Focused unit and emulator integration tests.
- Explicit error behavior for conflicts, missing records, invalid state, and authorization failures.

The implementation must not prescribe unnecessary new abstractions or duplicate Stage 36A1 domain logic. Stage 36A1 validation functions must be used directly.

## 6. Critical transactional requirements

### A. Operation idempotency

- Read the existing operation record inside the transaction.
- Validate the complete stored record using Stage 36A1 domain functions.
- Same operation ID + same operation type + same canonical payload must return the original result without duplicating effects.
- Same operation ID with a different operation type or payload must fail with an explicit conflict.
- Persist the operation record atomically with associated business writes.
- Never rely on a client-supplied hash without server-side canonicalization and verification.

### Durable original operation result

- The accepted Stage 36A1 operation record remains exactly { operationId, operationType, canonicalPayload, payloadHash }.
- Stage 36A2 must not alter this schema.
- Exact retry must return the original operation result durably.
- Candidate design: a separate deterministic operation-result record keyed by operationId, persisted in the same Firestore transaction as the operation record and business writes.
- The operation-result record must be validated on read and must not be trusted if malformed or inconsistent.
- If no operation-result record exists for a completed operation, the integration must define fail-closed behavior rather than fabricating a result.
- The identity, atomic persistence, validation, and retry behavior of any operation-result record must be documented before implementation.

### B. Inventory movements

- Every movement must include a valid `medicineId`.
- Validate movement type and exact available/reserved stock deltas using the Stage 36A1 domain module.
- Read authoritative medicine state inside the transaction.
- Do not permit negative available or reserved balances.
- Do not silently reinterpret or migrate legacy `stock` values.
- Do not create a movement without its corresponding operation record.

### C. Reversal protection

- Read the source movement and its reversal guard inside the same transaction.
- Reject a reversal if the source movement is invalid or already reversed.
- Create the reversal movement and reversal guard atomically.
- A missing guard outside the transaction is never sufficient proof that a reversal is allowed.
- Ensure concurrent reversal attempts cannot both succeed.

### D. Firestore transaction discipline

- Complete all required transaction reads before issuing transaction writes.
- Do not perform external network calls inside a Firestore transaction callback.
- Do not use in-memory arrays or client-supplied history as authoritative evidence.
- Make transaction callbacks safe for Firestore automatic retries.
- Do not generate a new logical operation identity on each transaction retry.

### Stable operation ID ownership

- The transaction integration layer receives a stable operation ID.
- The same logical operation must use the same ID across retries.
- Transaction callback retries must never generate a new operation ID.
- The operation ID must be validated before persistence.
- The long-term owner of operation ID generation and durable client-side persistence may remain an unresolved decision if outside Stage 36A2 scope.
- Exact idempotency requirements are not weakened.

## 7. Authorization boundary

The integration must not treat a profile-only `approved` classification as sufficient authorization.

It must require:

- An authenticated caller.
- An approved user profile.
- An explicit enabled Firebase Authentication account state, verified through a trusted server-side mechanism.
- Authorization revalidation at the appropriate server-side operation boundary.

It must not trust client-supplied roles, approval flags, account states, or actor UIDs.

### Firebase Authentication account-state verification constraints

- Use a trusted server-side Firebase Admin Authentication mechanism to retrieve the caller's actual account state.
- Verify the account exists and is not disabled.
- Perform external Authentication lookups outside Firestore transaction callbacks.
- Treat missing accounts, disabled accounts, and lookup failures as authorization failures.
- Do not cache account-state results in a way that can bypass the required verification boundary.
- Firebase Authentication state and Firestore state cannot be read atomically in one Firestore transaction.
- Do not claim atomic consistency between these two services.
- The requirement to fail closed remains unchanged.

If the existing architecture cannot safely provide required Firebase Auth account-state verification, the requirement must not be weakened. The blocker must be documented and the affected implementation stopped.

## 8. Explicit exclusions

Stage 36A2 must not silently expand into:

- Production deployment.
- Firestore Rules deployment.
- Legacy inventory migration.
- Stock-field conversion.
- Renderer or UI changes.
- Android project changes.
- Full implementation of order submission, approval, rejection, fulfillment, cancellation, or returns unless a later approved stage explicitly assigns those workflows.
- Changes to unrelated existing behavior.
- Modification of pre-existing dirty files without a separately justified and approved change.

No commit, push, reset, clean, stash, or discard operations are permitted.

## 9. Dependencies and unresolved decisions

### Dependencies on Stage 36A1

- Canonical operation identity and hash functions.
- Stored operation validation.
- Inventory state and movement validation.
- Reversal guard validation.
- Order lifecycle and return evidence validation.
- Authorization classification functions.

### Unresolved owner decisions

- Full versus partial return policy.
- Operation ID generation and persistence ownership.
- ID grammar compatibility with existing records.
- Maximum order and movement quantities.
- Reversal approval policy.
- Legacy data reconciliation requirements.

These decisions are not resolved by this document.

## 10. Acceptance criteria

Stage 36A2 is acceptable only if the following are objectively verifiable:

- Atomicity of operation records and business writes.
- Exact retry behavior.
- Conflict rejection.
- Reversal uniqueness under concurrent requests.
- No negative inventory balances.
- Fail-closed authorization.
- No partial writes after transaction failure.
- Emulator-backed verification for guarantees that cannot be established by unit tests alone.
- Existing behavior and pre-existing changes preserved.

Unit-test evidence and emulator evidence must be distinguished. Concurrency and atomicity guarantees must not be claimed based only on mocked unit tests.

## 11. Repository inspection and conflicts

### Stage 36A0 documentation

No approved Stage 36A0 roadmap document was found in the repository. This scope document is based on the accepted Stage 36A1 domain contract, the repository's existing Cloud Functions architecture, and the explicit owner decisions provided for this stage.

### Existing architecture evidence

- Cloud Functions entry point: `functions/src/index.ts`.
- Authorization service: `functions/src/auth/authorization.ts`.
- User profile reader/parser: `functions/src/auth/user-profile.ts`.
- Existing callable: `submitOrder` in `functions/src/index.ts`.
- Firestore transaction usage exists in `submitOrder`.
- Existing transaction reads medicine and user state, then writes order, medicine, stock log, user, and submission records.
- Existing authorization requires an authenticated UID and an approved user profile, but does not verify Firebase Authentication account state through a trusted server-side mechanism.

### Repository conflict to document

The existing authorization architecture in `functions/src/auth/authorization.ts` classifies an approved profile as authorized without verifying Firebase Authentication account state (`enabled`, `disabled`, `missing`, or `unavailable`). This conflicts with the Stage 36A2 authorization boundary.

This discrepancy must be resolved during implementation planning. The requirement must not be weakened. If the existing architecture cannot safely provide trusted Firebase Auth account-state verification, the affected implementation must stop and document the blocker.

### Legacy stock interpretation

The existing `submitOrder` path treats `stock` as available stock and updates `stock` and `reservedStock`. Other legacy paths may interpret `stock` differently. Stage 36A2 must not assume a consistent meaning for `stock` and must not perform automatic conversion.

## 12. Restrictions

This document is the only intended output of this task.

- Do not implement Stage 36A2.
- Do not modify any other file.
- Do not run Firebase deployment commands or access production.
- Do not implement code or tests.
- Do not start Stage 36A3.

Wait for owner review and explicit approval of this scope document.


## 13. Approved owner decisions
### 13.1 Operation-record schema preservation

The exact Stage 36A1 operation-record schema is preserved:

`{ operationId, operationType, canonicalPayload, payloadHash }`

Stage 36A2 must not add, remove, rename, or reinterpret any field in this schema.

### 13.2 Durable original operation result

Durable original operation results must be stored in a separate deterministic record keyed by `operationId`.

Requirements:

- The result record is persisted in the same Firestore transaction as the Stage 36A1 operation record and all associated business writes.
- The result record identity must be deterministic from `operationId`.
- The result record must be validated on read using strict schema and consistency checks.
- A malformed or inconsistent result record must be treated as an authorization/data-integrity failure and must not be trusted.
- Exact retry must read the existing result record and return it without duplicating effects.
- If a completed operation has no valid result record, Stage 36A2 must fail closed rather than fabricating or inferring a result.
- Concurrent attempts using the same `operationId` must not create duplicate result records; transactional read-before-write and deterministic document identity must prevent races.
- Transaction retries must reuse the same `operationId` and must never generate a new result identity.

### 13.3 Firebase Authentication account-state verification

Authorization must use a trusted server-side Firebase Admin Authentication mechanism to retrieve the caller's actual account state.

Requirements:

- Verify that the account exists.
- Reject disabled accounts.
- Reject missing accounts.
- Reject lookup failures.
- Perform external Authentication lookups outside Firestore transaction callbacks.
- Do not cache account-state results in a way that can bypass the required verification boundary.
- Firebase Authentication state and Firestore state cannot be read atomically in one Firestore transaction.
- Do not claim atomic consistency between Firebase Authentication and Firestore.
- Fail closed on every authorization uncertainty.
### 13.4 Full and partial returns

Stage 36A2 must support both full and partial returns.

Requirements:

- Multiple partial returns for the same order are permitted.
- Cumulative returned quantity per medicine must never exceed the originally fulfilled quantity.
- Duplicate return operations must be prevented.
- Full return means all eligible fulfilled quantities have been returned.
- Cumulative totals and return-event uniqueness must be enforced transactionally against authoritative backend records.
- Pure domain validation alone is not sufficient to enforce cumulative totals or event uniqueness.

### 13.5 Inventory reversal approval

Inventory reversal requires a separate Administrator approval.

Requirements:

- Record approver identity.
- Record approval timestamp.
- Record approval reason.
- Approval and reversal execution must be independently auditable.
- Prevent duplicate reversal.
- Prevent concurrent reversal races through atomic guard creation.
- Reversal approval policy and reversal execution must remain distinct auditable events.

### 13.6 Quantity limits

Do not introduce arbitrary global quantity limits.

Requirements:

- Preserve existing per-medicine `maxQuantity` enforcement.
- Preserve applicable safe-integer and Stage 36A1 domain validation.
- Any new quantity ceiling requires a separately approved owner decision.

### 13.7 Legacy-data reconciliation

A legacy-data reconciliation plan is required before any migration or automatic stock reinterpretation.

Requirements:

- Do not migrate or reinterpret legacy records automatically in Stage 36A2.
- Reconciliation must compare legacy `stock`, `reservedStock`, and available movement history before any conversion.
- Existing legacy operation IDs and records must not be changed.

### 13.8 Operation ID ownership

The integration layer must supply a stable ID for each logical operation.

Requirements:

- The same logical operation must reuse the same ID across retries.
- The same logical operation must reuse the same ID across application restarts.
- IDs must not be generated inside Firestore transaction callbacks.
- IDs must be validated before persistence using the accepted Stage 36A1 validation rules.

## 14. Unresolved gates

The following remain explicitly unresolved and must not be assumed:

### A. Stage 36A1 ID grammar compatibility

Do not assume the Stage 36A1 ID grammar is compatible with existing production records. Compatibility requires evidence from production or representative legacy data before approval.

### B. Durable client-side operation ID ownership boundary

Do not assume where durable client-side operation ID ownership should reside. An architectural investigation is required to determine the correct persistence boundary before implementation.

### C. Legacy records

Do not change existing legacy operation IDs or migrate records. Any reconciliation or migration requires a separately approved plan.
