/**
 * Stage 7 - the IPC boundary itself.
 *
 * Four of the nine required proofs live here, and all four are about what the
 * renderer CAN and CANNOT reach:
 *   1. the renderer-facing API exposes no token
 *   2. the renderer-facing API exposes no raw Firestore access
 *   3. IPC handlers call application services, not repositories
 *   8. the renderer cannot invoke an arbitrary IPC channel
 *
 * The suite is deliberately static where static is the stronger proof. Reading
 * `electron/preload.ts` and the handler module as text can assert things a
 * runtime test cannot: that `ipcRenderer` is never handed over, that no channel
 * string is built from a variable, that a handler module does not import a
 * repository. A behavioural test proves what the code does; a source assertion
 * proves what it could never be changed to do without failing the build.
 *
 * No network, no Electron runtime, no production Firebase.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createManagerApplication } from '../../electron/application';
import { IPC_CHANNELS, listIpcChannelNames } from '../../electron/ipc/channels';
import { DRUG_MANAGER_API_VERSION, createDrugManagerApi } from '../../electron/ipc/api';
import { createIpcHandlers, readRequestId } from '../../electron/ipc/handlers/application-handlers';
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
  makeMedicine,
  makeOrderRequest,
  makeSettings,
  makeUser,
  rulesDenied,
} from './helpers/fakes';

/**
 * The project root.
 *
 * These tests live one directory deeper than the existing suites
 * (`tests/stage7/`), so the compiled file sits at `dist/tests/stage7/` and needs
 * three levels up. Getting this wrong turns every source assertion into a
 * confusing ENOENT instead of a clear failure.
 */
const projectRoot = join(__dirname, '..', '..', '..');

function readProjectFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

/**
 * Strips comments so a source guard reads CODE, not prose.
 *
 * Without this, a perfectly good explanatory comment that happens to mention a
 * forbidden word would fail the build - which trains people to work around the
 * guard instead of reading it. The state machine is deliberately simple: it
 * tracks string literals so that a `//` inside one is not mistaken for a
 * comment.
 */
function stripComments(source: string): string {
  let output = '';
  let index = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let quote = '';

  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';

    if (inLineComment) {
      if (character === '\n') {
        inLineComment = false;
        output += character;
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        index += 2;
        continue;
      }
      if (character === '\n') {
        output += character;
      }
      index += 1;
      continue;
    }

    if (quote !== '') {
      output += character;
      if (character === '\\') {
        output += next;
        index += 2;
        continue;
      }
      if (character === quote) {
        quote = '';
      }
      index += 1;
      continue;
    }

    if (character === '/' && next === '/') {
      inLineComment = true;
      index += 2;
      continue;
    }

    if (character === '/' && next === '*') {
      inBlockComment = true;
      index += 2;
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    }
    output += character;
    index += 1;
  }

  return output;
}

/** The CODE of a project file, with every comment removed. */
function readProjectCode(relativePath: string): string {
  return stripComments(readProjectFile(relativePath));
}

/** Builds the real application layer over fakes, for the handler tests. */
function buildApplication(stage6: FakeOrderProcessingService = new FakeOrderProcessingService()): ReturnType<typeof createManagerApplication> {
  return createManagerApplication({
    session: FakeSession.signedIn(),
    usersRepository: new FakeUsersRepository([makeUser()], null, makeUser()),
    medicinesRepository: new FakeMedicinesRepository([makeMedicine()]),
    settingsRepository: new FakeSettingsRepository(makeSettings()),
    orderRequestsRepository: new FakeOrderRequestsRepository([makeOrderRequest()]),
    ordersRepository: new FakeOrdersRepository([]),
    // Stage 14: wired so the audit read is buildable; these suites never call it.
    stockLogsRepository: new FakeStockLogsRepository(),
    // Stage 15: wired so the receipt path is buildable; these suites never call it.
    inboundStockTransactionFactory: async () => new FakeInboundStockTransaction(),
    orderProcessing: stage6,
  });
}

