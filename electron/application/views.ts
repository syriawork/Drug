/**
 * Stage 7 - projections from the domain model onto the renderer-safe view.
 *
 * This is the ONLY place a stage 5B/6 domain model becomes renderer payload.
 * Keeping the conversion in one file is what makes the containment provable: a
 * reader can confirm that no wire value, no class instance and no token-shaped
 * field has a route to `window.drugManager`.
 *
 * THE TIMESTAMP RULE
 * `DomainTimestamp` is a `FirestoreTimestamp` class instance carrying an
 * `isoValue` string. Structured-cloning it over IPC would hand the renderer a
 * plain object with no `toDate()` and no prototype - a silently broken value
 * that still looks like data. Every timestamp is therefore flattened here, in
 * the Main process, to an ISO-8601 string or `null`. `isoValue` is used rather
 * than `toDate().toISOString()` because it keeps the full stored precision:
 * `toDate()` truncates to milliseconds, and the UI is the wrong place to lose
 * data.
 *
 * THE CLOSED-SET RULE
 * `role`, `status` and `lastOrderStatus` are narrowed through the domain's own
 * guards instead of being cast. A stored value outside the union degrades to a
 * documented default rather than being smuggled into the payload as a raw
 * string the UI would then have to interpret.
 */

import type { AppSettings, DomainTimestamp, Medicine, Order, OrderRequest, StockLog, StockMovementType, User } from '../domain/models';
import { normalizeMonthYear } from '../domain/month-year';
import { isOrderStatus, isStockMovementType, isUserRole, isUserStatus, type OrderRequestStatus } from '../domain/values';
import type { OrderProcessingOutcome } from '../services/order-processing.service';

/** Flattens a domain timestamp to the ISO-8601 string the renderer receives. */
function toIso(timestamp: DomainTimestamp | null): string | null {
  return timestamp === null ? null : timestamp.isoValue;
}

/** Narrows a stored role to the closed set, degrading to the documented default. */
function toRoleView(role: string): UserRoleView {
  return isUserRole(role) ? role : 'employee';
}

/** Narrows a stored approval status to the closed set. */
function toUserStatusView(status: string): UserStatusView {
  return isUserStatus(status) ? status : 'pending';
}

/** Narrows a stored request status to the closed set. */
function toOrderRequestStatusView(status: OrderRequestStatus): OrderRequestStatusView {
  return status;
}

/** Projects one `users/{uid}` document. */
export function toUserListItemView(user: User): UserListItemView {
  const lastOrderStatus = user.lastOrderStatus;
  return Object.freeze({
    uid: user.uid,
    name: user.name,
    employeeId: user.employeeId,
    role: toRoleView(user.role),
    status: toUserStatusView(user.status),
    hasException: user.hasException,
    lastOrderId: user.lastOrderId,
    lastOrderDateIso: toIso(user.lastOrderDate),
    // Raw `MM-yyyy`, exactly as persisted; D1 is not migrated here.
    lastOrderMonthYear: user.lastOrderMonthYear,
    // Read-side PRESENTATION only: D1 legacy documents store Arabic-Indic digits,
    // and the UI must show the same month the domain compares against. There is
    // no update path to this field, so the normalised form can never be written
    // back - normalising a read is not a migration.
    lastOrderMonthYearDisplay: normalizeMonthYear(user.lastOrderMonthYear),
    lastOrderStatus: lastOrderStatus === null || lastOrderStatus === '' || isOrderStatus(lastOrderStatus)
      ? lastOrderStatus
      : null,
    lastOrderIsException: user.lastOrderIsException,
  });
}

/** Projects one `medicines/{id}` document. */
export function toMedicineListItemView(medicine: Medicine): MedicineListItemView {
  return Object.freeze({
    id: medicine.id,
    name: medicine.name,
    maxQuantity: medicine.maxQuantity,
    stock: medicine.stock,
    totalInward: medicine.totalInward,
    totalOutward: medicine.totalOutward,
  });
}

