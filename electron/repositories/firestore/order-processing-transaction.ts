/**
 * Stage 6 - the Firestore implementation of `OrderProcessingTransaction`.
 *
 * This adapter owns ONE begin/commit/rollback cycle and knows nothing about
 * business rules: it reads, it queues writes, it commits or it rolls back. The
 * orchestration (what to read, in what order, and when a failure means `failed`)
 * lives in `services/order-processing.service.ts`.
 *
 * THREE DESIGN POINTS WORTH STATING
 *
 * 1. Writes are QUEUED, not sent. `createOrder` and friends only append to a local
 *    list. A single `commitWrites` at the end sends them all in one `:commit`, so
 *    W1-W5 are atomic. Committing twice is a programming error and throws rather
 *    than producing a confusing server error.
 *
 * 2. Reads are NOT cached across calls. A2's `transaction.get` re-reads inside
 *    the transaction, and the whole correctness argument of W2 - an ABSOLUTE stock
 *    value computed from a read that Firestore re-validates at commit time -
 *    depends on the value coming from THIS transaction. A cache would make a
 *    retry silently reuse stale data, the exact bug a transaction prevents.
 *
 * 3. `readRawRequestStatus` deliberately bypasses `mapOrderRequest`. A2 line
 *    174-176 reads the raw string, and the Stage 5B mapper maps an absent status to
 *    the `'pending'` fallback. Routing the decision through the mapper would
 *    resurrect an already-processed request.
 */

import { DomainError } from '../../domain/errors';
import type { AppSettings, Medicine, OrderRequest, User } from '../../domain/models';
import type {
  NewOrder,
  NewStockLog,
  OrderProcessingTransaction,
  TransactionId,
  UserOrderSummaryWrite,
} from '../contracts/common';
import type { FirestoreDocument, FirestoreWriteRequest } from '../../services/firestore-rest';
import { generateAutoId } from '../../services/firestore-rest';
import { mapMedicine } from './mappers/medicine-mapper';
import { toDomainError } from './repository-support';
import { mapAppSettings } from './mappers/order-mapper';
import { mapOrderRequest } from './mappers/order-request-mapper';
import { mapUser, type MapOptions } from './mappers/user-mapper';
import type { RawFields } from './mappers/readers';
import {
  mapMedicineStockWrite,
  mapNewOrderWrite,
  mapNewStockLogWrite,
  mapRequestFailedWrite,
  mapRequestProcessedWrite,
  USER_SUMMARY_MASK,
} from './mappers/order-write-mapper';

/** The slice of the Stage 5A client this adapter and its factory need. */
export interface FirestoreOrderProcessingTransactionClient {
  /** Used by the factory to obtain a handle BEFORE the adapter exists. */
  beginTransaction(): Promise<string>;
  batchGetDocuments(paths: readonly string[], tx?: string): Promise<readonly (FirestoreDocument | null)[]>;
  commitWrites(writes: readonly FirestoreWriteRequest[], tx?: string): Promise<unknown>;
  rollback(tx: string): Promise<void>;
}

export class FirestoreOrderProcessingTransaction implements OrderProcessingTransaction {
  private readonly pendingWrites: FirestoreWriteRequest[] = [];
  private finished = false;

  public constructor(
    private readonly client: FirestoreOrderProcessingTransactionClient,
    private readonly transactionId: TransactionId,
    private readonly onWarning?: ((message: string) => void) | undefined,
  ) {}

  // ------------------------------------------------------------------ reads

  public async readRequest(requestId: string): Promise<OrderRequest | null> {
    const document = await this.readOne(`order_requests/${requestId}`);
    if (document === null) {
      return null;
    }
    return mapOrderRequest(requestId, this.fieldsOf(document), document.relativePath, this.onWarning);
  }

  /**
   * A2 line 174-176: `getString("status") ?: ""` on the RAW document.
   *
   * Returns `''` for a missing document or a missing field, both of which A2
   * treats as "not pending" => `AlreadyProcessed` with ZERO writes.
   */
  public async readRawRequestStatus(requestId: string): Promise<string> {
    const document = await this.readOne(`order_requests/${requestId}`);
    const raw = document === null ? undefined : this.fieldsOf(document)['status'];
    return typeof raw === 'string' ? raw : '';
  }

  public async readUser(uid: string): Promise<User | null> {
    const document = await this.readOne(`users/${uid}`);
    if (document === null) {
      return null;
    }
    return mapUser(uid, this.fieldsOf(document), document.relativePath, this.mapOptions());
  }

  public async readSettings(): Promise<AppSettings | null> {
    const document = await this.readOne('settings/app');
    if (document === null) {
      return null;
    }
    return mapAppSettings(this.fieldsOf(document));
  }

  public async readMedicine(medicineId: string): Promise<Medicine | null> {
    const document = await this.readOne(`medicines/${medicineId}`);
    if (document === null) {
      return null;
    }
    return mapMedicine(medicineId, this.fieldsOf(document), document.relativePath);
  }

  // ----------------------------------------------------------------- writes

  public createOrder(order: NewOrder): Promise<string> {
    const orderId = generateAutoId();
    this.enqueue(mapNewOrderWrite(order, orderId));
    return Promise.resolve(orderId);
  }

  public setMedicineStock(medicineId: string, absoluteStock: number): Promise<void> {
    this.enqueue(mapMedicineStockWrite(medicineId, absoluteStock));
    return Promise.resolve();
  }

