import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError, MalformedDataError } from '../../electron/domain/errors';
import type { AppSettings, Medicine, OrderRequest, User } from '../../electron/domain/models';
import type {
  NewOrder,
  NewStockLog,
  OrderProcessingTransaction,
  TransactionId,
  UserOrderSummaryWrite,
} from '../../electron/repositories/contracts/common';
import {
  FirestoreOrderProcessingTransaction,
  type FirestoreOrderProcessingTransactionClient,
} from '../../electron/repositories/firestore/order-processing-transaction';
import type { FirestoreDocument } from '../../electron/services/firestore-rest';
import {
  DEFAULT_MAX_TRANSACTION_ATTEMPTS,
  ERROR_MALFORMED_REQUEST,
  FirestoreOrderProcessingService,
} from '../../electron/services/order-processing.service';
import { FirestoreTimestamp, SERVER_TIMESTAMP, isServerTimestamp } from '../../electron/services/firestore-codec';
import {
  MEDICINE_STOCK_MASK,
  USER_SUMMARY_MASK,
  mapMedicineStockWrite,
  mapNewOrderWrite,
  mapNewStockLogWrite,
  mapRequestFailedWrite,
  mapRequestProcessedWrite,
} from '../../electron/repositories/firestore/mappers/order-write-mapper';

/**
 * Stage 6 T4 - the write mappers.
 *
 * These assertions are about SHAPE, not business outcomes: which fields a write
 * carries, which fields its mask names, and which of them must NEVER appear.
 * The shape is the contract the emulator and A2 both depend on, so it is pinned
 * here once instead of being re-derived by every suite.
 */

const ORDER: NewOrder = {
  userId: 'uid-emp',
  userName: 'Nour',
  items: [{ medicineId: 'med-1', medicineName: 'Panadol', quantity: 2 }],
  date: FirestoreTimestamp.fromDate(new Date('2026-06-03T08:00:00Z')),
  monthYear: '06-2026',
  isExceptionOrder: false,
  requestId: 'req-1',
} as unknown as NewOrder;

const LOG: NewStockLog = {
  uid: 'uid-emp',
  medicineId: 'med-1',
  medicineName: 'Panadol',
  quantity: 2,
  type: 'outward',
  date: FirestoreTimestamp.fromDate(new Date('2026-06-03T08:00:00Z')),
  // The domain calls it `label`; only the wire calls it `userName` (D10).
  label: 'Nour',
  requestId: 'req-1',
  orderId: 'order-1',
} as unknown as NewStockLog;

describe('Stage 6: W1 the order write', () => {
  it('creates the order with the generated id and A2 field names', () => {
    const write = mapNewOrderWrite(ORDER, 'order-1');
    assert.equal(write.kind, 'create');
    assert.equal(write.relativePath, 'orders/order-1');
    // A2 stores `status: 'pending'`, never 'processed'.
    assert.equal(write.data['status'], 'pending');
    assert.equal(write.data['userId'], 'uid-emp');
    assert.equal(write.data['userName'], 'Nour');
    assert.equal(write.data['requestId'], 'req-1');
    assert.equal(write.data['isExceptionOrder'], false);
    assert.equal(write.data['monthYear'], '06-2026');
  });

  it('carries no mask: a create must never partially write', () => {
    assert.equal(mapNewOrderWrite(ORDER, 'order-1').updateMaskPaths, undefined);
  });

  it('copies only the three item fields, so no domain extra leaks to the wire', () => {
    const write = mapNewOrderWrite(ORDER, 'order-1');
    const items = write.data['items'] as Record<string, unknown>[];
    assert.equal(items.length, 1);
    assert.deepEqual(Object.keys(items[0] ?? {}).sort(), ['medicineId', 'medicineName', 'quantity']);
  });
});

describe('Stage 6: W3 the outward stock-log write', () => {
  it('maps the domain `label` onto the wire `userName`, and nothing else', () => {
    const write = mapNewStockLogWrite(LOG, 'log-1');
    assert.equal(write.relativePath, 'stock_logs/log-1');
    assert.equal(write.data['userName'], 'Nour');
    assert.equal(write.data['uid'], 'uid-emp', 'the EMPLOYEE, per D3');
    assert.equal(write.data['type'], 'outward');
    assert.equal(write.data['orderId'], 'order-1');
    // The rename is the ONLY transformation: `label` must not survive as a
    // second, redundant field in the document.
    assert.equal('label' in write.data, false);
  });

  it('never writes an admin identity into a movement log', () => {
    const write = mapNewStockLogWrite(LOG, 'log-1');
    assert.equal('processedBy' in write.data, false);
    assert.equal('adminUid' in write.data, false);
  });
});