/**
 * Projects one `order_requests/{id}` document.
 *
 * `employeeName` is NOT a field of `OrderRequest`. A5 - the mobile submission
 * path - stores only `uid`; it never wrote a name, so there is nothing here to
 * read. Rather than show a manager a bare uid in a column headed "الموظف", the
 * application layer may supply a name resolved from `users/{uid}`; when it
 * cannot, `null` is returned and the renderer falls back to the uid, which is the
 * exact field the domain does carry.
 *
 * The name is therefore PRESENTATION only. It is never sent back anywhere, and no
 * code path can write it, because the request contract has no update method at all.
 */
export function toOrderRequestListItemView(
  request: OrderRequest,
  employeeName: string | null = null,
): OrderRequestListItemView {
  return Object.freeze({
    id: request.id,
    uid: request.uid,
    employeeName,
    items: Object.freeze(request.items.map((item) => Object.freeze({
      medicineId: item.medicineId,
      medicineName: item.medicineName,
      quantity: item.quantity,
    }))),
    status: toOrderRequestStatusView(request.status),
    requestDateIso: toIso(request.requestDate) ?? request.requestDate.toString(),
    orderId: request.orderId,
    error: request.error,
    processedBy: request.processedBy,
    processedAtIso: toIso(request.processedAt),
  });
}

/**
 * Stage 12: projects one `orders/{id}` document for the history/audit screen.
 *
 * FIELDS ARE TAKEN FROM THE DOMAIN MODEL, NOT INVENTED
 * Every value below exists on `Order` as Stage 6 wrote it. Nothing is computed:
 * no total quantity, no stock figure, no eligibility verdict, no derived month.
 * A history screen that showed a computed stock number would be a second,
 * disagreeing implementation of Stage 6.
 *
 * `itemCount` is a COUNT OF LINES, not a sum of quantities. Aggregating is Stage
 * 6's job (and it may legitimately reject duplicates); adding the quantities
 * here would publish a total the stored order never contained.
 *
 * `employeeName` is PRESENTATION ONLY and follows one documented precedence:
 * the name SNAPSHOT Stage 6 stored on the order wins, because this is an audit
 * surface and the recorded value is the historical truth. Only when that
 * snapshot is empty - a legacy document, since the mapper defaults a missing
 * `userName` to `''` - may the application layer supply a live profile name.
 * Nothing is written back either way.
 */
export function toOrderHistoryItemView(
  order: Order,
  employeeName: string | null = null,
): OrderHistoryItemView {
  return Object.freeze({
    id: order.id,
    /**
     * The EMPLOYEE the order belongs to: the stored `orders.userId`.
     *
     * Deliberately NOT conflated with `order_requests.uid`, which is the
     * employee who SUBMITTED the request, nor with `order_requests.processedBy`,
     * which is the ADMIN who processed it (D3). The three fields name different
     * people in different flows and the audit screen must not blur them.
     */
    userId: order.userId,
    employeeName: order.userName.trim().length > 0 ? order.userName : employeeName,
    items: Object.freeze(order.items.map((item) => Object.freeze({
      medicineId: item.medicineId,
      // Snapshot of the name at write time, never re-resolved from `medicines`:
      // a renamed medicine must not rewrite what a historical order said.
      medicineName: item.medicineName,
      quantity: item.quantity,
    }))),
    itemCount: order.items.length,
    dateIso: toIso(order.date) ?? order.date.toString(),
    // RAW `MM-yyyy` exactly as persisted (D1: may hold Arabic-Indic digits),
    // alongside the normalised form the UI displays. Neither is written back.
    monthYear: order.monthYear,
    monthYearDisplay: normalizeMonthYear(order.monthYear),
    status: toOrderStatusView(order.status),
    isExceptionOrder: order.isExceptionOrder,
    requestId: order.requestId,
  });
}

