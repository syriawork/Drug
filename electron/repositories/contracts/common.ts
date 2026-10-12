/**
 * Stage 5B - repository contracts.
 *
 * These interfaces express APPLICATION INTENT, not Firestore mechanics. There is
 * deliberately no `getDocument(path)` here: a path-taking method would let a
 * caller reach any collection with any shape, which is precisely the
 * unrestricted low-level surface the stage forbids.
 *
 * Each interface is split into three explicit sections because firestore.rules
 * makes them three genuinely different powers:
 *
 *   READ                - allowed per collection and per caller identity
 *   ADMINISTRATIVE WRITE- `isAdmin()` only
 *   TRANSACTION         - the Stage 6 order-processing boundary (declared here,
 *                         deliberately NOT implemented in Stage 5B)
 *
 * SECURITY: no method here checks a role, and none may. The client is
 * role-agnostic on purpose: firestore.rules is the only authorization authority.
 * A repository that returned "yes" for an admin-only call would be a lie the
 * server would still refuse with 403. What the repository DOES guarantee is that
 * an operation the rules never allow cannot be expressed at all.
 */

import type { AppSettings, Medicine, OrderRequest, User } from '../../domain/models';

/** Marker for a Firestore transaction id, so it cannot be mixed up with a path. */
export type TransactionId = string & { readonly __brand: 'FirestoreTransactionId' };

/**
 * The Stage 6 transaction boundary, declared now and implemented in Stage 6.
 *
 * A single `OrderProcessingTransaction` object owns one begin/commit/rollback
 * cycle and performs the EXACT sequence the Android engine performs
 * (docs/domain-data-architecture.md §6.3):
 *
 *   R1 read order_requests/{id}   (must be status == 'pending', else write NOTHING)
 *   R2 read users/{uid}            (the denormalised summary IS the eligibility source)
 *   R3 read settings/app
 *   R4 read medicines/{id} per line
 *   W1 create orders/{autoId}
 *   W2 set medicines.stock to an ABSOLUTE value (REST has no FieldValue.increment)
 *   W3 create stock_logs (outward)
 *   W4 update users/{uid} summary
 *   W5 set order_requests/{id} to 'processed'
 *
 * Why it is shaped this way:
 *  - firestore.rules is evaluated TWICE: at the read (batchGet) and at the write
 *    (commit). A denial can therefore surface at either point, and the caller
 *    must roll back rather than retry blindly.
 *  - every write is MASKED (Stage 5A C5). An unmasked update would silently
 *    delete `name`, `maxQuantity`, `totalInward` and `totalOutward`.
 *  - the "already processed" branch must commit NOTHING; that idempotency check
 *    is what makes re-running the processor safe.
 *
 * This interface is intentionally NOT implemented in Stage 5B. It exists so the
 * Stage 6 boundary is fixed in code and reviewable now.
 */
export interface OrderProcessingTransaction {
  /** R1: reads the request; a non-pending status means "return already processed". */
  readRequest(requestId: string): Promise<OrderRequest | null>;
  /** R2: reads the user summary that decides eligibility. */
  readUser(uid: string): Promise<User | null>;
  /** R3: reads `settings/app`. */
  readSettings(): Promise<AppSettings | null>;
  /**
   * R4: reads ONE medicine, exactly as A2 line 293 does inside its loop.
   *
   * A2 reads and validates each medicine before moving to the next, and the
   * short-circuit differs per line ("not found" vs "insufficient stock"). A bulk
   * batchGet cannot reproduce that ordering, so the contract is deliberately
   * singular. `null` means the document does not exist, which is NOT the same as
   * a medicine with insufficient stock.
   */
  readMedicine(medicineId: string): Promise<Medicine | null>;
  /** W1. */
  createOrder(order: NewOrder): Promise<string>;
  /** W2: writes an ABSOLUTE stock value through a mask (never an increment). */
  setMedicineStock(medicineId: string, absoluteStock: number): Promise<void>;
  /** W3. */
  createStockLog(log: NewStockLog): Promise<void>;
  /** W4. */
  updateUserSummary(uid: string, summary: UserOrderSummaryWrite): Promise<void>;
  /** W5. */
  markRequestProcessed(requestId: string, orderId: string, adminUid: string): Promise<void>;
  /**
   * A2's failure marker, queued INSIDE the same transaction (A2 lines 181-186,
   * 197-198, 202-209, 214-220, 227-233, 249-255, 268-273, 280-286, 297-303,
   * 312-318, 323-329).
   *
   * It belongs HERE, not in a repository, because A2 commits it atomically with
   * the reads that caused the failure: rolling back first and writing afterwards
   * would leave a window in which the request still reads as `pending` and could
   * be picked up again.
   */
  markRequestFailed(requestId: string, reason: string, adminUid: string): Promise<void>;
  /** Commits every queued write in one `:commit`. */
  commit(): Promise<void>;
  /** Abandons the transaction; nothing is written. */
  rollback(): Promise<void>;
  /**
   * The raw `status` of the request, read straight from the decoded document.
   *
   * A2 line 174-176 decides on the RAW value (`getString("status") ?: ""`), and
   * anything other than exactly `"pending"` is `AlreadyProcessed`. The domain
   * `OrderRequest.status` CANNOT be used for that decision, because the Stage 5B
   * mapper maps an absent or unknown status to the `"pending"` fallback - which
   * would silently resurrect an already-processed request.
   */
  readRawRequestStatus(requestId: string): Promise<string>;
}