describe('Stage 6: W2 the absolute stock write', () => {
  it('masks exactly one field', () => {
    assert.deepEqual(MEDICINE_STOCK_MASK, ['stock']);
    const write = mapMedicineStockWrite('med-1', 8);
    assert.equal(write.kind, 'update');
    assert.equal(write.relativePath, 'medicines/med-1');
    assert.equal(write.data['stock'], 8);
    assert.deepEqual(write.updateMaskPaths, ['stock']);
  });

  it('writes the ABSOLUTE value, never an increment transform', () => {
    const write = mapMedicineStockWrite('med-1', 8);
    // An increment would need a transform A2 never used and the REST API cannot
    // express; the absolute value is recomputed from the transactional read.
    assert.equal(isServerTimestamp(write.data['stock']), false);
    assert.equal(write.data['stock'], 8);
  });
});

describe('Stage 6: W5 the request markers', () => {
  it('marks processed with a server timestamp and a four-field mask', () => {
    const write = mapRequestProcessedWrite('req-1', 'order-1', 'uid-admin');
    assert.equal(write.kind, 'update');
    assert.equal(write.relativePath, 'order_requests/req-1');
    assert.equal(write.data['status'], 'processed');
    assert.equal(write.data['orderId'], 'order-1');
    assert.equal(write.data['processedBy'], 'uid-admin');
    assert.ok(isServerTimestamp(write.data['processedAt']), "the clock must be Firestore's");
    assert.deepEqual(write.updateMaskPaths, ['status', 'orderId', 'processedBy', 'processedAt']);
  });

  it('marks failed with `error`, and never touches `orderId`', () => {
    const write = mapRequestFailedWrite('req-1', 'Insufficient stock', 'uid-admin');
    assert.equal(write.data['status'], 'failed');
    assert.equal(write.data['error'], 'Insufficient stock');
    assert.ok(isServerTimestamp(write.data['processedAt']));
    // No order was created, so `orderId` must be neither written nor masked -
    // otherwise a stale id from an earlier partial run would survive.
    assert.equal('orderId' in write.data, false);
    assert.equal(write.updateMaskPaths?.includes('orderId'), false);
    assert.deepEqual(write.updateMaskPaths, ['status', 'error', 'processedBy', 'processedAt']);
  });
});

describe('Stage 6: W4 the user summary mask', () => {
  it('includes hasException, because A2 CONSUMES the exception', () => {
    // Dropping this field would keep an exception alive after it was spent;
    // omitting the guard instead would make the Stage 5A validator reject the
    // whole write.
    assert.ok(USER_SUMMARY_MASK.includes('hasException'));
  });

  it('touches only the six summary fields, never the profile', () => {
    assert.deepEqual(USER_SUMMARY_MASK, [
      'hasException',
      'lastOrderId',
      'lastOrderDate',
      'lastOrderMonthYear',
      'lastOrderStatus',
      'lastOrderIsException',
    ]);
    for (const forbidden of ['name', 'role', 'status', 'employeeId', 'uid']) {
      assert.equal(USER_SUMMARY_MASK.includes(forbidden), false, `${forbidden} must not be masked`);
    }
  });
});

describe('Stage 6: the server timestamp is a transform, not a local clock', () => {
  it('is the marker itself rather than a literal instant', () => {
    const write = mapRequestProcessedWrite('req-1', 'order-1', 'uid-admin');
    assert.deepEqual(write.data['processedAt'], SERVER_TIMESTAMP);
  });
});

/**
 * Stage 6 T3 - the processing service against a FAKE transaction.
 *
 * The fake records every call in order, which is what lets this file assert the
 * three things that are invisible on a real emulator:
 *
 *  - the READ phase really precedes the WRITE phase (A1 requires it);
 *  - `AlreadyProcessed` produces ZERO writes;
 *  - an `ABORTED` is retried from R1 and the budget is BOUNDED.
 *
 * The write SHAPES themselves (masks, absolute stock, the `label` -> `userName`
 * field) are asserted in the emulator suite, where a real server accepts them.
 */

