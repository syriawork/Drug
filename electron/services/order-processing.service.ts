/**
 * Stage 6 - the order-processing orchestration.
 *
 * This is the Windows translation of A2 `AdminOrderProcessor.processRequest`, and
 * A2 is the authority for every branch, every message and every ORDER. The
 * service owns the sequence and the error conversion; it owns no I/O of its own
 * and no business rules of its own.
 *
 * THE SEQUENCE, AND WHY IT IS FIXED (A2 §6.3)
 *
 *   R1 order_requests/{id}    non-pending => AlreadyProcessed, ZERO writes
 *   R2 users/{uid}
 *   R3 settings/app
 *   R4 medicines/{id} per aggregated line
 *   ---- pure validation, no I/O ----
 *   W1 orders/{autoId}        W2 absolute stock   W3 stock_logs (outward)
 *   W4 users/{uid} summary    W5 order_requests -> 'processed'
 *
 * Every read precedes every write, which Firestore's transaction API enforces
 * anyway. Keeping the same order here is what makes a Windows failure diagnosable
 * against an Android one.
 *
 * THE FOUR OUTCOMES ARE NOT INTERCHANGEABLE
 *
 *  1. `Success`                    -> W1-W5 committed.
 *  2. `BusinessValidationFailure`  -> a `failed` marker committed. A2 does this
 *     for every rule refusal, so the employee sees WHY rather than finding a
 *     request stuck on "pending" forever.
 *  3. `AlreadyProcessed`           -> ZERO writes, rolled back. Idempotency.
 *  4. `DomainError` thrown         -> NOT_AUTHORIZED (the rules said no),
 *     ABORTED (a conflict - retry from R1), or a transport failure. NONE of
 *     these may be turned into a business failure: a rules denial is not a
 *     business verdict, and a conflict says "try again", not "refuse".
 *
 * The `MalformedDataError` bridge is the subtle one. `mapOrderRequest` stays
 * strict, but A2's own field-level checks (lines 179-221) turn a request with a
 * missing uid / non-list items / non-Timestamp date into `status = 'failed'`.
 * So malformed data is a BUSINESS outcome in A2, and the boundary here converts
 * the mapper's technical `MalformedDataError` into that same outcome - keeping
 * the technical field path in the ERROR LOG rather than in the user-facing
 * `order_requests.error` string.
 */

import { DomainError, MalformedDataError } from '../domain/errors';
import type {
  AppSettings,
  DomainTimestamp,
  Medicine,
  OrderItem,
  OrderRequest,
  User,
} from '../domain/models';
import { aggregateItems, type NormalizedItem } from '../domain/order-rules';
import { validateUserEligibility } from '../domain/eligibility';
import { validateScheduleAndTime, getDamascusMonthYear } from '../domain/schedule';
import {
  type ProcessingResult,
  isRawStatusPending,
  RAW_STATUS_ABSENT,
} from '../domain/results';
import type { OrderProcessingTransaction, UserOrderSummaryWrite } from '../repositories/contracts/common';

/** A2 line 363's stock check uses the medicine NAME, never its id. */
function insufficientStockError(medicineName: string): string {
  return `Insufficient stock for ${medicineName}`;
}

/** A2 line 297-303: a medicine the catalogue does not contain. */
function medicineNotFoundError(medicineId: string): string {
  return `Medicine not found: ${medicineId}`;
}

export interface OrderProcessingActor {
  /** The authenticated admin who pressed the button. */
  readonly uid: string;
  /** A2 line 367 writes this as the log's `userName` (D10). */
  readonly name: string;
}

export interface OrderProcessingOutcome {
  readonly result: ProcessingResult;
  /** One `ABORTED` is retried from R1; this counts the attempts actually made. */
  readonly attempts: number;
  /**
   * The technical cause of a `MalformedDataError` that was converted into a
   * business failure. The A2-equivalent USER-FACING text went into the request;
   * this keeps the field path for the log, as A2 never had one to report.
   */
  readonly malformedDetails?: readonly string[] | undefined;
}

export interface OrderProcessingServiceOptions {
  readonly maxTransactionAttempts?: number | undefined;
  readonly onWarning?: ((message: string) => void) | undefined;
}

/** The default retry budget for `ABORTED` transactions. */
export const DEFAULT_MAX_TRANSACTION_ATTEMPTS = 3;

/**
 * The clock seam. A2 reads the server clock for `processedAt` via a Firestore
 * transform and reads the request's own `requestDate` for every rule, so the
 * service needs no "now" of its own - `date` below is A2's `serverTimestamp`,
 * resolved once and reused for the order, the logs and the user summary.
 */
