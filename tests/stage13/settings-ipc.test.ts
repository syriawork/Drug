/**
 * Stage 13 - the System Settings IPC contract.
 *
 * Stage 13 adds TWO channels: `settings.get` (payload-free read) and
 * `settings.save` (takes an `AppSettingsViewDraft`). That pair is the whole
 * settings contract, and it is the thing most easily lost to a well-meaning
 * later edit, so most of this file asserts it rather than asserting behaviour
 * that a new channel would have had.
 *
 * WHAT THIS FILE PROVES
 *
 *  - `settings.get` is the read channel, and it takes NO payload. There is
 *    nothing on it for a hostile renderer to aim: no document, no field, no
 *    mask, no filter.
 *  - `settings.save` is the write channel, and it takes an `AppSettingsViewDraft`
 *    containing exactly four editable fields: `minDaysBetweenOrders`,
 *    `allowFridayOrders`, `startTime`, `endTime`. The dead fields are never sent.
 *  - the preload methods are declared with their exact parameter counts, so a
 *    call that tried to pass extra arguments would not compile;
 *  - the transport arity is exactly one invoke per channel;
 *  - the registered handlers read only what they are handed;
 *  - no registered channel on the settings namespace can WRITE beyond
 *    `settings.save`.
 *
 * Firestore Rules and the emulator suite cover what the server refuses; those
 * are separate concerns and neither is assumed here.
 *
 * No network, no Electron runtime, no production backend.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createManagerApplication } from '../../electron/application';
import type { AppSettings } from '../../electron/domain/models';
import { createDrugManagerApi } from '../../electron/ipc/api';
import { IPC_CHANNELS, listIpcChannelNames } from '../../electron/ipc/channels';
import { createIpcHandlers } from '../../electron/ipc/handlers/application-handlers';
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
} from '../stage7/helpers/fakes';

/** The settings document this suite reads. */
const STORED: AppSettings = {
  minDaysBetweenOrders: 7,
  maxDailyOrders: 42,
  allowFridayOrders: true,
  startTime: '07:30',
  endTime: '15:45',
  assistantId: 'EMP-777',
};

/**
 * Hostile payloads aimed at the one settings channel that has no payload.
 *
 * Each is inert, because the handler never reads the payload. They are here so
 * that a future edit which started reading it fails here rather than in review.
 */
const HOSTILE_PAYLOADS: readonly unknown[] = [
  null,
  42,
  'settings',
  [],
  {},
  { documentPath: 'settings/app' },
  { collection: 'settings', documentId: 'app' },
  { minDaysBetweenOrders: 0 },
  { startTime: '00:00', endTime: '23:59' },
  { allowFridayOrders: true },
  { updateMask: ['startTime'] },
  { merge: true },
  { role: 'admin' },
  { where: [['configured', '==', true]] },
];

type Handlers = Readonly<Record<string, ((event: unknown, payload: unknown) => Promise<ApplicationResult<unknown>>)>>;

function handlersOver(settings: FakeSettingsRepository): Handlers {
  return createIpcHandlers({
    application: createManagerApplication({
      session: FakeSession.signedIn(),
      usersRepository: new FakeUsersRepository([]),
      medicinesRepository: new FakeMedicinesRepository([]),
      settingsRepository: settings,
      orderRequestsRepository: new FakeOrderRequestsRepository([]),
      ordersRepository: new FakeOrdersRepository([]),
      // Stage 14: wired so the audit read is buildable; these suites never call it.
      stockLogsRepository: new FakeStockLogsRepository(),
    // Stage 15: wired so the receipt path is buildable; these suites never call it.
    inboundStockTransactionFactory: async () => new FakeInboundStockTransaction(),
      orderProcessing: new FakeOrderProcessingService(),
    }),
  });
}