/** An invoke stub that records every channel the API actually touches. */
function recordingInvoke(response: unknown = null): {
  readonly invoke: (channel: string, ...args: readonly unknown[]) => Promise<unknown>;
  readonly calls: readonly { readonly channel: string; readonly args: readonly unknown[] }[];
} {
  const calls: { channel: string; args: readonly unknown[] }[] = [];
  return {
    calls,
    invoke: async (channel: string, ...args: readonly unknown[]): Promise<unknown> => {
      calls.push({ channel, args });
      return response;
    },
  };
}

/** Recursively collects every own key of a value that matches `pattern`. */
function findKeys(value: unknown, pattern: RegExp, path = '$'): string[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const found: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (pattern.test(key)) {
      found.push(`${path}.${key}`);
    }
    found.push(...findKeys(nested, pattern, `${path}.${key}`));
  }
  return found;
}

/**
 * Every source file that sits ON the renderer boundary.
 *
 * The list is written out rather than globbed so that adding a module here is a
 * deliberate act: a new file that talks to the renderer has to be audited.
 */
const BOUNDARY_FILES: readonly string[] = [
  join('electron', 'preload.ts'),
  join('electron', 'ipc', 'api.ts'),
  join('electron', 'ipc', 'channels.ts'),
  join('electron', 'ipc', 'handlers', 'application-handlers.ts'),
  join('electron', 'application', 'index.ts'),
  join('electron', 'application', 'views.ts'),
  join('electron', 'application', 'auth.service.ts'),
  join('electron', 'application', 'manager-data.service.ts'),
  join('electron', 'application', 'order-requests.service.ts'),
  join('electron', 'application', 'application-error.ts'),
  join('electron', 'application', 'application-result.ts'),
  join('src', 'shared', 'ipc-contract.d.ts'),
  join('src', 'shared', 'domain-view.d.ts'),
  join('src', 'renderer', 'renderer.ts'),
];

