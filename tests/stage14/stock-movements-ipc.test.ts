/**
 * Stage 14 - the IPC surface of the READ-ONLY Stock Movement Audit page.
 *
 * WHAT THIS FILE PROVES
 * `stockLogs.list` is ONE argument-free channel, and the `stock_logs` namespace
 * carries no write verb at all. That second half matters more here than on any
 * other screen: the rules DO permit an admin to write `stock_logs` (line 86), so
 * the read-only guarantee rests entirely on this namespace having nothing to
 * write with. A `stockLogs.append` added later would be a stock write with a
 * channel, and these tests are what would stop it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createManagerApplication } from '../../electron/application';
import type { StockLog } from '../../electron/domain/models';
import { createDrugManagerApi } from '../../electron/ipc/api';
import { IPC_CHANNELS, listIpcChannelNames } from '../../electron/ipc/channels';
import { createIpcHandlers } from '../../electron/ipc/handlers/application-handlers';
import {
  FakeMedicinesRepository,
  FakeOrderProcessingService,
  FakeOrderRequestsRepository,
  FakeOrdersRepository,
  FakeSession,
  FakeSettingsRepository,
  FakeInboundStockTransaction,
  FakeStockLogsRepository,
  FakeUsersRepository,
  timestamp,
} from '../stage7/helpers/fakes';

const MOVEMENT: StockLog = {
  id: 'log-1',
  medicineId: 'med-42',
  medicineName: 'باراسيتامول',
  quantity: 7,
  type: 'outward',
  date: timestamp('2026-06-04T08:30:00.000Z'),
  label: 'صرف طلب Allison',
  actorUid: 'uid-employee',
  requestId: 'req-9',
  orderId: 'ord-3',
};

/**
 * Hostile payloads aimed at the one movement channel that has no payload.
 *
 * Each is inert, because the handler never reads the payload. They are here so
 * that a future edit which started reading it fails here rather than in review -
 * especially the filter and mask shapes, which are what a "read one medicine"
 * or "write these fields" payload would look like.
 */
const HOSTILE_PAYLOADS: readonly unknown[] = [
  null,
  42,
  'stock_logs',
  [],
  {},
  { documentPath: 'stock_logs/log-1' },
  { collection: 'stock_logs', documentId: 'log-1' },
  { medicineId: 'med-42' },
  { type: 'outward' },
  { quantity: 1 },
  { where: [['type', '==', 'inward']] },
  { updateMask: ['quantity'] },
  { merge: true },
  { append: true },
  { role: 'admin' },
];

type Handlers = Readonly<Record<string, ((event: unknown, payload: unknown) => unknown)>>;

function handlersOver(movements: FakeStockLogsRepository): Handlers {
  return createIpcHandlers({
    application: createManagerApplication({
      session: FakeSession.signedIn(),
      usersRepository: new FakeUsersRepository([]),
      medicinesRepository: new FakeMedicinesRepository([]),
      settingsRepository: new FakeSettingsRepository(null),
      orderRequestsRepository: new FakeOrderRequestsRepository([]),
      ordersRepository: new FakeOrdersRepository([]),
      stockLogsRepository: movements,
      // Stage 15: wired so the receipt path is buildable; this suite never calls it.
      inboundStockTransactionFactory: async () => new FakeInboundStockTransaction(),
      orderProcessing: new FakeOrderProcessingService(),
    }),
  });
}

