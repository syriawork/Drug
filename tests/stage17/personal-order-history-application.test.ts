import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createManagerApplication } from '../../electron/application';
import { ManagerApplicationService } from '../../electron/application/manager-data.service';
import { FakeInboundStockTransaction, FakeMedicinesRepository, FakeOrderProcessingService, FakeOrderRequestsRepository, FakeOrdersRepository, FakeSession, FakeSettingsRepository, FakeStockLogsRepository, FakeUsersRepository, makeOrder } from '../stage7/helpers/fakes';
import { buildApplication } from '../stage9/helpers';

function signedOutManager(orders: FakeOrdersRepository): ManagerApplicationService {
  const session = FakeSession.signedOut();
  const app = createManagerApplication({
    session,
    usersRepository: new FakeUsersRepository(),
    medicinesRepository: new FakeMedicinesRepository(),
    settingsRepository: new FakeSettingsRepository(),
    orderRequestsRepository: new FakeOrderRequestsRepository(),
    ordersRepository: orders,
    stockLogsRepository: new FakeStockLogsRepository(),
    inboundStockTransactionFactory: async () => new FakeInboundStockTransaction(),
    orderProcessing: new FakeOrderProcessingService(),
  });
  return app.manager;
}

describe('Stage 17 personal order history application', () => {
  it('uses the trusted session UID and fixed bound, returning only the safe personal projection', async () => {
    const orders = new FakeOrdersRepository([
      makeOrder({ id: 'own-order', userId: 'uid-admin', userName: 'private name' }),
      makeOrder({ id: 'not-returned', userId: 'uid-someone-else' }),
    ]);
    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listMyOrders();

    assert.equal(result.ok, true);
    assert.deepEqual(orders.seenOwnerIds, ['uid-admin']);
    assert.deepEqual(orders.seenLimits, [500]);
    assert.deepEqual(result.ok ? result.value : [], [{
      id: 'own-order',
      items: [{ medicineName: 'Panadol', quantity: 2 }],
      itemCount: 1,
      dateIso: '2026-06-03T08:00:00.000Z',
      monthYearDisplay: '06-2026',
      status: 'pending',
    }]);
    assert.equal(JSON.stringify(result).includes('uid-admin'), false);
    assert.equal(JSON.stringify(result).includes('private name'), false);
  });

  it('refuses a signed-out session without querying the repository', async () => {
    const orders = new FakeOrdersRepository([makeOrder()]);

    const result = await signedOutManager(orders).listMyOrders();

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'AUTHENTICATION_FAILED');
    assert.deepEqual(orders.seenOwnerIds, []);
    assert.deepEqual(orders.seenLimits, []);
  });

  it('maps repository failures through the safe application result', async () => {
    const orders = new FakeOrdersRepository([], new Error('private transport details'));

    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listMyOrders();

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(result).includes('private transport details'), false);
  });

  it('does not accept renderer input or use it as an owner identity', async () => {
    const orders = new FakeOrdersRepository([makeOrder({ userId: 'uid-admin' })]);
    const manager = buildApplication(undefined, undefined, undefined, orders).manager;

    const result = await manager.listMyOrders();

    assert.equal(result.ok, true);
    assert.deepEqual(orders.seenOwnerIds, ['uid-admin']);
  });
});
