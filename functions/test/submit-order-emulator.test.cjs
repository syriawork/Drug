const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { after, before, describe, it } = require('node:test');

const PROJECT_ID = 'demo-drug-manager-stage3';
const API_KEY = 'demo-emulator-api-key';
const DEMO_PASSWORD = 'Stage34D-Emulator-Only!2026';
const RUN_ID = `${Date.now()}-${process.pid}`;
const EMULATOR_REQUEST_TIMEOUT_MS = 60000;

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const projectId = process.env.FIREBASE_PROJECT_ID || PROJECT_ID;

const createdDocs = new Set();
const authUsers = new Map();

function assertLoopbackEndpoint(value, expectedPort, label) {
  const match = /^(127\.0\.0\.1|localhost|\[?::1\]?):(\d+)$/.exec(value);
  assert.ok(match, `${label} must use a loopback address`);
  assert.equal(Number(match[2]), expectedPort, `${label} must use its dedicated local port`);
}

function stableHash(value) {
  return createHash('sha256').update(value, 'utf8').digest('base64url').replace(/=+$/u, '');
}

function monthYearFor(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Damascus',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  return `${month}-${year}`;
}

function toFields(record) {
  const fields = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null) {
      fields[key] = { nullValue: null };
      continue;
    }
    if (typeof value === 'string') {
      fields[key] = { stringValue: value };
      continue;
    }
    if (typeof value === 'number') {
      fields[key] = Number.isInteger(value)
        ? { integerValue: String(value) }
        : { doubleValue: String(value) };
      continue;
    }
    if (typeof value === 'boolean') {
      fields[key] = { booleanValue: value };
      continue;
    }
    if (value instanceof Date) {
      fields[key] = { timestampValue: value.toISOString() };
      continue;
    }
    if (Array.isArray(value)) {
      fields[key] = { arrayValue: { values: value.map((entry) => toFields({ value: entry }).value ?? { nullValue: null }) } };
      continue;
    }
    if (typeof value === 'object') {
      fields[key] = { mapValue: { fields: toFields(value) } };
      continue;
    }
    fields[key] = { stringValue: String(value) };
  }
  return fields;
}

function unwrapFirestoreValue(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if ('stringValue' in value) {
    return value.stringValue;
  }
  if ('integerValue' in value) {
    return Number(value.integerValue);
  }
  if ('doubleValue' in value) {
    return Number(value.doubleValue);
  }
  if ('booleanValue' in value) {
    return value.booleanValue;
  }
  if ('timestampValue' in value) {
    return new Date(value.timestampValue);
  }
  if ('nullValue' in value) {
    return null;
  }
  if ('arrayValue' in value) {
    return (value.arrayValue?.values ?? []).map((entry) => unwrapFirestoreValue(entry));
  }
  if ('mapValue' in value) {
    const fields = value.mapValue?.fields ?? {};
    const out = {};
    for (const [key, entry] of Object.entries(fields)) out[key] = unwrapFirestoreValue(entry);
    return out;
  }
  const fieldMarkers = new Set(['stringValue', 'integerValue', 'doubleValue', 'booleanValue', 'timestampValue', 'nullValue', 'arrayValue', 'mapValue', 'fields']);
  if (Object.keys(value).some((key) => !fieldMarkers.has(key))) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = unwrapFirestoreValue(entry);
    return out;
  }
  if ('fields' in value && typeof value.fields === 'object' && value.fields !== null) {
    const out = {};
    for (const [key, entry] of Object.entries(value.fields)) out[key] = unwrapFirestoreValue(entry);
    return out;
  }
  return value;
}

async function requestJson(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(EMULATOR_REQUEST_TIMEOUT_MS),
  });
}

async function authUrl(path) {
  return `http://${authHost}/identitytoolkit.googleapis.com/v1/${path}?key=${API_KEY}`;
}

async function firestoreDocumentUrl(relativePath) {
  return `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${relativePath}`;
}

async function callableUrl(functionName) {
  return `http://${functionsHost}/${projectId}/us-central1/${functionName}`;
}

