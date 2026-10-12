/**
 * Stage 12 - the orders-history IPC contract.
 *
 * Stage 12 adds one channel, and the entire point of this file is that it takes
 * NO PAYLOAD. Unlike every other renderer call in the system, there is nothing
 * for a hostile renderer to smuggle, so the assertions here are about the
 * ABSENCE of influence rather than the rejection of a bad value:
 *
 *  - a payload of any shape cannot change the limit, the filter, or the target;
 *  - the call crosses as a single argument-free invoke;
 *  - nothing on the channel can write.
 *
 * A payload that was merely IGNORED would still prove less than one that is not
 * even EXPRESSIBLE, so the preload signature is asserted to take no parameter and
 * the transport arity is asserted to be exactly one.
 *
 * No network, no Electron runtime, no production backend.
 */

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

/**
 * Hostile payloads aimed at the one channel that has no payload parameter.
 *
 * Every one of these must be inert. There is nothing to sanitise - the handler
 * never reads the payload - and the cases exist to prove that a future edit which
 * started reading it would be caught here.
 */
const HOSTILE_PAYLOADS: readonly unknown[] = [
  null,
  42,
  'orders',
  [],
  {},
  { limit: 100000 },
  { limit: 0 },
  { orderId: 'ord-1' },
  { userId: 'uid-emp' },
  { where: [['status', '==', 'accepted']] },
  { orderBy: 'date', limit: 1 },
  { role: 'admin' },
  { updateMask: ['status'] },
  { collection: 'users' },
];

describe('Stage 12 requirement 5: the history read is one NAMED, argument-free channel', () => {
  it('registers a handler for the history channel', () => {
    assert.equal(IPC_CHANNELS.ordersList, 'drug-manager:orders:list');

    const handlers = createIpcHandlers({ application: buildApplication() });
    assert.equal(typeof handlers[IPC_CHANNELS.ordersList], 'function');
  });

  it('crosses the bridge as exactly ONE argument-free invoke', async () => {
    const calls: { readonly channel: string; readonly arity: number }[] = [];
    const api = createDrugManagerApi(async (channel: string, ...args: readonly unknown[]) => {
      calls.push({ channel, arity: args.length });
      return { ok: true, value: { orders: [], hasMore: false } };
    });

    await api.orders.list();

    assert.deepEqual(calls, [{ channel: IPC_CHANNELS.ordersList, arity: 0 }]);
  });

  it('declares a typed method that accepts NO parameter at all', () => {
    // The strongest form of "no renderer-controlled payload": the type system
    // refuses to compile a call that tries to supply one.
    const api = createDrugManagerApi(async () => null);
    const list = (api.orders as { readonly list: () => unknown }).list;

    assert.equal(typeof list, 'function');
    assert.equal(list.length, 0, 'the bridge method must take no argument');
  });

  it('ignores every payload shape, so none of them can aim the read', async () => {
    for (const payload of HOSTILE_PAYLOADS) {
      const orders = new FakeOrdersRepository([makeOrder({ id: 'ord-1' })]);
      const handlers = createIpcHandlers({
        application: buildApplication(undefined, undefined, undefined, orders),
      });

      const result = await invoke(handlers, IPC_CHANNELS.ordersList, payload);

      assert.equal(result.ok, true, `payload ${JSON.stringify(payload) ?? 'null'} must still read`);
      // The application-owned limit is unchanged by anything the renderer sent,
      // which is the observable proof the payload was not consumed.
      assert.deepEqual([...orders.seenLimits], [500], `payload ${JSON.stringify(payload) ?? 'null'} influenced the read`);
    }
  });

  it('never returns a payload the renderer could turn back into a write', async () => {
    const orders = new FakeOrdersRepository([makeOrder()]);
    const handlers = createIpcHandlers({
      application: buildApplication(undefined, undefined, undefined, orders),
    });

    const result = await invoke(handlers, IPC_CHANNELS.ordersList, undefined);

    assert.equal(result.ok, true);
    const rows = result.ok
      ? (result.value as { readonly orders: readonly unknown[] }).orders
      : [];
    // Every row is a plain frozen projection. Nothing in it is a handle, a
    // document path, or a field a subsequent call could be built from.
    assert.equal(Array.isArray(rows), true);
    for (const row of rows as readonly Record<string, unknown>[]) {
      assert.equal(Object.keys(row).includes('ref'), false);
      assert.equal(Object.keys(row).includes('path'), false);
      assert.equal(Object.isFrozen(row), true);
    }
  });

  it('cannot write: the orders channel pair contains exactly one write', () => {
    const api = createDrugManagerApi(async () => null) as unknown as Record<string, object>;

    // `list` is the addition; `process` is Stage 11's. A future second writer on
    // this namespace would break this equality, which is the point.
    assert.deepEqual(Object.keys(api['orders'] as object).sort(), ['list', 'loadMore', 'myHistory', 'process']);
  });
});