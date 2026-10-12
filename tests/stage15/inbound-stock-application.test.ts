/**
 * Stage 15 - the INBOUND STOCK RECEIPT use case.
 *
 * WHAT THIS FILE PROVES
 *
 * The use case is where the receipt's DECISIONS live - validation, the absolute
 * arithmetic, the retry policy - and the transaction only moves bytes. So this file
 * pins the decisions, against a transaction double that records what it was asked
 * to do:
 *
 *  - a receipt computes ABSOLUTE totals from the stock read INSIDE the transaction,
 *    never from a value the caller supplied;
 *  - the medicine update and the audit row are ALWAYS queued together, so no
 *    outcome exists in which one happens without the other;
 *  - every failure path ends the transaction, so no handle is left locking the
 *    documents it read;
 *  - an unexpected key is REFUSED, which is what keeps `stock`, `totalInward`,
 *    `totalOutward`, `name`, `type` and `uid` unreachable rather than ignored;
 *  - a conflict is retried from a FRESH transaction, and a denial is not.
 *
 * The real `FirestoreInboundStockTransaction` is exercised by
 * `inbound-stock-transaction.test.ts`, and the whole thing against the real rules
 * by the Stage 15 emulator suite.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InboundStockService } from '../../electron/application/inbound-stock.service';
import { DomainError } from '../../electron/domain/errors';
import { SERVER_TIMESTAMP } from '../../electron/services/firestore-codec';
import {
  FakeInboundStockTransaction,
  FakeSession,
  makeMedicine,
  signedIn,
} from '../stage7/helpers/fakes';

const MEDICINE_ID = 'med-42';
const ADMIN_NAME = 'مسؤول الاختبار';

/** A medicine with stock 10 and totalInward 40 - the numbers every receipt builds on. */
function stockMedicine() {
  return makeMedicine({ id: MEDICINE_ID, name: 'Panadol', stock: 10, totalInward: 40, totalOutward: 3 });
}

/** Builds a service whose factory hands out the supplied transactions in order. */
function serviceOver(
  options: {
    readonly transactions?: readonly FakeInboundStockTransaction[];
    readonly medicine?: ReturnType<typeof makeMedicine> | null;
    readonly signedIn?: boolean;
    readonly maxAttempts?: number;
    readonly transactionFailure?: Error;
  } = {},
) {
  const started: FakeInboundStockTransaction[] = [];
  const queue = [...(options.transactions ?? [])];

  const service = new InboundStockService({
    createTransaction: async () => {
      if (options.transactionFailure !== undefined) {
        throw options.transactionFailure;
      }
      const next = queue.shift();
      if (next !== undefined) {
        started.push(next);
        return next;
      }
      const created = new FakeInboundStockTransaction(
        options.medicine === undefined ? stockMedicine() : options.medicine,
      );
      started.push(created);
      return created;
    },
    auth: {
      getState: () => (options.signedIn === false
        ? FakeSession.signedOut().getSafeState()
        : signedIn({ displayName: ADMIN_NAME })),
    },
    maxAttempts: options.maxAttempts ?? 3,
  });

  return { service, started };
}

describe('Stage 15 requirement 1: a receipt succeeds and moves stock by exactly the quantity', () => {
  it('queues the absolute totals AND the audit row, then commits once', async () => {
    const transaction = new FakeInboundStockTransaction(stockMedicine());
    const { service } = serviceOver({ transactions: [transaction] });

    const result = await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 5 });

    assert.equal(result.ok, true);
    // 10 + 5 and 40 + 5, computed from the read the transaction returned.
    assert.deepEqual(transaction.totals, [{ medicineId: MEDICINE_ID, stock: 15, totalInward: 45 }]);
    assert.equal(transaction.commits, 1);
    assert.equal(transaction.rollbacks, 0, 'a success must not roll back');
  });

  it('reports the ABSOLUTE post-receipt values, never a delta', async () => {
    const { service } = serviceOver();

    const result = await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 7 });

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.value.newStock : null, 17);
    assert.equal(result.ok ? result.value.newTotalInward : null, 47);
    assert.equal(result.ok ? result.value.quantity : null, 7, 'the receipt itself is the magnitude');
  });

  it('files the audit row with the ADMIN and an INWARD type without order references', async () => {
    const transaction = new FakeInboundStockTransaction(stockMedicine());
    const { service } = serviceOver({ transactions: [transaction] });

    await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 5 });

    assert.equal(transaction.appendedLogs.length, 1);
    const log = transaction.appendedLogs[0]!;
    // D3: a receipt is filed under the staff member who entered it - the opposite
    // of A2, which files an outward movement under the employee who received it.
    assert.equal(log.uid, signedIn({ displayName: ADMIN_NAME }).uid);
    assert.equal(log.type, 'inward');
    assert.equal(log.quantity, 5, 'a POSITIVE magnitude; the sign lives in `type`');
    assert.equal('orderId' in log, false);
    assert.equal('requestId' in log, false);
    // D4: the server decides the instant.
    assert.equal(log.date, SERVER_TIMESTAMP);
  });

  it('snapshots the medicine name and identifies the authenticated administrator', async () => {
    const transaction = new FakeInboundStockTransaction(stockMedicine());
    const { service } = serviceOver({ transactions: [transaction] });

    await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 5 });

    assert.equal(transaction.appendedLogs[0]?.medicineName, 'Panadol');
    assert.equal(transaction.appendedLogs[0]?.label, ADMIN_NAME);
  });
});