/** Projects only the stored fields the employee personal-history screen needs. */
export function toPersonalOrderHistoryItemView(order: Order): PersonalOrderHistoryItemView {
  return Object.freeze({
    id: order.id,
    items: Object.freeze(order.items.map((item) => Object.freeze({
      medicineName: item.medicineName,
      quantity: item.quantity,
    }))),
    itemCount: order.items.length,
    dateIso: toIso(order.date) ?? order.date.toString(),
    monthYearDisplay: normalizeMonthYear(order.monthYear),
    status: toOrderStatusView(order.status),
  });
}

/** Narrows a stored order status to the closed set, degrading to a known value. */
function toOrderStatusView(status: string): OrderStatusView {
  return isOrderStatus(status) ? status : 'pending';
}

/** Narrows a stored movement type to the closed set, degrading to `inward`. */
function toStockMovementTypeView(type: string): StockMovementTypeView {
  return isStockMovementType(type) ? type : 'inward';
}

/**
 * Stage 14: projects ONE `stock_logs/{id}` document onto the audit row.
 *
 * This is a field-for-field copy with exactly one transformation, the ISO
 * flattening every timestamp in this file gets. There is deliberately:
 *  - no summing of `quantity` into a balance, and no netting of inward against
 *    outward. `stock` is a STORED field in `medicines`, and deriving it here
 *    would publish a number the database does not contain;
 *  - no grouping per medicine, and no "daily total";
 *  - no resolving `label` or `actorUid` into names.
 *
 * A movement log is evidence. Every field that reaches the renderer is the value
 * that is in the document.
 */
export function toStockLogView(log: StockLog): StockLogView {
  return Object.freeze({
    id: log.id,
    medicineId: log.medicineId,
    label: log.label,
    quantity: log.quantity,
    type: toStockMovementTypeView(log.type) satisfies StockMovementType,
    dateIso: toIso(log.date) ?? log.date.toString(),
    actorUid: log.actorUid,
    requestId: log.requestId,
    orderId: log.orderId,
  });
}

/**
 * A2 lines 258-263: the values the processing step itself falls back to when
 * `settings/app` is absent. Returning them (with `configured: false`) lets the
 * UI show what will actually be enforced instead of blank fields, and keeps the
 * defaults defined in exactly one place.
 */
const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  minDaysBetweenOrders: 15,
  maxDailyOrders: 0,
  allowFridayOrders: false,
  startTime: '06:00',
  endTime: '10:00',
  assistantId: '',
});

/** Projects `settings/app`, or the enforced defaults when the document is absent. */
export function toAppSettingsView(settings: AppSettings | null): AppSettingsView {
  const source = settings ?? DEFAULT_APP_SETTINGS;
  return Object.freeze({
    minDaysBetweenOrders: source.minDaysBetweenOrders,
    maxDailyOrders: source.maxDailyOrders,
    allowFridayOrders: source.allowFridayOrders,
    startTime: source.startTime,
    endTime: source.endTime,
    assistantId: source.assistantId,
    configured: settings !== null,
  });
}

/**
 * Projects a Stage 6 outcome.
 *
 * All three outcomes are SUCCESSES of the operation. A business refusal
 * committed a `failed` marker, and an already-processed request wrote nothing
 * at all; neither is a failure of the call, and neither is reported through
 * the error channel. A rules denial, a conflict or a transport failure is
 * different: Stage 6 throws for those, and `applicationFailureFrom` maps them.
 */
export function toOrderProcessingOutcomeView(outcome: OrderProcessingOutcome): OrderProcessingOutcomeView {
  switch (outcome.result.kind) {
    case 'success':
      return Object.freeze({ outcome: 'processed', orderId: outcome.result.orderId, reason: null, status: null });
    case 'business-validation-failure':
      return Object.freeze({ outcome: 'rejected', orderId: null, reason: outcome.result.reason, status: null });
    case 'already-processed':
      return Object.freeze({ outcome: 'already-processed', orderId: null, reason: null, status: outcome.result.status });
  }
}