describe('Stage 7 requirement 8: the renderer cannot invoke an arbitrary channel', () => {
  it('exposes no generic invoke, send, or listener API', () => {
    const api = createDrugManagerApi(async () => null) as unknown as Record<string, unknown>;

    for (const forbidden of ['invoke', 'send', 'sendSync', 'on', 'once', 'postMessage', 'ipcRenderer', 'require', 'process']) {
      assert.equal(api[forbidden], undefined, `the bridge must not expose ${forbidden}`);
    }
  });

  it('routes every operation to a channel constant declared in channels.ts', async () => {
    const { invoke, calls } = recordingInvoke();
    const api = createDrugManagerApi(invoke);

    await api.getAppStatus();
    await api.auth.getState();
    await api.auth.signIn({ email: 'a@b.com', password: 'p' });
    await api.auth.signOut();
    await api.users.list();
    await api.medicines.list();
    await api.medicines.addInboundStock({ medicineId: 'med-1', quantity: 2 });
    await api.orderRequests.list();
    await api.orderRequests.get({ requestId: 'req-1' });
    await api.orderRequests.submit({ items: [{ medicineId: 'med-1', quantity: 1 }] });
    await api.settings.get();
    // Stage 12: the read-only history read takes NO argument, which is asserted
    // below by the absence of any second entry for this call.
    await api.orders.list();
    // Stage 23: Load More uses Main's cursor and takes no argument.
    await api.orders.loadMore();
    // Stage 17: the personal owner-scoped history also takes no argument.
    await api.orders.myHistory();
    await api.orders.process({ requestId: 'req-1' });
    await api.stockLogs.list();
    await api.stockLogs.listByOrder({ orderId: 'ord-2' });

    // Every channel used is a KNOWN channel. There is no way for a caller to
    // supply a channel name, so this equality is the whole guarantee.
    const known = new Set(listIpcChannelNames());
    for (const call of calls) {
      assert.equal(known.has(call.channel), true, `unknown channel reached: ${call.channel}`);
    }
    assert.deepEqual(calls.map((call) => call.channel), [
      IPC_CHANNELS.appStatus,
      IPC_CHANNELS.authGetState,
      IPC_CHANNELS.authSignIn,
      IPC_CHANNELS.authSignOut,
      IPC_CHANNELS.usersList,
      IPC_CHANNELS.medicinesList,
      IPC_CHANNELS.medicinesAddInboundStock,
      IPC_CHANNELS.orderRequestsList,
      IPC_CHANNELS.orderRequestsGet,
      IPC_CHANNELS.orderRequestsSubmit,
      IPC_CHANNELS.settingsGet,
      // Stage 12 added the READ-ONLY history channel. It sits next to
      // `ordersProcess` in the assertion because it is the same resource; it is
      // listed separately to make the one-way nature of this pair visible.
      IPC_CHANNELS.ordersList,
      IPC_CHANNELS.ordersHistoryLoadMore,
      IPC_CHANNELS.ordersMyHistory,
      IPC_CHANNELS.ordersProcess,
      IPC_CHANNELS.stockLogsList,
      IPC_CHANNELS.stockLogsListByOrder,
    ]);
  });

  it('never names a channel from a variable in the preload source', () => {
    const preload = readProjectFile(join('electron', 'preload.ts'));

    // Every `invoke` call site must pass a bare UPPERCASE constant, never an
    // expression. `invoke(someVariable)` is how an arbitrary-channel escape
    // would be introduced.
    const invokeCalls = [...preload.matchAll(/ipcRenderer\.invoke\(([^,)]+)/g)].map((match) => match[1]?.trim());
    // Stage 7 added five application operations; Stage 9 added `users.update`;
    // Stage 10 added `medicines.updateMaxQuantity`; Stage 11 added
    // `orderRequests.get`; Stage 12 added `orders.list`; Stage 23 added
    // `orders.loadMore`; Stage 15 added the
    // named inbound receipt; Stage 16 adds employee submission; Stage 17 adds
    // one payload-free personal history read; Stage 19 adds the selected-order
    // movement read.
    assert.equal(invokeCalls.length, 19, 'the preload must have exactly nineteen invoke call sites');
    for (const argument of invokeCalls) {
      assert.match(argument ?? '', /^[A-Z][A-Z0-9_]*$/, `channel must be a constant, found: ${String(argument)}`);
    }
  });

  it('keeps the preload channel list and the main-process list in lockstep', () => {
    const preload = readProjectFile(join('electron', 'preload.ts'));

    // A sandboxed preload cannot `require` the shared module, so the names are
    // duplicated. This assertion is what stops that duplication from rotting.
    for (const channel of listIpcChannelNames()) {
      assert.ok(preload.includes(`'${channel}'`), `preload is missing the channel literal for ${channel}`);
    }
    const literals = [...preload.matchAll(/'(drug-manager:[a-z:-]+)'/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(literals)].sort(), [...listIpcChannelNames()].sort());
  });

  it('keeps the preload API version in step with the shared factory', () => {
    const preload = readProjectFile(join('electron', 'preload.ts'));
    assert.ok(
      preload.includes(`const DRUG_MANAGER_API_VERSION = '${DRUG_MANAGER_API_VERSION}'`),
      'the preload API version must match electron/ipc/api.ts',
    );
  });

  it('exposes no channel that mirrors a Firestore REST verb', () => {
    // A channel named after a transport verb would be a channel the renderer
    // could aim at a document. Every name here is a named application intent.
    for (const channel of listIpcChannelNames()) {
      for (const forbiddenVerb of ['query', 'get-document', 'commit', 'batch-get', 'rollback', 'transaction', 'raw', 'execute']) {
        assert.equal(
          channel.includes(forbiddenVerb),
          false,
          `channel ${channel} looks like a transport primitive, not an operation`,
        );
      }
    }
  });

  it('registers a handler for exactly the application channels', () => {
    const handlers = createIpcHandlers({ application: buildApplication() });

    // Stage 9 added `users.update`; Stage 10 added `medicines.updateMaxQuantity`;
    // Stage 11 added `orderRequests.get`; Stage 15 added the named inbound receipt;
    // Stage 19 adds the selected-order movement read without any stock write.
    assert.deepEqual(Object.keys(handlers).sort(), [
      IPC_CHANNELS.medicinesAddInboundStock,
      IPC_CHANNELS.medicinesList,
      IPC_CHANNELS.medicinesUpdateMaxQuantity,
      IPC_CHANNELS.orderRequestsGet,
      IPC_CHANNELS.orderRequestsSubmit,
      IPC_CHANNELS.orderRequestsList,
      // Stage 12 adds the read-only `orders.list`. It is asserted here so the
      // handler set can never silently lose the history read again.
      IPC_CHANNELS.ordersList,
      IPC_CHANNELS.ordersHistoryLoadMore,
      IPC_CHANNELS.ordersMyHistory,
      IPC_CHANNELS.ordersProcess,
      IPC_CHANNELS.settingsGet,
      // Stage 14/19: the movement audit reads. No independent stock-log write exists.
      IPC_CHANNELS.stockLogsList,
      IPC_CHANNELS.stockLogsListByOrder,
      IPC_CHANNELS.usersList,
      IPC_CHANNELS.usersUpdate,
    ].sort());
    for (const handler of Object.values(handlers)) {
      assert.equal(typeof handler, 'function');
    }
  });
});

