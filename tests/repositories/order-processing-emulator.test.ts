/**
 * Stage 6 - the order-processing transaction against the REAL Firestore emulator.
 *
 * Everything below travels through the application's own `FirestoreRestClient`
 * and the real Android `firestore.rules`, so what is proven here is not "the
 * service called the right methods" but "Firestore accepted the W1-W5 commit,
 * applied exactly the masked fields, and resolved the server timestamp".
 *
 * No production project is involved: the project id is a "demo-" id that
 * Firebase can only resolve locally.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { DomainError } from '../../electron/domain/errors';
import type { OrderProcessingActor } from '../../electron/services/order-processing.service';
import { FirestoreOrderProcessingService } from '../../electron/services/order-processing.service';
import { createOrderProcessingTransactionFactory } from '../../electron/repositories/firestore/order-processing-transaction-factory';
import type {
  FirestoreDocument,
  FirestoreWriteRequest,
} from '../../electron/services/firestore-rest';
import {
  DEMO_PASSWORD,
  EmulatorHarness,
  readEmulatorEnvironment,
  type ActorSession,
} from '../helpers/firestore-emulator-harness';

const ADMIN_EMAIL = 'admin.stage6@drug-manager.demo';
const EMPLOYEE_EMAIL = 'employee.stage6@drug-manager.demo';
/** A second employee, used only by the concurrency test. */
const RIVAL_EMAIL = 'rival.stage6@drug-manager.demo';
/** A third employee: the writer that is expected to lose the race. */
const LOSER_EMAIL = 'loser.stage6@drug-manager.demo';

let harness: EmulatorHarness;
let admin: ActorSession;
let employee: ActorSession;
let adminUid = '';
let employeeUid = '';

/** Every document this suite creates, so the flush between cases is exact. */
const suiteDocuments: string[] = [];

function serviceFor(session: ActorSession, maxAttempts?: number): FirestoreOrderProcessingService {
  return new FirestoreOrderProcessingService(
    createOrderProcessingTransactionFactory(session.client),
    maxAttempts === undefined ? {} : { maxTransactionAttempts: maxAttempts },
  );
}

function actor(uid: string, name: string): OrderProcessingActor {
  return { uid, name };
}

/**
 * Unwraps Firestore's typed REST envelope (`{ stringValue: 'x' }`) so the
 * assertions can talk about plain JavaScript values. Nested maps and arrays are
 * resolved recursively, which is what makes the `items` assertion meaningful.
 *
 * This is deliberately NOT the application's mapper: the test must observe what
 * Firestore actually stored, not what a mapper decided to make of it.
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
      // Firestore's REST API encodes every number as a STRING. Leaving it as
      // one would make every numeric assertion a lie, so it is converted here
      // and nowhere else: the production codec is untouched.
      case 'integerValue':
      case 'doubleValue':
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

/** Reads a document back through the emulator, without any mapper in between. */
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

/** Lists a collection the same way, so the created stock logs can be inspected. */
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