export interface OrderProcessingService {
  process(requestId: string, actor: OrderProcessingActor): Promise<OrderProcessingOutcome>;
}

/** A2's user-facing text for a request whose own fields are unusable. */
export const ERROR_MALFORMED_REQUEST = 'Invalid request structure or malformed request data';

/** A2 line 260-262: the `settings/app` fallbacks, used when the doc is absent. */
const DEFAULT_MIN_DAYS = 15;

/** Sentinel meaning "this attempt lost a race; restart from R1". */
const RETRY_FROM_R1 = Symbol('retry-from-r1');

interface StockPlanEntry {
  readonly medicine: Medicine;
  readonly quantity: number;
  /** The ABSOLUTE value W2 writes; computed from this transaction's read. */
  readonly newStock: number;
}

interface AttemptState {
  /** Technical causes kept for the log, never shown to the employee. */
  readonly malformedDetails: string[];
}

/** Turns the `AppSettings` document into the shape `validateScheduleAndTime` wants. */
function toScheduleSettings(settings: AppSettings | null): {
  readonly allowFridayOrders: boolean;
  readonly startTime: string;
  readonly endTime: string;
  readonly minDaysBetweenOrders: number;
} {
  // A missing `settings/app` falls back to A2's own defaults (line 258-263), the
  // same four the Stage 5B mapper applies to a document that exists.
  return settings ?? {
    allowFridayOrders: false,
    startTime: '06:00',
    endTime: '10:00',
    minDaysBetweenOrders: DEFAULT_MIN_DAYS,
  };
}

/** A2 line 389: the summary W4 writes, with the exception consumed. */
function buildUserSummary(
  user: User,
  orderId: string,
  date: DomainTimestamp,
): UserOrderSummaryWrite {
  return {
    // A2 line 389 sets this to false, which SPENDS the exception.
    hasException: false,
    lastOrderId: orderId,
    lastOrderDate: date,
    lastOrderMonthYear: monthYearValue(date),
    lastOrderStatus: 'pending',
    // A2 records that this order WAS the exception, so A4 can tell why the
    // minimum interval was skipped.
    lastOrderIsException: user.hasException,
  };
}

/**
 * The month written onto an order and into the user summary.
 *
 * A2 derives the month from the SAME `getDamascusCalendar` object it uses for
 * the weekday, so routing both through one domain function is what guarantees
 * the order's month can never disagree with the day the schedule check used.
 */
function monthYearValue(date: DomainTimestamp): string {
  return getDamascusMonthYear(date);
}

export class FirestoreOrderProcessingService implements OrderProcessingService {
  private readonly maxAttempts: number;

  public constructor(
    private readonly beginTransaction: () => Promise<OrderProcessingTransaction>,
    options: OrderProcessingServiceOptions = {},
  ) {
    // A bound of 0 would turn a conflict into a hard failure, and an unbounded
    // loop would spin forever against a genuinely contended medicine.
    this.maxAttempts = Math.max(1, options.maxTransactionAttempts ?? DEFAULT_MAX_TRANSACTION_ATTEMPTS);
  }