/** A Damascus 08:00 instant on a Wednesday, inside A2's default window. */
const REQUEST_DATE = FirestoreTimestamp.parse(new Date(Date.UTC(2026, 5, 3, 5, 0)).toISOString());

const ADMIN = { uid: 'uid-admin', name: 'Dr. Salsabil' } as const;

function makeRequest(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    id: 'req-1',
    uid: 'uid-patient',
    items: [{ medicineId: 'med-1', medicineName: 'Panadol', quantity: 2 }],
    status: 'pending',
    requestDate: REQUEST_DATE,
    orderId: null,
    error: null,
    processedBy: null,
    processedAt: null,
    ...overrides,
  } as OrderRequest;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    uid: 'uid-patient',
    name: 'Nour',
    employeeId: 'E-1',
    role: 'employee',
    status: 'approved',
    hasException: false,
    lastOrderId: null,
    lastOrderDate: null,
    lastOrderMonthYear: '',
    lastOrderStatus: null,
    lastOrderIsException: false,
    ...overrides,
  } as User;
}

function makeMedicine(overrides: Partial<Medicine> = {}): Medicine {
  return {
    id: 'med-1',
    name: 'Panadol',
    maxQuantity: 10,
    stock: 50,
    totalInward: 0,
    totalOutward: 0,
    ...overrides,
  } as Medicine;
}

const DEFAULT_SETTINGS: AppSettings = {
  minDaysBetweenOrders: 15,
  maxDailyOrders: 50,
  allowFridayOrders: false,
  startTime: '06:00',
  endTime: '10:00',
  assistantId: '',
} as AppSettings;

/** A minimal order, used only by the transaction-lifecycle tests below. */
const LIFECYCLE_ORDER: NewOrder = {
  uid: 'uid-patient',
  items: [{ medicineId: 'med-1', medicineName: 'Panadol', quantity: 2 }],
  processedBy: 'uid-admin',
} as unknown as NewOrder;


interface FakeOptions {
  /**
   * Simulates a document whose `status` field is ABSENT. Kept separate from
   * `rawStatus: ''` because they are different documents, and the absent field
   * is the one the Stage 5B mapper would silently turn into 'pending'.
   */
  readonly rawStatusMissing?: boolean;
  readonly rawStatus?: string | undefined;
  readonly request?: OrderRequest | null | undefined;
  readonly user?: User | null;
  readonly settings?: AppSettings | null;
  readonly medicines?: Readonly<Record<string, Medicine | null>>;
  /** Thrown by `readRequest`, to exercise the malformed-data bridge. */
  readonly readRequestError?: unknown;
  /** Thrown by `commit`, to exercise the conflict path. */
  readonly commitError?: unknown;
  /** Thrown by the first read, to exercise a rules denial. */
  readonly readError?: unknown;
}

/** An in-memory `OrderProcessingTransaction` that records the call sequence. */
class FakeTransaction implements OrderProcessingTransaction {
  public readonly calls: string[] = [];
  public readonly orders: NewOrder[] = [];
  public readonly stockWrites: { readonly medicineId: string; readonly absolute: number }[] = [];
  public readonly logs: NewStockLog[] = [];
  public readonly summaries: { readonly uid: string; readonly summary: UserOrderSummaryWrite }[] = [];
  public readonly processed: { readonly requestId: string; readonly orderId: string; readonly adminUid: string }[] = [];
  public readonly failed: { readonly requestId: string; readonly reason: string; readonly adminUid: string }[] = [];
  public commitCount = 0;
  public rollbackCount = 0;

  private readonly options: FakeOptions;
  private orderCounter = 0;

  public constructor(options: FakeOptions) {
    this.options = options;
  }

  public async readRawRequestStatus(): Promise<string> {
    this.calls.push('readRawRequestStatus');
    if (this.options.readError !== undefined) {
      throw this.options.readError;
    }
    if (this.options.rawStatusMissing === true) {
      return '';
    }
    return this.options.rawStatus === undefined ? 'pending' : this.options.rawStatus;
  }

