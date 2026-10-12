/**
 * Stage 6 - the pure item rules, ported from A2 (AdminOrderProcessor.kt).
 *
 * A2 is the authority. Every branch below exists at the same line in A2 and
 * produces the SAME string, because that string is what the employee eventually
 * reads in `order_requests.error` and what A2's 17 Robolectric cases assert.
 *
 * This module is PURE: no Firestore, no Electron, no clock of its own (the
 * instant is always passed in).
 */

/** A2 `NormalizedItem` (line 23-26): an aggregated line. */
export interface NormalizedItem {
  readonly medicineId: string;
  readonly quantity: number;
}

/** A2 `aggregateItems` result: the items, or the exact A2 error message. */
export type AggregateResult =
  | { readonly items: readonly NormalizedItem[]; readonly error: null }
  | { readonly items: null; readonly error: string };

/** A2 line 48-49: the limit is checked on the RAW list, before aggregation. */
export const MAX_RAW_ITEMS = 5;

const ERROR_EMPTY_ITEMS = 'Invalid request structure or empty items list';
const ERROR_TOO_MANY_ITEMS = 'Maximum 5 items per order';
const ERROR_BAD_STRUCTURE = 'Invalid item structure in request';

function overflowError(medicineId: string): string {
  return `Quantity aggregation overflow for medicine ${medicineId}`;
}

function badQuantityError(medicineId: string): string {
  return `Invalid item or quantity for medicine ${medicineId}`;
}

/** A2 line 74-78: `parseTimeToMinutes`. `garbage` yields 0, i.e. midnight. */
export function parseTimeToMinutes(time: string): number {
  const parts = time.split(':');
  if (parts.length !== 2) {
    return 0;
  }
  return (Number.parseInt(parts[0] ?? '', 10) || 0) * 60 + (Number.parseInt(parts[1] ?? '', 10) || 0);
}

/**
 * A2 line 44-72: `aggregateItems`.
 *
 * ORDER MATTERS (A2 test `testMoreThanFiveItems`): the ">5" check runs on the RAW
 * list, so five DIFFERENT medicines plus one duplicate is still rejected.
 *
 * Aggregation is why a single order can never exceed a medicine's `maxQuantity`
 * overall: the per-medicine check in the processing service runs on the
 * AGGREGATED quantity, exactly as A2 line 310 does.
 */
export function aggregateItems(rawItems: readonly unknown[]): AggregateResult {
  if (rawItems.length === 0) {
    return { items: null, error: ERROR_EMPTY_ITEMS };
  }
  if (rawItems.length > MAX_RAW_ITEMS) {
    return { items: null, error: ERROR_TOO_MANY_ITEMS };
  }

  const quantities = new Map<string, number>();
  for (const entry of rawItems) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { items: null, error: ERROR_BAD_STRUCTURE };
    }
    const line = entry as Record<string, unknown>;

    const medicineId = line['medicineId'];
    if (typeof medicineId !== 'string') {
      return { items: null, error: ERROR_BAD_STRUCTURE };
    }
    const rawQuantity = line['quantity'];
    if (typeof rawQuantity !== 'number' || !Number.isInteger(rawQuantity)) {
      return { items: null, error: ERROR_BAD_STRUCTURE };
    }
    if (medicineId.trim().length === 0 || rawQuantity <= 0) {
      return { items: null, error: badQuantityError(medicineId) };
    }

    const next = (quantities.get(medicineId) ?? 0) + rawQuantity;
    if (!Number.isSafeInteger(next)) {
      return { items: null, error: overflowError(medicineId) };
    }
    quantities.set(medicineId, next);
  }

  const items = Array.from(quantities.entries(), ([medicineId, quantity]) => Object.freeze({
    medicineId,
    quantity,
  }));
  return { items: Object.freeze(items), error: null };
}
