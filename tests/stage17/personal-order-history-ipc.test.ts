import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createManagerApplication } from '../../electron/application';
import { createDrugManagerApi } from '../../electron/ipc/api';
import { IPC_CHANNELS, listIpcChannelNames } from '../../electron/ipc/channels';
import { createIpcHandlers } from '../../electron/ipc/handlers/application-handlers';
import { FakeInboundStockTransaction, FakeMedicinesRepository, FakeOrderProcessingService, FakeOrderRequestsRepository, FakeOrdersRepository, FakeSettingsRepository, FakeStockLogsRepository, FakeUsersRepository, makeOrder } from '../stage7/helpers/fakes';

function buildApp(orders: FakeOrdersRepository) {
  return createManagerApplication({
    session: {
      getSafeState: () => ({
        authenticated: true,
        uid: 'trusted-main-uid',
        email: 'employee@example.com',
        emailVerified: true,
        expirationTimeIso: null,
      }),
      signInWithEmailAndPassword: async () => {
        throw new Error('not used by this test');
      },
      signOut: () => undefined,
    },
    usersRepository: new FakeUsersRepository(),
    medicinesRepository: new FakeMedicinesRepository(),
    settingsRepository: new FakeSettingsRepository(),
    orderRequestsRepository: new FakeOrderRequestsRepository(),
    ordersRepository: orders,
    stockLogsRepository: new FakeStockLogsRepository(),
    inboundStockTransactionFactory: async () => new FakeInboundStockTransaction(),
    orderProcessing: new FakeOrderProcessingService(),
  });
}

describe('Stage 17 personal order history IPC', () => {
  it('adds exactly one named, payload-free preload operation and channel', async () => {
    assert.equal(IPC_CHANNELS.ordersMyHistory, 'drug-manager:orders:my-history');
    assert.equal(listIpcChannelNames().filter((channel) => channel === IPC_CHANNELS.ordersMyHistory).length, 1);

    const calls: { readonly channel: string; readonly args: readonly unknown[] }[] = [];
    const api = createDrugManagerApi(async (channel, ...args) => {
      calls.push({ channel, args });
      return { ok: true, value: [] };
    });
    await api.orders.myHistory();

    assert.deepEqual(calls, [{ channel: IPC_CHANNELS.ordersMyHistory, args: [] }]);
    // Stage 23 adds `orders.loadMore`, a second READ-ONLY history operation that
    // continues the Main-owned cursor. It adds no write verb to this namespace.
    assert.deepEqual(Object.keys(api.orders).sort(), ['list', 'loadMore', 'myHistory', 'process']);
  });

  it('delegates to the application operation and uses trusted session identity despite hostile payload', async () => {
    const orders = new FakeOrdersRepository([makeOrder({ userId: 'trusted-main-uid' })]);
    const application = buildApp(orders);
    const handlers = createIpcHandlers({ application });
    const result = await handlers[IPC_CHANNELS.ordersMyHistory]?.({}, {
      uid: 'renderer-selected-uid',
      limit: 1,
      collection: 'orders',
    }) as ApplicationResult<readonly PersonalOrderHistoryItemView[]>;

    assert.equal(result.ok, true);
    assert.deepEqual(orders.seenOwnerIds, ['trusted-main-uid']);
    assert.deepEqual(orders.seenLimits, [500]);
    assert.equal(JSON.stringify(result).includes('renderer-selected-uid'), false);
  });
});
