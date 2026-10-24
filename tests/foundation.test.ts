import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APP_DEFAULTS,
  AppConfigError,
  createAppConfig,
  resolveRendererIndexPath,
} from '../electron/config/app-config';
import { DRUG_MANAGER_API_VERSION, createDrugManagerApi } from '../electron/ipc/api';
import { IPC_CHANNELS, listIpcChannelNames } from '../electron/ipc/channels';
import {
  APP_STATUS_HEADING,
  APP_STATUS_LABEL,
  AppStatusError,
  createAppStatusPayload,
  createAppStatusProvider,
} from '../electron/services/app-status';
import { containsArabicCharacters, countArabicCharacters } from '../electron/util/text';
import {
  SECURITY_INVARIANTS,
  SecurityPolicyError,
  assertSecureWebPreferences,
  createSecureWebPreferences,
} from '../electron/window/security';

/** These tests need no file system access, no network access and no Electron runtime. */
const FAKE_PROJECT_ROOT = 'X:\\drug-manager';
const FAKE_PRELOAD_PATH = 'X:\\drug-manager\\dist\\electron\\preload.js';

function createTestStatusPayload(): AppStatusPayload {
  return createAppStatusPayload({
    appName: 'drug-manager',
    version: '0.1.0',
    electronVersion: '44.4.5',
    nodeVersion: '24.19.0',
    locale: 'ar',
    rtl: true,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

describe('application configuration', () => {
  it('describes an Arabic RTL manager window', () => {
    const config = createAppConfig({
      projectRoot: FAKE_PROJECT_ROOT,
      isDevelopment: true,
      defaults: APP_DEFAULTS,
    });

    assert.equal(config.appName, 'drug-manager');
    assert.equal(config.windowTitle, 'مدير نظام الطلبات والمخزون');
    assert.ok(containsArabicCharacters(config.windowTitle));
    assert.equal(config.isDevelopment, true);
    assert.equal(config.windowBounds.width, APP_DEFAULTS.width);
    assert.equal(config.windowBounds.minHeight, APP_DEFAULTS.minHeight);
    assert.ok(config.indexPath.endsWith('index.html'));
    assert.ok(config.indexPath.includes('dist'));
    assert.ok(config.indexPath.includes('renderer'));
    assert.ok(Object.isFrozen(config));
  });

  it('rejects an empty project root', () => {
    assert.throws(() => resolveRendererIndexPath('   '), AppConfigError);
  });

  it('rejects unusable window bounds', () => {
    assert.throws(() => createAppConfig({
      projectRoot: FAKE_PROJECT_ROOT,
      isDevelopment: false,
      defaults: { ...APP_DEFAULTS, width: 0 },
    }), AppConfigError);

    assert.throws(() => createAppConfig({
      projectRoot: FAKE_PROJECT_ROOT,
      isDevelopment: false,
      defaults: { ...APP_DEFAULTS, height: -10 },
    }), AppConfigError);

    assert.throws(() => createAppConfig({
      projectRoot: FAKE_PROJECT_ROOT,
      isDevelopment: false,
      defaults: { ...APP_DEFAULTS, width: 9999, minWidth: 20000 },
    }), AppConfigError);

    assert.throws(() => createAppConfig({
      projectRoot: FAKE_PROJECT_ROOT,
      isDevelopment: false,
      defaults: { ...APP_DEFAULTS, minHeight: 12.5 },
    }), AppConfigError);

    assert.doesNotThrow(() => createAppConfig({
      projectRoot: FAKE_PROJECT_ROOT,
      isDevelopment: false,
      defaults: { ...APP_DEFAULTS, width: 1000, height: 700, minWidth: 900, minHeight: 600 },
    }));
  });
});

describe('renderer security policy', () => {
  it('keeps every security invariant on the hardened preferences', () => {
    const preferences = createSecureWebPreferences({
      preloadPath: FAKE_PRELOAD_PATH,
      isDevelopment: true,
    });

    assert.equal(preferences.contextIsolation, SECURITY_INVARIANTS.contextIsolation);
    assert.equal(preferences.nodeIntegration, SECURITY_INVARIANTS.nodeIntegration);
    assert.equal(preferences.sandbox, SECURITY_INVARIANTS.sandbox);
    assert.equal(preferences.webSecurity, SECURITY_INVARIANTS.webSecurity);
    assert.equal(preferences.webviewTag, SECURITY_INVARIANTS.webviewTag);
    assert.equal(preferences.allowRunningInsecureContent, false);
    assert.equal(preferences.preload, FAKE_PRELOAD_PATH);
    assert.equal(preferences.devTools, true);
    assert.doesNotThrow(() => assertSecureWebPreferences(preferences));

    const productionPreferences = createSecureWebPreferences({
      preloadPath: FAKE_PRELOAD_PATH,
      isDevelopment: false,
    });
    assert.equal(productionPreferences.devTools, false);
  });

  it('refuses a missing preload script', () => {
    assert.throws(
      () => createSecureWebPreferences({ preloadPath: '  ', isDevelopment: true }),
      SecurityPolicyError,
    );
  });

  it('detects a weakened configuration', () => {
    const preferences = createSecureWebPreferences({
      preloadPath: FAKE_PRELOAD_PATH,
      isDevelopment: true,
    });

    const weakenedOverrides: readonly Partial<typeof preferences>[] = [
      { contextIsolation: false },
      { nodeIntegration: true },
      { sandbox: false },
      { webSecurity: false },
      { webviewTag: true },
      { allowRunningInsecureContent: true },
      { preload: '' },
    ];

    for (const override of weakenedOverrides) {
      assert.throws(
        () => assertSecureWebPreferences({ ...preferences, ...override }),
        SecurityPolicyError,
      );
    }
  });
});

describe('ipc bridge', () => {
  it('exposes exactly the minimal frozen API surface', () => {
    const api = createDrugManagerApi(async () => createTestStatusPayload());

    // Stage 7 added five NAMED application operations; Stage 9 added a sixth
    // (`users.update`). The assertion stays exhaustive on purpose: a new key
    // appearing here is a security decision that must be made deliberately.
    assert.deepEqual(Object.keys(api).sort(), [
      'apiVersion',
      'auth',
      'getAppStatus',
      'medicines',
      'orderRequests',
      'orders',
      'settings',
      // Stage 14 adds the READ-ONLY movement audit namespace. The assertion stays
      // exhaustive on purpose: a new key appearing here is a security decision
      // that must be made deliberately.
      'stockLogs',
      'users',
    ]);
    assert.equal(api.apiVersion, DRUG_MANAGER_API_VERSION);
    assert.ok(Object.isFrozen(api));
    // Stage 7: the whole tree is frozen, so a renderer cannot replace an operation.
    assert.ok(Object.isFrozen(api.auth));
    assert.ok(Object.isFrozen(api.users));
    assert.ok(Object.isFrozen(api.medicines));
    assert.ok(Object.isFrozen(api.orderRequests));
    assert.ok(Object.isFrozen(api.settings));
    assert.ok(Object.isFrozen(api.orders));
    // Stage 14: the movement namespace is frozen on the same terms - a renderer
    // must not be able to replace the read with something of its own.
    assert.ok(Object.isFrozen(api.stockLogs));
    assert.deepEqual(Object.keys(api.medicines).sort(), [
      'addInboundStock',
      'list',
      'updateMaxQuantity',
    ]);
    assert.deepEqual([...listIpcChannelNames()].sort(), [
      IPC_CHANNELS.appStatus,
      IPC_CHANNELS.authSignIn,
      IPC_CHANNELS.authSignOut,
      IPC_CHANNELS.authGetState,
      IPC_CHANNELS.usersList,
      IPC_CHANNELS.medicinesList,
      IPC_CHANNELS.orderRequestsList,
      IPC_CHANNELS.orderRequestsGet,
      IPC_CHANNELS.orderRequestsSubmit,
      IPC_CHANNELS.settingsGet,
      IPC_CHANNELS.ordersProcess,
      // Stage 12 adds one READ-ONLY channel. Nothing else about the surface
      // changed: no new top-level namespace, no new write.
      IPC_CHANNELS.ordersList,
      // Stage 23 adds one more READ-ONLY channel: the Main-owned cursor that
      // continues the history one page further. It still takes no payload and
      // adds no write verb.
      IPC_CHANNELS.ordersHistoryLoadMore,
      // Stage 17 adds one payload-free, owner-scoped read.
      IPC_CHANNELS.ordersMyHistory,
      // Stage 14 adds the read-only movement audit channels, and Stage 19 adds
      // the selected-order detail read while keeping the namespace write-free.
      IPC_CHANNELS.stockLogsList,
      IPC_CHANNELS.stockLogsListByOrder,
      IPC_CHANNELS.usersUpdate,
      IPC_CHANNELS.medicinesUpdateMaxQuantity,
      // Stage 15 adds only the named atomic inbound receipt operation.
      IPC_CHANNELS.medicinesAddInboundStock,
    ].sort());
  });

  it('routes getAppStatus through the registered channel', async () => {
    const usedChannels: string[] = [];
    const expectedPayload = createTestStatusPayload();

    const api = createDrugManagerApi(async (channel: string) => {
      usedChannels.push(channel);
      return expectedPayload;
    });

    const payload = await api.getAppStatus();

    assert.deepEqual(usedChannels, [IPC_CHANNELS.appStatus]);
    assert.deepEqual(payload, expectedPayload);
  });
});

describe('application status service', () => {
  it('reports an Arabic ready status', () => {
    const payload = createTestStatusPayload();

    assert.equal(payload.state, 'ready');
    assert.equal(payload.heading, APP_STATUS_HEADING);
    assert.equal(payload.label, APP_STATUS_LABEL);
    assert.ok(containsArabicCharacters(`${payload.heading}: ${payload.label}`));
    assert.equal(payload.rtl, true);
    assert.equal(payload.locale, 'ar');
    assert.equal(payload.startedAtIso, '2026-01-01T00:00:00.000Z');
    assert.ok(Object.isFrozen(payload));
  });

  it('returns a stable snapshot from the provider', () => {
    const provider = createAppStatusProvider({
      appName: 'drug-manager',
      version: '0.1.0',
      electronVersion: '44.4.5',
      nodeVersion: '24.19.0',
      locale: 'ar',
      rtl: true,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const first = provider();
    const second = provider();

    assert.equal(first, second);
    assert.equal(first.startedAtIso, second.startedAtIso);
  });

  it('rejects empty metadata and invalid dates', () => {
    assert.throws(() => createAppStatusPayload({
      appName: '',
      version: '0.1.0',
      electronVersion: '44.4.5',
      nodeVersion: '24.19.0',
      locale: 'ar',
      rtl: true,
      startedAt: new Date(),
    }), AppStatusError);

    assert.throws(() => createAppStatusPayload({
      appName: 'drug-manager',
      version: '0.1.0',
      electronVersion: '44.4.5',
      nodeVersion: '24.19.0',
      locale: 'ar',
      rtl: true,
      startedAt: new Date('not-a-date'),
    }), AppStatusError);
  });
});

describe('arabic text helpers', () => {
  it('detects and counts Arabic characters', () => {
    assert.equal(containsArabicCharacters('حالة التطبيق: يعمل'), true);
    assert.equal(containsArabicCharacters('drug-manager'), false);
    assert.ok(countArabicCharacters('حالة التطبيق') > 0);
    assert.equal(countArabicCharacters('drug-manager'), 0);
  });
});