before(async () => {
  harness = new EmulatorHarness(readEmulatorEnvironment());
  adminUid = await harness.ensureAuthUser(ADMIN_EMAIL, DEMO_PASSWORD);
  employeeUid = await harness.ensureAuthUser(EMPLOYEE_EMAIL, DEMO_PASSWORD);
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
  suiteDocuments.push(`users/${adminUid}`, `users/${employeeUid}`);

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

/**
 * A partial view of `FirestoreRestClient`, holding ONLY the methods the Stage 6
 * adapter actually calls. Declaring the seam this narrowly is what lets the
 * concurrency tests substitute a wrapper without reaching into private state or
 * reconstructing a whole client - and it documents the dependency exactly.
 */
interface TransactionClientView {
  beginTransaction(): Promise<string>;
  batchGetDocuments(paths: readonly string[], tx?: string): Promise<readonly (FirestoreDocument | null)[]>;
  commitWrites(writes: readonly FirestoreWriteRequest[], tx?: string): Promise<unknown>;
  rollback(tx: string): Promise<void>;
}

describe('Stage 6 on the emulator: the W1-W5 commit is atomic', () => {
  const requestId = 's6-req-success';
  let orderId = '';

  before(async () => {
    await harness.seedDocument(`order_requests/${requestId}`, {
      uid: employeeUid,
      items: [{ medicineId: 's6-med-1', medicineName: 'Panadol', quantity: 2 }],
      status: 'pending',
      requestDate: new Date('2026-06-03T08:00:00Z'),
    });
    suiteDocuments.push(`order_requests/${requestId}`);
    await harness.seedDocument('medicines/s6-med-1', {
      name: 'Panadol', unit: 'box', stock: 10, maxQuantity: 5, minStock: 2, outOfStock: false,
    });
    suiteDocuments.push('medicines/s6-med-1');
  });

  it('applies exactly the five writes, with the masked fields only', async () => {
    const outcome = await serviceFor(admin).process(requestId, actor(adminUid, 'المدير'));

    assert.equal(outcome.result.kind, 'success');

    // W5: the request is marked processed with the generated order id.
    const request = await readRaw(admin, `order_requests/${requestId}`);
    assert.ok(request, 'the request document must survive');
    assert.equal(request['status'], 'processed');
    assert.equal(request['processedBy'], adminUid);
    orderId = String(request['orderId']);
    assert.ok(orderId.length > 0, 'the order id is generated and written back');

    // W1: the order itself. The wire names are A2's, not the domain's.
    const order = await readRaw(admin, `orders/${orderId}`);
    assert.ok(order, 'W1 must create the order document');
    assert.deepEqual(order['items'], [
      { medicineId: 's6-med-1', medicineName: 'Panadol', quantity: 2 },
    ]);
    assert.equal(order['userId'], employeeUid, 'the order belongs to the EMPLOYEE');
    assert.equal(order['userName'], 'أحمد');
    assert.equal(order['status'], 'pending');
    assert.equal(order['requestId'], requestId);
    assert.equal(order['isExceptionOrder'], false);
    assert.equal(typeof order['date'], 'string');
    assert.equal(typeof order['monthYear'], 'string');
    suiteDocuments.push(`orders/${orderId}`);


    // W2: the ABSOLUTE new stock (10 - 2 = 8), written with a mask.
    const medicine = await readRaw(admin, 'medicines/s6-med-1');
    assert.ok(medicine);
    assert.equal(medicine['stock'], 8);
    // The mask must not have disturbed the other medicine fields.
    assert.equal(medicine['name'], 'Panadol');
    assert.equal(medicine['maxQuantity'], 5);
    assert.equal(medicine['minStock'], 2);
    assert.equal(medicine['outOfStock'], false);

    // W3: an OUTWARD stock log, attributed to the EMPLOYEE, not the admin.
    const logs = await listRaw(admin, 'stock_logs');
    assert.equal(logs.length, 1, 'W3 writes exactly one log for a one-line request');
    const log = logs[0];
    assert.ok(log);
    assert.equal(log['medicineId'], 's6-med-1');
    assert.equal(log['medicineName'], 'Panadol');
    assert.equal(log['quantity'], 2);
    // A2 records the movement as OUTWARD, and there is no server timestamp on
    // a log: the `date` is the order's own date, not the commit instant.
    assert.equal(log['type'], 'outward');
    assert.equal(log['orderId'], orderId);
    // A2 attributes the movement to the employee who received the medicine
    // (D3): the admin identity belongs only in `processedBy`.
    assert.equal(log['uid'], employeeUid);
    assert.equal(log['userName'], 'أحمد');

    // W4: the user summary, written with a mask.
    const user = await readRaw(admin, `users/${employeeUid}`);
    assert.ok(user);
    assert.equal(user['lastOrderStatus'], 'pending');
    assert.equal(user['hasException'], false);
    assert.equal(user['lastOrderIsException'], false);
    assert.equal(user['lastOrderId'], orderId);
    assert.equal(typeof user['lastOrderDate'], 'string');
    assert.equal(typeof user['lastOrderMonthYear'], 'string');
    // The mask must not have clobbered the profile fields.
    assert.equal(user['name'], 'أحمد');
    assert.equal(user['employeeId'], 'EMP-100');
    assert.equal(user['role'], 'employee');
    assert.equal(user['status'], 'approved');
  });
});

describe('Stage 6 on the emulator: refusals are committed, denials are not', () => {
  it('marks a malformed request failed and writes nothing else', async () => {
    const requestId = 's6-req-malformed';
    suiteDocuments.push(`order_requests/${requestId}`);
    // `items` is not an array: the strict mapper must reject it.
    await harness.seedDocument(`order_requests/${requestId}`, {
      uid: employeeUid, items: 'not-an-array', status: 'pending',
      requestDate: new Date('2026-06-03T08:00:00Z'),
    });
    const stockBefore = await readRaw(admin, 'medicines/s6-med-1');

    const outcome = await serviceFor(admin).process(requestId, actor(adminUid, 'المدير'));

    assert.equal(outcome.result.kind, 'business-validation-failure');
    const request = await readRaw(admin, `order_requests/${requestId}`);
    assert.ok(request);
    assert.equal(request['status'], 'failed');
    // A2's own field name is `error`, and the mask must not invent a new one.
    assert.equal(typeof request['error'], 'string');
    // The technical field path stays out of the employee-facing reason.
    assert.ok(!String(request['error']).includes('items'));
    // ...and the stock did not move.
    assert.deepEqual(await readRaw(admin, 'medicines/s6-med-1'), stockBefore);
  });

  it('refuses insufficient stock, committing only the failed marker', async () => {
    const requestId = 's6-req-no-stock';
    suiteDocuments.push(`order_requests/${requestId}`);
    await harness.seedDocument('medicines/s6-med-low', {
      name: 'Rare', unit: 'box', stock: 1, maxQuantity: 9, minStock: 1, outOfStock: false,
    });
    suiteDocuments.push('medicines/s6-med-low');
    await harness.seedDocument(`order_requests/${requestId}`, {
      uid: employeeUid,
      items: [{ medicineId: 's6-med-low', medicineName: 'Rare', quantity: 4 }],
      status: 'pending', requestDate: new Date('2026-06-03T08:00:00Z'),
    });

    const outcome = await serviceFor(admin).process(requestId, actor(adminUid, 'المدير'));

    assert.equal(outcome.result.kind, 'business-validation-failure');
    const request = await readRaw(admin, `order_requests/${requestId}`);
    assert.equal(request?.['status'], 'failed');
    // A refusal must never write a negative stock value.
    const medicine = await readRaw(admin, 'medicines/s6-med-low');
    assert.equal(medicine?.['stock'], 1, 'the stock is untouched, never 1 - 4');
  });

  it('treats an already-processed request as a zero-write outcome', async () => {
    const requestId = 's6-req-processed';
    suiteDocuments.push(`order_requests/${requestId}`);
    await harness.seedDocument(`order_requests/${requestId}`, {
      uid: employeeUid,
      items: [{ medicineId: 's6-med-1', medicineName: 'Panadol', quantity: 1 }],
      status: 'processed', orderId: 's6-order-existing', processedBy: adminUid,
      processedAt: new Date('2026-06-03T08:01:00Z'),
    });
    // The order it points at must survive: proof that nothing was rewritten.
    await harness.seedDocument('orders/s6-order-existing', {
      uid: employeeUid, items: [{ medicineId: 's6-med-1', medicineName: 'Panadol', quantity: 1 }],
      processedBy: adminUid, processedAt: new Date('2026-06-03T08:01:00Z'),
    });
    suiteDocuments.push('orders/s6-order-existing');
    const stockBefore = await readRaw(admin, 'medicines/s6-med-1');
    const logsBefore = await listRaw(admin, 'stock_logs');

    const outcome = await serviceFor(admin).process(requestId, actor(adminUid, 'المدير'));

    assert.equal(outcome.result.kind, 'already-processed');
    assert.deepEqual(await readRaw(admin, 'medicines/s6-med-1'), stockBefore, 'stock is bit-identical');
    assert.equal((await listRaw(admin, 'stock_logs')).length, logsBefore.length, 'no new log');
    assert.equal((await readRaw(admin, 'orders/s6-order-existing'))?.['processedBy'], adminUid);
  });

  it('propagates a 403 from the rules without fabricating a verdict', async () => {
    const requestId = 's6-req-forbidden';
    suiteDocuments.push(`order_requests/${requestId}`);
    await harness.seedDocument(`order_requests/${requestId}`, {
      uid: employeeUid,
      items: [{ medicineId: 's6-med-1', medicineName: 'Panadol', quantity: 1 }],
      status: 'pending', requestDate: new Date('2026-06-03T08:00:00Z'),
    });

    // The EMPLOYEE may not process requests: that is a rules denial (403).
    await assert.rejects(
      () => serviceFor(employee).process(requestId, actor(employeeUid, 'أحمد')),
      (error: unknown) => {
        assert.ok(error instanceof DomainError, 'a denial must surface as a DomainError');
        assert.equal(error.kind, 'NOT_AUTHORIZED');
        return true;
      },
    );

    // A denial is not a business verdict, so the request stays PENDING.
    const request = await readRaw(admin, `order_requests/${requestId}`);
    assert.ok(request);
    assert.equal(request['status'], 'pending', 'a rules denial must not mark the request failed');
  });
});

describe('Stage 6 on the emulator: optimistic concurrency is real', () => {
  it('serialises two real writers: one is ABORTED, retries from R1, and stock lands on 13', async () => {
    const medicineId = 's6-med-race';
    const requestIdA = 's6-req-race-a';
    const rivalRequest = 's6-req-rival';
    suiteDocuments.push(
      `order_requests/${requestIdA}`, `order_requests/${rivalRequest}`, `medicines/${medicineId}`,
    );

    await harness.seedDocument(`medicines/${medicineId}`, {
      name: 'Racey', unit: 'box', stock: 20, maxQuantity: 9, minStock: 1, outOfStock: false,
    });

    // TWO INDEPENDENT EMPLOYEES, one medicine. A2 allows one order per employee
    // per month, so a second request from the same user would be REFUSED on
    // eligibility - a correct verdict that would prove nothing about contention.
    // What the two writers share is the MEDICINE, which is exactly the resource
    // that has to serialise.
    const rivalUid = await harness.ensureAuthUser(RIVAL_EMAIL, DEMO_PASSWORD);
    await harness.seedUserProfile({
      uid: rivalUid, name: 'Sami', employeeId: 'EMP-101',
      role: 'employee', status: 'approved', hasException: false,
    });
    suiteDocuments.push(`users/${rivalUid}`);
    await harness.seedDocument(`order_requests/${rivalRequest}`, {
      uid: rivalUid,
      items: [{ medicineId: medicineId, medicineName: 'Racey', quantity: 3 }],
      status: 'pending', requestDate: new Date('2026-06-04T08:00:00Z'),
    });

    const loserUid = await harness.ensureAuthUser(LOSER_EMAIL, DEMO_PASSWORD);
    await harness.seedUserProfile({
      uid: loserUid, name: 'Rayan', employeeId: 'EMP-102',
      role: 'employee', status: 'approved', hasException: false,
    });
    suiteDocuments.push(`users/${loserUid}`);
    await harness.seedDocument(`order_requests/${requestIdA}`, {
      uid: loserUid,
      items: [{ medicineId: medicineId, medicineName: 'Racey', quantity: 4 }],
      status: 'pending', requestDate: new Date('2026-06-03T08:00:00Z'),
    });

    // BOTH writers are ordinary, fully transactional services started together.
    // Nothing is stubbed and no commit is intercepted: the overlap is real, so
    // whichever one loses is aborted by the FIRESTORE EMULATOR itself and only
    // then re-reads from R1.
    //
    // An earlier version of this test let a "rival" commit from inside the
    // loser's `commitWrites` instead. That cannot work, and the reason is worth
    // keeping: Firestore locks every document a transaction has read until that
    // transaction ends, so a competing write - transactional or not - is
    // rejected with ABORTED before it can land. Contention therefore has to come
    // from two real transactions in flight, which is what this is.
    const client = admin.client;
    let initialMedicineReads = 0;
    let releaseInitialMedicineReads: (() => void) | undefined;
    const bothInitialMedicineReads = new Promise<void>((resolve) => {
      releaseInitialMedicineReads = resolve;
    });
    const synchronizedClient: TransactionClientView = {
      beginTransaction: client.beginTransaction.bind(client),
      batchGetDocuments: async (
        paths: readonly string[],
        transaction?: string,
      ): Promise<readonly (FirestoreDocument | null)[]> => {
        const documents = await client.batchGetDocuments(paths, transaction);
        if (
          transaction !== undefined
          && paths.includes(`medicines/${medicineId}`)
          && initialMedicineReads < 2
        ) {
          initialMedicineReads += 1;
          if (initialMedicineReads === 2) {
            releaseInitialMedicineReads?.();
          }
          await bothInitialMedicineReads;
        }
        return documents;
      },
      commitWrites: client.commitWrites.bind(client),
      rollback: client.rollback.bind(client),
    };
    const transactionFactory = createOrderProcessingTransactionFactory(synchronizedClient);

    const [a, b] = await Promise.all([
      new FirestoreOrderProcessingService(transactionFactory)
        .process(requestIdA, actor(adminUid, 'admin')),
      new FirestoreOrderProcessingService(transactionFactory)
        .process(rivalRequest, actor(adminUid, 'admin')),
    ]);

    // Both orders are honoured; neither is silently dropped.
    assert.equal(
      a.result.kind, 'success',
      `A must succeed, got ${JSON.stringify(a.result)} after ${a.attempts} attempt(s)`,
    );
    assert.equal(
      b.result.kind, 'success',
      `B must succeed, got ${JSON.stringify(b.result)} after ${b.attempts} attempt(s)`,
    );
    // One of them must have been aborted and retried from R1. This is the claim
    // that makes the test a concurrency test rather than a lucky serialisation.
    assert.ok(
      Math.max(a.attempts, b.attempts) >= 2,
      `a real ABORTED must have forced a retry; A=${a.attempts} B=${b.attempts}`,
    );

    // The stock moved ONCE for each order: 20 - 3 - 4 = 13, not 9 and not 16.
    const medicine = await readRaw(admin, `medicines/${medicineId}`);
    const first = await readRaw(admin, `order_requests/${requestIdA}`);
    const second = await readRaw(admin, `order_requests/${rivalRequest}`);
    const raceLogs = (await listRaw(admin, 'stock_logs'))
      .filter((l) => l['medicineId'] === medicineId)
      .map((l) => l['quantity']);
    assert.equal(
      medicine?.['stock'],
      13,
      `both decrements must be applied exactly once; ` +
      `A(${requestIdA})=${JSON.stringify(first)} ` +
      `B(${rivalRequest})=${JSON.stringify(second)} ` +
      `logs=${JSON.stringify(raceLogs)}`,
    );
    // Exactly one log per order: a retried attempt must not double-log.
    assert.deepEqual(raceLogs.slice().sort((x, y) => Number(x) - Number(y)), [3, 4]);

    // And both requests ended processed, each with its own order.
    assert.equal(first?.['status'], 'processed');
    assert.equal(second?.['status'], 'processed');
    assert.notEqual(first?.['orderId'], second?.['orderId'], 'two distinct orders');
    suiteDocuments.push(`orders/${String(first?.['orderId'])}`, `orders/${String(second?.['orderId'])}`);
  });
  it('stops after the bounded budget when the conflict never clears', async () => {
    const requestId = 's6-req-endless';
    suiteDocuments.push(`order_requests/${requestId}`);
    await harness.seedDocument(`order_requests/${requestId}`, {
      uid: employeeUid,
      items: [{ medicineId: 's6-med-1', medicineName: 'Panadol', quantity: 1 }],
      status: 'pending', requestDate: new Date('2026-06-05T08:00:00Z'),
    });

    // Every attempt is sabotaged, so the loop must give up rather than spin.
    // The same explicit-spread approach as above: a Proxy here would silently
    // fail to intercept the inherited method, and the "bounded" claim would then
    // be proven against a client that never actually conflicted.
    const client = admin.client;
    let commits = 0;
    let rollbacks = 0;
    const alwaysConflicting: TransactionClientView = {
      beginTransaction: client.beginTransaction.bind(client),
      batchGetDocuments: client.batchGetDocuments.bind(client),
      commitWrites: async (): Promise<unknown> => {
        commits += 1;
        // Exactly what Firestore does on a conflict: the commit is rejected and
        // the handle must then be released by a rollback.
        throw new DomainError('ABORTED', 'injected conflict');
      },
      rollback: async (transaction: string): Promise<void> => {
        rollbacks += 1;
        await client.rollback(transaction);
      },
    };

    const service = new FirestoreOrderProcessingService(
      createOrderProcessingTransactionFactory(alwaysConflicting),
      { maxTransactionAttempts: 2 },
    );

    await assert.rejects(
      () => service.process(requestId, actor(adminUid, 'المدير')),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        // The conflict must survive as ABORTED, NOT be masked by the INVALID_INPUT
        // a premature "finished" flag used to produce.
        assert.equal(error.kind, 'ABORTED');
        return true;
      },
    );
    assert.equal(commits, 2, 'exactly the budget, no unbounded retry loop');
    assert.equal(rollbacks, 2, 'each aborted attempt released its transaction handle');
    // Nothing was committed, so the request is still PENDING.
    const request = await readRaw(admin, `order_requests/${requestId}`);
    assert.equal(request?.['status'], 'pending');
  });
});