  public async readRequest(): Promise<OrderRequest | null> {
    this.calls.push('readRequest');
    if (this.options.readRequestError !== undefined) {
      throw this.options.readRequestError;
    }
    return this.options.request === undefined ? makeRequest() : this.options.request;
  }

  public async readUser(): Promise<User | null> {
    this.calls.push('readUser');
    return this.options.user === undefined ? makeUser() : this.options.user;
  }

  public async readSettings(): Promise<AppSettings | null> {
    this.calls.push('readSettings');
    return this.options.settings === undefined ? DEFAULT_SETTINGS : this.options.settings;
  }

  public async readMedicine(medicineId: string): Promise<Medicine | null> {
    this.calls.push(`readMedicine:${medicineId}`);
    const catalogue = this.options.medicines;
    if (catalogue === undefined) {
      return makeMedicine({ id: medicineId });
    }
    return catalogue[medicineId] ?? null;
  }

  public createOrder(order: NewOrder): Promise<string> {
    this.calls.push('createOrder');
    this.orders.push(order);
    this.orderCounter += 1;
    return Promise.resolve(`order-${this.orderCounter}`);
  }

  public setMedicineStock(medicineId: string, absoluteStock: number): Promise<void> {
    this.calls.push('setMedicineStock');
    this.stockWrites.push({ medicineId, absolute: absoluteStock });
    return Promise.resolve();
  }

  public createStockLog(log: NewStockLog): Promise<void> {
    this.calls.push('createStockLog');
    this.logs.push(log);
    return Promise.resolve();
  }

  public updateUserSummary(uid: string, summary: UserOrderSummaryWrite): Promise<void> {
    this.calls.push('updateUserSummary');
    this.summaries.push({ uid, summary });
    return Promise.resolve();
  }

  public markRequestProcessed(requestId: string, orderId: string, adminUid: string): Promise<void> {
    this.calls.push('markRequestProcessed');
    this.processed.push({ requestId, orderId, adminUid });
    return Promise.resolve();
  }

  public markRequestFailed(requestId: string, reason: string, adminUid: string): Promise<void> {
    this.calls.push('markRequestFailed');
    this.failed.push({ requestId, reason, adminUid });
    return Promise.resolve();
  }

  public async commit(): Promise<void> {
    this.calls.push('commit');
    this.commitCount += 1;
    if (this.options.commitError !== undefined) {
      throw this.options.commitError;
    }
  }

  public async rollback(): Promise<void> {
    this.calls.push('rollback');
    this.rollbackCount += 1;
  }

  /** Every write-producing call, in order (rollback excluded: it writes nothing). */
  public writeCalls(): string[] {
    return this.calls.filter((call) => call !== 'rollback' && !call.startsWith('read'));
  }
}

function serviceFor(options: FakeOptions, maxAttempts?: number): {
  service: FirestoreOrderProcessingService;
  transactions: FakeTransaction[];
} {
  const transactions: FakeTransaction[] = [];
  const service = new FirestoreOrderProcessingService(
    async (): Promise<OrderProcessingTransaction> => {
      const transaction = new FakeTransaction(options);
      transactions.push(transaction);
      return transaction;
    },
    maxAttempts === undefined ? {} : { maxTransactionAttempts: maxAttempts },
  );
  return { service, transactions };
}