/**
 * Stage 15 - the INBOUND STOCK transaction boundary.
 *
 * WHY THIS IS A SEPARATE INTERFACE AND NOT A METHOD ON A REPOSITORY
 *
 * The audit guarantee this stage exists to establish is: a stock receipt and its
 * `stock_logs` row are written TOGETHER or NOT AT ALL. A repository method such as
 * `addInboundStock(medicineId, q)` would let a caller update the medicine and
 * forget the log - and that is precisely the "unexplainable inventory" the Stage 5B
 * `MedicinesRepository` contract has always refused to permit.
 *
 * So the write is only expressible HERE, on an object that owns one
 * begin/commit/rollback cycle and holds the writes until `commit()`. There is no
 * `appendStockLog` on `StockLogsRepository` that a caller could reach on its own:
 * without a transaction to queue into, a log row could be written with no
 * corresponding stock change.
 *
 * WHAT THIS DELIBERATELY DOES NOT HAVE
 *  - no `setStock`, `adjustStock` or absolute-value setter: the caller supplies the
 *    ABSOLUTE new values, and computing them is the use case's job, not the
 *    transport's;
 *  - no `createMedicine` or `deleteMedicine`: each of those also writes a
 *    `stock_logs` row on Android, so each needs its own transaction and its own
 *    deliberate decision;
 *  - no append OUTWARD: only an administrator may receive goods, and an outward
 *    movement remains Stage 6's exclusive business.
 *
 * THE READ IS PART OF THE TRANSACTION ON PURPOSE
 *
 * `readMedicine` must be answered from inside this transaction, not from a list the
 * UI already loaded. The REST client has no `FieldValue.increment` (D5), so the new
 * stock is an ABSOLUTE value computed from the stock read HERE - and Firestore
 * re-validates that read at commit time. Reading from a cached list instead would
 * make two concurrent receipts compute the same absolute value and the second would
 * silently overwrite the first.
 */
export interface InboundStockTransaction {
  /**
   * Reads the medicine this receipt applies to.
   *
   * `null` when the document does not exist, which is NOT the same as a medicine
   * with zero stock - the use case must be able to tell them apart.
   */
  readMedicine(medicineId: string): Promise<import('../../domain/models').Medicine | null>;
  /**
   * Writes the ABSOLUTE post-receipt values.
   *
   * Two fields in ONE masked write, never two calls: `stock` and `totalInward` move
   * together (Android's `transaction.update(ref, stock, totalInward)`), and an
   * unmasked write would silently delete `name`, `maxQuantity` and `totalOutward`
   * - the Stage 5A G3 finding.
   */
  applyInboundTotals(medicineId: string, absoluteStock: number, absoluteTotalInward: number): Promise<void>;
  /**
   * Queues the audit row for this receipt.
   *
   * Named and separate from `NewStockLog`'s path on purpose, so the inbound shape
   * cannot be mistaken for an order-driven one.
   */
  appendStockLog(movement: NewInboundStockMovement): Promise<void>;
  /** Commits every queued write in one `:commit`, or writes nothing. */
  commit(): Promise<void>;
  /** Abandons the transaction; nothing is written. */
  rollback(): Promise<void>;
}

/** Creates a fresh inbound transaction for each use-case attempt. */
export type InboundStockTransactionFactory = () => Promise<InboundStockTransaction>;

