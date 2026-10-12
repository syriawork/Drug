/**
 * Stage 5B - `orders/{id}`, `stock_logs/{id}` and `settings/app` mappers.
 *
 * All three follow the same convention as the other mappers: REQUIRED fields the
 * Android engine depends on are read strictly, optional legacy fields are read
 * with a documented default, and an unknown enum value is reported rather than
 * silently rewritten.
 */

import type { AppSettings, Order, OrderStatus, StockLog, StockMovementType } from '../../../domain/models';
import { isStockMovementType } from '../../../domain/values';
import {
  type RawFields,
  booleanOrFalse,
  numberOrDefault,
  optionalString,
  readOrderItems,
  readOrderStatus,
  requireNumber,
  requireString,
  requireTimestamp,
  stringOrDefault,
} from './readers';

// ----------------------------------------------------------------- orders

/** Maps one decoded `orders/{id}` document (authority: Â§4.3). */
export function mapOrder(
  documentId: string,
  fields: RawFields,
  documentPath: string,
  onUnknown?: (actual: string) => void,
): Order {
  return Object.freeze({
    id: documentId,
    // Ownership field; firestore.rules line 77 scopes reads by it.
    userId: requireString(fields, 'userId', documentPath),
    userName: stringOrDefault(fields, 'userName', ''),
    items: readOrderItems(fields, documentPath),
    date: requireTimestamp(fields, 'date', documentPath),
    // RAW value: it may hold Arabic-Indic digits (D1). Normalisation is an
    // explicit, opt-in step (domain/month-year.ts) and never happens here.
    monthYear: stringOrDefault(fields, 'monthYear', ''),
    status: readOrderStatus(fields, onUnknown) satisfies OrderStatus,
    // Absent in 8 of 26 real production orders (A8) => false, not an error.
    isExceptionOrder: booleanOrFalse(fields, 'isExceptionOrder'),
    requestId: optionalString(fields, 'requestId'),
  });
}

/** Reads an order id out of an `orders/<id>` relative path. */
export function orderIdFromPath(relativePath: string): string {
  const parts = relativePath.split('/');
  if (parts.length !== 2 || parts[0] !== 'orders') {
    throw new Error(`not an orders path: ${relativePath}`);
  }
  return parts[1] ?? '';
}

// ------------------------------------------------------------- stock logs

/**
 * Maps one decoded `stock_logs/{id}` document (authority: Â§4.5).
 *
 * Two documented traps are handled here rather than pushed to callers:
 *  - `userName` has historical mixed semantics (D10): it may be a recipient's
 *    name, descriptive text, or an authenticated administrator's name, so it is
 *    exposed as `label`.
 *  - `uid` has conflicting semantics (D3): order processing writes the recipient,
 *    while inbound receipts write the administrator, so it is exposed as `actorUid`.
 */
export function mapStockLog(
  documentId: string,
  fields: RawFields,
  documentPath: string,
  onUnknown?: (actual: string) => void,
): StockLog {
  const storedType = fields['type'];
  let type: StockMovementType = 'inward';
  if (typeof storedType === 'string' && isStockMovementType(storedType)) {
    type = storedType;
  } else if (typeof storedType === 'string' && storedType.length > 0) {
    onUnknown?.(storedType);
  }

  return Object.freeze({
    id: documentId,
    medicineId: requireString(fields, 'medicineId', documentPath),
    medicineName: stringOrDefault(fields, 'medicineName', ''),
    // A4 line 595 always stores Math.abs(diff), so this is a positive magnitude.
    quantity: requireNumber(fields, 'quantity', documentPath),
    type,
    date: requireTimestamp(fields, 'date', documentPath),
    label: stringOrDefault(fields, 'userName', ''),
    actorUid: optionalString(fields, 'uid'),
    requestId: optionalString(fields, 'requestId'),
    orderId: optionalString(fields, 'orderId'),
  });
}

/** Reads a log id out of a `stock_logs/<id>` relative path. */
export function stockLogIdFromPath(relativePath: string): string {
  const parts = relativePath.split('/');
  if (parts.length !== 2 || parts[0] !== 'stock_logs') {
    throw new Error(`not a stock_logs path: ${relativePath}`);
  }
  return parts[1] ?? '';
}

// --------------------------------------------------------------- settings

/** The ONE settings document id. `settings/schedule` was a test fixture only. */
export const APP_SETTINGS_DOCUMENT_ID = 'app';

/** The fixed relative path of the application settings document (D9). */
export const APP_SETTINGS_PATH = 'settings/app';

/**
 * Maps `settings/app` (authority: Â§4.6).
 *
 * Every field is optional in the document, so each is read with the SAME default
 * the Android processing engine uses when the field is missing - A2 lines
 * 259-262 (allowFridayOrders=false, startTime="06:00", endTime="10:00",
 * minDaysBetweenOrders=15). maxDailyOrders/assistantId are dead in the Android
 * model; A4 writes 50 / "" and nothing reads them.
 */
export function mapAppSettings(fields: RawFields): AppSettings {
  return Object.freeze({
    minDaysBetweenOrders: numberOrDefault(fields, 'minDaysBetweenOrders', 15),
    maxDailyOrders: numberOrDefault(fields, 'maxDailyOrders', 50),
    allowFridayOrders: fields['allowFridayOrders'] === true,
    startTime: stringOrDefault(fields, 'startTime', '06:00'),
    endTime: stringOrDefault(fields, 'endTime', '10:00'),
    assistantId: stringOrDefault(fields, 'assistantId', ''),
  });
}

/** Builds the `settings/app` payload for an administrative save. */
export function mapAppSettingsWrite(settings: AppSettings): Record<string, unknown> {
  return {
    minDaysBetweenOrders: settings.minDaysBetweenOrders,
    maxDailyOrders: settings.maxDailyOrders,
    allowFridayOrders: settings.allowFridayOrders,
    startTime: settings.startTime,
    endTime: settings.endTime,
    assistantId: settings.assistantId,
  };
}