describe('Stage 15 requirement 2: an unexpected key is REFUSED, not ignored', () => {
  const refusedKeys = ['stock', 'totalInward', 'totalOutward', 'name', 'medicineName', 'type', 'uid'];

  for (const key of refusedKeys) {
    it(`refuses a payload carrying "${key}"`, async () => {
      const transaction = new FakeInboundStockTransaction(stockMedicine());
      const { service } = serviceOver({ transactions: [transaction] });

      const result = await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 5, [key]: 1 });

      assert.equal(result.ok, false);
      assert.equal(result.ok ? null : result.error.code, 'VALIDATION_FAILED');
      // The whole reason an allowlist beats ignoring unknown keys: a renderer that
      // sends `stock: 999` must be told NO, not silently given a receipt of zero.
      assert.deepEqual(transaction.totals, [], 'nothing may be written');
      assert.equal(transaction.appendedLogs.length, 0, 'and no log row either');
    });
  }

  it('refuses a payload that is not an object at all', async () => {
    const { service } = serviceOver();

    for (const payload of [null, 42, 'receipt', [], undefined]) {
      const result = await service.receiveInboundStock(payload);
      assert.equal(result.ok, false, `payload ${JSON.stringify(payload) ?? 'undefined'} must be refused`);
      assert.equal(result.ok ? null : result.error.code, 'VALIDATION_FAILED');
    }
  });

  it('refuses a quantity that is not a POSITIVE integer', async () => {
    const { service } = serviceOver();

    for (const quantity of [0, -5, 1.5, '5', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const result = await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity });
      assert.equal(result.ok, false, `quantity ${String(quantity)} must be refused`);
      assert.equal(result.ok ? null : result.error.code, 'VALIDATION_FAILED');
    }
  });

  it('accepts positive safe integers without imposing a business maximum', () => {
    const { service } = serviceOver();

    const result = service.validateInboundStock({
      medicineId: MEDICINE_ID,
      quantity: Number.MAX_SAFE_INTEGER,
    });

    assert.equal(result.ok, true);
  });

  it('refuses totals that would exceed safe-integer precision', async () => {
    const medicine = makeMedicine({
      id: MEDICINE_ID,
      name: 'Panadol',
      stock: Number.MAX_SAFE_INTEGER,
      totalInward: 40,
      totalOutward: 3,
    });
    const transaction = new FakeInboundStockTransaction(medicine);
    const { service } = serviceOver({ transactions: [transaction] });

    const result = await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 1 });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'VALIDATION_FAILED');
    assert.deepEqual(transaction.totals, []);
    assert.deepEqual(transaction.appendedLogs, []);
    assert.equal(transaction.rollbacks, 1);
  });

  it('refuses a malformed medicine id before anything is read', async () => {
    const { service, started } = serviceOver();

    for (const medicineId of ['', 'med/../users', 'med 42', 'x'.repeat(200)]) {
      const result = await service.receiveInboundStock({ medicineId, quantity: 5 });
      assert.equal(result.ok, false, `id "${medicineId}" must be refused`);
    }
    // No transaction was even begun, so no handle was opened and no lock taken.
    assert.deepEqual(started, [], 'a refused payload must not open a transaction');
  });
});