async function invoke(handlers: Handlers, payload: unknown): Promise<ApplicationResult<unknown>> {
  return (await handlers[IPC_CHANNELS.stockLogsList]?.({}, payload)) as ApplicationResult<unknown>;
}
describe('Stage 14 requirement 1: the movement read is ONE argument-free channel', () => {
  it('registers a handler for the movement channel', () => {
    assert.equal(IPC_CHANNELS.stockLogsList, 'drug-manager:stock-logs:list');

    const handlers = handlersOver(new FakeStockLogsRepository([MOVEMENT]));
    assert.equal(typeof handlers[IPC_CHANNELS.stockLogsList], 'function');
  });

  it('crosses the bridge as exactly ONE argument-free invoke', async () => {
    const seen: unknown[] = [];
    const api = createDrugManagerApi(async (channel: string, ...args: readonly unknown[]) => {
      seen.push([channel, ...args]);
      return { ok: true, value: [] };
    });

    await api.stockLogs.list();

    // One channel, zero arguments. Anything else would be a parameter the renderer
    // could aim, which this read deliberately does not have.
    assert.deepEqual(seen, [['drug-manager:stock-logs:list']]);
  });

  it('declares a method that accepts NO parameter at all', () => {
    const api = createDrugManagerApi(async () => ({ ok: true, value: [] }));

    // `list.length === 0` is checked on the FUNCTION, so a signature that gained
    // an optional or defaulted argument would be caught here.
    assert.equal(api.stockLogs.list.length, 0);
  });

  it('ignores every payload shape, so none of them can aim the read', async () => {
    const movements = new FakeStockLogsRepository([MOVEMENT]);
    const handlers = handlersOver(movements);

    for (const payload of HOSTILE_PAYLOADS) {
      const result = await invoke(handlers, payload);

      assert.equal(result.ok, true, `a payload of ${JSON.stringify(payload) ?? 'undefined'} broke the read`);
      // The SAME window every time: a filter or a medicine id in the payload must
      // not have narrowed what came back.
      assert.equal(
        (result.ok ? (result.value as unknown[]).length : -1),
        1,
        'every payload shape must return the whole permitted window',
      );
    }
  });

  it('returns stored rows verbatim, with no handle to write back through', async () => {
    const handlers = handlersOver(new FakeStockLogsRepository([MOVEMENT]));

    const result = await invoke(handlers, undefined);

    assert.equal(result.ok, true);
    const rows = (result.ok ? result.value : []) as Record<string, unknown>[];
    assert.deepEqual(rows[0], {
      id: 'log-1',
      medicineId: 'med-42',
      label: 'صرف طلب Allison',
      quantity: 7,
      type: 'outward',
      dateIso: '2026-06-04T08:30:00.000Z',
      actorUid: 'uid-employee',
      requestId: 'req-9',
      orderId: 'ord-3',
    });
    // The payload is an ARRAY and nothing else: no totals object, no batch handle,
    // no callback, nothing that could be used to send a value back.
    assert.deepEqual(Object.keys(rows[0] ?? {}).filter((key) => key === 'total' || key === 'balance'), []);
  });
});
describe('Stage 14 requirement 2: the stock_logs namespace cannot write', () => {
  it('registers the read-only stock_logs channels and none of the write verbs', () => {
    const names = listIpcChannelNames().filter((name) => name.includes(':stock-logs:'));

    assert.deepEqual(names, ['drug-manager:stock-logs:list', 'drug-manager:stock-logs:list-by-order']);
  });

  it('declares no write verb anywhere in the stock_logs namespace', () => {
    // SCOPED TO THIS NAMESPACE. Other namespaces legitimately own writes -
    // `users:update` (Stage 9) and `medicines:update-max-quantity` (Stage 10) - so
    // a whole-surface "no write channel exists" assertion would fail two correct
    // screens. What must not exist is a write aimed at STOCK.
    const stockChannels = listIpcChannelNames().filter((name) => name.includes(':stock-logs:'));

    for (const writeVerb of ['save', 'create', 'update', 'delete', 'append', 'patch', 'set', 'write']) {
      assert.equal(
        stockChannels.some((name) => name.split(':')[2] === writeVerb),
        false,
        `no stock_logs channel may be named "${writeVerb}"`,
      );
    }
    // Still exactly the read-only stock movement channels, after the write check.
    assert.deepEqual(stockChannels, ['drug-manager:stock-logs:list', 'drug-manager:stock-logs:list-by-order']);
  });

  it('still lets the namespaces that legitimately write, write', () => {
    // The counterpart of the scoped check above, so it cannot be "fixed" later by
    // deleting writes that are correct: Stage 9 and Stage 10 own theirs, and this
    // stage did not take them away.
    const names = listIpcChannelNames();

    assert.equal(names.includes('drug-manager:users:update'), true, 'Stage 9 user writes must remain');
    assert.equal(
      names.includes('drug-manager:medicines:update-max-quantity'),
      true,
      'Stage 10 medicine writes must remain',
    );
  });

  it('exposes the read-only stock movement methods on the preload stock namespace', () => {
    const api = createDrugManagerApi(async () => ({ ok: true, value: [] }));

    // The rule the RULES cannot enforce: firestore.rules line 86 DOES allow an
    // admin to write `stock_logs`. So the read-only claim is not the server's - it
    // is this namespace's, and it holds because the only methods are reads.
    assert.deepEqual(Object.keys(api.stockLogs).sort(), ['list', 'listByOrder']);
  });

  it('registers no handler that can reach a stock write', async () => {
    const movements = new FakeStockLogsRepository([MOVEMENT]);
    const handlers = handlersOver(movements);

    for (const writeVerb of ['save', 'create', 'update', 'delete', 'append', 'patch', 'set']) {
      const channel = `drug-manager:stock-logs:${writeVerb}`;
      assert.equal(
        handlers[channel],
        undefined,
        `no handler may exist for ${channel}`,
      );
    }

    // And the one that DOES exist is a read. It is actually invoked here rather
    // than merely asserted absent, because "the write handlers do not exist" says
    // nothing about what the read does.
    await invoke(handlers, undefined);
    assert.deepEqual([...movements.seenLimits], [500]);
  });

  it('keeps the stock movement channel out of every write surface', () => {
    const channel = IPC_CHANNELS.stockLogsList.split(':');

    // `<app>:<area>:<verb>`: the area names the collection and the verb names the
    // operation. Asserting the VERB is `list` is the load-bearing part - a channel
    // called `drug-manager:stock-logs:set` would satisfy the naming convention and
    // still be a write.
    assert.equal(channel[1], 'stock-logs');
    assert.equal(channel[2], 'list');
  });
});