describe('Stage 7 requirement 1: the renderer-facing API exposes no token', () => {
  it('keeps every renderer-facing source file free of token vocabulary', () => {
    for (const relativePath of BOUNDARY_FILES) {
      const content = readProjectCode(relativePath).toLowerCase();
      for (const forbidden of ['idtoken', 'refreshtoken', 'accesstoken', 'bearertoken', 'serviceaccount', 'privatekey']) {
        assert.equal(content.includes(forbidden), false, `"${forbidden}" found in ${relativePath}`);
      }
    }
  });

  it('never lets a token reach the renderer, even through a sign-in success', async () => {
    const api = createDrugManagerApi(async () => ({
      success: true,
      authState: {
        authenticated: true,
        uid: 'uid-1',
        email: 'a@b.com',
        emailVerified: true,
        expirationTimeIso: '2026-09-29T10:00:00.000Z',
        displayName: 'Nour',
        role: 'admin',
      },
    }));

    const result = await api.auth.signIn({ email: 'a@b.com', password: 'p' });

    // The pass-through is a cast, so the guarantee has to be asserted, not
    // assumed: walk the whole returned tree looking for token-shaped keys.
    assert.deepEqual(findKeys(result, /token|secret|credential|apikey/i), []);
  });

  it('keeps the sign-in request free of anything but credentials', async () => {
    const { invoke, calls } = recordingInvoke({ success: true, authState: {} });
    const api = createDrugManagerApi(invoke);

    await api.auth.signIn({ email: 'a@b.com', password: 'p' });

    const signInCall = calls.find((call) => call.channel === IPC_CHANNELS.authSignIn);
    assert.deepEqual(Object.keys((signInCall?.args[0] ?? {}) as Record<string, unknown>).sort(), ['email', 'password']);
  });

  it('never asks the Main process for a token', () => {
    // The only operations that exist are the named ones. A `getToken` call
    // would have to appear in this list, and the list is asserted exhaustively.
    const api = createDrugManagerApi(async () => null);
    assert.deepEqual(Object.keys(api).sort(), [
      'apiVersion', 'auth', 'getAppStatus', 'medicines', 'orderRequests', 'orders', 'settings', 'stockLogs', 'users',
    ]);
    assert.deepEqual(Object.keys(api.auth).sort(), ['getState', 'signIn', 'signOut']);
  });

  it('never writes a token to disk or to renderer storage', () => {
    // The Stage 3 guard already covers the transport; this extends it to the
    // whole Stage 7 boundary, so a future use case cannot start persisting one.
    for (const relativePath of [
      join('electron', 'application', 'auth.service.ts'),
      join('electron', 'application', 'views.ts'),
      join('electron', 'ipc', 'handlers', 'application-handlers.ts'),
      join('electron', 'preload.ts'),
    ]) {
      const content = readProjectFile(relativePath).toLowerCase();
      for (const forbidden of ['writefile', 'appendfile', 'localstorage', 'sessionstorage', 'keytar', 'safestorage', 'electron-store']) {
        assert.equal(content.includes(forbidden), false, `"${forbidden}" found in ${relativePath}`);
      }
    }
  });
});