describe('Stage 6: successful processing performs W1-W5 in A2 order', () => {
  it('reads everything BEFORE writing anything, then commits once', async () => {
    const { service, transactions } = serviceFor({});
    const outcome = await service.process('req-1', ADMIN);

    assert.equal(outcome.result.kind, 'success');
    assert.equal(outcome.attempts, 1);
    const transaction = transactions[0];
    assert.ok(transaction);

    // The whole READ phase comes first (A1 requires it; A2 §6.3 fixes the order).
    const reads = transaction.calls.filter((call) => call.startsWith('read'));
    assert.deepEqual(reads, [
      'readRawRequestStatus',
      'readRequest',
      'readUser',
      'readSettings',
      'readMedicine:med-1',
    ]);

    // Then exactly the five writes of W1..W5, in that order.
    assert.deepEqual(transaction.writeCalls(), [
      'createOrder',
      'setMedicineStock',
      'createStockLog',
      'updateUserSummary',
      'markRequestProcessed',
      'commit',
    ]);
    assert.equal(transaction.commitCount, 1);
    // The handle is released on the way out of EVERY attempt, committed or not.
    // After a successful commit the adapter's `rollback` is a no-op, so this is
    // not a second Firestore call - it is the guarantee that no attempt can
    // return while still holding locks.
    assert.equal(transaction.rollbackCount, 1);
  });

  it('writes the ABSOLUTE new stock, not an increment', async () => {
    const { service, transactions } = serviceFor({
      medicines: { 'med-1': makeMedicine({ stock: 50 }) },
    });
    await service.process('req-1', ADMIN);

    const transaction = transactions[0];
    assert.ok(transaction);
    // Requesting 2 of a stock of 50 leaves 48, as an absolute value.
    assert.deepEqual(transaction.stockWrites, [{ medicineId: 'med-1', absolute: 48 }]);
  });

  it('aggregates duplicate lines into ONE medicine read and ONE stock write', async () => {
    const request = makeRequest({
      items: [
        { medicineId: 'med-1', medicineName: 'Panadol', quantity: 2 },
        { medicineId: 'med-1', medicineName: 'Panadol', quantity: 3 },
      ],
    });
    const { service, transactions } = serviceFor({ request });
    await service.process('req-1', ADMIN);

    const transaction = transactions[0];
    assert.ok(transaction);
    assert.equal(transaction.calls.filter((c) => c === 'readMedicine:med-1').length, 1);
    // 50 - (2 + 3) = 45: the cap is checked on the AGGREGATED quantity.
    assert.deepEqual(transaction.stockWrites, [{ medicineId: 'med-1', absolute: 45 }]);
    assert.equal(transaction.logs.length, 1);
    assert.equal(transaction.logs[0]?.quantity, 5);
  });

  it('records the EMPLOYEE in the log label and the request in the order', async () => {
    const { service, transactions } = serviceFor({});
    await service.process('req-1', ADMIN);

    const transaction = transactions[0];
    assert.ok(transaction);
    const log = transaction.logs[0];
    assert.ok(log);
    // A2 (AdminOrderProcessor.kt:366,373) files the movement under the EMPLOYEE
    // who receives the medicine - `uid` from the request and the name from the
    // user document - never under the admin who pressed the button. Filing it
    // under the admin would make the stock report unreadable and would lose the
    // link between the movement and the order that caused it.
    assert.equal(log.uid, 'uid-patient');
    assert.equal(log.label, 'Nour');
    assert.equal(log.type, 'outward');

    const order = transaction.orders[0];
    assert.ok(order);
    assert.equal(order.userId, 'uid-patient');
    assert.equal(order.userName, 'Nour');
    assert.equal(order.requestId, 'req-1');
  });

  it('marks the request processed with the new order id', async () => {
    const { service, transactions } = serviceFor({});
    await service.process('req-1', ADMIN);
    const transaction = transactions[0];
    assert.ok(transaction);
    assert.deepEqual(transaction.processed, [
      { requestId: 'req-1', orderId: 'order-1', adminUid: 'uid-admin' },
    ]);
    assert.deepEqual(transaction.failed, []);
  });

  it('writes lastOrderStatus = pending and consumes the exception', async () => {
    const { service, transactions } = serviceFor({
      user: makeUser({ hasException: true, lastOrderStatus: 'rejected', lastOrderIsException: false }),
    });
    await service.process('req-1', ADMIN);

    const transaction = transactions[0];
    assert.ok(transaction);
    const entry = transaction.summaries[0];
    assert.ok(entry);
    assert.equal(entry.summary.lastOrderStatus, 'pending');
    // D7: the exception is SPENT by the order that used it.
    assert.equal(entry.summary.hasException, false);
    assert.equal(entry.summary.lastOrderIsException, true);
    assert.equal(entry.summary.lastOrderId, 'order-1');
    assert.equal(entry.summary.lastOrderMonthYear, '06-2026');
  });
});

