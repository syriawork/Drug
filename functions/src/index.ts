import { createHash } from 'node:crypto';

import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { createAuthorizationService } from './auth/authorization';
import { createAdminUserProfileReader } from './auth/user-profile';
import { withSafeCallableErrors } from './callable/error-handling';

if (getApps().length === 0) {
  initializeApp();
}

const firestore = getFirestore();
const authorization = createAuthorizationService({
  profiles: createAdminUserProfileReader(),
});

type AuthorizationCapability = 'approved-user' | 'administrator' | 'assistant';

interface SubmitOrderLine {
  readonly medicineId: string;
  readonly quantity: number;
}

interface SubmitOrderPayload {
  readonly idempotencyKey: string;
  readonly items: readonly SubmitOrderLine[];
  readonly payloadHash: string;
}

interface InventoryRecord {
  readonly name: string;
  readonly maxQuantity: number;
  readonly stock: number;
  readonly reservedStock: number;
  readonly totalInward: number;
  readonly totalOutward: number;
  readonly onHandBefore: number;
}

interface SettingsDocument {
  readonly allowFridayOrders: boolean;
  readonly startTime: string;
  readonly endTime: string;
  readonly minDaysBetweenOrders: number;
}

const DEFAULT_SETTINGS: SettingsDocument = Object.freeze({
  allowFridayOrders: false,
  startTime: '06:00',
  endTime: '10:00',
  minDaysBetweenOrders: 15,
});

const ALLOWED_SUBMIT_ORDER_KEYS = new Set(['items', 'idempotencyKey']);

function readCapability(data: unknown): AuthorizationCapability {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new HttpsError('invalid-argument', 'A capability is required.');
  }

  const capability = (data as Record<string, unknown>)['capability'];
  if (capability !== 'approved-user' && capability !== 'administrator' && capability !== 'assistant') {
    throw new HttpsError('invalid-argument', 'The requested capability is invalid.');
  }
  return capability;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${label} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new HttpsError('invalid-argument', `${label} must not be empty.`);
  }
  return trimmed;
}

function normalizePositiveQuantity(value: unknown, medicineId: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new HttpsError('invalid-argument', `Invalid quantity for medicine ${medicineId}.`);
  }
  return value;
}

function stableHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url').replace(/=+$/u, '');
}

function canonicalizeOrderPayload(payload: unknown): SubmitOrderPayload {
  if (!isPlainObject(payload)) {
    throw new HttpsError('invalid-argument', 'A valid order payload is required.');
  }

  for (const key of Object.keys(payload)) {
    if (!ALLOWED_SUBMIT_ORDER_KEYS.has(key)) {
      throw new HttpsError('invalid-argument', `Unknown field: ${key}.`);
    }
  }

  const idempotencyKey = normalizeString(payload['idempotencyKey'], 'idempotencyKey');
  const rawItems = payload['items'];
  if (!Array.isArray(rawItems)) {
    throw new HttpsError('invalid-argument', 'items must be an array of medicine lines.');
  }
  if (rawItems.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one medicine is required.');
  }
  if (rawItems.length > 5) {
    throw new HttpsError('invalid-argument', 'Maximum 5 medicine lines per order.');
  }

  const totals = new Map<string, number>();
  for (const item of rawItems) {
    if (!isPlainObject(item)) {
      throw new HttpsError('invalid-argument', 'Each medicine line must be an object.');
    }
    const medicineIdValue = normalizeString(item['medicineId'], 'medicineId');
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(medicineIdValue)) {
      throw new HttpsError('invalid-argument', `Invalid medicine id: ${medicineIdValue}.`);
    }
    const quantity = normalizePositiveQuantity(item['quantity'], medicineIdValue);
    const next = (totals.get(medicineIdValue) ?? 0) + quantity;
    if (!Number.isSafeInteger(next)) {
      throw new HttpsError('invalid-argument', `Quantity aggregation overflow for medicine ${medicineIdValue}.`);
    }
    totals.set(medicineIdValue, next);
  }

  const items = Array.from(totals.entries(), ([medicineId, quantity]) => Object.freeze({
    medicineId,
    quantity,
  } satisfies SubmitOrderLine)).sort((left, right) => left.medicineId.localeCompare(right.medicineId));
  const canonical = JSON.stringify(items);
  return {
    idempotencyKey,
    items,
    payloadHash: stableHash(canonical),
  };
}

