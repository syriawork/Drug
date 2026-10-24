/**
 * Stage 11 - the order-requests IPC contract.
 *
 * Stage 11 adds one named READ channel beside the existing process channel, and
 * the interesting question is what the RENDERER is still able to say. For the
 * queue that is "nothing"; for a single request and for processing that is an id
 * and nothing else.
 *
 * Each hostile payload below is refused WITHOUT the repository or the engine ever
 * being reached, which is asserted on the fake's own call counters. Asserting only
 * the returned code would pass even if the write had already happened and the
 * refusal came afterwards.
 *
 * No network, no Electron runtime, no production backend.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DRUG_MANAGER_API_VERSION, createDrugManagerApi } from '../../electron/ipc/api';
import { IPC_CHANNELS } from '../../electron/ipc/channels';
import { createIpcHandlers, readRequestId } from '../../electron/ipc/handlers/application-handlers';
import {
  FakeOrderProcessingService,
  FakeOrderRequestsRepository,
  makeOrderRequest,
} from '../stage7/helpers/fakes';
import { buildApplication, buildApplicationWithStage6 } from '../stage9/helpers';

type Handlers = Readonly<Record<string, ((event: unknown, payload: unknown) => unknown)>>;

/**
 * Invokes a handler and reads its envelope.
 *
 * The handler map is typed as returning `unknown` on purpose - a handler's real
 * return shape is the application's business, not the IPC layer's. This helper
 * casts once, in the test, rather than weakening the production type.
 */
async function invoke(handlers: Handlers, channel: string, payload: unknown): Promise<ApplicationResult<unknown>> {
  return (await handlers[channel]?.({}, payload)) as ApplicationResult<unknown>;
}

/**
 * Payloads carrying NO usable id. Each must be refused before any I/O.
 *
 * `requestId` values carrying `/` or `.` are here on purpose: the REST path is
 * built by joining segments, so an id that addressed `users/uid-1` would read a
 * DIFFERENT collection than the caller named.
 */
const UNUSABLE_PAYLOADS: readonly unknown[] = [
  null,
  42,
  'req-1',
  [],
  {},
  { id: 'req-1' },
  { requestId: null },
  { requestId: 42 },
  { requestId: '' },
  { requestId: 'order_requests/req-1' },
  { requestId: 'users/uid-1' },
  { requestId: '../users/uid-1' },
  { requestId: 'a.b' },
  { requestId: 'req-1'.repeat(200) },
];

/**
 * Payloads carrying a VALID id together with fields a renderer must not be able
 * to influence. These are ACCEPTED, because the extra keys are dropped at the
 * handler rather than forwarded - and the cases below prove the drop by showing
 * the engine still receives exactly the id that was named.
 */
const VALID_ID_WITH_EXTRA_FIELDS: readonly unknown[] = [
  { requestId: 'req-1', role: 'admin' },
  { requestId: 'req-1', status: 'processed' },
  { requestId: 'req-1', orderId: 'order-9' },
  { requestId: 'req-1', items: [] },
  { requestId: 'req-1', updateMask: ['status'] },
  { requestId: 'req-1', processedBy: 'uid-somebody-else' },
];

describe('Stage 11 requirement 1: the queue and the single read are NAMED channels', () => {
  it('registers the list, the get and the process channels', () => {
    assert.equal(IPC_CHANNELS.orderRequestsList, 'drug-manager:order-requests:list');
    assert.equal(IPC_CHANNELS.orderRequestsGet, 'drug-manager:order-requests:get');
    assert.equal(IPC_CHANNELS.ordersProcess, 'drug-manager:orders:process');

    const handlers = createIpcHandlers({ application: buildApplication() });
    assert.equal(typeof handlers[IPC_CHANNELS.orderRequestsList], 'function');
    assert.equal(typeof handlers[IPC_CHANNELS.orderRequestsGet], 'function');
    assert.equal(typeof handlers[IPC_CHANNELS.ordersProcess], 'function');
  });

  it('reaches every operation from the typed bridge, never a channel name', async () => {
    const channels: string[] = [];
    const api = createDrugManagerApi(async (channel: string) => {
      channels.push(channel);
      return { ok: true, value: null };
    });

    await api.orderRequests.list();
    await api.orderRequests.get({ requestId: 'req-1' });
    await api.orders.process({ requestId: 'req-1' });

    assert.deepEqual(channels, [
      IPC_CHANNELS.orderRequestsList,
      IPC_CHANNELS.orderRequestsGet,
      IPC_CHANNELS.ordersProcess,
    ]);
    // The renderer names an OPERATION. There is no parameter through which either
    // the channel or the payload shape could be redirected.
    assert.equal(Object.keys(api.orderRequests as object).includes('invoke'), false);
  });

  it('carries the bridge version the renderer asserts against', () => {
    assert.equal(typeof DRUG_MANAGER_API_VERSION, 'string');
    assert.notEqual(DRUG_MANAGER_API_VERSION.length, 0);
  });

  it('exposes exactly the Stage 11 surface, with no transport verb', () => {
    const api = createDrugManagerApi(async () => null) as unknown as Record<string, unknown>;

    assert.deepEqual(Object.keys(api['orderRequests'] as object).sort(), ['get', 'list', 'submit']);
    // Stage 12 adds `orders.list`, the READ-ONLY history read. `process` remains
    // the only WRITE on this namespace - the audit surface added a read, not a
    // second way to change an order.
    //
    // Stage 23 adds `orders.loadMore`, a second READ-ONLY history read that
    // continues the Main-owned cursor. Like `orders.list` it takes no payload,
    // so the namespace still holds exactly one write verb.
    assert.deepEqual(Object.keys(api['orders'] as object).sort(), ['list', 'loadMore', 'myHistory', 'process']);
    for (const forbidden of ['invoke', 'send', 'sendSync', 'on', 'once', 'postMessage', 'ipcRenderer']) {
      assert.equal(api[forbidden], undefined, `the bridge must not expose ${forbidden}`);
    }
  });
});