/** Fields W4 may touch on `users/{uid}`. Anything else would break the rules. */
export interface UserOrderSummaryWrite {
  readonly hasException: boolean;
  readonly lastOrderId: string;
  readonly lastOrderDate: import('../../domain/models').DomainTimestamp;
  readonly lastOrderMonthYear: string;
  readonly lastOrderStatus: import('../../domain/models').OrderStatus;
  readonly lastOrderIsException: boolean;
}

/** A new `orders/{id}` document as the processing step builds it. */
export interface NewOrder {
  readonly userId: string;
  readonly userName: string;
  readonly items: readonly import('../../domain/models').OrderItem[];
  readonly date: import('../../domain/models').DomainTimestamp;
  /** ASCII `MM-yyyy` (A2 uses Locale.US). */
  readonly monthYear: string;
  readonly isExceptionOrder: boolean;
  readonly requestId: string;
}

/** A new `stock_logs/{id}` document (A2 line 365). */
export interface NewStockLog {
  readonly uid: string;
  readonly medicineId: string;
  readonly medicineName: string;
  readonly quantity: number;
  readonly type: import('../../domain/models').StockMovementType;
  readonly date: import('../../domain/models').DomainTimestamp;
  /**
   * The employee who issued the medicine.
   *
   * NAMED `label` on purpose. A2 line 367 calls this same value `label` (the log
   * labels the movement with a person's name), and `userName` reads as though it
   * were the PATIENT. The Firestore wire field stays `userName` - it is a legacy
   * storage name that must not be migrated in Stage 6 - and the mapper is the one
   * place that translates between the two.
   */
  readonly label: string;
  readonly requestId: string;
  readonly orderId: string;
}

/**
 * Stage 15: a new INBOUND `stock_logs/{id}` row, as an administrator's stock
 * receipt writes it.
 *
 * THIS IS NOT `NewStockLog`, AND THE DIFFERENCE IS THE WHOLE POINT.
 *
 * `NewStockLog` requires `requestId` and `orderId` because A2 only ever writes a
 * log for a movement CAUSED BY AN ORDER, so both are guaranteed non-empty strings.
 * An inbound receipt is caused by no order at all - Android's
 * `AdminActivity.showAddStockDialog` writes six fields and simply omits both. A
 * type that demanded them here would force a caller to invent an order id, and an
 * invented id is worse than an absent one: it would silently attach the movement to
 * an order that never moved stock.
 *
 * So the two shapes are SEPARATE types rather than one type with optional fields.
 * An optional field would let an order-driven movement be built without its
 * reference - the exact bug the required fields prevent - while keeping the
 * inbound path honest about having no order.
 *
 * `requestId` and `orderId` are absent BY CONSTRUCTION, matching Android's inbound
 * receipt documents. `mapStockLog` already reads both as optional strings, so their
 * absence surfaces as `null` on the audit screen.
 */
export interface NewInboundStockMovement {
  /**
   * WHO performed the movement - the signed-in administrator.
   *
   * D3 again, and the opposite of A2: A2 files an outward movement under the
   * EMPLOYEE who received the medicine, while a receipt is filed under the staff
   * member who entered it. Both are correct for their own flow, which is exactly
   * why the field is named `actorUid` everywhere and must never be read as "the
   * employee this order belongs to".
   */
  readonly uid: string;
  readonly medicineId: string;
  readonly medicineName: string;
  /**
   * The magnitude, ALWAYS POSITIVE.
   *
   * A4 stores `Math.abs(diff)` and the direction lives in `type`. A receipt that
   * stored a negative number would be read by every future aggregation as a
   * double-counted outflow - the exact failure Stage 14's screen is built to avoid.
   */
  readonly quantity: number;
  /** Always `'inward'` for this shape. */
  readonly type: import('../../domain/models').StockMovementType;
  /**
   * When the goods arrived.
   *
   * `SERVER_TIMESTAMP` in practice: the receipt is being recorded as it happens, so
   * the server decides the instant (D4) and a Windows clock can never file the
   * movement at the wrong time. A real `DomainTimestamp` is also accepted so the
   * type stays honest about what the stored value becomes once the server stamps
   * it - the Stage 6 flow needs only that narrower case, because it inherits the
   * request's own server-stamped `requestDate` instead of minting a new instant.
   */
  readonly date: import('../../domain/models').DomainTimestamp
    | import('../../services/firestore-codec').FirestoreServerTimestamp;
  /**
   * The authenticated administrator's profile name. `label` is the existing
   * domain name for the Firestore `userName` audit field.
   */
  readonly label: string;
}