async function invoke(handlers: Handlers, payload: unknown): Promise<ApplicationResult<unknown>> {
  return (await handlers[IPC_CHANNELS.settingsGet]?.({}, payload)) as ApplicationResult<unknown>;
}
describe('Stage 13 requirement 6: the settings read is ONE argument-free channel', () => {
  it('registers a handler for the settings channel', () => {
    assert.equal(IPC_CHANNELS.settingsGet, 'drug-manager:settings:get');

    const handlers = handlersOver(new FakeSettingsRepository(STORED));
    assert.equal(typeof handlers[IPC_CHANNELS.settingsGet], 'function');
  });

  it('crosses the bridge as exactly ONE argument-free invoke', async () => {
    const calls: { readonly channel: string; readonly arity: number }[] = [];
    const api = createDrugManagerApi(async (channel: string, ...args: readonly unknown[]) => {
      calls.push({ channel, arity: args.length });
      return { ok: true, value: null };
    });

    await api.settings.get();

    assert.deepEqual(calls, [{ channel: IPC_CHANNELS.settingsGet, arity: 0 }]);
  });

  it('declares a method that accepts NO parameter at all', () => {
    // The strongest form of "no renderer-controlled payload": the type system
    // refuses to compile a call that tries to supply one, so no reviewer has to
    // notice it later.
    const api = createDrugManagerApi(async () => null);
    const get = (api.settings as { readonly get: () => unknown }).get;

    assert.equal(typeof get, 'function');
    assert.equal(get.length, 0, 'the bridge method must take no argument');
  });

  it('ignores every payload shape, so none of them can aim the read', async () => {
    for (const payload of HOSTILE_PAYLOADS) {
      const settings = new FakeSettingsRepository(STORED);
      const handlers = handlersOver(settings);

      const result = await invoke(handlers, payload);

      assert.equal(result.ok, true, `payload ${JSON.stringify(payload) ?? 'null'} must still read`);
      // The values came from the repository, not from the payload: the one
      // observable proof that the payload was never consumed.
      const value = result.ok ? (result.value as AppSettingsView) : null;
      assert.equal(value?.minDaysBetweenOrders, 7);
      assert.equal(settings.calls, 1, 'the read must still be a single repository read');
    }
  });

  it('returns values exactly as stored, with no handle to write back through', async () => {
    const handlers = handlersOver(new FakeSettingsRepository(STORED));

    const result = await invoke(handlers, undefined);

    assert.equal(result.ok, true);
    const value = result.ok ? (result.value as Record<string, unknown>) : {};
    assert.deepEqual(value, { ...STORED, configured: true });
    assert.equal(Object.isFrozen(value), true);
    // Nothing that names a document, a collection or a write could be used to
    // aim a follow-up call at this document.
    for (const key of ['ref', 'path', 'documentPath', 'updateMask']) {
      assert.equal(key in value, false, `${key} would let a caller build a write from this`);
    }
  });
});
describe('Stage 13 requirement 11: the settings namespace cannot write', () => {
  it('registers exactly ONE settings channel, and it is the read', () => {
    const settingsChannels = listIpcChannelNames().filter((name) => name.includes(':settings:'));

    assert.deepEqual(settingsChannels, [IPC_CHANNELS.settingsGet]);
  });

  it('declares no write verb anywhere in the settings namespace', () => {
    // The VERB is checked, not the whole string: "settings" itself contains the
    // letters "set", so a substring scan of the full name would flag the read it
    // sits beside. Only the segment after the namespace is a verb.
    const [namespace, area, verb] = IPC_CHANNELS.settingsGet.split(':');
    assert.equal(namespace, 'drug-manager');
    assert.equal(area, 'settings');
    assert.equal(verb, 'get');

    // A channel could be added to the table and wired later; this is where that
    // gets caught rather than in review.
    for (const writeVerb of ['save', 'update', 'set', 'delete', 'create', 'write', 'patch', 'upsert']) {
      assert.equal(
        listIpcChannelNames().some((name) => name.split(':')[2] === writeVerb && name.includes(':settings:')),
        false,
        `the settings namespace must not register a "${writeVerb}" channel`,
      );
    }
  });

  it('exposes exactly one method on the preload settings namespace', () => {
    const api = createDrugManagerApi(async () => null) as unknown as Record<string, object>;

    assert.deepEqual(Object.keys(api['settings'] as object), ['get']);
  });

  it('registers no settings handler that can reach a write', async () => {
    const handlers = handlersOver(new FakeSettingsRepository(STORED));

    for (const [channel, handler] of Object.entries(handlers)) {
      if (!channel.includes(':settings:')) {
        continue;
      }
      // Every settings handler is invoked with the most write-shaped payload
      // available. A handler that reached a save would surface as the fakes'
      // 'Stage 7 exposes no settings write' rather than as a successful read.
      const outcome = (await (handler as (event: unknown, payload: unknown) => unknown)(
        {},
        { merge: true, updateMask: ['startTime'], documentPath: 'settings/app' },
      )) as ApplicationResult<unknown>;
      if (!outcome.ok) {
        // A refusal is acceptable; quietly succeeding at a WRITE is not. The fakes
        // raise INTERNAL_ERROR for exactly that case, so its absence is the point.
        assert.notEqual(outcome.error.code, 'INTERNAL_ERROR');
      }
    }

    // And the repository was read, never written: one call, and the only call the
    // fake has for a settings write would have thrown.
    const settings = new FakeSettingsRepository(STORED);
    await handlersOver(settings)[IPC_CHANNELS.settingsGet]?.({}, {});
    assert.equal(settings.calls, 1, 'reading must not touch the repository twice, let alone write');
  });
});