function parseIntegerField(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new HttpsError('failed-precondition', `${fieldName} is missing or malformed.`);
  }
  return value;
}

function readSettingsDocument(document: unknown): SettingsDocument {
  if (!isPlainObject(document)) {
    return { ...DEFAULT_SETTINGS };
  }

  const allowFridayOrders = document['allowFridayOrders'] === true;
  const startTime = typeof document['startTime'] === 'string' ? document['startTime'] : DEFAULT_SETTINGS.startTime;
  const endTime = typeof document['endTime'] === 'string' ? document['endTime'] : DEFAULT_SETTINGS.endTime;
  const minDaysBetweenOrders = (() => {
    const value = document['minDaysBetweenOrders'];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
    return DEFAULT_SETTINGS.minDaysBetweenOrders;
  })();

  return {
    allowFridayOrders,
    startTime,
    endTime,
    minDaysBetweenOrders,
  };
}

function parseTimeToMinutes(value: string): number {
  const parts = value.split(':');
  if (parts.length !== 2) {
    return 0;
  }
  return (Number.parseInt(parts[0] ?? '0', 10) || 0) * 60 + (Number.parseInt(parts[1] ?? '0', 10) || 0);
}

function getDamascusParts(date: Date): { readonly dayOfWeek: number; readonly hour: number; readonly minute: number } {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Damascus', weekday: 'short' }).format(date);
  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Damascus',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number.parseInt(timeParts.find((part) => part.type === 'hour')?.value ?? '0', 10) % 24;
  const minute = Number.parseInt(timeParts.find((part) => part.type === 'minute')?.value ?? '0', 10);
  const dayOfWeekTable: Readonly<Record<string, number>> = Object.freeze({
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  });
  return { dayOfWeek: dayOfWeekTable[weekday] ?? 0, hour, minute };
}

function monthYearFor(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Damascus',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  return `${month}-${year}`;
}

function validateEligibility(
  profile: Record<string, unknown>,
  now: Date,
  settings: SettingsDocument,
): void {
  const status = profile['status'];
  if (status !== 'approved') {
    throw new HttpsError('permission-denied', 'User is not approved to make orders.');
  }

  const hasException = profile['hasException'] === true;
  if (hasException) {
    return;
  }

  const lastOrderStatus = profile['lastOrderStatus'];
  if (lastOrderStatus === 'pending') {
    throw new HttpsError('failed-precondition', 'You already have a pending order.');
  }

  const lastOrderMonthYear = typeof profile['lastOrderMonthYear'] === 'string' ? profile['lastOrderMonthYear'] : '';
  if (lastOrderMonthYear.trim().length > 0 && lastOrderMonthYear === monthYearFor(now)) {
    throw new HttpsError('failed-precondition', 'You have already ordered this month.');
  }

  const lastOrderDateValue = profile['lastOrderDate'];
  const hasTimestampLikeDate =
    lastOrderDateValue instanceof Date
    || (typeof lastOrderDateValue === 'object' && lastOrderDateValue !== null && 'toDate' in lastOrderDateValue);
  if (hasTimestampLikeDate) {
    const lastOrderDate = lastOrderDateValue instanceof Date ? lastOrderDateValue : (lastOrderDateValue as { readonly toDate: () => Date }).toDate();
    const diffDays = Math.floor((now.getTime() - lastOrderDate.getTime()) / 86_400_000);
    if (diffDays < settings.minDaysBetweenOrders) {
      throw new HttpsError('failed-precondition', `Minimum interval between orders is ${settings.minDaysBetweenOrders} days`);
    }
  }

  const cadence = getDamascusParts(now);
  if (!settings.allowFridayOrders && cadence.dayOfWeek === 5) {
    throw new HttpsError('failed-precondition', 'Orders are not allowed on Fridays.');
  }

  const nowMinutes = cadence.hour * 60 + cadence.minute;
  const startMinutes = parseTimeToMinutes(settings.startTime);
  const endMinutes = parseTimeToMinutes(settings.endTime);
  if (nowMinutes < startMinutes || nowMinutes > endMinutes) {
    throw new HttpsError('failed-precondition', `Orders allowed only between ${settings.startTime} and ${settings.endTime} (Asia/Damascus)`);
  }
}

