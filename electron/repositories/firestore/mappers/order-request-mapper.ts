/**
 * Stage 5B - `order_requests/{id}` <-> domain `OrderRequest`.
 *
 * Authority: Â§4.4 of the Stage 4 document and firestore.rules lines 90-103.
 *
 * The creation rule is the tightest in the whole schema:
 *
 *   request.resource.data.keys().hasOnly(['uid','items','status','requestDate'])
 *
 * so a Windows-created request may contain EXACTLY those four keys - no
 * `source`, no `idempotencyKey`, no client timestamp. `mapNewOrderRequest`
 * therefore builds the payload from a fixed key set, and `ALLOWED_CREATE_KEYS`
 * exists so a test can assert that property instead of trusting a comment.
 *
 * The four processing fields (`orderId`, `error`, `processedBy`, `processedAt`)
 * are read-only here: Stage 5B never processes a request.
 */

import type { OrderItem, OrderRequest, OrderRequestStatus } from '../../../domain/models';
import { isOrderRequestStatus } from '../../../domain/values';
import { SERVER_TIMESTAMP } from '../../../services/firestore-codec';
import {
  type RawFields,
  optionalString,
  optionalTimestamp,
  readOrderItems,
  requireString,
  requireTimestamp,
} from './readers';

/** The ONLY keys firestore.rules allows when an order request is created. */
export const ALLOWED_CREATE_KEYS: readonly string[] = Object.freeze(['uid', 'items', 'status', 'requestDate']);

/** Maps one decoded `order_requests/{id}` document. */
export function mapOrderRequest(
  documentId: string,
  fields: RawFields,
  documentPath: string,
  onUnknown?: (actual: string) => void,
): OrderRequest {
  const storedStatus = fields['status'];
  let status: OrderRequestStatus = 'pending';
  if (typeof storedStatus === 'string' && isOrderRequestStatus(storedStatus)) {
    status = storedStatus;
  } else if (typeof storedStatus === 'string' && storedStatus.length > 0) {
    onUnknown?.(storedStatus);
  }

  return Object.freeze({
    id: documentId,
    // `uid` is the OWNERSHIP field the rules compare against (line 92).
    uid: requireString(fields, 'uid', documentPath),
    items: readOrderItems(fields, documentPath),
    status,
    // REQUIRED: A2 fails a request whose requestDate is not a Timestamp
    // (line 212 reads it with getTimestamp), so a missing or textual value is
    // reported as malformed rather than silently defaulting to "now".
    requestDate: requireTimestamp(fields, 'requestDate', documentPath),
    orderId: optionalString(fields, 'orderId'),
    error: optionalString(fields, 'error'),
    processedBy: optionalString(fields, 'processedBy'),
    processedAt: optionalTimestamp(fields, 'processedAt'),
  });
}

/**
 * Builds the payload for a NEW pending order request.
 *
 * `requestDate` is the `SERVER_TIMESTAMP` marker: Stage 5A turns it into a
 * Firestore `REQUEST_TIME` transform, so Firestore - not the Windows clock -
 * decides the authoritative request time (decision D4). A caller cannot pass a
 * client-generated instant here, which is exactly the intent: the type makes the
 * unsafe alternative unrepresentable.
 */
export function mapNewOrderRequest(input: {
  readonly uid: string;
  readonly items: readonly OrderItem[];
}): { readonly data: Record<string, unknown>; readonly kind: 'create' } {
  return {
    kind: 'create',
    data: {
      uid: input.uid,
      items: input.items.map((item) => ({
        medicineId: item.medicineId,
        medicineName: item.medicineName,
        quantity: item.quantity,
      })),
      // firestore.rules line 97 REQUIRES 'pending' on create.
      status: 'pending',
      requestDate: SERVER_TIMESTAMP,
    },
  };
}

/** Reads a request id out of an `order_requests/<id>` relative path. */
export function orderRequestIdFromPath(relativePath: string): string {
  const parts = relativePath.split('/');
  if (parts.length !== 2 || parts[0] !== 'order_requests') {
    throw new Error(`not an order_requests path: ${relativePath}`);
  }
  return parts[1] ?? '';
}