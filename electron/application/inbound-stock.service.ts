/**
 * Stage 15 - the INBOUND STOCK RECEIPT use case.
 *
 * WHAT THIS STAGE ADDS, EXACTLY
 *
 * One operation: an administrator records that goods arrived. It writes the
 * medicine's `stock` and `totalInward` AND a `stock_logs` row, in ONE Firestore
 * transaction, so the inventory can always be explained.
 *
 * WHY IT IS IN `application/` AND NOT IN A REPOSITORY
 *
 * The decision content lives here and the transport lives in
 * `repositories/firestore/`. Deciding that a receipt means `stock + q`, reading
 * the current stock INSIDE the transaction, refusing a missing medicine, and
 * retrying a lost race are all use-case concerns; none of them belongs in a
 * repository, which exists only to describe what the server stores.
 *
 * THE ONE GUARANTEE THIS FILE EXISTS TO KEEP
 *
 * No receipt without its audit row, ever. Both writes are queued on one
 * transaction object and committed together, so there is no code path that can
 * move stock without leaving a trace. That is the condition the Stage 5B
 * `MedicinesRepository` contract always refused to trade away, and it is now
 * satisfied rather than assumed.
 *
 * WHAT IS DELIBERATELY ABSENT
 *  - no `setStock`, `adjustStock`, `createMedicine` or `deleteMedicine`;
 *  - no OUTWARD movement: dispensing stays Stage 6's exclusive business;
 *  - no `totalOutward`: that counter belongs to the order processor;
 *  - no `name` edit, because Android has no rename operation at all.
 *
 * WHY NOTHING HERE DECIDES AUTHORIZATION
 *
 * The only local check is session PRESENCE. A caller who is not an administrator
 * reaches the network and firestore.rules answers 403 - `isAdmin()` covers both
 * `admin` and `assistant`, and this stage neither widens nor narrows that. The
 * Stage 15 emulator suite proves the refusal against the real engine.
 */

import type {
  InboundStockTransaction,
  InboundStockTransactionFactory,
} from '../repositories/contracts/common';
import { DomainError } from '../domain/errors';
import { SERVER_TIMESTAMP } from '../services/firestore-codec';
import { applicationFailureFrom, applicationRefusal, applicationSuccess } from './application-result';

/** Supplies the current safe auth state; never a token. */
export interface AuthStateSource {
  getState(): SafeAuthState;
}

/** The exact keys an inbound receipt may carry. */
const ALLOWED_INBOUND_KEYS: ReadonlySet<string> = new Set<string>(['medicineId', 'quantity']);

/**
 * A medicine id must survive being used as a document id, so a crafted id can never
 * address a document outside `medicines/`. Identical to the Stage 10 rule, so the
 * two medicine screens cannot drift apart on what a legal id is.
 */
const MEDICINE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** One `ABORTED` is retried; this counts the attempts actually made. */
const DEFAULT_MAX_ATTEMPTS = 3;

/** What the use case accepts once the payload has been checked. */
export interface ValidatedInboundStock {
  readonly medicineId: string;
  readonly quantity: number;
}

/** What the caller is told after a receipt succeeded. */
export interface InboundStockReceiptView {
  readonly medicineId: string;
  /** The medicine name at write time - the snapshot, never re-resolved later. */
  readonly medicineName: string;
  /** The stored `stock` AFTER the receipt, as an absolute value. */
  readonly newStock: number;
  /** The stored `totalInward` AFTER the receipt. */
  readonly newTotalInward: number;
  /** The positive magnitude that was received. */
  readonly quantity: number;
}

export interface InboundStockServiceOptions {
  readonly createTransaction: InboundStockTransactionFactory;
  readonly auth: AuthStateSource;
  readonly maxAttempts?: number | undefined;
  readonly onDiagnostic?: ((message: string) => void) | undefined;
}

/**
 * The verdict of one attempt, kept separate from the receipt itself so a retried
 * attempt cannot accidentally report a half-finished outcome.
 */
type AttemptVerdict =
  | { readonly kind: 'succeeded'; readonly receipt: InboundStockReceiptView }
  | { readonly kind: 'missing-medicine' }
  | { readonly kind: 'retry' };

export class InboundStockService {
  private readonly createTransaction: InboundStockTransactionFactory;
  private readonly auth: AuthStateSource;
  private readonly maxAttempts: number;
  private readonly onDiagnostic: ((message: string) => void) | undefined;

  public constructor(options: InboundStockServiceOptions) {
    this.createTransaction = options.createTransaction;
    this.auth = options.auth;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.onDiagnostic = options.onDiagnostic;
  }

  /**
   * Validates the payload without performing any I/O.
   *
   * Exposed separately from `receiveInboundStock` so a handler can reject a
   * malformed request before a transaction is even begun, and so the rules are
   * testable without a repository behind them.
   */
  public validateInboundStock(payload: unknown): ApplicationResult<ValidatedInboundStock> {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return applicationRefusal('VALIDATION_FAILED', { diagnostic: 'the receipt payload must be an object' });
    }

    const candidate = payload as Record<string, unknown>;

    // Refusing an unexpected key is what makes `stock`, `totalInward`,
    // `totalOutward`, `name`, `medicineName` and `type` UNREACHABLE rather than
    // merely ignored. A renderer sending `stock: 999` must be told no, not be
    // silently given a receipt of zero.
    for (const key of Object.keys(candidate)) {
      if (!ALLOWED_INBOUND_KEYS.has(key)) {
        return applicationRefusal('VALIDATION_FAILED', {
          diagnostic: `refused a receipt carrying the unsupported key "${key}"`,
        });
      }
    }

    const medicineId = candidate['medicineId'];
    if (typeof medicineId !== 'string' || !MEDICINE_ID_PATTERN.test(medicineId)) {
      return applicationRefusal('VALIDATION_FAILED', { diagnostic: 'refused a malformed medicine id' });
    }