function validateInventoryRecord(medicineId: string, rawDocument: unknown): InventoryRecord {
  if (!isPlainObject(rawDocument)) {
    throw new HttpsError('failed-precondition', `Medicine ${medicineId} is missing or malformed.`);
  }

  const name = normalizeString(rawDocument['name'], `medicine ${medicineId} name`);
  const maxQuantity = parseIntegerField(rawDocument['maxQuantity'], `maxQuantity for ${medicineId}`);
  const stock = parseIntegerField(rawDocument['stock'], `stock for ${medicineId}`);
  const reservedStock = parseIntegerField(rawDocument['reservedStock'], `reservedStock for ${medicineId}`);
  const totalInward = parseIntegerField(rawDocument['totalInward'], `totalInward for ${medicineId}`);
  const totalOutward = parseIntegerField(rawDocument['totalOutward'], `totalOutward for ${medicineId}`);

  if (name.length === 0 || maxQuantity <= 0 || stock < 0 || reservedStock < 0 || totalInward < 0 || totalOutward < 0) {
    throw new HttpsError('failed-precondition', `Medicine ${medicineId} has invalid inventory values.`);
  }

  const onHandBefore = stock + reservedStock;
  if (!Number.isSafeInteger(onHandBefore)) {
    throw new HttpsError('failed-precondition', `Medicine ${medicineId} inventory overflowed.`);
  }

  return {
    name,
    maxQuantity,
    stock,
    reservedStock,
    totalInward,
    totalOutward,
    onHandBefore,
  };
}

function buildOrderId(uid: string, idempotencyKey: string): string {
  return stableHash(`${uid}:${idempotencyKey}`);
}

function sampleUserName(profileData: unknown, fallbackUid: string): string {
  if (isPlainObject(profileData) && typeof profileData['name'] === 'string' && profileData['name'].trim().length > 0) {
    return profileData['name'];
  }
  return fallbackUid;
}

export const authorizationProbe = onCall(async (request) =>
  withSafeCallableErrors('authorizationProbe', async () => {
    if (process.env['FUNCTIONS_EMULATOR'] !== 'true') {
      throw new HttpsError('failed-precondition', 'This test-only callable is available only in the Functions emulator.');
    }

    const capability = readCapability(request.data);
    switch (capability) {
      case 'approved-user':
        await authorization.requireApprovedEmployee(request);
        break;
      case 'administrator':
        await authorization.requireAdministrator(request);
        break;
      case 'assistant':
        await authorization.requireAssistant(request);
        break;
    }
    return { capability, granted: true };
  }),
);