  public createStockLog(log: NewStockLog): Promise<void> {
    this.enqueue(mapNewStockLogWrite(log, generateAutoId()));
    return Promise.resolve();
  }

  public updateUserSummary(uid: string, summary: UserOrderSummaryWrite): Promise<void> {
    this.enqueue({
      kind: 'update',
      relativePath: `users/${uid}`,
      data: {
        hasException: summary.hasException,
        lastOrderId: summary.lastOrderId,
        lastOrderDate: summary.lastOrderDate,
        lastOrderMonthYear: summary.lastOrderMonthYear,
        // A2 writes 'pending' here, which is what makes the NEXT order hit the
        // "already a pending order" rule until this one is accepted or rejected.
        lastOrderStatus: summary.lastOrderStatus,
        lastOrderIsException: summary.lastOrderIsException,
      },
      updateMaskPaths: USER_SUMMARY_MASK,
    });
    return Promise.resolve();
  }

  public markRequestProcessed(requestId: string, orderId: string, adminUid: string): Promise<void> {
    this.enqueue(mapRequestProcessedWrite(requestId, orderId, adminUid));
    return Promise.resolve();
  }

  public markRequestFailed(requestId: string, reason: string, adminUid: string): Promise<void> {
    this.enqueue(mapRequestFailedWrite(requestId, reason, adminUid));
    return Promise.resolve();
  }

  // -------------------------------------------------------------- lifecycle

  public async commit(): Promise<void> {
    this.assertOpen('commit');
    if (this.pendingWrites.length === 0) {
      // A2's `AlreadyProcessed` branch writes NOTHING. ROLLING BACK - rather than
      // committing an empty list - is the honest representation: the transaction
      // is genuinely abandoned, not "succeeded with zero writes".
      await this.rollback();
      return;
    }
    // The transaction is marked finished only AFTER Firestore accepted the
    // commit. Marking it first would make the caller's `rollback()` - the very
    // thing that lets a conflict be retried from R1 - throw INVALID_INPUT
    // instead of releasing the handle.
    try {
      await this.client.commitWrites(this.pendingWrites, this.transactionId);
    } catch (error: unknown) {
      // Same boundary rule as `readOne`: a conflict MUST arrive as
      // `DomainError('ABORTED')`, or the service's retry loop would never see
      // it and the first ordinary contention would fail the whole order.
      throw toDomainError(error, null);
    }
    this.pendingWrites.length = 0;
    this.finished = true;
  }

  public async rollback(): Promise<void> {
    // A rollback must stay possible after a FAILED commit: that is precisely
    // the ABORTED path, and refusing it there would leak an open transaction
    // and turn a retryable conflict into a hard failure. An already-finished
    // transaction, by contrast, is silently a no-op: its handle is gone and
    // there is nothing left to release.
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.pendingWrites.length = 0;
    try {
      await this.client.rollback(this.transactionId);
    } catch (error: unknown) {
      // Firestore answers a rollback of an already-terminated transaction with
      // 400 INVALID_ARGUMENT, not 409. The handle is gone either way, so
      // swallowing this specific shape is what lets a real conflict stay a
      // retryable ABORTED instead of being replaced by a confusing 400.
      const translated = toDomainError(error, null);
      if (translated.kind === 'ABORTED' || translated.kind === 'NOT_FOUND' || translated.kind === 'INVALID_INPUT') {
        return;
      }
      throw translated;
    }
  }

  /** The queued writes, for assertions in tests. Not part of the contract. */
  public queuedWrites(): readonly FirestoreWriteRequest[] {
    return Object.freeze([...this.pendingWrites]);
  }

  // --------------------------------------------------------------- internals

  private enqueue(write: FirestoreWriteRequest): void {
    this.assertOpen('enqueue a write');
    this.pendingWrites.push(write);
  }

  private assertOpen(operation: string): void {
    if (this.finished) {
      throw new DomainError('INVALID_INPUT', `cannot ${operation}: this Firestore transaction has already finished`, {
        documentPath: null,
      });
    }
  }

  /**
   * Adapts the caller's simple `(message) => void` sink to the mapper's structured
   * `MappingWarning`, so a caller does not have to learn the mapper's shape.
   */
  private mapOptions(): MapOptions {
    if (this.onWarning === undefined) {
      return {};
    }
    return {
      onWarning: (warning): void => this.onWarning?.(
        `${warning.documentPath}.${warning.field}: ${warning.detail}`,
      ),
    };
  }

  /**
   * One `:batchGet` for one path, inside THIS transaction.
   *
   * The translation is NOT optional. A raw `FirestoreRestError` escaping here
   * would reach the processing service as a transport failure, and the service
   * would then treat a rules denial as an opaque crash instead of the
   * `NOT_AUTHORIZED` it is - or, worse, fail to recognise a real `ABORTED`
   * conflict and refuse to retry it. Converting at the boundary keeps the
   * service's ABORTED branch and the fake-transaction unit tests in agreement.
   */
  private async readOne(relativePath: string): Promise<FirestoreDocument | null> {
    this.assertOpen(`read ${relativePath}`);
    try {
      const [document] = await this.client.batchGetDocuments([relativePath], this.transactionId);
      return document ?? null;
    } catch (error: unknown) {
      throw toDomainError(error, relativePath);
    }
  }

  private fieldsOf(document: FirestoreDocument): RawFields {
    return document.data as unknown as RawFields;
  }
}
