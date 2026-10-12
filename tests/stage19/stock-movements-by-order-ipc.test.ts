import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDrugManagerApi } from '../../electron/ipc/api';
import { IPC_CHANNELS, listIpcChannelNames } from '../../electron/ipc/channels';
import { createIpcHandlers } from '../../electron/ipc/handlers/application-handlers';
import { createTestApplication, RecordingStockLogsRepository, stockLog } from './helpers';

describe('Stage 19: the named stockLogs.listByOrder IPC contract', () => {
  it('registers the one order-scoped channel and delegates its payload', async () => {
    const repository = new RecordingStockLogsRepository([stockLog()]);
    const handlers = createIpcHandlers({ application: createTestApplication(repository) });
    const handler = handlers[IPC_CHANNELS.stockLogsListByOrder];
    assert.equal(IPC_CHANNELS.stockLogsListByOrder, 'drug-manager:stock-logs:list-by-order');
    assert.equal(typeof handler, 'function');

    const response = await handler?.({}, { orderId: 'ord-3' }) as ApplicationResult<unknown>;
    assert.equal(response.ok, true);
    assert.deepEqual(repository.orderQueries, [{ orderId: 'ord-3', limit: 500 }]);
  });

  it('preload API fixes the channel and forwards only the named input', async () => {
    const calls: { readonly channel: string; readonly args: readonly unknown[] }[] = [];
    const api = createDrugManagerApi(async (channel, ...args) => {
      calls.push({ channel, args });
      return { ok: true, value: [] };
    });

    await api.stockLogs.listByOrder({ orderId: 'ord-3' });

    assert.deepEqual(calls, [{
      channel: IPC_CHANNELS.stockLogsListByOrder,
      args: [{ orderId: 'ord-3' }],
    }]);
    assert.deepEqual(Object.keys(api.stockLogs).sort(), ['list', 'listByOrder']);
    assert.equal(listIpcChannelNames().includes(IPC_CHANNELS.stockLogsListByOrder), true);
  });
});
