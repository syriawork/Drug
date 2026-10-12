/**
 * Stage 6 - the processing result model.
 *
 * Ported from A2 `sealed class ProcessingResult` (AdminOrderProcessor.kt:13-17),
 * which is the authority for the shape:
 *
 *   Success(orderId) | BusinessValidationFailure(reason) | AlreadyProcessed(status)
 *
 * WHY A DOMAIN TYPE AND NOT AN EXCEPTION
 * `AlreadyProcessed` is a normal, expected outcome, not a failure: the request
 * was handled by someone else. A2 returns it from inside the transaction and the
 * caller inspects it. Throwing would force every caller into a try/catch and
 * would blur it with a real error - which is exactly the distinction Â§15 of
 * docs/domain-data-architecture.md insists on preserving.
 *
 * This module is PURE: no Firestore, no Electron, no I/O.
 */

/** The order was processed; `orderId` is the new `orders/{id}` document id. */
export interface ProcessingSuccess {
  readonly kind: 'success';
  readonly orderId: string;
}

/**
 * A business rule refused the request.
 *
 * A2 still COMMITS the `status = 'failed'` marker for these (inside the
 * transaction), which is what distinguishes them from `AlreadyProcessed`.
 * `reason` is the exact user-facing text A2 produces - never a technical field
 * path such as `items[1].quantity`.
 */
export interface ProcessingBusinessValidationFailure {
  readonly kind: 'business-validation-failure';
  readonly reason: string;
}

/**
 * The request was already processed. A2 line 174-176: any raw `status` that is
 * not exactly `"pending"` - including an ABSENT one, which reads as `""` -
 * produces this outcome, and the transaction writes NOTHING.
 */
export interface ProcessingAlreadyProcessed {
  readonly kind: 'already-processed';
  /** The raw status found on the document (`""` when the field is absent). */
  readonly status: string;
}

export type ProcessingResult =
  | ProcessingSuccess
  | ProcessingBusinessValidationFailure
  | ProcessingAlreadyProcessed;

/** Narrowing helpers (used by the service and by the tests). */
export function isSuccess(result: ProcessingResult): result is ProcessingSuccess {
  return result.kind === 'success';
}

export function isBusinessValidationFailure(
  result: ProcessingResult,
): result is ProcessingBusinessValidationFailure {
  return result.kind === 'business-validation-failure';
}

export function isAlreadyProcessed(result: ProcessingResult): result is ProcessingAlreadyProcessed {
  return result.kind === 'already-processed';
}

/** The raw `status` value that A2 treats as "not pending". */
export const RAW_STATUS_PENDING = 'pending';

/** The value A2's `getString("status") ?: ""` yields for an absent field. */
export const RAW_STATUS_ABSENT = '';

/**
 * A2 line 174-176, verbatim: the raw status must be exactly `"pending"`.
 *
 * NOTE this is deliberately a comparison on the RAW Firestore value, not on the
 * domain model. `readEnum` in the mappers maps an unknown/absent status to the
 * `"pending"` fallback, so deciding here from the domain object would silently
 * turn an already-processed request back into a processable one.
 */
export function isRawStatusPending(rawStatus: string | null | undefined): boolean {
  return (rawStatus ?? RAW_STATUS_ABSENT) === RAW_STATUS_PENDING;
}