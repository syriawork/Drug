/**
 * Stage 15 - the Firestore implementation of the INBOUND STOCK transaction.
 *
 * This adapter owns ONE begin/commit/rollback cycle and knows nothing about why a
 * receipt is being entered. It reads one medicine, queues two writes, and either
 * commits both or writes nothing. The orchestration - which medicine, whether it
 * exists, how large the receipt is - lives in `application/inbound-stock.service.ts`,
 * which is deliberately ABOVE this file in the dependency graph.
 *
 * WHY THIS EXISTS RATHER THAN A REPOSITORY METHOD
 *
 * The guarantee this stage establishes is atomicity between a medicine update and
 * its audit row. A repository method `addInboundStock(medicineId, q)` could update
 * the medicine and return without the caller ever queueing the log, and the stock
 * trail would then be silently incomplete. Here, `commit()` sends whatever was
 * queued in ONE `:commit`, so the medicine and its `stock_logs` row either both
 * land or neither does.
 *
 * THE READ IS NEVER CACHED
 *
 * `readMedicine` re-reads on every call, inside the transaction. The new stock is an
 * ABSOLUTE value computed from that read (the REST client has no
 * `FieldValue.increment`), and Firestore re-validates the read at commit time. A
 * cache would let a retry reuse a stale figure, which is the exact bug a
 * transaction exists to prevent.
 */
import { DomainError } from '../../domain/errors';
import type { Medicine } from '../../domain/models';
import type {
  InboundStockTransaction,
  NewInboundStockMovement,
  TransactionId,
} from '../contracts/common';
import type { FirestoreDocument, FirestoreWriteRequest } from '../../services/firestore-rest';
import { generateAutoId } from '../../services/firestore-rest';
import { mapMedicine } from './mappers/medicine-mapper';
import { toDomainError } from './repository-support';
import {
  mapInboundStockTotalsWrite,
  mapNewInboundStockLogWrite,
} from './mappers/order-write-mapper';
/**
 * The slice of the Stage 5A client this adapter and its factory need.
 *
 * Identical in shape to the Stage 6 client's - both speak the same four transport
 * calls - but declared separately so this stage cannot accidentally grow a
 * dependency on anything Stage 6 owns.
 */
export interface FirestoreInboundStockTransactionClient {
  /** Used by the factory to obtain a handle BEFORE the adapter exists. */
  beginTransaction(): Promise<string>;
  batchGetDocuments(paths: readonly string[], tx?: string): Promise<readonly (FirestoreDocument | null)[]>;
  commitWrites(writes: readonly FirestoreWriteRequest[], tx?: string): Promise<unknown>;
  rollback(tx: string): Promise<void>;
}

export class FirestoreInboundStockTransaction implements InboundStockTransaction {
  private readonly pendingWrites: FirestoreWriteRequest[] = [];
  private finished = false;
  /**
   * Whether `:rollback` has actually been sent for this handle.
   *
   * Separate from `finished`, because the two answer different questions:
   * `finished` means "no more writes may be queued here", while `released` means
   * "Firestore has been told to let go of this transaction". A commit that FAILS
   * is finished but NOT released - the caller still owes the server a rollback, and
   * conflating the two would leak an open transaction.
   */
  private released = false;

  public constructor(
    private readonly client: FirestoreInboundStockTransactionClient,
    private readonly transactionId: TransactionId,
  ) {}

  // ------------------------------------------------------------------ reads

  public async readMedicine(medicineId: string): Promise<Medicine | null> {
    const relativePath = `medicines/${medicineId}`;
    this.assertOpen(`read ${relativePath}`);

    let documents: readonly (FirestoreDocument | null)[];
    try {
      documents = await this.client.batchGetDocuments([relativePath], this.transactionId);
    } catch (error: unknown) {
      // Translated exactly as the Stage 6 adapter translates a read failure, so a
      // rules refusal reaches the application layer as the same `DomainError` kind
      // and produces the same `AUTHORIZATION_DENIED` answer.
      throw toDomainError(error, relativePath);
    }

    const document = documents[0] ?? null;
    if (document === null) {
      return null;
    }
    return mapMedicine(medicineId, document.data as never, document.relativePath);
  }

  // ----------------------------------------------------------------- writes

  public applyInboundTotals(
    medicineId: string,
    absoluteStock: number,
    absoluteTotalInward: number,
  ): Promise<void> {
    this.enqueue(mapInboundStockTotalsWrite(medicineId, absoluteStock, absoluteTotalInward));
    return Promise.resolve();
  }

  public appendStockLog(movement: NewInboundStockMovement): Promise<void> {
    this.enqueue(mapNewInboundStockLogWrite(movement, generateAutoId()));
    return Promise.resolve();
  }

  public async commit(): Promise<void> {
    this.assertOpen('commit');

    // An empty queue is a programming error rather than a success: this transaction
    // exists to write a medicine and a log, and committing neither would report a
    // stock receipt that moved nothing. Rolling back keeps the "every attempt ends
    // in exactly one commit or one rollback" invariant the retry loop relies on, and
    // leaves the handle released.
    if (this.pendingWrites.length === 0) {
      await this.rollback();
      return;
    }

    // Marked finished only AFTER Firestore accepted the commit. Marking it first
    // would make the caller's `rollback()` - the thing that makes a conflict
    // retryable - throw INVALID_INPUT instead of releasing the handle.
    try {
      await this.client.commitWrites(this.pendingWrites, this.transactionId);
    } catch (error: unknown) {
      // Finished but NOT released: the caller still owes a rollback, and
      // `receiveInboundStock` issues one on every failure path.
      this.finished = true;
      throw toDomainError(error, 'inbound stock commit');
    }
    // Accepted by Firestore, so the handle is gone and a later rollback is a no-op.
    this.finished = true;
    this.released = true;
  }

  public async rollback(): Promise<void> {
    // ALWAYS release the handle, even when the transaction was already marked
    // finished by a FAILED commit.
    //
    // The first version of this file set `finished = true` in the commit's catch
    // and then returned early here, which meant a failed commit left the handle
    // open: Firestore keeps locks on every document the attempt read, so another
    // administrator's receipt would block behind a transaction nobody could
    // release. Marking it finished means "no more QUEUED writes", not "the
    // handle is already gone" - so the release still has to be attempted.
    //
    // An ALREADY-FINISHED transaction is a no-op only because its handle was
    // released when it committed successfully.
    const wasAlreadyReleased = this.finished && this.pendingWrites.length === 0 && this.released;
    if (wasAlreadyReleased) {
      return;
    }
    this.finished = true;
    this.pendingWrites.length = 0;
    this.released = true;

    try {
      await this.client.rollback(this.transactionId);
    } catch (error: unknown) {
      // Firestore answers a rollback of an already-terminated transaction with 400
      // INVALID_ARGUMENT, not 409. The handle is gone either way, so the failure
      // is swallowed rather than reported as the caller's problem.
    }
  }

  // ---------------------------------------------------------------- private

  private enqueue(write: FirestoreWriteRequest): void {
    this.assertOpen('enqueue a write');
    this.pendingWrites.push(write);
  }

  private assertOpen(operation: string): void {
    if (this.finished) {
      throw new DomainError(
        'INVALID_INPUT',
        `cannot ${operation}: this Firestore transaction has already finished`,
        { documentPath: null },
      );
    }
  }
}