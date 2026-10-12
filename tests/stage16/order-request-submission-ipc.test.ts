import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDrugManagerApi } from '../../electron/ipc/api';
import { IPC_CHANNELS, listIpcChannelNames } from '../../electron/ipc/channels';
import { createIpcHandlers } from '../../electron/ipc/handlers/application-handlers';
import { FakeMedicinesRepository, FakeOrderRequestsRepository, makeMedicine } from '../stage7/helpers/fakes';
import { buildApplication } from '../stage9/helpers';

type HandlerMap = Readonly<Record<string, (event: unknown, payload: unknown) => unknown>>;

async function invoke(handlers: HandlerMap, payload: unknown): Promise<ApplicationResult<unknown>> {
  return (await handlers[IPC_CHANNELS.orderRequestsSubmit]?.({}, payload)) as ApplicationResult<unknown>;
}

describe('Stage 16 submission IPC', () => {
  it('adds exactly one named channel and one typed bridge operation', async () => {
    assert.equal(IPC_CHANNELS.orderRequestsSubmit, 'drug-manager:order-requests:submit');
    assert.equal(listIpcChannelNames().filter((channel) => channel === IPC_CHANNELS.orderRequestsSubmit).length, 1);

    const used: { channel: string; args: readonly unknown[] }[] = [];
    const api = createDrugManagerApi(async (channel, ...args) => {
      used.push({ channel, args });
      return { ok: true, value: { requestId: 'generated-id' } };
    });
    await api.orderRequests.submit({ items: [{ medicineId: 'med-1', quantity: 1 }] });

    assert.deepEqual(used, [{
      channel: IPC_CHANNELS.orderRequestsSubmit,
      args: [{ items: [{ medicineId: 'med-1', quantity: 1 }] }],
    }]);
    assert.deepEqual(Object.keys(api.orderRequests).sort(), ['get', 'list', 'submit']);
    assert.equal('invoke' in api.orderRequests, false);
  });

  it('delegates to the application service and returns its safe result envelope', async () => {
    const requests = new FakeOrderRequestsRepository();
    const application = buildApplication(
      undefined,
      new FakeMedicinesRepository([makeMedicine()]),
      requests,
    );
    const handlers = createIpcHandlers({ application });

    const result = await invoke(handlers, { items: [{ medicineId: 'med-1', quantity: 2 }] });

    assert.deepEqual(result, { ok: true, value: { requestId: 'req-generated-stage16' } });
    assert.equal(requests.submitted[0]?.uid, 'uid-admin');
  });

  it('rejects hostile identity and request metadata without writing', async () => {
    const requests = new FakeOrderRequestsRepository();
    const application = buildApplication(
      undefined,
      new FakeMedicinesRepository([makeMedicine()]),
      requests,
    );
    const handlers = createIpcHandlers({ application });
    const hostile = [
      { items: [{ medicineId: 'med-1', quantity: 1 }], uid: 'uid-other' },
      { items: [{ medicineId: 'med-1', quantity: 1 }], status: 'processed' },
      { items: [{ medicineId: 'med-1', quantity: 1 }], requestDate: 'client-time' },
      { items: [{ medicineId: 'med-1', quantity: 1 }], requestId: 'client-id' },
      { items: [{ medicineId: 'med-1', quantity: 1 }], orderId: 'client-order' },
      { items: [{ medicineId: 'med-1', quantity: 1 }], path: 'order_requests/uid-other' },
      { items: [{ medicineId: 'med-1', quantity: 1 }], document: { uid: 'uid-other' } },
    ];

    for (const payload of hostile) {
      const result = await invoke(handlers, payload);
      assert.equal(result.ok, false);
      assert.equal(!result.ok ? result.error.code : null, 'VALIDATION_FAILED');
    }
    assert.deepEqual(requests.submitted, []);
  });
});
