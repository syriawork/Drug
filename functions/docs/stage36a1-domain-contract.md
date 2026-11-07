# Stage 36A1 domain contract

This stage contains pure validation and accounting only. It does not read or
write Firestore, expose a callable, or connect to existing order or stock paths.

## Operation identity and stored record

- Every mutation uses one caller-provided `operationId` namespace regardless
  of type. IDs are 1-128 ASCII letters, digits, periods, underscores, colons,
  or hyphens, beginning with a letter or digit.
- The canonical stored operation record has exactly these fields:
  `operationId`, `operationType`, `canonicalPayload`, and `payloadHash`.
  `operationId` follows the domain ID grammar; `operationType` is one of
  `reserve`, `fulfill`, `release`, `receipt`, `correction`, or `reversal`;
  `canonicalPayload` is the canonical, closed-schema payload for that type;
  and `payloadHash` is 64 lowercase hexadecimal SHA-256 characters.
- Stored records are validated in full. Their payload must already be in
  canonical form and the hash is recomputed from
  `{ operationType, payload: canonicalPayload }`. A mismatch, incomplete
  record, unknown field, or noncanonical payload is rejected.
- A retry is compatible only when both full records validate and their ID,
  type, canonical payload, and hash match. Hash equality alone is insufficient:
  canonical payloads are compared too.
- Reserve, fulfill, and release payloads contain exactly `orderId`, `userId`,
  and non-empty `items`. Duplicate medicine lines are aggregated with checked
  arithmetic and sorted deterministically. Receipt payloads identify one
  medicine and positive quantity. Correction payloads identify one medicine,
  one stock pool, and one non-zero signed delta. Reversal payloads identify
  one source movement.

## Inventory movement contract

- State contains exactly nonnegative safe-integer `availableStock` and
  `reservedStock`. No missing or ambiguous legacy field is defaulted.
  `onHand` is derived as their checked sum; it is never mutable state.
- Every movement records `movementId`, `operationId`, `medicineId`, before and
  after balances, and exact available/reserved/on-hand deltas.
- Reservation requires available delta `-quantity`, reserved delta
  `+quantity`, and on-hand delta zero. Fulfillment requires available delta
  zero, reserved delta `-quantity`, and on-hand delta `-quantity`. Release
  requires available delta `+quantity`, reserved delta `-quantity`, and
  on-hand delta zero. Receipt requires available delta `+quantity`, reserved
  delta zero, and on-hand delta `+quantity`.
- Correction identifies exactly one pool (`availableStock` or `reservedStock`)
  and a non-zero signed delta. Only that pool and derived on-hand change.
- All IDs, quantities, balances, sums, and deltas are checked; invalid,
  negative, fractional, unsafe, inconsistent, insufficient, and overflowing
  values are rejected.

## Reversal guard and movement

- A reversal references both the source movement ID and source operation ID,
  identifies the same medicine, and stores the exact inverse of the source
  movement's deltas. Source movements are validated against their declared
  movement semantics; reversal-of-reversal is rejected.
- Domain reversal requires a guard result keyed by `sourceMovementId` with
  `{ sourceMovementId, reversalExists }`. A present guard rejects the reversal;
  an absent guard permits calculation only if the inverse yields safe,
  nonnegative balances.
- The guard value is a trusted-backend input contract, not proof authenticated
  by a pure function. Domain validation cannot guarantee uniqueness or that
  guard history is complete. Future backend logic must read the deterministic
  guard and create it atomically with the reversal movement in one transaction.

## Order lifecycle and physical return

- The owner-approved lifecycle distinguishes administrative approval from
  physical handoff: `pending -> accepted -> fulfilled`. `accepted` means
  approved but not yet handed over. `fulfilled` records the physical handoff.
- `pending` may also transition to `rejected` or `cancelled`; `accepted` may
  transition to `cancelled`; `rejected` and `cancelled` are terminal.
- Approval is not fulfillment and does not consume reserved inventory.
  Fulfillment is the event that consumes reserved stock.
- Fulfilled cancellation requires structured evidence containing
  `returnEventId`, matching `orderId`, medicine-associated positive quantities,
  `acceptedByUid`, and canonical UTC acceptance timestamp. The supplied order
  context is used to check the event's order and item association.
- The pure validator cannot authenticate the actor, establish timestamp
  provenance, or prove that a return record exists. Future backend logic must
  verify the evidence against authoritative records and enforce the required
  authorization inside the transaction. Cancellation itself never restores
  stock; restoration must be a separate validated receipt/return movement.
- Whether a fulfilled order may be cancelled with only a partial return is a
  remaining business-policy decision. This validator requires at least one
  associated accepted return item and does not claim that all items were
  returned.

## Profile and Firebase Auth authorization distinction

- Profile classification validates a domain UID matching the expected UID and
  the repository role vocabulary `admin`, `assistant`, `employee` plus status
  vocabulary `pending`, `approved`, `rejected`.
- Profile classification is not Firebase authorization. Combined
  authorization requires an explicit trusted Firebase Auth account lookup
  result: `{ state: 'enabled' | 'disabled' | 'missing' | 'unavailable' }`.
  Missing, unavailable, malformed, or unrecognized account state never means
  enabled. Only an approved profile combined with explicit enabled Auth state
  classifies as approved.
- Future callable code must obtain account state using a trusted server-side
  Firebase Auth lookup. Do not accept client-supplied account state. Profile
  `role` and `status` remain server-controlled authorization attributes, and
  this stage does not change or establish Firestore Rules or enforce roles
  transactionally.
- Unrelated profile fields are ignored by this classifier; they do not grant
  privileges. The role and status fields themselves must be recognized.

## Remaining integration policies

- Confirm the identifier grammar against existing production IDs before use.
- Define order size and per-medicine quantity ceilings; no arbitrary business
  ceiling is introduced here.
- Define operation ID issuance, persistence, retention, and replay-window
  policy.
- Confirm reversal approval and any ordering policy beyond the atomic
  source-movement guard.
- Decide whether fulfilled-order cancellation requires complete rather than
  partial return.
- Define the trusted records and authorization rules behind return evidence and
  Firebase Auth lookups before backend integration.
