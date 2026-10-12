/**
 * Stage 11 - Order Requests management against the REAL Firestore emulator.
 *
 * WHAT MAKES THIS SUITE DIFFERENT FROM THE STAGE 6 ONE
 * The Stage 6 suite calls `FirestoreOrderProcessingService` directly. This suite
 * deliberately does NOT: it builds the whole Stage 11 APPLICATION layer over the
 * real repositories and the real Stage 6 engine, and drives it through
 * `application.orderRequests`. That is the only way to prove the claim this
 * stage makes - that the Windows UI path, not merely the engine beneath it,
 * commits W1-W5 correctly and is stopped by the real Android rules.
 *
 * NO FAKE STAGE 6. `createOrderProcessingTransactionFactory` and
 * `FirestoreOrderProcessingService` are the production implementations, wired
 * exactly as `main.ts` wires them. A stand-in here would prove only that the
 * stand-in works.
 *
 * THE RULES REMAIN THE AUTHORITY. Nothing in this file decides whether an
 * operation is allowed. Every denial asserted below is the emulator evaluating
 * the real `firestore.rules`, whose fingerprint is pinned in the final case.
 *
 * Reads are done through raw REST with the actor's own ID token and unwrapped
 * WITHOUT the application's mappers, so the assertions describe what Firestore
 * actually stored rather than what a mapper made of it.
 *
 * No production project is involved: the project id is a "demo-" id that
 * Firebase can only resolve locally.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createManagerApplication, type ManagerApplication } from '../../electron/application';
import {
  FirestoreMedicinesRepository,
  FirestoreOrderRequestsRepository,
  FirestoreOrdersRepository,
  FirestoreStockLogsRepository,
  FirestoreSettingsRepository,
  FirestoreUsersRepository,
  type RepositoryContext,
  createInboundStockTransactionFactory,
  createOrderProcessingTransactionFactory,
} from '../../electron/repositories';
import { FirestoreOrderProcessingService } from '../../electron/services/order-processing.service';
import {
  DEMO_PASSWORD,
  EmulatorHarness,
  readEmulatorEnvironment,
  type ActorSession,
} from '../helpers/firestore-emulator-harness';

const ADMIN_EMAIL = 'admin.stage11@drug-manager.demo';
const EMPLOYEE_EMAIL = 'employee.stage11@drug-manager.demo';
/** A second employee: the one whose requests the first must never see. */
const RIVAL_EMAIL = 'rival.stage11@drug-manager.demo';

let harness: EmulatorHarness;
let admin: ActorSession;
let employee: ActorSession;
let adminUid = '';
let employeeUid = '';
let rivalUid = '';

/** Every document this suite creates, so the flush between cases is exact. */
const suiteDocuments: string[] = [];

/**
 * Builds the Stage 11 application the way `main.ts` does, for one session.
 *
 * The repositories and the Stage 6 engine are the production classes; only the
 * `session` is narrowed to the actor's safe state, because the emulator session
 * already holds the token and the application layer must never see one.
 */
function applicationFor(session: ActorSession): ManagerApplication {
  const context: RepositoryContext = { client: session.client, onWarning: () => undefined };
  return createManagerApplication({
    session: {
      // `getSafeState`, not `getState`: the narrow port deliberately exposes no
      // token, and the emulator session already holds one in Main-only memory.
      getSafeState: () => ({
        authenticated: true,
        uid: session.uid,
        email: session.email,
        emailVerified: true,
        expirationTimeIso: '2026-06-04T09:00:00.000Z',
        displayName: session.uid === adminUid ? 'المدير' : 'موظف',
        role: session.uid === adminUid ? 'admin' : 'employee',
      }),
      signInWithEmailAndPassword: async () => {
        throw new Error('the emulator suite never signs in through the application');
      },
      signOut: () => undefined,
    },
    usersRepository: new FirestoreUsersRepository(context),
    medicinesRepository: new FirestoreMedicinesRepository(context),
    settingsRepository: new FirestoreSettingsRepository(context),
    orderRequestsRepository: new FirestoreOrderRequestsRepository(context),
    ordersRepository: new FirestoreOrdersRepository(context),

    // Stage 14: wired so the audit screen can be built, never used by these suites.

    stockLogsRepository: new FirestoreStockLogsRepository(context),
  // Stage 15: real factory, so the receipt path is buildable; these suites never call it.
  inboundStockTransactionFactory: createInboundStockTransactionFactory(session.client),
    orderProcessing: new FirestoreOrderProcessingService(
      createOrderProcessingTransactionFactory(session.client),
    ),
  });
}