describe('Stage 6: AlreadyProcessed is a ZERO-write outcome', () => {
  for (const status of ['processed', 'failed', '', 'PENDING']) {
    it(`writes nothing when the raw status is ${JSON.stringify(status)}`, async () => {
      const { service, transactions } = serviceFor({ rawStatus: status });
      const outcome = await service.process('req-1', ADMIN);

      assert.deepEqual(outcome.result, { kind: 'already-processed', status });
      const transaction = transactions[0];
      assert.ok(transaction);
      assert.deepEqual(transaction.writeCalls(), []);
      assert.equal(transaction.commitCount, 0);
      // It stops at R1: nothing else is even read.
      assert.deepEqual(transaction.calls, ['readRawRequestStatus', 'rollback']);
      // ZERO writes, but the handle is still RELEASED. This branch never
      // reaches `commit()`, so without the unconditional rollback the attempt
      // would return holding Firestore's locks on every document it read - and
      // an idempotency check is exactly the path a re-run hits most often.
      assert.equal(transaction.rollbackCount, 1, 'the abandoned handle is released');
    });
  }

  it('treats a MISSING raw status as already processed, never as pending', async () => {
    // This is the case the Stage 5B mapper would hide: it maps an absent status
    // to 'pending'. Reading the RAW value is what keeps A2's behaviour.
    const { service, transactions } = serviceFor({ rawStatus: undefined, rawStatusMissing: true });
    const outcome = await service.process('req-1', ADMIN);

    assert.equal(outcome.result.kind, 'already-processed');
    assert.deepEqual(outcome.result, { kind: 'already-processed', status: '' });
    const transaction = transactions[0];
    assert.ok(transaction);
    assert.deepEqual(transaction.writeCalls(), []);
    // The same release guarantee as the raw-status branch: a request document
    // that is simply gone must not leave an open transaction behind.
    assert.equal(transaction.rollbackCount, 1);
  });
});

describe('Stage 6: business validation failures mark the request failed', () => {
  it('refuses a request that is not approved, writing a failed marker', async () => {
    const { service, transactions } = serviceFor({ user: makeUser({ status: 'pending' }) });
    const outcome = await service.process('req-1', ADMIN);

    assert.deepEqual(outcome.result, {
      kind: 'business-validation-failure',
      reason: 'User is not approved to make orders',
    });
    const transaction = transactions[0];
    assert.ok(transaction);
    assert.deepEqual(transaction.failed, [
      { requestId: 'req-1', reason: 'User is not approved to make orders', adminUid: 'uid-admin' },
    ]);
    assert.deepEqual(transaction.orders, [], 'no order may be created');
    assert.deepEqual(transaction.stockWrites, [], 'no stock may move');
    assert.equal(transaction.commitCount, 1, 'the failed marker is committed atomically');
  });

  it('refuses a medicine the catalogue does not contain', async () => {
    const { service } = serviceFor({ medicines: { 'med-1': null } });
    const outcome = await service.process('req-1', ADMIN);
    assert.match((outcome.result as { reason: string }).reason, /Medicine not found: med-1/);
  });

  it('refuses a quantity above the medicine cap', async () => {
    // The request asks for 2 and the cap is 1, so the cap is exceeded.
    const { service, transactions } = serviceFor({
      medicines: { 'med-1': makeMedicine({ maxQuantity: 1, stock: 50 }) },
    });
    const outcome = await service.process('req-1', ADMIN);

    assert.equal((outcome.result as { reason: string }).reason, 'Maximum quantity for Panadol is 1');
    const transaction = transactions[0];
    assert.ok(transaction);
    assert.deepEqual(transaction.stockWrites, []);
  });

  it('accepts a quantity EQUAL to the cap (A2 line 310 is a strict >)', async () => {
    const { service } = serviceFor({
      medicines: { 'med-1': makeMedicine({ maxQuantity: 2, stock: 50 }) },
    });
    const outcome = await service.process('req-1', ADMIN);
    assert.equal(outcome.result.kind, 'success', 'a quantity equal to the cap is allowed');
  });

  it('checks the cap on the AGGREGATED quantity, not each line', async () => {
    // 2 + 2 = 4 > 3, even though neither line alone exceeds 3.
    const request = makeRequest({
      items: [
        { medicineId: 'med-1', medicineName: 'Panadol', quantity: 2 },
        { medicineId: 'med-1', medicineName: 'Panadol', quantity: 2 },
      ],
    });
    const { service } = serviceFor({
      request,
      medicines: { 'med-1': makeMedicine({ maxQuantity: 3, stock: 50 }) },
    });
    const outcome = await service.process('req-1', ADMIN);
    assert.equal(
      (outcome.result as { reason: string }).reason,
      'Maximum quantity for Panadol is 3',
    );
  });

  it('refuses insufficient stock and never writes a negative value', async () => {
    const { service, transactions } = serviceFor({
      medicines: { 'med-1': makeMedicine({ maxQuantity: 10, stock: 1 }) },
    });
    const outcome = await service.process('req-1', ADMIN);

    assert.equal((outcome.result as { reason: string }).reason, 'Insufficient stock for Panadol');
    const transaction = transactions[0];
    assert.ok(transaction);
    assert.deepEqual(transaction.stockWrites, [], 'a refusal must leave the stock untouched');
  });

  it('refuses outside the window, AFTER reading the medicines', async () => {
    const { service, transactions } = serviceFor({
      settings: { ...DEFAULT_SETTINGS, startTime: '20:00', endTime: '22:00' },
    });
    const outcome = await service.process('req-1', ADMIN);

    assert.match((outcome.result as { reason: string }).reason, /Orders allowed only between/);
    const transaction = transactions[0];
    assert.ok(transaction);
    // A2 reads everything first, so the medicine read already happened...
    assert.ok(transaction.calls.includes('readMedicine:med-1'));
    // ...but nothing was written.
    assert.deepEqual(transaction.orders, []);
  });

  it('refuses a second order in the same month', async () => {
    const { service } = serviceFor({ user: makeUser({ lastOrderMonthYear: '06-2026' }) });
    const outcome = await service.process('req-1', ADMIN);
    assert.equal(
      (outcome.result as { reason: string }).reason,
      'You have already ordered this month',
    );
  });
});