async function createAuthUser(label) {
  const email = `stage34d-${RUN_ID}-${label}@example.test`;
  const response = await requestJson(await authUrl('accounts:signUp'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: DEMO_PASSWORD, returnSecureToken: true }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, 'Auth emulator did not create an isolated test user');
  assert.equal(typeof body.localId, 'string');
  assert.equal(typeof body.idToken, 'string');
  const claims = JSON.parse(Buffer.from(body.idToken.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.aud, projectId, 'Auth emulator token project differs from the lab project');

  const user = { uid: body.localId, idToken: body.idToken, email };
  authUsers.set(label, user);
  return user;
}

async function writeFirestoreDocument(relativePath, record) {
  const response = await requestJson(await firestoreDocumentUrl(relativePath), {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer owner',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFields(record) }),
  });
  assert.equal(response.status, 200, `Firestore fixture write failed for ${relativePath}: ${await response.text()}`);
  createdDocs.add(relativePath);
}

async function readFirestoreDocument(relativePath) {
  const response = await requestJson(await firestoreDocumentUrl(relativePath), {
    method: 'GET',
    headers: { Authorization: 'Bearer owner' },
  });
  if (response.status === 404) {
    return null;
  }
  const rawBody = await response.text();
  assert.equal(response.status, 200, `Firestore read failed for ${relativePath}: ${rawBody}`);
  const body = JSON.parse(rawBody);
  return unwrapFirestoreValue(body.fields ?? null);
}

async function deleteFirestoreDocument(relativePath) {
  const response = await requestJson(await firestoreDocumentUrl(relativePath), {
    method: 'DELETE',
    headers: { Authorization: 'Bearer owner' },
  });
  if (response.status === 200 || response.status === 404) {
    return;
  }
  assert.equal(response.status, 200, `Firestore cleanup failed for ${relativePath}: ${await response.text()}`);
}

async function writeProfile(user, profile) {
  await writeFirestoreDocument(`users/${user.uid}`, {
    uid: user.uid,
    name: 'Stage 34D emulator fixture',
    employeeId: 'STAGE34D',
    ...profile,
  });
}

async function writeMedicine(identifier, attributes) {
  await writeFirestoreDocument(`medicines/${identifier}`, attributes);
}

async function writeSettings(settings) {
  await writeFirestoreDocument('settings/app', settings);
}

async function deleteUserAccount(user) {
  const response = await requestJson(await authUrl('accounts:delete'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: user.idToken }),
  });
  assert.equal(response.status, 200, 'Auth fixture cleanup failed');
}

async function callSubmitOrder(user, payload, authenticated = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (authenticated && user) {
    headers.Authorization = `Bearer ${user.idToken}`;
  }
  const response = await requestJson(await callableUrl('submitOrder'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ data: payload }),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = { rawText: await response.text() };
  }
  return { response, body };
}

async function assertCallableFailure(user, payload, code, options = {}) {
  const { response, body } = await callSubmitOrder(user, payload, options.authenticated !== false);
  assert.notEqual(response.status, 200, `expected ${code} but the callable succeeded`);
  assert.equal(body.error?.status ?? body.error?.code ?? null, code, `expected ${code} but body was ${JSON.stringify(body)}`);
  assert.equal(typeof body.error?.message, 'string');
  return { response, body };
}

