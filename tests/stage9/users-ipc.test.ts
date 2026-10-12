/**
 * Stage 9 - the user IPC contract.
 *
 * The renderer reaches user data through exactly two NAMED channels. Everything
 * asserted here is about the SHAPE of that channel surface rather than its
 * behaviour:
 *
 *  6. the users list is a named IPC operation
 *  7. the user update is a named IPC operation
 *  8. arbitrary IPC channels still cannot be invoked
 *  9. invalid update payloads are refused AT THE BOUNDARY
 *
 * The recurring question is whether a caller could reach something the contract
 * does not list. A generic `invoke`, a channel parameter, or an update payload
 * carrying a whole document would each answer "yes", and each is asserted absent.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DRUG_MANAGER_API_VERSION, createDrugManagerApi } from '../../electron/ipc/api';
import { IPC_CHANNELS, listIpcChannelNames } from '../../electron/ipc/channels';
import { createIpcHandlers } from '../../electron/ipc/handlers/application-handlers';
import { FakeUsersRepository, makeUser, rulesDenied } from '../stage7/helpers/fakes';
import { buildApplication } from './helpers';

/** Recursively collects every own key of a value that matches `pattern`. */
function findKeys(value: unknown, pattern: RegExp): string[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const found: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (pattern.test(key)) {
      found.push(key);
    }
    found.push(...findKeys(nested, pattern));
  }
  return found;
}

/**
 * Invokes a handler and reads its envelope.
 *
 * The handler map is typed as returning `unknown` on purpose - a handler's real
 * return shape is the application's business, not the IPC layer's. This helper
 * casts once, in the test, rather than weakening the production type.
 */
async function invoke(
  handlers: Readonly<Record<string, ((event: unknown, payload: unknown) => unknown)>>,
  channel: string,
  payload: unknown,
): Promise<ApplicationResult<unknown>> {
  const result = await handlers[channel]?.({}, payload);
  return result as ApplicationResult<unknown>;
}

describe('Stage 9 requirements 6 & 7: users are reached by NAMED operations', () => {
  it('exposes exactly one list channel and one update channel', () => {
    assert.equal(IPC_CHANNELS.usersList, 'drug-manager:users:list');
    assert.equal(IPC_CHANNELS.usersUpdate, 'drug-manager:users:update');

    const handlers = createIpcHandlers({ application: buildApplication() });
    assert.equal(typeof handlers[IPC_CHANNELS.usersList], 'function');
    assert.equal(typeof handlers[IPC_CHANNELS.usersUpdate], 'function');
  });

  it('routes each channel to the matching application operation', async () => {
    const users = new FakeUsersRepository([makeUser()]);
    const handlers = createIpcHandlers({ application: buildApplication(users) });

    const listed = await invoke(handlers, IPC_CHANNELS.usersList, null);
    const updated = await invoke(handlers, IPC_CHANNELS.usersUpdate, { uid: 'uid-1', approval: 'approve' });

    assert.equal(users.listCalls, 1);
    assert.equal(listed.ok, true);
    assert.equal(users.callsTo('approveUser').length, 1);
    assert.equal(updated.ok, true);
  });

  it('reaches the update channel from the typed bridge, not from a channel name', async () => {
    const channels: string[] = [];
    const api = createDrugManagerApi(async (channel: string) => {
      channels.push(channel);
      return { ok: true, value: null };
    });

    await api.users.list();
    await api.users.update({ uid: 'uid-1', name: 'س' });

    // The renderer names an OPERATION; the channel is a constant inside the
    // bridge. There is no parameter through which to redirect either call.
    assert.deepEqual(channels, [IPC_CHANNELS.usersList, IPC_CHANNELS.usersUpdate]);
    assert.equal(Object.keys(api.users).sort().includes('invoke'), false);
  });
});