describe('Stage 7 requirement 2: the renderer-facing API exposes no raw Firestore access', () => {
  it('keeps Firestore wire vocabulary out of the whole boundary', () => {
    // Wire values in a renderer type would mean the transport leaked past the
    // mappers. This list is the vocabulary the Stage 3/5A layers own exclusively.
    const wireVocabulary: readonly string[] = [
      'stringValue', 'integerValue', 'doubleValue', 'booleanValue', 'nullValue',
      'mapValue', 'arrayValue', 'timestampValue', 'updateMask', 'setToServerValue',
      'relativePath', 'runQuery', 'batchGet', 'commitWrites', 'beginTransaction',
      'structuredQuery', '/documents/', 'fieldFilter', 'writeResults', 'commitTime',
    ];

    for (const relativePath of BOUNDARY_FILES) {
      const content = readProjectCode(relativePath);
      for (const token of wireVocabulary) {
        assert.equal(content.includes(token), false, `wire token "${token}" found in ${relativePath}`);
      }
    }
  });

  it('never hands the renderer a document path or a collection name', async () => {
    // The API factory is a pure pass-through, so the guarantee is not in it: it
    // is in the projection. This drives the REAL application service, whose
    // repository returns domain models, and checks what actually arrives.
    const application = buildApplication();
    const result = await application.manager.listUsers();

    assert.equal(result.ok, true);
    const serialised = JSON.stringify(result);
    assert.equal(serialised.includes('users/'), false);
    assert.equal(serialised.includes('relativePath'), false);
    assert.equal(serialised.includes('medicines/'), false);
    assert.equal(serialised.includes('order_requests/'), false);
    assert.equal(serialised.includes('/documents/'), false);
  });

  it('exposes no operation beyond the declared ones', () => {
    // Each exposed function is checked by its full path below. The sole
    // employee-write operation is the narrow, named order-request submission.
    const api = createDrugManagerApi(async () => null);
    const found: string[] = [];
    const collect = (value: unknown, prefix: string): void => {
      if (typeof value !== 'object' || value === null) {
        return;
      }
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (typeof nested === 'function') {
          found.push(`${prefix}.${key}`);
        } else {
          collect(nested, `${prefix}.${key}`);
        }
      }
    };
    collect(api, 'api');

    // Stage 19 adds the selected-order movement read while the stock namespace
    // remains read-only and write-free.
    assert.deepEqual(found.sort(), [
      'api.auth.getState',
      'api.auth.signIn',
      'api.auth.signOut',
      'api.getAppStatus',
      'api.medicines.addInboundStock',
      'api.medicines.list',
      'api.medicines.updateMaxQuantity',
      'api.orderRequests.get',
      'api.orderRequests.list',
      'api.orderRequests.submit',
      'api.orders.list',
      'api.orders.loadMore',
      'api.orders.myHistory',
      'api.orders.process',
      'api.settings.get',
      'api.stockLogs.list',
      'api.stockLogs.listByOrder',
      'api.users.list',
      'api.users.update',
    ]);
  });

  it('keeps Firestore out of the compiled renderer bundle', () => {
    // The renderer cannot reach Firestore even in principle: its bundle has no
    // transport vocabulary, and its CSP forbids `connect-src`.
    const compiled = readProjectFile(join('dist', 'renderer', 'renderer.js')).toLowerCase();
    for (const forbidden of ['firestore', 'firebase', 'googleapis', 'runquery', 'batchget', 'commitwrites']) {
      assert.equal(compiled.includes(forbidden), false, `"${forbidden}" found in the renderer bundle`);
    }
  });
});

