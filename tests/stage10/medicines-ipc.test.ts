/**
 * Stage 10 - the medicine IPC contract.
 *
 * The recurring question is whether a caller could reach something the contract
 * does not list. For medicines the risk is sharper than for users, because the
 * collection holds INVENTORY: a caller must not be able to express a stock
 * movement, a counter, a document or a mask - only the one permitted field.
 *
 *  8. the medicine list is a named IPC operation
 *  9. the medicine update is a named IPC operation
 * 10. arbitrary IPC invocation is impossible
 * 11. invalid update payloads are refused at the boundary
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DRUG_MANAGER_API_VERSION, createDrugManagerApi } from '../../electron/ipc/api';
import { IPC_CHANNELS, listIpcChannelNames } from '../../electron/ipc/channels';
import { createIpcHandlers } from '../../electron/ipc/handlers/application-handlers';
import { FakeMedicinesRepository, makeMedicine, rulesDenied } from '../stage7/helpers/fakes';
import { buildApplication } from '../stage9/helpers';

/**
 * Invokes a handler and reads its envelope.
 *
 * The handler map returns `unknown` on purpose - a handler's real return shape is
 * the application's business, not the IPC layer's. The cast happens once, here.
 */
async function invoke(
  handlers: Readonly<Record<string, ((event: unknown, payload: unknown) => unknown)>>,
  channel: string,
  payload: unknown,
): Promise<ApplicationResult<unknown>> {
  const result = await handlers[channel]?.({}, payload);
  return result as ApplicationResult<unknown>;
}

describe('Stage 10 requirements 8 & 9: medicines are reached by NAMED operations', () => {
  it('exposes exactly one list channel and one update channel', () => {
    assert.equal(IPC_CHANNELS.medicinesList, 'drug-manager:medicines:list');
    assert.equal(IPC_CHANNELS.medicinesUpdateMaxQuantity, 'drug-manager:medicines:update-max-quantity');

    const handlers = createIpcHandlers({ application: buildApplication() });
    assert.equal(typeof handlers[IPC_CHANNELS.medicinesList], 'function');
    assert.equal(typeof handlers[IPC_CHANNELS.medicinesUpdateMaxQuantity], 'function');
  });

  it('routes each channel to the matching application operation', async () => {
    const medicines = new FakeMedicinesRepository([makeMedicine()]);
    const handlers = createIpcHandlers({
      application: buildApplication(undefined, medicines),
    });

    const listed = await invoke(handlers, IPC_CHANNELS.medicinesList, null);
    const updated = await invoke(handlers, IPC_CHANNELS.medicinesUpdateMaxQuantity, {
      medicineId: 'med-1',
      maxQuantity: 7,
    });

    assert.equal(medicines.limits.length, 1);
    assert.equal(listed.ok, true);
    assert.deepEqual([...medicines.callsTo], [['med-1', 7]]);
    assert.equal(updated.ok, true);
  });

  it('reaches the channels from the typed bridge, not from a channel name', async () => {
    const channels: string[] = [];
    const api = createDrugManagerApi(async (channel: string) => {
      channels.push(channel);
      return { ok: true, value: null };
    });

    await api.medicines.list();
    await api.medicines.updateMaxQuantity({ medicineId: 'med-1', maxQuantity: 3 });
    await api.medicines.addInboundStock({ medicineId: 'med-1', quantity: 2 });

    // The renderer names an OPERATION; the channel is a constant inside the
    // bridge, with no parameter through which to redirect it.
    assert.deepEqual(channels, [
      IPC_CHANNELS.medicinesList,
      IPC_CHANNELS.medicinesUpdateMaxQuantity,
      IPC_CHANNELS.medicinesAddInboundStock,
    ]);
    assert.deepEqual(Object.keys(api.medicines).sort(), [
      'addInboundStock',
      'list',
      'updateMaxQuantity',
    ]);
  });
});

