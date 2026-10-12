/**
 * Stage 6 - the WRITE side of order processing (W1, W3, W5) and W2's mask.
 *
 * The Stage 5B mappers all go document -> domain. This file is the other
 * direction, and it is deliberately the ONLY place that knows the wire field
 * names of the processing writes, so a rename cannot half-happen.
 *
 * The `label` <-> `userName` translation lives here (D10). A2 line 367 names the
 * value `label` because it labels the movement with a person; the Firestore field
 * is `userName` because that is what every existing Android/A4 document contains.
 * Renaming the field would require a data migration, which Stage 6 forbids - so
 * the DOMAIN name is fixed and the STORAGE name is left exactly as it is.
 */

import type {
  NewInboundStockMovement,
  NewOrder,
  NewStockLog,
} from '../../../repositories/contracts/common';
import { SERVER_TIMESTAMP } from '../../../services/firestore-codec';

import type { FirestoreWriteRequest } from '../../../services/firestore-rest';

/**
 * W1: the `orders/{id}` create.
 *
 * `status: 'pending'` is A2 line 362. W4 then writes `lastOrderStatus: 'pending'`
 * on the user, so the two must agree: the summary is a denormalised copy of this
 * field, and a mismatch would let a second order slip past the
 * "You already have a pending order" rule.
 */
export function mapNewOrderWrite(order: NewOrder, orderId: string): FirestoreWriteRequest {
  return {
    kind: 'create',
    relativePath: `orders/${orderId}`,
    data: {
      userId: order.userId,
      userName: order.userName,
      items: order.items.map((item) => ({
        medicineId: item.medicineId,
        medicineName: item.medicineName,
        quantity: item.quantity,
      })),
      date: order.date,
      monthYear: order.monthYear,
      status: 'pending',
      isExceptionOrder: order.isExceptionOrder,
      requestId: order.requestId,
    },
  };
}

/**
 * W3: the outward `stock_logs/{id}` create.
 *
 * `uid` is the EMPLOYEE (D3: A2 writes the issuing user, A4 writes the admin),
 * which is why the domain calls the same value `actorUid` elsewhere. Here the
 * contract field is `uid` because that is what the log records in this flow.
 */
export function mapNewStockLogWrite(log: NewStockLog, logId: string): FirestoreWriteRequest {
  return {
    kind: 'create',
    relativePath: `stock_logs/${logId}`,
    data: {
      uid: log.uid,
      medicineId: log.medicineId,
      medicineName: log.medicineName,
      quantity: log.quantity,
      type: log.type,
      date: log.date,
      // The ONLY place `label` becomes `userName` (D10).
      userName: log.label,
      requestId: log.requestId,
      orderId: log.orderId,
    },
  };
}

/** W2: the exact mask for an absolute stock write. One field, nothing else. */
export const MEDICINE_STOCK_MASK: readonly string[] = Object.freeze(['stock']);

/**
 * Stage 15: the exact mask for an inbound receipt.
 *
 * TWO FIELDS, ONE WRITE. Android's `showAddStockDialog` increments `stock` AND
 * `totalInward` together in a single transaction call, so this mask must name both -
 * writing one without the other would leave the counters disagreeing with the stock
 * they are meant to track.
 *
 * `totalOutward` is deliberately NOT here. It is the Stage 6 processor's field, and
 * including it would let a receipt overwrite an order's expenditure with whatever
 * the caller happened to send.
 *
 * KNOWN, DOCUMENTED CONTRADICTION WITH Stage 14
 *
 * Stage 14's audit screen refuses to derive a balance, and this mask maintains the
 * two counters such a balance would be built from. That tension is real and is
 * stated rather than hidden: `totalInward` is a lifetime running total with no
 * defined window, while `stock_logs` is the complete per-movement record. They can
 * disagree - a receipt entered before this stage existed is in `totalInward` with no
 * log row, and a legacy correction may appear in one and not the other - so the two
 * are not interchangeable, and neither is presented as authoritative over the other.
 * The audit trail remains the record of individual movements; these totals remain a
 * convenience the mobile app has always kept.
 */
export const INBOUND_STOCK_TOTALS_MASK: readonly string[] = Object.freeze([
  'stock',
  'totalInward',
]);