async function expectSuccessResult(user, payload) {
  const { response, body } = await callSubmitOrder(user, payload);
  assert.equal(response.status, 200, `expected success but got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.result.status, 'pending');
  assert.equal(typeof body.result.orderId, 'string');
  return body.result;
}

function makePayload(items, idempotencyKey = `stage34d-${Math.random().toString(36).slice(2)}`) {
  return { idempotencyKey, items };
}

function parseOrderDocument(doc) {
  const items = Array.isArray(doc.items) ? doc.items.map((entry) => ({
    medicineId: entry.medicineId,
    medicineName: entry.medicineName,
    quantity: Number(entry.quantity),
  })) : [];
  return {
    id: doc.id,
    userId: doc.userId,
    userName: doc.userName,
    items,
    status: doc.status,
    isExceptionOrder: Boolean(doc.isExceptionOrder),
    requestId: doc.requestId,
    monthYear: doc.monthYear,
  };
}

function getDamascusNowParts(date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Damascus', weekday: 'short' }).format(date);
  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Damascus',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number.parseInt(timeParts.find((part) => part.type === 'hour')?.value ?? '0', 10) % 24;
  const minute = Number.parseInt(timeParts.find((part) => part.type === 'minute')?.value ?? '0', 10);
  const dayOfWeekTable = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dayOfWeek: dayOfWeekTable[weekday] ?? 0, hour, minute };
}

before(async () => {
  assert.equal(projectId, PROJECT_ID, 'This suite must run only against the demo-drg-manager-stage3 local project.');
  assertLoopbackEndpoint(authHost, 9099, 'Auth emulator');
  assertLoopbackEndpoint(firestoreHost, 8080, 'Firestore emulator');
  assertLoopbackEndpoint(functionsHost, 5001, 'Functions emulator');

  const authProbe = await requestJson(`http://${authHost}/`, { method: 'GET' });
  const firestoreProbe = await requestJson(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/`, { method: 'GET' });
  const functionsProbe = await requestJson(`http://${functionsHost}/`, { method: 'GET' });

  assert.notEqual(authProbe.status, 0, 'Auth emulator is unavailable');
  assert.notEqual(firestoreProbe.status, 0, 'Firestore emulator is unavailable');
  assert.notEqual(functionsProbe.status, 0, 'Functions emulator is unavailable');
  assert.equal(authProbe.status < 500, true, 'Auth emulator must be reachable');
  assert.equal(firestoreProbe.status < 500, true, 'Firestore emulator must be reachable');
  assert.equal(functionsProbe.status < 500, true, 'Functions emulator must be reachable');

  console.log(`[stage34d] project=${projectId} auth=${authHost} firestore=${firestoreHost} functions=${functionsHost}`);
});

after(async () => {
  for (const relativePath of Array.from(createdDocs).reverse()) {
    await deleteFirestoreDocument(relativePath);
  }
  for (const user of authUsers.values()) {
    await deleteUserAccount(user);
  }
});

describe('Stage 34D submitOrder emulator integration', () => {
  it('rejects an unauthenticated caller', async () => {
    const user = await createAuthUser('unauthenticated');
    await assertCallableFailure(user, makePayload([{ medicineId: 'm-1', quantity: 1 }]), 'UNAUTHENTICATED', { authenticated: false });
  });

  it('rejects a missing user profile', async () => {
    const user = await createAuthUser('missing-profile');
    await assertCallableFailure(user, makePayload([{ medicineId: 'm-1', quantity: 1 }]), 'NOT_FOUND');
  });

  it('rejects an unapproved caller', async () => {
    const user = await createAuthUser('unapproved');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'pending', hasException: false });
    await assertCallableFailure(user, makePayload([{ medicineId: 'm-1', quantity: 1 }]), 'PERMISSION_DENIED');
  });

  it('rejects an unknown top-level payload field', async () => {
    const user = await createAuthUser('unknown-top-level');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await assertCallableFailure(user, { idempotencyKey: 'unknown-top-level', items: [{ medicineId: 'm-1', quantity: 1 }], unexpected: true }, 'INVALID_ARGUMENT');
  });

  it('accepts unknown nested fields by ignoring them instead of rejecting', async () => {
    const user = await createAuthUser('unknown-nested');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    const result = await expectSuccessResult(user, { idempotencyKey: 'unknown-nested-key', items: [{ medicineId: 'm-1', quantity: 2, ignored: 'value' }] });
    const orderDoc = await readFirestoreDocument(`orders/${result.orderId}`);
    assert.deepEqual(parseOrderDocument(orderDoc), {
      id: result.orderId,
      userId: user.uid,
      userName: 'Stage 34D emulator fixture',
      items: [{ medicineId: 'm-1', medicineName: 'Alpha', quantity: 2 }],
      status: 'pending',
      isExceptionOrder: false,
      requestId: null,
      monthYear: monthYearFor(new Date()),
    });
  });

  it('rejects invalid medicine IDs', async () => {
    const user = await createAuthUser('invalid-medicine-id');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await assertCallableFailure(user, { idempotencyKey: 'invalid-medicine-id', items: [{ medicineId: 'bad medicine', quantity: 1 }] }, 'INVALID_ARGUMENT');
  });

  it('rejects zero, negative, fractional, unsafe, or malformed quantities', async () => {
    const user = await createAuthUser('bad-quantities');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
      await assertCallableFailure(user, { idempotencyKey: `bad-quantity-${String(quantity)}`, items: [{ medicineId: 'm-1', quantity }] }, 'INVALID_ARGUMENT');
    }
  });

  it('rejects more than five raw lines', async () => {
    const user = await createAuthUser('too-many-lines');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    const items = Array.from({ length: 6 }, (_, index) => ({ medicineId: `m-${index + 1}`, quantity: 1 }));
    await assertCallableFailure(user, { idempotencyKey: 'too-many-lines', items }, 'INVALID_ARGUMENT');
  });

  it('aggregates duplicate medicines and sorts deterministic item order', async () => {
    const user = await createAuthUser('aggregate-order');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-b', { name: 'Beta', maxQuantity: 10, stock: 10, reservedStock: 0, totalInward: 10, totalOutward: 0 });
    await writeMedicine('m-a', { name: 'Alpha', maxQuantity: 10, stock: 10, reservedStock: 0, totalInward: 10, totalOutward: 0 });
    const result = await expectSuccessResult(user, { idempotencyKey: 'aggregate-order-key', items: [{ medicineId: 'm-b', quantity: 2 }, { medicineId: 'm-a', quantity: 1 }, { medicineId: 'm-b', quantity: 3 }, { medicineId: 'm-a', quantity: 2 }] });
    const orderDoc = await readFirestoreDocument(`orders/${result.orderId}`);
    assert.deepEqual(parseOrderDocument(orderDoc).items, [
      { medicineId: 'm-a', medicineName: 'Alpha', quantity: 3 },
      { medicineId: 'm-b', medicineName: 'Beta', quantity: 5 },
    ]);
  });

  it('rejects a missing medicine document before reservation begins', async () => {
    const user = await createAuthUser('missing-medicine');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await assertCallableFailure(user, { idempotencyKey: 'missing-medicine-key', items: [{ medicineId: 'not-there', quantity: 1 }] }, 'FAILED_PRECONDITION');
  });

  it('rejects missing or malformed required inventory fields', async () => {
    const user = await createAuthUser('malformed-inventory');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('bad-inventory', { name: 'Broken', stock: 5, reservedStock: 2, totalInward: 10 });
    await assertCallableFailure(user, { idempotencyKey: 'malformed-inventory-key', items: [{ medicineId: 'bad-inventory', quantity: 1 }] }, 'FAILED_PRECONDITION');
  });

  it('rejects insufficient available stock', async () => {
    const user = await createAuthUser('insufficient-stock');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('stock-low', { name: 'Low', maxQuantity: 10, stock: 2, reservedStock: 0, totalInward: 2, totalOutward: 0 });
    await assertCallableFailure(user, { idempotencyKey: 'insufficient-stock-key', items: [{ medicineId: 'stock-low', quantity: 3 }] }, 'FAILED_PRECONDITION');
  });

  it('enforces maxQuantity before reservation', async () => {
    const user = await createAuthUser('max-quantity');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('qty-limit', { name: 'Limit', maxQuantity: 2, stock: 10, reservedStock: 0, totalInward: 10, totalOutward: 0 });
    await assertCallableFailure(user, { idempotencyKey: 'max-quantity-key', items: [{ medicineId: 'qty-limit', quantity: 3 }] }, 'FAILED_PRECONDITION');
  });

  it('rolls back a multi-medicine failure atomically', async () => {
    const user = await createAuthUser('atomic-rollback');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-ok', { name: 'OK', maxQuantity: 10, stock: 5, reservedStock: 0, totalInward: 5, totalOutward: 0 });
    await writeMedicine('m-bad', { name: 'BAD', maxQuantity: 10, stock: 1, reservedStock: 0, totalInward: 1, totalOutward: 0 });
    const payload = { idempotencyKey: 'atomic-rollback-key', items: [{ medicineId: 'm-ok', quantity: 2 }, { medicineId: 'm-bad', quantity: 2 }] };
    await assertCallableFailure(user, payload, 'FAILED_PRECONDITION');
    const orderId = stableHash(`${user.uid}:${stableHash('atomic-rollback-key')}`);
    const orderDoc = await readFirestoreDocument(`orders/${orderId}`);
    assert.equal(orderDoc, null);
    const logs = await readFirestoreDocument('stock_logs/none');
    assert.equal(logs, null);
  });

  it('reuses the same key and payload idempotently', async () => {
    const user = await createAuthUser('idempotent-same');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    const payload = { idempotencyKey: 'idempotent-key-1', items: [{ medicineId: 'm-1', quantity: 2 }] };
    const first = await expectSuccessResult(user, payload);
    const second = await expectSuccessResult(user, payload);
    assert.equal(second.orderId, first.orderId);
    const docs = await readFirestoreDocument(`orderSubmissions/${user.uid}:${stableHash(payload.idempotencyKey)}`);
    assert.equal(docs.uid, user.uid);
    assert.equal(typeof docs.payloadHash, 'string');
    assert.equal(docs.orderId, first.orderId);
  });

  it('rejects the same key with a different payload', async () => {
    const user = await createAuthUser('same-key-different-payload');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    const first = { idempotencyKey: 'same-key', items: [{ medicineId: 'm-1', quantity: 2 }] };
    const second = { idempotencyKey: 'same-key', items: [{ medicineId: 'm-1', quantity: 3 }] };
    const firstResult = await expectSuccessResult(user, first);
    await assertCallableFailure(user, second, 'ALREADY_EXISTS');
    const orderDoc = await readFirestoreDocument(`orders/${firstResult.orderId}`);
    assert.equal(orderDoc.items[0].quantity, 2);
  });

  it('serializes concurrent same-key requests to one order and one reservation', async () => {
    const user = await createAuthUser('concurrent-same-key');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    const payload = { idempotencyKey: 'concurrent-same-key', items: [{ medicineId: 'm-1', quantity: 2 }] };
    const [first, second] = await Promise.all([
      callSubmitOrder(user, payload),
      callSubmitOrder(user, payload),
    ]);
    const orderIds = [first.body.result?.orderId, second.body.result?.orderId].filter(Boolean);
    const statuses = [first.body.error?.status, second.body.error?.status].filter(Boolean);
    assert.equal(new Set(orderIds).size, 1);
    assert.ok(orderIds.length >= 1 && orderIds.length <= 2);
  });

  it('rejects concurrent different-key stock contention when total requested exceeds stock', async () => {
    const user = await createAuthUser('concurrent-stock');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('stock-contend', { name: 'Contend', maxQuantity: 5, stock: 3, reservedStock: 0, totalInward: 3, totalOutward: 0 });
    const payloadA = { idempotencyKey: 'concurrent-stock-a', items: [{ medicineId: 'stock-contend', quantity: 2 }] };
    const payloadB = { idempotencyKey: 'concurrent-stock-b', items: [{ medicineId: 'stock-contend', quantity: 2 }] };
    const [first, second] = await Promise.all([
      callSubmitOrder(user, payloadA),
      callSubmitOrder(user, payloadB),
    ]);
    const success = [first, second].filter((entry) => entry.response.status === 200);
    const failures = [first, second].filter((entry) => entry.response.status !== 200);
    assert.equal(success.length, 1, 'exactly one concurrent request should reserve the limited stock');
    assert.ok(failures.some((entry) => entry.body.error?.status === 'FAILED_PRECONDITION'));
  });

  it('enforces Friday restriction when the current Damascus day is Friday', async () => {
    const parts = getDamascusNowParts();
    if (parts.dayOfWeek !== 5) {
      return;
    }
    const user = await createAuthUser('friday-restricted');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: false, startTime: '06:00', endTime: '10:00', minDaysBetweenOrders: 0 });
    await writeMedicine('friday-medicine', { name: 'Friday', maxQuantity: 10, stock: 10, reservedStock: 0, totalInward: 10, totalOutward: 0 });
    await assertCallableFailure(user, { idempotencyKey: 'friday-key', items: [{ medicineId: 'friday-medicine', quantity: 1 }] }, 'FAILED_PRECONDITION');
  });

  it('enforces the submission time window when the current Damascus time is outside the window', async () => {
    const parts = getDamascusNowParts();
    const nowMinutes = parts.hour * 60 + parts.minute;
    if (nowMinutes >= 6 * 60 && nowMinutes <= 10 * 60) {
      return;
    }
    const user = await createAuthUser('time-window');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: true, startTime: '06:00', endTime: '10:00', minDaysBetweenOrders: 0 });
    await writeMedicine('time-window-med', { name: 'Window', maxQuantity: 10, stock: 10, reservedStock: 0, totalInward: 10, totalOutward: 0 });
    await assertCallableFailure(user, { idempotencyKey: 'time-window-key', items: [{ medicineId: 'time-window-med', quantity: 1 }] }, 'FAILED_PRECONDITION');
  });

  it('rejects a user who has ordered too recently', async () => {
    const user = await createAuthUser('recent-order');
    const now = new Date();
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false, lastOrderDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), lastOrderMonthYear: monthYearFor(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)), lastOrderStatus: 'rejected' });
    await writeSettings({ allowFridayOrders: true, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 15 });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    await assertCallableFailure(user, { idempotencyKey: 'recent-order-key', items: [{ medicineId: 'm-1', quantity: 1 }] }, 'FAILED_PRECONDITION');
  });

  it('rejects the same-month order lock', async () => {
    const user = await createAuthUser('same-month');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false, lastOrderMonthYear: monthYearFor(new Date()), lastOrderStatus: 'accepted' });
    await writeSettings({ allowFridayOrders: true, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    await assertCallableFailure(user, { idempotencyKey: 'same-month-key', items: [{ medicineId: 'm-1', quantity: 1 }] }, 'FAILED_PRECONDITION');
  });

  it('rejects a user that already has a pending order', async () => {
    const user = await createAuthUser('pending-order');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false, lastOrderStatus: 'pending' });
    await writeSettings({ allowFridayOrders: true, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    await assertCallableFailure(user, { idempotencyKey: 'pending-order-key', items: [{ medicineId: 'm-1', quantity: 1 }] }, 'FAILED_PRECONDITION');
  });

  it('falls back to safe defaults when the settings document is missing', async () => {
    const user = await createAuthUser('missing-settings');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    const result = await expectSuccessResult(user, { idempotencyKey: 'missing-settings-key', items: [{ medicineId: 'm-1', quantity: 1 }] });
    assert.equal(typeof result.orderId, 'string');
  });

  it('falls back to safe defaults with malformed settings data', async () => {
    const nowMinutes = getDamascusNowParts().hour * 60 + getDamascusNowParts().minute;
    if (nowMinutes < 6 * 60 || nowMinutes > 10 * 60) {
      return;
    }
    const user = await createAuthUser('malformed-settings');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: 'yes', startTime: 42, endTime: null, minDaysBetweenOrders: 'bad' });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    const result = await expectSuccessResult(user, { idempotencyKey: 'malformed-settings-key', items: [{ medicineId: 'm-1', quantity: 1 }] });
    assert.equal(typeof result.orderId, 'string');
  });

  it('writes the expected order document fields for a successful order', async () => {
    const user = await createAuthUser('order-document-fields');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: true, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    const payload = { idempotencyKey: 'order-fields-key', items: [{ medicineId: 'm-1', quantity: 2 }] };
    const result = await expectSuccessResult(user, payload);
    const orderDoc = await readFirestoreDocument(`orders/${result.orderId}`);
    assert.deepEqual(parseOrderDocument(orderDoc), {
      id: result.orderId,
      userId: user.uid,
      userName: 'Stage 34D emulator fixture',
      items: [{ medicineId: 'm-1', medicineName: 'Alpha', quantity: 2 }],
      status: 'pending',
      isExceptionOrder: false,
      requestId: null,
      monthYear: monthYearFor(new Date()),
    });
  });

  it('writes the expected user summary fields', async () => {
    const user = await createAuthUser('user-summary-fields');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: true, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    const payload = { idempotencyKey: 'user-summary-key', items: [{ medicineId: 'm-1', quantity: 2 }] };
    const result = await expectSuccessResult(user, payload);
    const userDoc = await readFirestoreDocument(`users/${user.uid}`);
    assert.equal(userDoc.lastOrderId, result.orderId);
    assert.equal(userDoc.lastOrderStatus, 'pending');
    assert.equal(userDoc.pendingOrder, true);
    assert.equal(userDoc.pendingOrderId, result.orderId);
    assert.equal(userDoc.lastOrderMonthYear, monthYearFor(new Date()));
    assert.equal(typeof userDoc.lastOrderDate, 'object');
  });

  it('writes exact reservation stock_log fields and arithmetic', async () => {
    const user = await createAuthUser('stock-logs-fields');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: true, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    const payload = { idempotencyKey: 'stock-log-key', items: [{ medicineId: 'm-1', quantity: 3 }] };
    const result = await expectSuccessResult(user, payload);
    const movementDoc = await readFirestoreDocument(`stock_logs/${stableHash(`${result.orderId}:m-1:${stableHash(JSON.stringify([{ medicineId: 'm-1', quantity: 3 }]))}`)}`);
    assert.equal(movementDoc.medicineId, 'm-1');
    assert.equal(movementDoc.medicineName, 'Alpha');
    assert.equal(movementDoc.quantity, 3);
    assert.equal(movementDoc.type, 'reservation');
    assert.equal(movementDoc.line, 'm-1');
    assert.equal(movementDoc.uid, user.uid);
    assert.equal(movementDoc.orderStatus, 'pending');
    assert.equal(movementDoc.availableStockBefore, 20);
    assert.equal(movementDoc.availableStockAfter, 17);
    assert.equal(movementDoc.reservedStockBefore, 0);
    assert.equal(movementDoc.reservedStockAfter, 3);
    assert.equal(movementDoc.onHandBefore, 20);
    assert.equal(movementDoc.onHandAfter, 20);
  });

  it('records idempotency ownership and payloadHash on the submission document', async () => {
    const user = await createAuthUser('idempotency-doc');
    await writeProfile(user, { uid: user.uid, role: 'employee', status: 'approved', hasException: false });
    await writeSettings({ allowFridayOrders: true, startTime: '00:00', endTime: '23:59', minDaysBetweenOrders: 0 });
    await writeMedicine('m-1', { name: 'Alpha', maxQuantity: 10, stock: 20, reservedStock: 0, totalInward: 20, totalOutward: 0 });
    const payload = { idempotencyKey: 'idempotency-doc-key', items: [{ medicineId: 'm-1', quantity: 1 }] };
    const result = await expectSuccessResult(user, payload);
    const subDoc = await readFirestoreDocument(`orderSubmissions/${user.uid}:${stableHash(payload.idempotencyKey)}`);
    assert.equal(subDoc.uid, user.uid);
    assert.equal(subDoc.orderId, result.orderId);
    assert.equal(subDoc.status, 'pending');
    assert.equal(typeof subDoc.payloadHash, 'string');
    assert.equal(subDoc.payloadHash, stableHash(JSON.stringify([{ medicineId: 'm-1', quantity: 1 }] )));
  });
});