describe('Stage 10 requirement 10: arbitrary IPC invocation is impossible', () => {
  it('exposes no generic invoke, send or listener API', () => {
    const api = createDrugManagerApi(async () => null) as unknown as Record<string, unknown>;

    for (const forbidden of ['invoke', 'send', 'sendSync', 'on', 'once', 'postMessage', 'ipcRenderer']) {
      assert.equal(api[forbidden], undefined, `the bridge must not expose ${forbidden}`);
    }
  });

  it('keeps every channel a constant named after an operation', () => {
    for (const channel of listIpcChannelNames()) {
      for (const forbiddenVerb of ['query', 'get-document', 'commit', 'raw', 'execute', 'patch']) {
        assert.equal(
          channel.includes(forbiddenVerb),
          false,
          `channel ${channel} looks like a transport primitive, not an operation`,
        );
      }
    }
  });

  it('offers only the named inbound receipt, never a generic inventory operation', () => {
    const medicineChannels = listIpcChannelNames().filter((channel) => channel.includes('medicines'));
    assert.deepEqual(medicineChannels.sort(), [
      IPC_CHANNELS.medicinesAddInboundStock,
      IPC_CHANNELS.medicinesList,
      IPC_CHANNELS.medicinesUpdateMaxQuantity,
    ].sort());
    assert.equal(IPC_CHANNELS.medicinesAddInboundStock, 'drug-manager:medicines:add-inbound-stock');

    for (const channel of medicineChannels.filter((entry) => entry !== IPC_CHANNELS.medicinesAddInboundStock)) {
      for (const forbidden of ['stock', 'inward', 'outward', 'delete', 'create', 'add'] as const) {
        assert.equal(channel.includes(forbidden), false, `${channel} must not offer a ${forbidden} operation`);
      }
    }
  });
});
describe('Stage 10 requirement 11: invalid update payloads are refused', () => {
  it('refuses every inventory field at the boundary', async () => {
    const medicines = new FakeMedicinesRepository([makeMedicine()]);
    const handlers = createIpcHandlers({
      application: buildApplication(undefined, medicines),
    });

    const hostile: readonly unknown[] = [
      null, 42, 'string', [], {},
      { medicineId: 'med-1', maxQuantity: 5, stock: 999 },
      { medicineId: 'med-1', maxQuantity: 5, totalInward: 999 },
      { medicineId: 'med-1', maxQuantity: 5, totalOutward: 999 },
      { medicineId: 'med-1', maxQuantity: 5, name: 'x' },
      { medicineId: 'med-1', maxQuantity: 1.5 },
      { medicineId: 'med-1', maxQuantity: '5' },
      { medicineId: 'med-1' },
      { maxQuantity: 5 },
    ];

    for (const payload of hostile) {
      const result = await invoke(handlers, IPC_CHANNELS.medicinesUpdateMaxQuantity, payload);
      assert.equal(result.ok, false, `payload ${JSON.stringify(payload) ?? 'null'} must be refused`);
      assert.equal(!result.ok ? result.error.code : null, 'VALIDATION_FAILED');
    }
    // Refused before the repository: no inventory write was even attempted.
    assert.deepEqual([...medicines.callsTo], []);
  });

  it('never rejects, so a refusal cannot become a renderer-facing error object', async () => {
    const handlers = createIpcHandlers({ application: buildApplication() });

    for (const payload of [null, 42, { medicineId: 'med-1', maxQuantity: 5, stock: 1 }]) {
      const result = await invoke(handlers, IPC_CHANNELS.medicinesUpdateMaxQuantity, payload);
      assert.equal(typeof result, 'object');
      assert.notEqual(result, null);
      assert.equal('ok' in (result as object), true);
    }
  });

  it('turns a rules denial into a safe code rather than leaking the refusal', async () => {
    const handlers = createIpcHandlers({
      application: buildApplication(undefined, new FakeMedicinesRepository([], rulesDenied('medicines/med-1'))),
    });

    const result = await invoke(handlers, IPC_CHANNELS.medicinesUpdateMaxQuantity, {
      medicineId: 'med-1',
      maxQuantity: 5,
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
    assert.equal(JSON.stringify(result).includes('medicines/med-1'), false);
  });

  it('keeps the documented API version in step with the preload copy', () => {
    assert.equal(DRUG_MANAGER_API_VERSION, '0.3.0');
  });
});