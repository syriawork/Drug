/**
 * Stage 12 - the orders-history application layer.
 *
 * THE CLAIM UNDER TEST: this screen is an INSPECTION surface.
 *
 * Every case asks one of three questions:
 *  - does the list hand the work to `OrdersRepository` and report what came back?
 *  - is every published field a value the STORED order actually carries?
 *  - is there genuinely NO path from here to a write?
 *
 * The last question gets its own suite below, because "we did not add a write" is
 * only meaningful if the type system would have rejected one. Stage 6 remains the
 * sole producer of orders, so a screen that could write one would be a second,
 * unaudited engine.
 *
 * No network, no Electron runtime, no production backend.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createManagerApplication } from '../../electron/application';
import { APPLICATION_ERROR_MESSAGES } from '../../electron/application/application-error';
import { FirestoreRestError } from '../../electron/services/firestore-rest';
import {
  FakeMedicinesRepository,
  FakeOrderProcessingService,
  FakeOrderRequestsRepository,
  FakeOrdersRepository,
  FakeStockLogsRepository,
  FakeInboundStockTransaction,
  FakeSession,
  FakeSettingsRepository,
  FakeUsersRepository,
  makeOrder,
  makeUser,
  rulesDenied,
} from '../stage7/helpers/fakes';
import { buildApplication } from '../stage9/helpers';

// Tests are executed from `dist/tests/stage12`, so the SOURCE tree is three
// levels up. Reading the compiled output instead would scan `.d.ts` files.
const projectRoot = join(__dirname, '..', '..', '..');

/** Builds the application over fakes with an explicit SIGNED-OUT session. */
function buildSignedOutApplication(orders: FakeOrdersRepository): ReturnType<typeof createManagerApplication> {
  return createManagerApplication({
    session: FakeSession.signedOut(),
    usersRepository: new FakeUsersRepository([makeUser()]),
    medicinesRepository: new FakeMedicinesRepository([]),
    settingsRepository: new FakeSettingsRepository(null),
    orderRequestsRepository: new FakeOrderRequestsRepository([]),
    ordersRepository: orders,
    stockLogsRepository: new FakeStockLogsRepository(),
    // Stage 15: wired so the receipt path is buildable; these suites never call it.
    inboundStockTransactionFactory: async () => new FakeInboundStockTransaction(),
    orderProcessing: new FakeOrderProcessingService(),
  });
}