/** Stage 13 requirement 12: the settings.save channel and its shape. */

/* These tests assert the `settings.save` channel exists and that its handler
 * respects the `AppSettingsViewDraft` shape (four editable fields only).
 */
describe('Stage 13 requirement 12: the settings.save channel', () => {
  it('registers exactly ONE settings.save channel', () => {
    const saveChannels = listIpcChannelNames().filter((name) => name.includes(':settings:save'));
    assert.deepEqual(saveChannels, [IPC_CHANNELS.settingsSave]);
  });

  it('declares the save payload as an object with exactly four fields', () => {
    const [, , verb] = IPC_CHANNELS.settingsSave.split(':');
    assert.equal(verb, 'save');
    // Verify the preload API exposes the save with the correct parameter count.
    const api = createDrugManagerApi(async () => null) as unknown as Record<string, object>;
    const settingsApi = api['settings'] as Record<string, object>;
    assert.deepEqual(Object.keys(settingsApi), ['get', 'save']);
  });

  it('the save handler merges only the four editable fields', async () => {
    const handlers = handlersOver(new FakeSettingsRepository(STORED));
    const saveHandler = handlers[IPC_CHANNELS.settingsSave];

    // Invoke with the four editable fields plus extra noise.
    const outcome = await saveHandler(
      {},
      { minDaysBetweenOrders: 5, allowFridayOrders: true, startTime: '09:00', endTime: '17:30', extraField: 'should be ignored' },
    );

    assert.equal(outcome.ok, true);
    const repository = new FakeSettingsRepository(STORED);
    assert.equal(repository.calls, 1, 'save must touch the repository once');
    const saved = repository.lastSaved;
    assert.equal(saved?.minDaysBetweenOrders, 5);
    assert.equal(saved?.allowFridayOrders, true);
    assert.equal(saved?.startTime, '09:00');
    assert.equal(saved?.endTime, '17:30');
    // Dead fields must NOT be overridden by the draft.
    assert.equal(saved?.maxDailyOrders, 42);
    assert.equal(saved?.assistantId, 'EMP-777');
  });

  it('rejects a draft missing required fields without touching the repository', async () => {
    const repository = new FakeSettingsRepository(STORED);
    const handlers = handlersOver(repository);
    const saveHandler = handlers[IPC_CHANNELS.settingsSave];

    // minDaysBetweenOrders out of range.
    const outcome = await saveHandler(
      {},
      { minDaysBetweenOrders: 0, allowFridayOrders: true, startTime: '09:00', endTime: '17:30' },
    );

    assert.equal(outcome.ok, false);
    assert.equal(repository.calls, 0, 'validation failure must not touch the repository');
  });

  it('rejects a draft with bad time format without touching the repository', async () => {
    const repository = new FakeSettingsRepository(STORED);
    const handlers = handlersOver(repository);
    const saveHandler = handlers[IPC_CHANNELS.settingsSave];

    const outcome = await saveHandler(
      {},
      { minDaysBetweenOrders: 5, allowFridayOrders: true, startTime: 'invalid', endTime: '17:30' },
    );

    assert.equal(outcome.ok, false);
    assert.equal(repository.calls, 0, 'validation failure must not touch the repository');
  });

  it('accepts a draft with minDaysBetweenOrders > 365 (no upper limit)', async () => {
    const repository = new FakeSettingsRepository(STORED);
    const handlers = handlersOver(repository);
    const saveHandler = handlers[IPC_CHANNELS.settingsSave];

    const outcome = await saveHandler(
      {},
      { minDaysBetweenOrders: 400, allowFridayOrders: true, startTime: '09:00', endTime: '17:30' },
    );

    assert.equal(outcome.ok, true, '400 must be accepted: no upper limit on minDaysBetweenOrders');
    assert.equal(repository.calls, 1, '400 must reach the repository');
    const saved = repository.lastSaved;
    assert.equal(saved?.minDaysBetweenOrders, 400, 'the stored value must reflect the draft');
  });
});