describe('Stage 7 requirement 3: IPC handlers call application services, not repositories', () => {
  it('imports no repository and no transport from the handler module', () => {
    const handlerCode = readProjectCode(join('electron', 'ipc', 'handlers', 'application-handlers.ts'));

    // The rule is enforced by the import list, not by discipline. A handler that
    // reached for a repository would need an import this file does not have.
    for (const forbidden of [
      'repositories',
      'firestore',
      'domain/models',
      'services/firestore',
      'FirestoreRestClient',
      'UsersRepository',
      'MedicinesRepository',
      'OrderRequestsRepository',
      'SettingsRepository',
      'FirestoreOrderProcessingService',
      "from 'electron'",
    ]) {
      assert.equal(handlerCode.includes(forbidden), false, `the handler module must not mention ${forbidden}`);
    }
  });

  it('imports no repository IMPLEMENTATION from the application layer', () => {
    for (const relativePath of BOUNDARY_FILES) {
      if (!relativePath.includes(join('electron', 'application'))) {
        continue;
      }
      const code = readProjectCode(relativePath);
      // Only `repositories/contracts/...` is allowed. The barrel also exports
      // the Firestore implementations, which is exactly what must stay out of
      // reach of the application layer.
      assert.equal(code.includes('repositories/firestore'), false, `Firestore implementation imported in ${relativePath}`);
      assert.equal(/from '\.\.\/repositories'/.test(code), false, `the repositories barrel is imported in ${relativePath}`);
    }
  });

  it('routes each channel to the matching application service operation', async () => {
    const stage6 = new FakeOrderProcessingService();
    const handlers = createIpcHandlers({ application: buildApplication(stage6) });

    const users = await handlers[IPC_CHANNELS.usersList]?.({}, null) as ApplicationResult<readonly unknown[]>;
    const medicines = await handlers[IPC_CHANNELS.medicinesList]?.({}, null) as ApplicationResult<readonly unknown[]>;
    const requests = await handlers[IPC_CHANNELS.orderRequestsList]?.({}, null) as ApplicationResult<readonly unknown[]>;
    const settings = await handlers[IPC_CHANNELS.settingsGet]?.({}, null) as ApplicationResult<unknown>;
    const processed = await handlers[IPC_CHANNELS.ordersProcess]?.({}, { requestId: 'req-7' }) as ApplicationResult<unknown>;

    assert.equal(users?.ok, true);
    assert.equal(medicines?.ok, true);
    assert.equal(requests?.ok, true);
    assert.equal(settings?.ok, true);
    assert.equal(processed?.ok, true);
    // The order channel reached the Stage 6 service with the id it was given.
    assert.deepEqual(stage6.calls.map((call) => call.requestId), ['req-7']);
  });

  it('never throws across the bridge, whatever the payload is', async () => {
    const handlers = createIpcHandlers({ application: buildApplication() });
    const payloads: readonly unknown[] = [
      null, undefined, 42, 'string', [], {}, { requestId: null }, { requestId: {} },
      { requestId: 'a'.repeat(5000) }, { requestId: 'req-1', extra: 'ignored' },
    ];

    for (const payload of payloads) {
      const result = await handlers[IPC_CHANNELS.ordersProcess]?.({}, payload) as ApplicationResult<unknown>;
      // A rejected `invoke` would make Electron build a renderer-facing error
      // from the internal Error's own properties. An envelope cannot.
      assert.equal(typeof result, 'object');
      assert.notEqual(result, null);
      assert.equal('ok' in result, true);
    }
  });

  it('reads only the requestId out of the payload', () => {
    assert.equal(readRequestId({ requestId: 'req-1' }), 'req-1');
    assert.equal(readRequestId({ requestId: '' }), '');
    // A payload cannot smuggle in a second instruction alongside the id.
    assert.equal(readRequestId({ requestId: 'req-1', uid: 'attacker', role: 'admin' }), 'req-1');
    for (const unusable of [null, undefined, 42, 'req-1', [], {}]) {
      assert.equal(readRequestId(unusable), null);
    }
  });

  it('turns a repository failure into a safe envelope, never a rejection', async () => {
    // A rules denial is the realistic case: the handler resolves with a code, so
    // no internal message can ever cross the bridge.
    const application = createManagerApplication({
      session: FakeSession.signedIn(),
      usersRepository: new FakeUsersRepository([], rulesDenied('users')),
      medicinesRepository: new FakeMedicinesRepository([]),
      settingsRepository: new FakeSettingsRepository(null),
      orderRequestsRepository: new FakeOrderRequestsRepository([]),
      ordersRepository: new FakeOrdersRepository([]),
    // Stage 14: wired so the audit read is buildable; these suites never call it.
    stockLogsRepository: new FakeStockLogsRepository(),
    // Stage 15: wired so the receipt path is buildable; these suites never call it.
    inboundStockTransactionFactory: async () => new FakeInboundStockTransaction(),
      orderProcessing: new FakeOrderProcessingService(),
    });
    const handlers = createIpcHandlers({ application });

    const result = await handlers[IPC_CHANNELS.usersList]?.({}, null) as ApplicationResult<unknown>;

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
    assert.deepEqual(!result.ok ? Object.keys(result.error).sort() : [], ['code', 'message', 'retryable']);
  });
});