/**
 * Stage 15: writes the ABSOLUTE post-receipt stock and inward total.
 *
 * ABSOLUTE, NOT AN INCREMENT - the same reason W2 gives. The REST API cannot express
 * `FieldValue.increment` (D5), and the absolute value was computed from the stock
 * read INSIDE this transaction, which Firestore re-validates at commit time. That
 * makes the absolute write exactly as safe as an increment, and it is the value a
 * human reads in the emulator.
 */
export function mapInboundStockTotalsWrite(
  medicineId: string,
  absoluteStock: number,
  absoluteTotalInward: number,
): FirestoreWriteRequest {
  return {
    kind: 'update',
    relativePath: `medicines/${medicineId}`,
    data: { stock: absoluteStock, totalInward: absoluteTotalInward },
    updateMaskPaths: INBOUND_STOCK_TOTALS_MASK,
  };
}

/**
 * Stage 15: the inbound `stock_logs/{id}` create.
 *
 * A DIFFERENT mapper from `mapNewStockLogWrite`, and the separation is deliberate.
 * The Stage 6 version takes `NewStockLog`, whose `requestId` and `orderId` are
 * required non-empty strings; this one takes `NewInboundStockMovement`, whose
 * contract omits both. Sharing a mapper would mean either an inbound receipt
 * fabricating an order reference or an order movement shipping without one.
 *
 * `requestId` and `orderId` are omitted, matching Android's inbound receipt
 * documents. The audit reader already maps absent optional references to `null`.
 */
export function mapNewInboundStockLogWrite(
  movement: NewInboundStockMovement,
  logId: string,
): FirestoreWriteRequest {
  return {
    kind: 'create',
    relativePath: `stock_logs/${logId}`,
    data: {
      uid: movement.uid,
      medicineId: movement.medicineId,
      medicineName: movement.medicineName,
      quantity: movement.quantity,
      type: movement.type,
      date: movement.date,
      // The existing domain name maps to the stored audit identity field.
      userName: movement.label,
    },
  };
}

/**
 * W2: writes the ABSOLUTE new stock (A2 line 363).
 *
 * A2 does not use `FieldValue.increment` - the REST API cannot express it
 * (D5/§7.4) - and that is not a downgrade: the value was computed from the stock
 * read INSIDE this transaction, so the absolute write is exactly as safe as an
 * increment, and it is the value a human reads in the emulator.
 */
export function mapMedicineStockWrite(medicineId: string, absoluteStock: number): FirestoreWriteRequest {
  return {
    kind: 'update',
    relativePath: `medicines/${medicineId}`,
    data: { stock: absoluteStock },
    updateMaskPaths: MEDICINE_STOCK_MASK,
  };
}

/**
 * W4: the exact mask for the user's order summary.
 *
 * `hasException` is in this mask on purpose (D7): A2 line 389 sets it to `false`,
 * which CONSUMES the exception. Listing the field without a guard would let
 * `validateMaskedWrite` reject the write, and dropping it would silently keep an
 * exception alive after it was used.
 */
export const USER_SUMMARY_MASK: readonly string[] = Object.freeze([
  'hasException',
  'lastOrderId',
  'lastOrderDate',
  'lastOrderMonthYear',
  'lastOrderStatus',
  'lastOrderIsException',
]);

/** W5: `order_requests` -> `processed`. */
export function mapRequestProcessedWrite(
  requestId: string,
  orderId: string,
  adminUid: string,
): FirestoreWriteRequest {
  return {
    kind: 'update',
    relativePath: `order_requests/${requestId}`,
    data: {
      status: 'processed',
      orderId,
      processedBy: adminUid,
      // Firestore decides the instant, not the Windows clock (D4).
      processedAt: SERVER_TIMESTAMP,
    },
    updateMaskPaths: Object.freeze(['status', 'orderId', 'processedBy', 'processedAt']),
  };
}

/**
 * A2's failure marker, shared by every business-validation branch.
 *
 * A2 writes `status`, `error`, `processedBy` and `processedAt` - no `orderId`,
 * because no order was created. The mask is explicit rather than derived so the
 * `orderId` an earlier partial run might have left behind is never touched.
 */
export function mapRequestFailedWrite(
  requestId: string,
  reason: string,
  adminUid: string,
): FirestoreWriteRequest {
  return {
    kind: 'update',
    relativePath: `order_requests/${requestId}`,
    data: {
      status: 'failed',
      error: reason,
      processedBy: adminUid,
      processedAt: SERVER_TIMESTAMP,
    },
    updateMaskPaths: Object.freeze(['status', 'error', 'processedBy', 'processedAt']),
  };
}