describe('Stage 6: malformed data becomes an A2-equivalent business failure', () => {
  it('converts a MalformedDataError into a failed marker with a user-facing reason', async () => {
    const { service, transactions } = serviceFor({
      readRequestError: new MalformedDataError('items[1].quantity', 'must be a number', 'order_requests/req-1'),
    });
    const outcome = await service.process('req-1', ADMIN);

    // The technical field path must NOT reach the employee.
    assert.deepEqual(outcome.result, {
      kind: 'business-validation-failure',
      reason: ERROR_MALFORMED_REQUEST,
    });
    const transaction = transactions[0];
    assert.ok(transaction);
    assert.deepEqual(transaction.failed, [
      { requestId: 'req-1', reason: ERROR_MALFORMED_REQUEST, adminUid: 'uid-admin' },
    ]);
    // ...but it is preserved for the operator's log.
    assert.equal(outcome.malformedDetails?.length, 1);
    assert.match(String(outcome.malformedDetails?.[0]), /items\[1\]\.quantity/);
  });

  it('lets every OTHER error propagate untouched', async () => {
    const { service } = serviceFor({ readRequestError: new DomainError('TRANSPORT', 'network is down') });
    await assert.rejects(
      () => service.process('req-1', ADMIN),
      (error: unknown) => error instanceof DomainError && error.kind === 'TRANSPORT',
    );
  });

  it('never puts a field path in the user-facing reason', () => {
    assert.equal(typeof ERROR_MALFORMED_REQUEST, 'string');
    assert.ok(!ERROR_MALFORMED_REQUEST.includes('items['), 'the business reason is not a field path');
  });
});

describe('Stage 6: a rules denial is NOT a business failure', () => {
  it('propagates a 403 as NOT_AUTHORIZED and writes nothing', async () => {
    const { service, transactions } = serviceFor({ readError: new DomainError('NOT_AUTHORIZED', 'denied') });

    await assert.rejects(
      () => service.process('req-1', ADMIN),
      (error: unknown) => error instanceof DomainError && error.kind === 'NOT_AUTHORIZED',
    );
    const transaction = transactions[0];
    assert.ok(transaction);
    // A denial is not a business verdict, so no `failed` marker is fabricated.
    assert.deepEqual(transaction.failed, []);
    assert.equal(transaction.commitCount, 0);
  });
});