describe('Stage 9 requirement 8: arbitrary IPC channels still cannot be invoked', () => {
  it('exposes no generic invoke, send or listener API', () => {
    const api = createDrugManagerApi(async () => null) as unknown as Record<string, unknown>;

    for (const forbidden of ['invoke', 'send', 'sendSync', 'on', 'once', 'postMessage', 'ipcRenderer']) {
      assert.equal(api[forbidden], undefined, `the bridge must not expose ${forbidden}`);
    }
    // Medicine operations remain individually named: policy update and inbound
    // receipt are distinct, and neither exposes a generic transport verb.
    assert.deepEqual(Object.keys(api['users'] as object).sort(), ['list', 'update']);
    assert.deepEqual(Object.keys(api['medicines'] as object).sort(), [
      'addInboundStock',
      'list',
      'updateMaxQuantity',
    ]);
    // Stage 11 adds exactly one more, and it is a READ by id - no process verb,
    // no raw document, and no way to address anything but one request.
    assert.deepEqual(Object.keys(api['orderRequests'] as object).sort(), ['get', 'list', 'submit']);
  });

  it('keeps every channel a constant named after an operation', () => {
    for (const channel of listIpcChannelNames()) {
      for (const forbiddenVerb of ['query', 'get-document', 'commit', 'raw', 'execute', 'document']) {
        assert.equal(
          channel.includes(forbiddenVerb),
          false,
          `channel ${channel} looks like a transport primitive, not an operation`,
        );
      }
    }
  });
});
describe('Stage 9 requirement 9: invalid update payloads are refused at the boundary', () => {
  it('refuses a payload the application layer considers unusable', async () => {
    const users = new FakeUsersRepository([makeUser()]);
    const handlers = createIpcHandlers({ application: buildApplication(users) });

    const hostilePayloads: readonly unknown[] = [
      null, 42, 'string', [], {},
      { uid: 'uid-1', role: 'admin' },
      { uid: 'uid-1', employeeId: 'EMP-1' },
      { uid: 'uid-1', lastOrderMonthYear: '07-2026' },
      { uid: 'uid-1', approval: 'promote' },
      { uid: 'uid-1', status: 'approved' },
    ];

    for (const payload of hostilePayloads) {
      const result = await invoke(handlers, IPC_CHANNELS.usersUpdate, payload);
      assert.equal(result.ok, false, `payload ${JSON.stringify(payload) ?? 'null'} must be refused`);
      assert.equal(!result.ok ? result.error.code : null, 'VALIDATION_FAILED');
    }
    // Refused at the boundary: the repository was never asked to write anything.
    assert.equal(users.totalCalls, 0);
  });

  it('never rejects, so a refused payload cannot become a renderer-facing error object', async () => {
    const handlers = createIpcHandlers({ application: buildApplication() });

    for (const payload of [null, 42, { uid: 'uid-1', role: 'admin' }]) {
      const result = await handlers[IPC_CHANNELS.usersUpdate]?.({}, payload);
      // A rejected `invoke` would make Electron serialise an internal Error into
      // the page. An envelope cannot.
      assert.equal(typeof result, 'object');
      assert.notEqual(result, null);
      assert.equal('ok' in (result as object), true);
    }
  });

  it('turns a rules denial into a safe code rather than leaking the refusal', async () => {
    const users = new FakeUsersRepository([], rulesDenied('users/uid-1'));
    const handlers = createIpcHandlers({ application: buildApplication(users) });

    const result = await invoke(handlers, IPC_CHANNELS.usersUpdate, { uid: 'uid-1', approval: 'approve' });

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
    assert.equal(JSON.stringify(result).includes('users/uid-1'), false);
  });

  it('refuses a list for a caller the rules would deny, without faking an empty page', async () => {
    const users = new FakeUsersRepository([], rulesDenied('users'));
    const handlers = createIpcHandlers({ application: buildApplication(users) });

    const result = await invoke(handlers, IPC_CHANNELS.usersList, null);

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
  });
});

describe('Stage 9: the renderer bridge carries no token on the users surface', () => {
  it('returns no token-shaped key from either user operation', async () => {
    const api = createDrugManagerApi(async (channel: string) => {
      if (channel === IPC_CHANNELS.usersList) {
        return {
          ok: true,
          value: [{
            uid: 'uid-1', name: 'نور', employeeId: 'EMP-1', role: 'admin', status: 'approved',
            hasException: false, lastOrderId: null, lastOrderDateIso: null,
            lastOrderMonthYear: '', lastOrderMonthYearDisplay: null,
            lastOrderStatus: null, lastOrderIsException: false,
          }],
        };
      }
      return { ok: true, value: null };
    });

    const listed = await api.users.list();
    await api.users.update({ uid: 'uid-1', approval: 'approve' });

    assert.deepEqual(findKeys(listed, /token|secret|credential/i), []);
    assert.equal(JSON.stringify(listed).includes('users/'), false);
    assert.equal(JSON.stringify(listed).includes('isoValue'), false);
  });

  it('keeps the documented API version in step with the preload copy', () => {
    assert.equal(DRUG_MANAGER_API_VERSION, '0.3.0');
  });
});