describe('Stage 12 requirement 1: the list delegates to the repository', () => {
  it('reads with the FIXED application limit, not one the caller chose', async () => {
    const orders = new FakeOrdersRepository([makeOrder()]);

    await buildApplication(undefined, undefined, undefined, orders).manager.listOrders();

    // The limit belongs to the application, so the renderer cannot widen or
    // narrow the read by passing a number it invented.
    assert.deepEqual([...orders.seenLimits], [500]);
  });

  it('returns every stored order, in whatever order the transport gave them', async () => {
    const orders = new FakeOrdersRepository([
      makeOrder({ id: 'ord-1' }),
      makeOrder({ id: 'ord-2', userId: 'uid-other' }),
      makeOrder({ id: 'ord-3' }),
    ]);

    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listOrders();

    assert.equal(result.ok, true);
    assert.deepEqual(
      (result.ok ? [...result.value] : []).map((order) => order.id),
      ['ord-1', 'ord-2', 'ord-3'],
    );
  });

  it('refuses a signed-out caller without touching the repository', async () => {
    const orders = new FakeOrdersRepository([makeOrder()]);

    const result = await buildSignedOutApplication(orders).manager.listOrders();

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'AUTHENTICATION_FAILED');
    assert.deepEqual([...orders.seenLimits], [], 'the repository must not have been read at all');
  });

  it('maps a rules refusal to a safe error rather than an empty page', async () => {
    const orders = new FakeOrdersRepository([makeOrder()], rulesDenied('orders'));

    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listOrders();

    // An empty array here would be a lie: the manager would conclude there are no
    // orders when in fact they were not allowed to look.
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'AUTHORIZATION_DENIED');
    assert.equal(result.ok ? null : result.error.message, APPLICATION_ERROR_MESSAGES.AUTHORIZATION_DENIED);
  });

  it('maps a thrown transport failure to an error, never to a success', async () => {
    const orders = new FakeOrdersRepository([], new FirestoreRestError({
      reason: 'NETWORK', httpStatus: 503, requestSent: true, message: 'upstream is down',
    }));

    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listOrders();

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'INFRASTRUCTURE_FAILURE');
  });
});
describe('Stage 12 requirement 2: every published field is a STORED value', () => {
  it('reports the item COUNT and never a quantity sum', async () => {
    const orders = new FakeOrdersRepository([
      makeOrder({
        items: [
          { medicineId: 'med-1', medicineName: 'Panadol', quantity: 7 },
          { medicineId: 'med-1', medicineName: 'Panadol', quantity: 5 },
        ],
      }),
    ]);

    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listOrders();

    const view = result.ok ? result.value[0] : null;
    // Two lines. Summing them would publish `12`, a total the stored order never
    // contained and that Stage 6 never wrote - it may legitimately have rejected
    // these very duplicates.
    assert.equal(view?.itemCount, 2);
    assert.equal(JSON.stringify(view ?? {}).includes('totalQuantity'), false);
  });

  it('preserves each item snapshot verbatim, duplicates included', async () => {
    const orders = new FakeOrdersRepository([
      makeOrder({
        items: [
          { medicineId: 'med-1', medicineName: 'Panadol', quantity: 7 },
          { medicineId: 'med-1', medicineName: 'Panadol', quantity: 5 },
          { medicineId: 'med-2', medicineName: 'Vitamin C', quantity: 1 },
        ],
      }),
    ]);

    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listOrders();

    const view = result.ok ? result.value[0] : null;
    assert.equal(view?.items.length, 3);
    assert.deepEqual(
      view?.items.map((item) => `${item.medicineName}:${item.quantity}`),
      ['Panadol:7', 'Panadol:5', 'Vitamin C:1'],
    );
  });

  it('does NOT reinterpret orders.status as the request status', async () => {
    // `orders.status` is the MOBILE app's own lifecycle. An order that was never
    // produced from a request still has one, and relabelling it would invent a
    // processing history that did not happen.
    const orders = new FakeOrdersRepository([makeOrder({ status: 'pending', requestId: null })]);

    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listOrders();

    const view = result.ok ? result.value[0] : null;
    assert.equal(view?.status, 'pending');
    assert.equal(view?.requestId, null, 'an order with no request must not gain one');
    assert.equal(
      Object.keys(view ?? {}).some((key) => key.includes('requestStatus')),
      false,
    );
  });

  it('normalises the display month WITHOUT changing the stored one', async () => {
    // D1 legacy documents store Arabic-Indic digits. The raw value must survive
    // untouched so the domain keeps comparing what it actually persisted.
    const orders = new FakeOrdersRepository([makeOrder({ monthYear: '٠٦-٢٠٢٦' })]);

    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listOrders();

    const view = result.ok ? result.value[0] : null;
    assert.equal(view?.monthYear, '٠٦-٢٠٢٦');
    assert.equal(view?.monthYearDisplay, '06-2026');
  });

  it('shows a null display month rather than inventing one', async () => {
    const orders = new FakeOrdersRepository([makeOrder({ monthYear: '' })]);

    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listOrders();

    const view = result.ok ? result.value[0] : null;
    assert.equal(view?.monthYearDisplay, null);
    assert.equal(view?.monthYear, '');
  });
});
describe('Stage 12 requirement 3: names are decoration, and never a rewrite', () => {
  it('prefers the name SNAPSHOT stored on the order', async () => {
    // The employee has since been renamed in their profile. On an audit surface
    // the RECORDED name is the historical truth, so the live one must not win.
    const users = new FakeUsersRepository([makeUser({ uid: 'uid-emp', name: 'أحمد الجديد' })]);
    const orders = new FakeOrdersRepository([makeOrder({ userId: 'uid-emp', userName: 'أحمد' })]);

    const result = await buildApplication(users, undefined, undefined, orders).manager.listOrders();

    assert.equal(result.ok ? result.value[0]?.employeeName : null, 'أحمد');
  });

  it('falls back to the live name only when the snapshot is empty', async () => {
    const users = new FakeUsersRepository([makeUser({ uid: 'uid-emp', name: 'أحمد الجديد' })]);
    const orders = new FakeOrdersRepository([makeOrder({ userId: 'uid-emp', userName: '' })]);

    const result = await buildApplication(users, undefined, undefined, orders).manager.listOrders();

    assert.equal(result.ok ? result.value[0]?.employeeName : null, 'أحمد الجديد');
  });

  it('degrades to null when profiles are unreadable, keeping every order', async () => {
    // Reading all profiles is admin-only, so this throws for any other caller.
    // A missing decoration must not remove rows from the audit trail.
    const users = new FakeUsersRepository([], rulesDenied('users'));
    const orders = new FakeOrdersRepository([
      makeOrder({ id: 'ord-1', userName: '' }),
      makeOrder({ id: 'ord-2', userName: '' }),
    ]);

    const result = await buildApplication(users, undefined, undefined, orders).manager.listOrders();

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.value.length : 0, 2);
    assert.equal(result.ok ? result.value[0]?.employeeName : 'x', null);
  });

  it('does not name the admin who processed, nor the request submitter', async () => {
    // Three different people appear across the pipeline. The history row names
    // the order's own employee and no one else.
    const orders = new FakeOrdersRepository([
      makeOrder({ userId: 'uid-emp', userName: 'أحمد', requestId: 'req-9' }),
    ]);

    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listOrders();

    const view = result.ok ? result.value[0] : null;
    assert.equal(view?.userId, 'uid-emp');
    assert.equal(
      Object.keys(view ?? {}).some((key) => key === 'processedBy' || key === 'submittedBy'),
      false,
      'neither the submitter nor the processing admin may appear',
    );
  });
});

describe('Stage 12 requirement 4: the screen cannot write', () => {
  it('declares no write method on the orders repository contract', () => {
    const contract = readFileSync(
      join(projectRoot, 'electron', 'repositories', 'contracts', 'order-repository.ts'),
      'utf8',
    );
    const code = contract.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // Stage 6 produces orders inside its transaction. A writer here would be a
    // second, unaudited producer, so the contract must not even be able to name
    // one.
    for (const forbidden of ['create', 'update', 'delete', 'write', 'commit', 'process']) {
      assert.equal(
        new RegExp(`\\b${forbidden}\\w*\\s*\\(`, 'i').test(code),
        false,
        `the read-only orders contract must not declare a "${forbidden}" method`,
      );
    }
  });

  it('exposes no orders write from the application layer', () => {
    const source = readFileSync(join(projectRoot, 'electron', 'application', 'manager-data.service.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    assert.equal(/\b(create|update|delete|write|commit)Order\w*\s*\(/.test(code), false);
    assert.match(code, /public async listOrders\(/, 'the only orders entry point is the read');
  });

  it('reads exactly once, and only the list, while the history is displayed', async () => {
    // The strongest available statement: drive the read the page performs and
    // assert the repository saw exactly one call, and it was a bounded list.
    const orders = new FakeOrdersRepository([makeOrder()]);

    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listOrders();

    assert.equal(result.ok, true);
    assert.deepEqual([...orders.seenLimits], [500]);
  });
});