describe('Stage 6: a transaction conflict is retried from R1, with a bound', () => {
  it('retries after ABORTED and succeeds on the second attempt', async () => {
    const transactions: FakeTransaction[] = [];
    let attempt = 0;
    const service = new FirestoreOrderProcessingService(async (): Promise<OrderProcessingTransaction> => {
      attempt += 1;
      // Only the FIRST attempt conflicts; the retry sees a clean transaction.
      const transaction = new FakeTransaction(attempt === 1 ? { commitError: new DomainError('ABORTED', 'c') } : {});
      transactions.push(transaction);
      return transaction;
    });

    const outcome = await service.process('req-1', ADMIN);

    assert.equal(outcome.result.kind, 'success');
    assert.equal(outcome.attempts, 2);
    assert.equal(transactions[0]?.rollbackCount, 1, 'the aborted attempt is rolled back');
    // The retry re-reads EVERYTHING from R1: no stale data is reused.
    assert.equal(transactions[1]?.calls.filter((c) => c.startsWith('read')).length, 5);
  });

  it('gives up after the bounded budget and reports an infrastructure error', async () => {
    const { service, transactions } = serviceFor(
      { commitError: new DomainError('ABORTED', 'conflict') },
      3,
    );

    await assert.rejects(
      () => service.process('req-1', ADMIN),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.kind, 'ABORTED', 'a conflict is infrastructure, not a business failure');
        return true;
      },
    );
    assert.equal(transactions.length, 3, 'exactly the budget, no unbounded loop');
    assert.equal(DEFAULT_MAX_TRANSACTION_ATTEMPTS, 3, 'the documented default budget');
  });

  it('uses a single attempt when the budget is one', async () => {
    const { service, transactions } = serviceFor({ commitError: new DomainError('ABORTED', 'c') }, 1);
    await assert.rejects(() => service.process('req-1', ADMIN), DomainError);
    assert.equal(transactions.length, 1);
  });
});

describe('Stage 6: the transaction lifecycle survives a commit conflict', () => {
  function adapterFor(commitError?: Error): {
    transaction: FirestoreOrderProcessingTransaction;
    rollbacks: () => number;
    commits: () => number;
  } {
    let rollbacks = 0;
    let commits = 0;
    const client: FirestoreOrderProcessingTransactionClient = {
      beginTransaction: async (): Promise<string> => 'tx-unused',
      batchGetDocuments: async (): Promise<readonly (FirestoreDocument | null)[]> => [],
      commitWrites: async (): Promise<unknown> => {
        commits += 1;
        if (commitError !== undefined) {
          throw commitError;
        }
        return {};
      },
      rollback: async (): Promise<void> => { rollbacks += 1; },
    };
    return {
      transaction: new FirestoreOrderProcessingTransaction(client, 'tx-1' as TransactionId),
      rollbacks: () => rollbacks,
      commits: () => commits,
    };
  }

  it('allows a rollback after a failed commit, so a conflict can be retried', async () => {
    const { transaction, rollbacks, commits } = adapterFor(new DomainError('ABORTED', 'conflict'));
    await transaction.createOrder(LIFECYCLE_ORDER);

    await assert.rejects(() => transaction.commit(), DomainError);
    assert.equal(commits(), 1, 'the conflict really came from the commit');
    // The regression: this used to throw INVALID_INPUT and leak the handle.
    await transaction.rollback();
    assert.equal(rollbacks(), 1, 'the aborted handle is released for the retry');
  });

  it('rolls back instead of committing when nothing was queued', async () => {
    const { transaction, rollbacks, commits } = adapterFor();
    await transaction.commit();
    assert.equal(commits(), 0, 'an empty commit is never sent to Firestore');
    assert.equal(rollbacks(), 1, 'AlreadyProcessed abandons the transaction, writing nothing');
  });

  it('treats a second rollback as a no-op rather than a second :rollback', async () => {
    const { transaction, rollbacks } = adapterFor();
    await transaction.rollback();
    await transaction.rollback();
    assert.equal(rollbacks(), 1);
  });

  it('refuses to queue more writes once the transaction is finished', async () => {
    const { transaction } = adapterFor();
    await transaction.rollback();
    await assert.rejects(
      async () => transaction.createOrder(LIFECYCLE_ORDER),
      (error: unknown) => error instanceof DomainError && error.kind === 'INVALID_INPUT',
    );
  });
});


