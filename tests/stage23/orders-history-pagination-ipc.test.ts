import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDrugManagerApi } from '../../electron/ipc/api';
import { IPC_CHANNELS } from '../../electron/ipc/channels';
import { createIpcHandlers } from '../../electron/ipc/handlers/application-handlers';
import { FakeOrdersRepository, makeOrder } from '../stage7/helpers/fakes';
import { buildApplication } from '../stage9/helpers';

type Handlers = Readonly<Record<string, ((event: unknown, payload: unknown) => unknown)>>;

async function invoke(handlers: Handlers, channel: string, payload: unknown): Promise<ApplicationResult<unknown>> {
  return (await handlers[channel]?.({}, payload)) as ApplicationResult<unknown>;
}

describe('Stage 23 IPC pagination boundary', () => {
  it('keeps list and Load More payload-free and never exposes the continuation token', async () => {
    const orders = new FakeOrdersRepository([], null, [
      { orders: [makeOrder({ id: 'order-1' })], nextPageToken: 'private-cursor' },
      { orders: [makeOrder({ id: 'order-2' })], nextPageToken: null },
    ]);
    const handlers = createIpcHandlers({
      application: buildApplication(undefined, undefined, undefined, orders),
    });
    const first = await invoke(handlers, IPC_CHANNELS.ordersList, { pageToken: 'attacker-token', limit: 1 });
    const second = await invoke(handlers, IPC_CHANNELS.ordersHistoryLoadMore, {
      pageToken: 'attacker-token',
      collection: 'users',
      limit: 100000,
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(JSON.stringify(first).includes('private-cursor'), false);
    assert.deepEqual(orders.seenLimits, [500, 500]);
    assert.deepEqual(orders.seenPageTokens, [null, 'private-cursor']);
  });

  it('exposes only zero-argument bridge functions on the fixed history channels', async () => {
    const calls: { readonly channel: string; readonly args: readonly unknown[] }[] = [];
    const api = createDrugManagerApi(async (channel: string, ...args: readonly unknown[]) => {
      calls.push({ channel, args });
      return { ok: true, value: { orders: [], hasMore: false } };
    });

    assert.equal(api.orders.list.length, 0);
    assert.equal(api.orders.loadMore.length, 0);
    await api.orders.list();
    await api.orders.loadMore();

    assert.deepEqual(calls, [
      { channel: IPC_CHANNELS.ordersList, args: [] },
      { channel: IPC_CHANNELS.ordersHistoryLoadMore, args: [] },
    ]);
  });
});