describe('Stage 15 requirement 3: a failure leaves NO medicine change and NO partial log', () => {
  it('maps transaction creation failures into the application error taxonomy', async () => {
    const { service, started } = serviceOver({
      transactionFailure: new DomainError('TRANSPORT', 'emulator unavailable'),
    });

    const result = await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 5 });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'INFRASTRUCTURE_FAILURE');
    assert.deepEqual(started, []);
  });

  it('writes neither half when the transaction cannot read the medicine', async () => {
    const denial = new DomainError('NOT_AUTHORIZED', 'rules said no', { documentPath: 'medicines/x' });
    const transaction = new FakeInboundStockTransaction(stockMedicine(), denial);
    const { service } = serviceOver({ transactions: [transaction] });

    const result = await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 5 });

    assert.equal(result.ok, false);
    // The refusal is reported, and NOTHING was queued: no medicine update, no log
    // row. This is the property the whole stage exists to establish.
    assert.deepEqual(transaction.totals, [], 'a refused read must not change the medicine');
    assert.deepEqual(transaction.appendedLogs, [], 'and must not file an orphan log');
    assert.equal(transaction.commits, 0, 'nothing may reach Firestore');
    // And the handle is released, so nobody else's receipt blocks behind this one.
    assert.equal(transaction.rollbacks, 1, 'every attempt must end in a rollback');
  });

  it('reports NOT_FOUND for a medicine that does not exist, writing nothing', async () => {
    const transaction = new FakeInboundStockTransaction(null);
    const { service } = serviceOver({ transactions: [transaction] });

    const result = await service.receiveInboundStock({ medicineId: 'med-missing', quantity: 5 });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'NOT_FOUND');
    assert.deepEqual(transaction.totals, [], 'a missing medicine must not be created');
    assert.deepEqual(transaction.appendedLogs, []);
    assert.equal(transaction.commits, 0);
    assert.equal(transaction.rollbacks, 1);
  });

  it('queues BOTH halves together, so neither can be sent alone', async () => {
    const transaction = new FakeInboundStockTransaction(stockMedicine());
    const { service } = serviceOver({ transactions: [transaction] });

    await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 5 });

    // The pair is the invariant: a medicine update with no log, or a log with no
    // medicine, is the one outcome this stage must make unrepresentable.
    assert.equal(transaction.totals.length, 1, 'the medicine half');
    assert.equal(transaction.appendedLogs.length, 1, 'the audit half');
    assert.equal(transaction.commits, 1, 'and both go out in one commit');
  });
});

describe('Stage 15 requirement 4: a conflict is retried from a FRESH transaction', () => {
  it('begins a new transaction on each retry, re-reading the medicine', async () => {
    const first = new FakeInboundStockTransaction(stockMedicine(), new DomainError('ABORTED', 'lost a race', { documentPath: null }));
    const second = new FakeInboundStockTransaction(stockMedicine());
    const { service, started } = serviceOver({ transactions: [first, second] });

    const result = await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 5 });

    assert.equal(result.ok, true);
    // A retry that reused the first handle would compute its absolute value from a
    // stale read - the exact bug the fresh-transaction factory exists to prevent.
    assert.equal(started.length, 2, 'a retry must begin its own transaction');
    assert.equal(first.rollbacks, 1, 'the abandoned attempt must release its handle');
    // The committed totals came from the SECOND read.
    assert.deepEqual(second.totals, [{ medicineId: MEDICINE_ID, stock: 15, totalInward: 45 }]);
  });

  it('gives up after the bounded budget and reports a CONCURRENCY_CONFLICT', async () => {
    const { service, started } = serviceOver({
      transactions: [1, 2, 3].map(() => new FakeInboundStockTransaction(
        stockMedicine(),
        new DomainError('ABORTED', 'lost a race', { documentPath: null }),
      )),
      maxAttempts: 3,
    });

    const result = await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 5 });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'CONCURRENCY_CONFLICT');
    assert.equal(result.ok ? null : result.error.retryable, true);
    // Bounded: an unbounded retry against a busy document would hammer Firestore
    // forever, and a receipt is a human action, not a background job.
    assert.equal(started.length, 3);
    assert.equal(started.every((transaction) => transaction.rollbacks === 1), true, 'every attempt releases its handle');
  });

  it('does NOT retry a rules denial, because the retry would reach the same verdict', async () => {
    const { service, started } = serviceOver({
      transactions: [1, 2, 3].map(() => new FakeInboundStockTransaction(
        stockMedicine(),
        new DomainError('NOT_AUTHORIZED', 'rules said no', { documentPath: 'medicines/x' }),
      )),
    });

    const result = await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 5 });

    assert.equal(result.ok, false);
    assert.equal(started.length, 1, 'exactly one attempt - three would be three identical 403s');
  });

  it('refuses a signed-out caller WITHOUT opening a transaction', async () => {
    const { service, started } = serviceOver({ signedIn: false });

    const result = await service.receiveInboundStock({ medicineId: MEDICINE_ID, quantity: 5 });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'AUTHENTICATION_FAILED');
    assert.deepEqual(started, [], 'no session means no transaction and no handle');
  });
});