export const submitOrder = onCall(async (request) =>
  withSafeCallableErrors('submitOrder', async () => {
    const caller = await authorization.requireApprovedEmployee(request);
    const payload = canonicalizeOrderPayload(request.data);
    const orderId = buildOrderId(caller.uid, payload.idempotencyKey);
    const payloadDocId = `${caller.uid}:${stableHash(payload.idempotencyKey)}`;
    const submissionRef = firestore.collection('orderSubmissions').doc(payloadDocId);
    const settingsRef = firestore.collection('settings').doc('app');
    const userRef = firestore.collection('users').doc(caller.uid);

    const result = await firestore.runTransaction(async (transaction) => {
      const submissionSnapshot = await transaction.get(submissionRef);
      if (submissionSnapshot.exists) {
        const submission = submissionSnapshot.data() as Record<string, unknown>;
        if (submission['payloadHash'] === payload.payloadHash) {
          return { orderId: String(submission['orderId'] ?? orderId), status: 'pending' };
        }
        throw new HttpsError('already-exists', 'This idempotency key is already in use with different content.');
      }

      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists) {
        throw new HttpsError('not-found', 'The user profile was not found.');
      }
      const profile = (userSnapshot.data() ?? {}) as Record<string, unknown>;
      const settingsSnapshot = await transaction.get(settingsRef);
      const settings = readSettingsDocument(settingsSnapshot.exists ? settingsSnapshot.data() : null);
      const now = new Date();
      validateEligibility(profile, now, settings);

      const medicineUpdates = new Map<string, { readonly stockBefore: number; readonly reservedStockBefore: number; readonly requestedQuantity: number; readonly stockAfter: number; readonly reservedStockAfter: number; readonly inventory: InventoryRecord; readonly medicineName: string; }>();
      for (const item of payload.items) {
        const medicineRef = firestore.collection('medicines').doc(item.medicineId);
        const inventorySnapshot = await transaction.get(medicineRef);
        if (!inventorySnapshot.exists) {
          throw new HttpsError('failed-precondition', `Medicine ${item.medicineId} was not found.`);
        }
        const inventory = validateInventoryRecord(item.medicineId, inventorySnapshot.data());
        if (item.quantity > inventory.maxQuantity) {
          throw new HttpsError('failed-precondition', `Maximum quantity for ${inventory.name} is ${inventory.maxQuantity}.`);
        }
        const availableStock = inventory.stock;
        if (item.quantity > availableStock) {
          throw new HttpsError('failed-precondition', `Insufficient stock for ${inventory.name}.`);
        }
        const stockAfter = inventory.stock - item.quantity;
        const reservedStockAfter = inventory.reservedStock + item.quantity;
        if (stockAfter < 0 || reservedStockAfter < 0 || stockAfter + reservedStockAfter !== inventory.onHandBefore) {
          throw new HttpsError('failed-precondition', `Reservation arithmetic failed for ${inventory.name}.`);
        }
        medicineUpdates.set(item.medicineId, {
          stockBefore: inventory.stock,
          reservedStockBefore: inventory.reservedStock,
          requestedQuantity: item.quantity,
          stockAfter,
          reservedStockAfter,
          inventory,
          medicineName: inventory.name,
        });
      }

      const orderRef = firestore.collection('orders').doc(orderId);
      const userName = sampleUserName(profile, caller.uid);
      const orderItems = Array.from(medicineUpdates.entries()).map(([medicineId, entry]) => ({
        medicineId,
        medicineName: entry.medicineName,
        quantity: entry.requestedQuantity,
      }));

      transaction.set(orderRef, {
        id: orderId,
        userId: caller.uid,
        userName,
        items: orderItems,
        date: FieldValue.serverTimestamp(),
        monthYear: monthYearFor(now),
        status: 'pending',
        isExceptionOrder: false,
        requestId: null,
      });

      for (const [medicineId, entry] of medicineUpdates) {
        const medicineRef = firestore.collection('medicines').doc(medicineId);
        const movementId = stableHash(`${orderId}:${medicineId}:${payload.payloadHash}`);
        const beforeOnHand = entry.inventory.onHandBefore;
        const movementDoc = {
          id: movementId,
          medicineId,
          medicineName: entry.medicineName,
          quantity: entry.requestedQuantity,
          type: 'reservation',
          orderId,
          line: medicineId,
          uid: caller.uid,
          actorType: 'employee',
          createdAt: FieldValue.serverTimestamp(),
          action: 'submitOrder',
          idempotencyKey: payload.idempotencyKey,
          reason: 'pending order reservation',
          availableStockBefore: entry.stockBefore,
          availableStockAfter: entry.stockAfter,
          reservedStockBefore: entry.reservedStockBefore,
          reservedStockAfter: entry.reservedStockAfter,
          onHandBefore: beforeOnHand,
          onHandAfter: beforeOnHand,
          orderStatus: 'pending',
        } satisfies Record<string, unknown>;

        transaction.update(medicineRef, {
          stock: entry.stockAfter,
          reservedStock: entry.reservedStockAfter,
        });
        transaction.set(firestore.collection('stock_logs').doc(movementId), movementDoc);
      }

      const nextUser = {
        ...profile,
        lastOrderId: orderId,
        lastOrderDate: FieldValue.serverTimestamp(),
        lastOrderMonthYear: monthYearFor(now),
        lastOrderStatus: 'pending',
        pendingOrder: true,
        pendingOrderId: orderId,
      };
      transaction.set(userRef, nextUser, { merge: true });
      transaction.set(submissionRef, {
        uid: caller.uid,
        payloadHash: payload.payloadHash,
        orderId,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      });

      return { orderId, status: 'pending' } as const;
    });

    return result;
  }),
);