/**
 * Unwraps Firestore's typed REST envelope so assertions can talk in plain
 * JavaScript. Deliberately NOT the application's mapper.
 */
function unwrap(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const typed = value as Record<string, unknown>;
  const keys = Object.keys(typed);
  if (keys.length === 1 && keys[0] !== 'fields') {
    switch (keys[0]) {
      case 'stringValue':
      case 'booleanValue':
      case 'timestampValue':
        return typed[keys[0] as string];
      case 'integerValue':
      case 'doubleValue':
        // Firestore's REST encodes every number as a STRING.
        return Number(typed[keys[0] as string]);
      case 'nullValue':
        return null;
      case 'arrayValue':
        return ((typed['arrayValue'] as { values?: unknown[] }).values ?? []).map(unwrap);
      case 'mapValue': {
        const map = (typed['mapValue'] as { fields?: Record<string, unknown> }).fields ?? {};
        return unwrap(map);
      }
      default:
        break;
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(typed)) {
    out[key] = unwrap(entry);
  }
  return out;
}

/** Reads a document back through the emulator, with no mapper in between. */
async function readRaw(session: ActorSession, path: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(harness.documentUrl(path), {
    headers: { Authorization: `Bearer ${session.idToken}` },
  });
  if (response.status === 404) {
    return null;
  }
  assert.equal(response.status, 200, `unexpected status reading ${path}: ${response.status}`);
  const body = (await response.json()) as { fields?: Record<string, unknown> };
  return (unwrap(body.fields ?? null) as Record<string, unknown> | null) ?? null;
}

/** Lists a collection the same way, so created logs and orders can be counted. */
async function listRaw(session: ActorSession, collection: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(harness.documentUrl(collection), {
    headers: { Authorization: `Bearer ${session.idToken}` },
  });
  if (response.status === 404) {
    return [];
  }
  assert.equal(response.status, 200, `unexpected status listing ${collection}: ${response.status}`);
  const body = (await response.json()) as { documents?: { fields?: Record<string, unknown> }[] };
  return (body.documents ?? []).map(
    (document) => unwrap(document.fields ?? null) as Record<string, unknown>,
  );
}

/** How many documents a collection currently holds. */
async function countRaw(session: ActorSession, collection: string): Promise<number> {
  return (await listRaw(session, collection)).length;
}

before(async () => {
  harness = new EmulatorHarness(readEmulatorEnvironment());
  adminUid = await harness.ensureAuthUser(ADMIN_EMAIL, DEMO_PASSWORD);
  employeeUid = await harness.ensureAuthUser(EMPLOYEE_EMAIL, DEMO_PASSWORD);
  rivalUid = await harness.ensureAuthUser(RIVAL_EMAIL, DEMO_PASSWORD);
  admin = await harness.openSession(ADMIN_EMAIL, DEMO_PASSWORD);
  employee = await harness.openSession(EMPLOYEE_EMAIL, DEMO_PASSWORD);

  await harness.seedUserProfile({
    uid: adminUid, name: 'المدير', employeeId: 'EMP-000',
    role: 'admin', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: employeeUid, name: 'أحمد', employeeId: 'EMP-100',
    role: 'employee', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: rivalUid, name: 'سارة', employeeId: 'EMP-200',
    role: 'employee', status: 'approved', hasException: false,
  });
  suiteDocuments.push(`users/${adminUid}`, `users/${employeeUid}`, `users/${rivalUid}`);

  // A window that is ALWAYS open, so the suite never depends on the wall clock.
  await harness.seedDocument('settings/app', {
    minDaysBetweenOrders: 0, maxDailyOrders: 500, allowFridayOrders: true,
    startTime: '00:00', endTime: '23:59', assistantId: 'EMP-000',
  });
  suiteDocuments.push('settings/app');
});

after(async () => {
  await harness.flush(suiteDocuments);
});

/** Seeds a pending request for `uid` against one medicine line. */
async function seedPendingRequest(
  id: string,
  uid: string,
  medicineId: string,
  quantity: number,
): Promise<void> {
  await harness.seedDocument(`order_requests/${id}`, {
    uid,
    items: [{ medicineId, medicineName: 'Panadol', quantity }],
    status: 'pending',
    requestDate: new Date('2026-06-03T08:00:00Z'),
  });
  suiteDocuments.push(`order_requests/${id}`);
}

/** Seeds a medicine with a known absolute stock level. */
async function seedMedicine(id: string, stock: number): Promise<void> {
  await harness.seedDocument(`medicines/${id}`, {
    name: 'Panadol', unit: 'box', stock, maxQuantity: 5, minStock: 2, outOfStock: false,
  });
  suiteDocuments.push(`medicines/${id}`);
}

describe('Stage 11 A on the emulator: the rules decide who may read the queue', () => {
  const visibilityRequestId = 's11-req-visible';

  before(async () => {
    await seedMedicine('s11-med-1', 10);
    await seedPendingRequest(visibilityRequestId, employeeUid, 's11-med-1', 1);
    await seedPendingRequest('s11-req-rival', rivalUid, 's11-med-1', 1);
  });

  it('lets the admin read the whole queue through the Stage 11 use case', async () => {
    const result = await applicationFor(admin).manager.listOrderRequests();

    assert.equal(result.ok, true);
    const ids = result.ok ? result.value.map((request) => request.id) : [];
    assert.equal(ids.includes(visibilityRequestId), true);
    assert.equal(ids.includes('s11-req-rival'), true, 'an admin sees every employee request');
  });

  it('resolves the employee name only because the admin may read users', async () => {
    const result = await applicationFor(admin).manager.listOrderRequests();
    const own = result.ok ? result.value.find((request) => request.id === visibilityRequestId) : undefined;

    // The enrichment is a `users` read, which the rules grant the admin.
    assert.equal(own?.employeeName, 'أحمد');
  });


describe('Stage 11 B on the emulator: a processed request commits W1-W5 once', () => {
  const requestId = 's11-req-success';
  let orderId = '';

  before(async () => {
    await seedMedicine('s11-med-success', 10);
    await seedPendingRequest(requestId, employeeUid, 's11-med-success', 2);
  });

  it('processes through the Stage 11 application and reports a success', async () => {
    const result = await applicationFor(admin).orderRequests.processOrderRequest(requestId);

    assert.equal(result.ok, true, 'processing is an operation the rules grant an admin');
    assert.equal(result.ok ? result.value.outcome : null, 'processed');
    orderId = result.ok ? String(result.value.orderId) : '';
    assert.equal(orderId.length > 0, true, 'the generated order id must reach the caller');
  });

  it('marks the request processed, with the actor and a SERVER timestamp', async () => {
    const request = await readRaw(admin, `order_requests/${requestId}`);

    assert.ok(request, 'the request document must survive the commit');
    assert.equal(request['status'], 'processed');
    assert.equal(request['orderId'], orderId);
    assert.equal(request['processedBy'], adminUid, 'the ADMIN identity belongs in processedBy');
    // A server timestamp is resolved by Firestore, so it arrives as a timestamp
    // value rather than as anything the client chose.
    assert.equal(typeof request['processedAt'], 'string');
    assert.equal(
      new Date(String(request['processedAt'])).getTime() > 0,
      true,
      'processedAt must be a resolvable server timestamp',
    );
  });

  it('creates exactly one order, belonging to the EMPLOYEE', async () => {
    const order = await readRaw(admin, `orders/${orderId}`);

    assert.ok(order, 'W1 must create the order document');
    assert.equal(order['userId'], employeeUid, 'the order belongs to the employee, not the admin');
    assert.deepEqual(order['items'], [
      { medicineId: 's11-med-success', medicineName: 'Panadol', quantity: 2 },
    ]);
    assert.equal(await countRaw(admin, 'orders'), 1, 'exactly one order');
  });

  it('reduces stock by the ABSOLUTE value Stage 6 wrote', async () => {
    const medicine = await readRaw(admin, 'medicines/s11-med-success');

    assert.ok(medicine);
    // Seeded at 10, two handed out. Stage 6 writes an absolute figure, so the
    // result is 8 - not a counter the client had to derive.
    assert.equal(medicine['stock'], 8);
    assert.equal(medicine['outOfStock'], false);
  });

  it('writes one stock log attributed to the EMPLOYEE', async () => {
    const logs = await listRaw(admin, 'stock_logs');

    assert.equal(logs.length, 1, 'exactly one log for a one-line request');
    const log = logs[0];
    assert.ok(log);
    assert.equal(log['medicineId'], 's11-med-success');
    assert.equal(log['quantity'], 2);
    assert.equal(log['type'], 'outward');
    assert.equal(log['orderId'], orderId);
    // A2/D3: the MOVEMENT belongs to the employee; the admin is only in
    // `processedBy`. Attributing the log to the admin would be a real defect.
    assert.equal(log['uid'], employeeUid);
    assert.equal(log['userName'], 'أحمد');
  });

  it('updates the user summary without touching the profile', async () => {

describe('Stage 11 C on the emulator: processing twice is already-processed', () => {
  it('re-attempting the same request writes NOTHING the second time', async () => {
    // Everything asserted here is a "no" - which is the entire point of the
    // outcome. Counting before and after is what makes a duplicate detectable;
    // checking only the returned kind would not be.
    const requestBefore = await readRaw(admin, 'order_requests/s11-req-success');
    const medicineBefore = await readRaw(admin, 'medicines/s11-med-success');
    const userBefore = await readRaw(admin, `users/${employeeUid}`);
    const ordersBefore = await countRaw(admin, 'orders');
    const logsBefore = await countRaw(admin, 'stock_logs');

    const result = await applicationFor(admin).orderRequests.processOrderRequest('s11-req-success');

    assert.equal(result.ok, true, 'an already-processed request is not an error');
    assert.equal(result.ok ? result.value.outcome : null, 'already-processed');
    assert.equal(result.ok ? result.value.orderId : 'x', null, 'no order may be claimed');

    assert.equal(await countRaw(admin, 'orders'), ordersBefore, 'no second order');
    assert.equal(await countRaw(admin, 'stock_logs'), logsBefore, 'no second stock log');
    assert.deepEqual(
      await readRaw(admin, 'medicines/s11-med-success'),
      medicineBefore,
      'no additional stock deduction',
    );
    assert.deepEqual(
      await readRaw(admin, `users/${employeeUid}`),
      userBefore,
      'no second user-summary mutation',
    );
    assert.deepEqual(
      await readRaw(admin, 'order_requests/s11-req-success'),
      requestBefore,
      'the existing processed request must not change',
    );
  });
});

describe('Stage 11 D on the emulator: a business refusal commits only the failed marker', () => {
  const requestId = 's11-req-no-stock';

  before(async () => {
    await seedMedicine('s11-med-low', 1);
    await seedPendingRequest(requestId, employeeUid, 's11-med-low', 4);
  });

  it('refuses insufficient stock as a REJECTED outcome, not a failure', async () => {
    // The rule itself is NOT reimplemented here: the fixture simply asks for
    // more than exists, and the existing Stage 6 engine decides.
    const result = await applicationFor(admin).orderRequests.processOrderRequest(requestId);

    assert.equal(result.ok, true, 'a committed refusal is a completed unit of work');
    assert.equal(result.ok ? result.value.outcome : null, 'rejected');
    assert.equal(
      result.ok ? String(result.value.reason).length > 0 : false,
      true,
      "the engine's own reason must reach the caller",
    );
    assert.equal(result.ok ? result.value.orderId : 'x', null);
  });

  it('marks the request failed and creates nothing else', async () => {
    const request = await readRaw(admin, `order_requests/${requestId}`);

    assert.ok(request);
    assert.equal(request['status'], 'failed');
    assert.equal(typeof request['error'], 'string');
    // The fixture never had an `orderId`, and the failed-marker mask does not
    // write one, so the field must be ABSENT (or explicitly null) - never a
    // generated id. A refused request creates no order.
    assert.equal(
      request['orderId'] === undefined || request['orderId'] === null,
      true,
      `a refused request must not record an order id, found: ${String(request['orderId'])}`,
    );
    assert.equal(await countRaw(admin, 'stock_logs'), 1, 'still only the success log from section B');
    // The medicine is untouched: seeded at 1, asked for 4, refused entirely.
    const medicine = await readRaw(admin, 'medicines/s11-med-low');

describe('Stage 11 E on the emulator: the rules refuse an employee, atomically', () => {
  const requestId = 's11-req-denied';

  before(async () => {
    await seedMedicine('s11-med-denied', 10);
    await seedPendingRequest(requestId, employeeUid, 's11-med-denied', 1);
  });

  it('answers AUTHORIZATION_DENIED when an employee attempts processing', async () => {
    const result = await applicationFor(employee).orderRequests.processOrderRequest(requestId);

    assert.equal(result.ok, false, 'the rules forbid a non-admin from updating a request');
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
  });

  it('leaves NO partial write behind', async () => {
    // A partially-applied transaction is the failure mode a rules denial must
    // never produce, so every side effect is counted rather than assumed.
    const request = await readRaw(admin, `order_requests/${requestId}`);
    assert.equal(request?.['status'], 'pending', 'the request must be unchanged');
    // The seeded fixture has no `processedBy` and no `orderId`, and a denial
    // writes nothing at all, so both must still be absent - or explicitly null.
    assert.equal(
      request?.['processedBy'] === undefined || request?.['processedBy'] === null,
      true,
      'no actor may be recorded',
    );
    assert.equal(
      request?.['orderId'] === undefined || request?.['orderId'] === null,
      true,
      'no order id may be recorded',
    );

    const medicine = await readRaw(admin, 'medicines/s11-med-denied');
    assert.equal(medicine?.['stock'], 10, 'no stock may be deducted');
    assert.equal(await countRaw(admin, 'stock_logs'), 1, 'no stock log may be written');
    assert.equal(await countRaw(admin, 'orders'), 1, 'no order may be created');
  });

  it('never leaks the server message or the document path', async () => {
    const result = await applicationFor(employee).orderRequests.processOrderRequest(requestId);
    const serialized = JSON.stringify(result);

    assert.equal(serialized.includes(requestId), false);
    assert.equal(serialized.toLowerCase().includes('permission'), false);
  });
});

describe('Stage 11 F on the emulator: the Android rules are unmodified', () => {
  /**
   * The fingerprint established before Stage 11 existed. It is pinned here so
   * that ANY edit to the rules - by this stage or a later one - fails loudly
   * instead of silently changing the security posture the suite just proved.
   *
   * Stored in UPPER CASE, matching the recorded value. `digest('hex')` emits
   * lower case, so the helper folds its output to upper case instead. Case
   * carries no meaning for a hex digest, so folding it cannot weaken the
   * comparison in any way - the 64 characters must match exactly.
   */
  const ESTABLISHED_RULES_SHA256 =
    '1FA3C6076BBA8DA4F0E10138B9E61E62257943C3C689B01964F4EAB402CDC63B';

  function sha256Of(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
  }

  it('matches the established fingerprint exactly', () => {
    const projectRoot = join(__dirname, '..', '..', '..');
    const labRules = join(projectRoot, 'emulator-lab', 'firestore.rules');

    assert.equal(existsSync(labRules), true, 'the lab rules copy must exist');
    assert.equal(sha256Of(labRules), ESTABLISHED_RULES_SHA256);
  });

  it('the lab copy is byte-identical to the authoritative Android rules', () => {
    const projectRoot = join(__dirname, '..', '..', '..');
    const labRules = join(projectRoot, 'emulator-lab', 'firestore.rules');
    const androidRules = process.env['DRUG_MANAGER_ANDROID_RULES_PATH']
      ?? join('E:', 'programs and applications', 'mobile', 'drug', 'firestore.rules');

    // The suite is only meaningful if the emulator ran the REAL Android rules,
    // not an edited copy. When the Android file is absent (a machine without the
    // mobile project) the comparison is skipped rather than faked.
    if (!existsSync(androidRules)) {
      return;
    }
    assert.equal(sha256Of(labRules), sha256Of(androidRules), 'the lab copy must be the Android rules');
    assert.equal(sha256Of(androidRules), ESTABLISHED_RULES_SHA256);
  });
});
    assert.equal(medicine?.['stock'], 1, 'a refusal must not deduct stock');
  });

  it('leaves the employee summary pointing at the order that DID succeed', async () => {
    const user = await readRaw(admin, `users/${employeeUid}`);

    assert.ok(user);
    // The refusal must not overwrite the summary written by section B.
    assert.equal(user['lastOrderStatus'], 'pending');
    assert.equal(user['lastOrderId'] !== null, true);
  });
});
    const user = await readRaw(admin, `users/${employeeUid}`);

    assert.ok(user);
    assert.equal(user['lastOrderId'], orderId);
    assert.equal(user['lastOrderStatus'], 'pending', 'the established Stage 6 summary value');
    assert.equal(user['hasException'], false);
    assert.equal(user['lastOrderIsException'], false);
    assert.equal(typeof user['lastOrderDate'], 'string');
    assert.equal(typeof user['lastOrderMonthYear'], 'string');
    // The mask must not have clobbered the profile fields.
    assert.equal(user['name'], 'أحمد');
    assert.equal(user['employeeId'], 'EMP-100');
    assert.equal(user['role'], 'employee');
    assert.equal(user['status'], 'approved');
  });
});
  it('refuses the queue to an EMPLOYEE, because the rules do not permit it', async () => {
    // `order_requests` read is `isAdmin() || owner`. The Stage 11 queue is a
    // status query that cannot prove ownership, so the emulator refuses it.
    // Nothing in this file decides that; the rules do.
    const result = await applicationFor(employee).manager.listOrderRequests();

    assert.equal(result.ok, false, 'an employee must not receive the whole queue');
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
  });

  it('lets an employee read ONLY their own single request', async () => {
    const own = await applicationFor(employee).orderRequests.getOrderRequest(visibilityRequestId);
    assert.equal(own.ok, true, 'the rules grant an employee their own request');

    const other = await applicationFor(employee).orderRequests.getOrderRequest('s11-req-rival');
    assert.equal(other.ok, false, "an employee must not read another employee's request");
    assert.equal(!other.ok ? other.error.code : null, 'AUTHORIZATION_DENIED');
  });

  it('never leaks the refused document path to the renderer', async () => {
    const other = await applicationFor(employee).orderRequests.getOrderRequest('s11-req-rival');

    assert.equal(JSON.stringify(other).includes('s11-req-rival'), false);
  });
});