  public async process(requestId: string, actor: OrderProcessingActor): Promise<OrderProcessingOutcome> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const state: AttemptState = { malformedDetails: [] };
      const transaction = await this.beginTransaction();
      try {
        const outcome = await this.runAttempt(transaction, requestId, actor, state);
        if (outcome === RETRY_FROM_R1) {
          // The transaction is dead. Roll it back, DISCARD every read it
          // produced, and start again from R1 - a retry that reused a stale
          // stock value would be exactly the bug the transaction prevents.
          await transaction.rollback();
          continue;
        }
        // Release the handle on the way out, UNCONDITIONALLY. The
        // `already-processed` branch decides at R1 that there is nothing to
        // write, so it never reaches `commit()` - and an abandoned handle keeps
        // Firestore's locks on every document that attempt read, blocking other
        // writers until the transaction times out. Releasing here is what makes
        // "every attempt ends in exactly one commit or one rollback" true by
        // construction rather than by remembering each early return. After a
        // successful commit the adapter treats this as a no-op.
        await transaction.rollback();
        return { result: outcome, attempts: attempt, malformedDetails: state.malformedDetails };
      } catch (error: unknown) {
        // A conflict is the ONLY retryable error. A rules denial or a transport
        // failure is re-thrown unchanged, so neither can be mistaken for a
        // business verdict.
        if (error instanceof DomainError && error.kind === 'ABORTED' && attempt < this.maxAttempts) {
          await transaction.rollback();
          continue;
        }
        await transaction.rollback();
        throw error;
      }
    }

    // Budget exhausted: an INFRASTRUCTURE outcome, thrown as such. It is
    // deliberately NOT a business failure - the request stays `pending` and can
    // be processed again once the contention clears.
    throw new DomainError(
      'ABORTED',
      `order ${requestId}: the transaction kept aborting after ${this.maxAttempts} attempts`,
      { documentPath: `order_requests/${requestId}` },
    );
  }

  /** One begin-to-commit attempt. Returns `RETRY_FROM_R1` only for a conflict. */
  private async runAttempt(
    transaction: OrderProcessingTransaction,
    requestId: string,
    actor: OrderProcessingActor,
    state: AttemptState,
  ): Promise<ProcessingResult | typeof RETRY_FROM_R1> {
    // ---- R1 + the request's own field checks (A2:168, 179-221) -------------
    // The RAW status decides "already processed" (A2:174-176). This MUST be
    // checked before relying on the mapped model, whose mapper turns an absent
    // status into the 'pending' fallback and would resurrect a finished request.
    const rawStatus = await transaction.readRawRequestStatus(requestId);
    if (!isRawStatusPending(rawStatus)) {
      return { kind: 'already-processed', status: rawStatus };
    }

    let request;
    try {
      request = await transaction.readRequest(requestId);
    } catch (error: unknown) {
      const failure = this.toMalformedOutcome(error, requestId);
      if (failure === null) {
        throw error;
      }
      state.malformedDetails.push(failure.detail);
      // A2-equivalent: the request is marked `failed` with a user-facing reason,
      // while the technical field path stays in the LOG (state.malformedDetails).
      return await this.markFailed(transaction, requestId, failure.reason, actor);
    }

    if (request === null) {
      // A2 line 168-171: a missing request document is "already processed".
      return { kind: 'already-processed', status: RAW_STATUS_ABSENT };
    }

    // A2's own field-level refusals (lines 179-221). These are BUSINESS
    // outcomes, and A2 marks the request `failed` for each of them.
    const fieldError = checkRequestFields(request, requestId);
    if (fieldError !== null) {
      state.malformedDetails.push(fieldError);
      return await this.markFailed(transaction, requestId, ERROR_MALFORMED_REQUEST, actor);
    }

    // ---- R2 -----------------------------------------------------------------
    const user = await transaction.readUser(request.uid);
    if (user === null) {
      return await this.markFailed(transaction, requestId, 'User not found', actor);
    }

    // ---- R3 -----------------------------------------------------------------
    const settings = await transaction.readSettings();

    // ---- item rules (A2:44-72), before any medicine is read ---------------
    const aggregated = aggregateItems(request.items);
    if (aggregated.error !== null) {
      return await this.markFailed(transaction, requestId, aggregated.error, actor);
    }

    // ---- R4: one medicine per aggregated line, A2's order (A2:293) ----------
    const stockPlan: StockPlanEntry[] = [];
    for (const line of aggregated.items) {
      const medicine = await transaction.readMedicine(line.medicineId);
      if (medicine === null) {
        return await this.markFailed(transaction, requestId, medicineNotFoundError(line.medicineId), actor);
      }
      const shortage = checkMedicineStock(medicine, line);
      if (shortage !== null) {
        return await this.markFailed(transaction, requestId, shortage, actor);
      }
      // The ABSOLUTE new stock, computed from the value read INSIDE this
      // transaction - never a re-read, never an increment (D5/§7.4).
      stockPlan.push({ medicine, quantity: line.quantity, newStock: medicine.stock - line.quantity });
    }

    return await this.validateAndWrite(transaction, request, user, settings, stockPlan, requestId, actor);
  }

  /**
   * The pure validation, then the five writes - A2 §6.3's exact split.
   *
   * Both validation steps run AFTER every read and BEFORE any write, which is
   * what A1 requires and what makes the transaction abort rather than half-apply
   * when a medicine changes underneath us.
   */
  private async validateAndWrite(
    transaction: OrderProcessingTransaction,
    request: OrderRequest,
    user: User,
    settings: AppSettings | null,
    stockPlan: readonly StockPlanEntry[],
    requestId: string,
    actor: OrderProcessingActor,
  ): Promise<ProcessingResult> {
    const date = request.requestDate;

    const scheduleError = validateScheduleAndTime(date, toScheduleSettings(settings));
    if (scheduleError.error !== null) {
      return await this.markFailed(transaction, requestId, scheduleError.error, actor);
    }

    const eligibilityError = validateUserEligibility(
      user,
      date,
      settings?.minDaysBetweenOrders ?? DEFAULT_MIN_DAYS,
    );
    if (eligibilityError.error !== null) {
      return await this.markFailed(transaction, requestId, eligibilityError.error, actor);
    }

    // ---- W1..W5, queued in A2's order and committed together --------------
    const orderItems: OrderItem[] = stockPlan.map((entry) => ({
      medicineId: entry.medicine.id,
      // A2 snapshots the CURRENT catalogue name, not the name the request sent.
      medicineName: entry.medicine.name,
      quantity: entry.quantity,
    }));

    const orderId = await transaction.createOrder({
      userId: user.uid,
      userName: user.name,
      items: orderItems,
      date,
      // ASCII MM-yyyy in Asia/Damascus (A2 uses Locale.US). D1 is not migrated.
      monthYear: monthYearValue(date),
      // The exception is CONSUMED by this order (A2:389).
      isExceptionOrder: user.hasException,
      requestId,
    });

    for (const entry of stockPlan) {
      await transaction.setMedicineStock(entry.medicine.id, entry.newStock);
    }

    for (const entry of stockPlan) {
      await transaction.createStockLog({
        // A2 records the EMPLOYEE who receives the medicine, NOT the admin who
        // pressed the button (D3). `actor` stays the admin: its identity belongs
        // only in `processedBy`. Using the actor here would file the movement
        // under the pharmacy staff and make the stock report unreadable.
        uid: user.uid,
        medicineId: entry.medicine.id,
        medicineName: entry.medicine.name,
        quantity: entry.quantity,
        type: 'outward',
        date,
        // The wire field is `userName` (D10); the mapper does that translation.
        label: user.name,
        requestId,
        orderId,
      });
    }

    await transaction.updateUserSummary(user.uid, buildUserSummary(user, orderId, date));
    await transaction.markRequestProcessed(requestId, orderId, actor.uid);

    await transaction.commit();
    return { kind: 'success', orderId };
  }

  /** A2's business-failure marker: queue the write, then commit it atomically. */
  private async markFailed(
    transaction: OrderProcessingTransaction,
    requestId: string,
    reason: string,
    actor: OrderProcessingActor,
  ): Promise<ProcessingResult> {
    await transaction.markRequestFailed(requestId, reason, actor.uid);
    await transaction.commit();
    return { kind: 'business-validation-failure', reason };
  }

  /**
   * The `MalformedDataError` bridge.
   *
   * `mapOrderRequest` stays STRICT - a Stage 5B guarantee that is not weakened
   * here. But A2 treats these very same shapes as a business failure (lines
   * 179-221), so the service converts the technical error into A2's user-facing
   * `failed` outcome instead of leaking a field path such as `items[1].quantity`
   * into `order_requests.error`.
   *
   * Returns `null` for every OTHER error, so a transport failure or a rules
   * denial keeps propagating untouched.
   */
  private toMalformedOutcome(
    error: unknown,
    requestId: string,
  ): { readonly reason: string; readonly detail: string } | null {
    if (!(error instanceof MalformedDataError)) {
      return null;
    }
    return {
      reason: ERROR_MALFORMED_REQUEST,
      detail: `order ${requestId}: ${error.fieldPath} - ${error.message}`,
    };
  }
}

/**
 * A2 lines 179-221: the request's own fields.
 *
 * The Stage 5B mapper already refuses a missing `uid` or a non-Timestamp
 * `requestDate` by throwing, so by the time this runs those two are guaranteed;
 * what remains is the emptiness check A2 performs on the mapped model.
 */
function checkRequestFields(request: OrderRequest, requestId: string): string | null {
  if (request.uid.trim().length === 0) {
    return `order ${requestId}: uid is blank`;
  }
  if (request.items.length === 0) {
    return `order ${requestId}: items is empty`;
  }
  return null;
}

/** A2 lines 310-323: the per-medicine cap, then the available stock. */
function checkMedicineStock(medicine: Medicine, line: NormalizedItem): string | null {
  // A2 line 310: the CAP, checked on the AGGREGATED quantity (see order-rules).
  if (line.quantity > medicine.maxQuantity) {
    return `Maximum quantity for ${medicine.name} is ${medicine.maxQuantity}`;
  }
  // A2 line 321: the stock actually available.
  if (line.quantity > medicine.stock) {
    return insufficientStockError(medicine.name);
  }
  return null;
}