    const quantity = candidate['quantity'];
    if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity)) {
      return applicationRefusal('VALIDATION_FAILED', { diagnostic: 'refused a non-integer quantity' });
    }
    // A receipt of zero, or a negative one, is not a receipt at all - and a negative
    // would be stored as a magnitude and read by every later aggregation as an
    // outflow, which is precisely the corruption Stage 14's audit screen exists to
    // prevent.
    if (quantity <= 0) {
      return applicationRefusal('VALIDATION_FAILED', {
        diagnostic: 'refused a non-positive receipt quantity',
      });
    }
    return applicationSuccess({ medicineId, quantity });
  }

  /**
   * Records an inbound receipt and its audit row, atomically.
   *
   * Never throws: every outcome comes back as an `ApplicationResult`.
   *
   * RETRY: a conflict (`ABORTED`) is the ONLY retryable outcome, exactly as in
   * Stage 6. A rules denial or a transport failure is not retried, because the
   * retry would reach the same verdict. Each attempt re-reads the medicine inside
   * its own transaction, so a retried receipt computes its absolute value from
   * fresh data rather than from a stale figure - which is what makes retrying safe
   * when the written value is absolute rather than an increment.
   */
  public async receiveInboundStock(payload: unknown): Promise<ApplicationResult<InboundStockReceiptView>> {
    const validated = this.validateInboundStock(payload);
    if (!validated.ok) {
      return validated;
    }

    // Session presence only. It grants nothing on the basis of a role; it just
    // avoids a pointless transaction.
    const state = this.auth.getState();
    if (!state.authenticated || state.uid === null) {
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'receiveInboundStock without a Main-process session',
      });
    }
    if (typeof state.displayName !== 'string' || state.displayName.trim().length === 0) {
      return applicationRefusal('INFRASTRUCTURE_FAILURE', {
        retryable: false,
        diagnostic: 'receiveInboundStock without an authenticated profile display name',
      });
    }

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let transaction: InboundStockTransaction;
      try {
        transaction = await this.createTransaction();
      } catch (error: unknown) {
        return applicationFailureFrom<InboundStockReceiptView>(error, this.onDiagnostic);
      }
      let verdict: AttemptVerdict;

      try {
        verdict = await this.runAttempt(transaction, validated.value, state.uid, state.displayName);
      } catch (error: unknown) {
        // Every attempt ends in exactly one commit or one rollback. An abandoned
        // handle keeps Firestore's locks on every document that attempt read, which
        // would block other administrators writing at the same time.
        await transaction.rollback();
        if (error instanceof DomainError && error.kind === 'ABORTED' && attempt < this.maxAttempts) {
          continue;
        }
        return applicationFailureFrom<InboundStockReceiptView>(error, this.onDiagnostic);
      }

      if (verdict.kind === 'retry') {
        await transaction.rollback();
        continue;
      }
      if (verdict.kind === 'missing-medicine') {
        await transaction.rollback();
        return applicationRefusal('NOT_FOUND', {
          retryable: false,
          diagnostic: `no medicine "${validated.value.medicineId}" to receive stock into`,
        });
      }
      return applicationSuccess(verdict.receipt);
    }

    return applicationRefusal('CONCURRENCY_CONFLICT', {
      retryable: true,
      diagnostic: `the inbound receipt kept aborting after ${this.maxAttempts} attempts`,
    });
  }

  /**
   * One begin-to-commit attempt.
   *
   * The order matters: read, queue BOTH writes, then commit. Nothing is sent
   * before `commit()`, so a failure anywhere in here leaves the database untouched -
   * no medicine updated without its log, and no log without its medicine.
   */
  private async runAttempt(
    transaction: InboundStockTransaction,
    request: ValidatedInboundStock,
    actorUid: string,
    actorName: string,
  ): Promise<AttemptVerdict> {
    const medicine = await transaction.readMedicine(request.medicineId);
    if (medicine === null) {
      return { kind: 'missing-medicine' };
    }

    // ABSOLUTE values, because the REST client has no `FieldValue.increment` (D5).
    // Computed from the read that Firestore re-validates at commit time, which is
    // what makes an absolute write as safe as an increment.
    const newStock = medicine.stock + request.quantity;
    const newTotalInward = medicine.totalInward + request.quantity;
    if (!Number.isSafeInteger(newStock) || !Number.isSafeInteger(newTotalInward)) {
      throw new DomainError('INVALID_INPUT', 'inbound stock totals exceed the safe integer range', {
        documentPath: `medicines/${medicine.id}`,
      });
    }

    await transaction.applyInboundTotals(request.medicineId, newStock, newTotalInward);
    await transaction.appendStockLog({
      uid: actorUid,
      medicineId: medicine.id,
      // Snapshot at write time: a renamed medicine must not rewrite what this
      // movement said, and no rename operation exists on either client anyway.
      medicineName: medicine.name,
      quantity: request.quantity,
      type: 'inward',
      // The SERVER decides the instant (D4), the same as every other write in the
      // project. A Windows clock would file the movement at the wrong time.
      date: SERVER_TIMESTAMP,
      // The trusted authenticated profile name identifies the administrator
      // responsible for this movement; it never comes from the Renderer payload.
      label: actorName,
    });

    try {
      await transaction.commit();
    } catch (error: unknown) {
      if (error instanceof DomainError && error.kind === 'ABORTED') {
        return { kind: 'retry' };
      }
      throw error;
    }

    return {
      kind: 'succeeded',
      receipt: {
        medicineId: medicine.id,
        medicineName: medicine.name,
        newStock,
        newTotalInward,
        quantity: request.quantity,
      },
    };
  }
}