describe('Stage 11 requirement 2: the single read reaches one document and no other', () => {
  it('routes the id to the application read', async () => {
    const requests = new FakeOrderRequestsRepository([makeOrderRequest({ id: 'req-42' })]);
    const handlers = createIpcHandlers({ application: buildApplication(undefined, undefined, requests) });

    const result = await invoke(handlers, IPC_CHANNELS.orderRequestsGet, { requestId: 'req-42' });

    assert.equal(result.ok, true);
    assert.equal(result.ok ? (result.value as { id: string }).id : null, 'req-42');
  });

  it('unwraps ONLY requestId, ignoring every other field in the payload', () => {
    // Extra fields are dropped here rather than forwarded. A payload that also
    // carried `status` must not be able to colour the document that is read.
    assert.equal(readRequestId({ requestId: 'req-1', status: 'processed' }), 'req-1');
    assert.equal(readRequestId({ requestId: 'req-1', updateMask: ['status'] }), 'req-1');
    for (const payload of [null, 42, 'req-1', [], { id: 'req-1' }, { requestId: null }]) {
      assert.equal(readRequestId(payload), null, `no id in ${JSON.stringify(payload) ?? 'null'}`);
    }
  });

  it('refuses every hostile payload without any I/O', async () => {
    const requests = new FakeOrderRequestsRepository([makeOrderRequest()]);
    const handlers = createIpcHandlers({ application: buildApplication(undefined, undefined, requests) });

    for (const payload of UNUSABLE_PAYLOADS) {
      const result = await invoke(handlers, IPC_CHANNELS.orderRequestsGet, payload);
      assert.equal(result.ok, false, `payload ${JSON.stringify(payload) ?? 'null'} must be refused`);
      assert.equal(!result.ok ? result.error.code : null, 'VALIDATION_FAILED');
    }
    assert.deepEqual([...requests.limits], [], 'no status query may run for a refused id');
  });
});

describe('Stage 11 requirements 3 & 4: processing forwards an id and nothing else', () => {
  it('names exactly the request the renderer named, whatever else was sent', async () => {
    // Each payload carries a valid id AND fields a renderer must not influence.
    // They are accepted - but the engine must still receive the id alone, so no
    // extra key can colour the actor, the status or the outcome.
    for (const [index, payload] of VALID_ID_WITH_EXTRA_FIELDS.entries()) {
      const stage6 = new FakeOrderProcessingService();
      const handlers = createIpcHandlers({ application: buildApplicationWithStage6(stage6) });

      await invoke(handlers, IPC_CHANNELS.ordersProcess, payload);

      assert.equal(stage6.calls.length, 1, `payload ${index} must reach the engine once`);
      assert.equal(stage6.calls[0]?.requestId, 'req-1');
      assert.deepEqual(
        Object.keys(stage6.calls[0] as unknown as Record<string, unknown>).sort(),
        ['actor', 'requestId'],
        'the engine is given the id and the session actor, nothing from the payload',
      );
    }
  });

  it('refuses every hostile payload before the engine is reached', async () => {
    const stage6 = new FakeOrderProcessingService();
    const handlers = createIpcHandlers({ application: buildApplicationWithStage6(stage6) });

    for (const payload of UNUSABLE_PAYLOADS) {
      const result = await invoke(handlers, IPC_CHANNELS.ordersProcess, payload);
      assert.equal(result.ok, false, `payload ${JSON.stringify(payload) ?? 'null'} must be refused`);
      assert.equal(!result.ok ? result.error.code : null, 'VALIDATION_FAILED');
    }
    // The decisive assertion: not one attempt reached the engine.
    assert.equal(stage6.calls.length, 0);
  });

  it('never rejects across the bridge, for any payload at all', async () => {
    const handlers = createIpcHandlers({ application: buildApplication() });

    for (const payload of [...UNUSABLE_PAYLOADS, { requestId: 'req-1' }]) {
      for (const channel of [IPC_CHANNELS.orderRequestsGet, IPC_CHANNELS.ordersProcess]) {
        const result = await handlers[channel]?.({}, payload);
        // A rejected `invoke` would make Electron serialise an internal Error into
        // the page. An envelope cannot.
        assert.equal(typeof result, 'object');
        assert.notEqual(result, null);
        assert.equal('ok' in (result as object), true);
      }
    }
  });

  it('returns each Stage 6 outcome as a plain, safe envelope', async () => {
    const outcomes: readonly (readonly [string, unknown, string])[] = [
      ['processed', { result: { kind: 'success', orderId: 'order-9' }, attempts: 1 }, 'processed'],
      [
        'rejected',
        { result: { kind: 'business-validation-failure', reason: 'Insufficient stock' }, attempts: 1 },
        'rejected',
      ],
      [
        'already-processed',
        { result: { kind: 'already-processed', status: 'processed' }, attempts: 1 },
        'already-processed',
      ],
    ];

    for (const [label, outcome, expected] of outcomes) {
      const handlers = createIpcHandlers({
        application: buildApplicationWithStage6(new FakeOrderProcessingService(outcome as never)),
      });
      const result = await invoke(handlers, IPC_CHANNELS.ordersProcess, { requestId: 'req-1' });

      assert.equal(result.ok, true, `${label} is a success envelope`);
      assert.equal(result.ok ? (result.value as { outcome: string }).outcome : null, expected);
    }
  });
});