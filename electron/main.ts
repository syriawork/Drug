import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { createManagerApplication } from './application';
import { APP_DEFAULTS, createAppConfig } from './config/app-config';
import { resolveFirebaseAuthConfig } from './config/firebase-config';
import { resolveFirestoreRestConfig } from './config/firestore-config';
import { DRUG_MANAGER_API_VERSION } from './ipc/api';
import { IPC_CHANNELS } from './ipc/channels';
import { createIpcHandlers } from './ipc/handlers/application-handlers';
import {
  type RepositoryContext,
  FirestoreMedicinesRepository,
  FirestoreOrderRequestsRepository,
  FirestoreOrdersRepository,
  FirestoreSettingsRepository,
  FirestoreStockLogsRepository,
  FirestoreUsersRepository,
  createInboundStockTransactionFactory,
  createOrderProcessingTransactionFactory,
} from './repositories';
import { createAppStatusProvider } from './services/app-status';
import { FirebaseAuthService } from './services/firebase-auth';
import { FirestoreRestClient } from './services/firestore-rest';
import { FirestoreOrderProcessingService } from './services/order-processing.service';
import { containsArabicCharacters, toCodePoints } from './util/text';
import { assertSecureWebPreferences, createSecureWebPreferences, createWindowOptions } from './window/security';

/**
 * Electron main process - Stage 7 (application / IPC boundary).
 *
 * Responsibilities:
 *  - create the hardened application window
 *  - compose the Stage 7 application layer over the Stage 5B repositories
 *  - register the named IPC channels (auth + five application operations)
 *  - own the Firestore REST access layer (typed client, no SDK at all)
 *  - block every navigation / new window / webview
 *  - optionally run a machine verifiable self-test (--self-test)
 *
 * REST-only rules (Stage 2 + Stage 3):
 *  - only the public REST APIs are used (built-in fetch)
 *  - all tokens (ID token, refresh token) remain strictly in Main process memory
 *  - Renderer receives only safe sanitized auth state; no token and no Firestore
 *    payload ever crosses the IPC bridge
 *  - Firestore authorization comes exclusively from Firebase Security Rules:
 *    every request carries the signed-in user's ID token
 *
 * WHAT THIS PROCESS IS, AND IS NOT, RESPONSIBLE FOR (Stage 7)
 *  - It OWNS the authentication session: the ID token, the refresh token and the
 *    expiry live here and nowhere else.
 *  - It WIRES the use cases; it does not contain them. The logic lives in
 *    `application/`, and this file only constructs the concrete repositories and
 *    hands them to `createManagerApplication`.
 *  - It never DECIDES authorization. A 403 from firestore.rules becomes an
 *    `AUTHORIZATION_DENIED` code that is reported to the renderer, not a verdict
 *    that is produced here. The single local check is session PRESENCE, which
 *    grants nothing.
 *  - It NEVER LETS AN INTERNAL FAILURE ESCAPE. Every application operation
 *    resolves with an `ApplicationResult`, so a rejected `invoke` - which
 *    Electron would populate from an Error's own enumerable properties - cannot
 *    happen.
 */

const SELF_TEST_FLAG = '--self-test';
const SELF_TEST_TIMEOUT_MS = 15000;

const isDevelopment = !app.isPackaged;
const isSelfTestRun = process.argv.includes(SELF_TEST_FLAG);

const config = createAppConfig({
  projectRoot: app.getAppPath(),
  isDevelopment,
  defaults: APP_DEFAULTS,
});

const firebaseAuthConfig = resolveFirebaseAuthConfig(isDevelopment ? 'development' : 'production');
const authService = new FirebaseAuthService(firebaseAuthConfig);

/**
 * Stage 3: Firestore REST access layer.
 *
 * The client is bound to the authentication layer and receives a fresh Firebase
 * ID token from it for every request (`getValidIdToken`), so Firebase Security
 * Rules always see `request.auth.uid` of the signed-in user. Tokens stay inside
 * this process: nothing Firestore-related is exposed over IPC.
 *
 * No request is issued at start-up; it is deliberately lazy so the foundation
 * self-test keeps running without any network access.
 */
const firestoreClient = new FirestoreRestClient({
  config: resolveFirestoreRestConfig(),
  getAccessToken: () => authService.getValidIdToken(),
});

/**
 * Stage 7: the application layer, wired to the repositories.
 *
 * Every repository is constructed here and nowhere else, and the application
 * layer receives only the Stage 5B CONTRACTS through `createManagerApplication`.
 * The order-processing service is the Stage 6 `FirestoreOrderProcessingService`,
 * bound to the REST client through the Stage 6 transaction factory: the R1-R4 /
 * W1-W5 sequence, the business rules and the bounded retry are used exactly as
 * they were and are not re-implemented for the UI.
 */
const repositoryContext: RepositoryContext = {
  client: firestoreClient,
  onWarning: (message) => log(`repository warning: ${message}`),
};

const orderProcessingService = new FirestoreOrderProcessingService(
  createOrderProcessingTransactionFactory(firestoreClient, {
    onWarning: (message) => log(`transaction warning: ${message}`),
  }),
  { onWarning: (message) => log(`processing warning: ${message}`) },
);

const application = createManagerApplication({
  session: authService,
  usersRepository: new FirestoreUsersRepository(repositoryContext),
  medicinesRepository: new FirestoreMedicinesRepository(repositoryContext),
  settingsRepository: new FirestoreSettingsRepository(repositoryContext),
  orderRequestsRepository: new FirestoreOrderRequestsRepository(repositoryContext),
  // Stage 12: READ-ONLY. The orders history/audit screen reads through this; the
  // repository exposes no create/update/delete, so nothing here can write an order.
  // Orders are created only by the Stage 6 transaction below.
  ordersRepository: new FirestoreOrdersRepository(repositoryContext),
  // Stage 14: READ-ONLY. The inventory movement audit screen reads through this;
  // the contract exposes only two list methods, so nothing here can write a
  // movement. Movements are produced by the Stage 6 transaction below and by the
  // mobile app - never by a Windows screen.
  stockLogsRepository: new FirestoreStockLogsRepository(repositoryContext),
  // Stage 15: the INBOUND STOCK RECEIPT. A factory, not a transaction, because a
  // retried receipt must re-read the medicine inside a fresh transaction.
  inboundStockTransactionFactory: createInboundStockTransactionFactory(firestoreClient),
  orderProcessing: orderProcessingService,
  onDiagnostic: (message) => log(`application: ${message}`),
});

/** Label describing the Firestore target without ever leaking credentials. */
function describeFirestoreTarget(): string {
  if (!firestoreClient.isConfigured()) {
    return 'unconfigured';
  }
  return firestoreClient.getConfig().emulatorHost !== undefined ? 'local-emulator' : 'configured-target';
}

const preloadPath = join(__dirname, 'preload.js');

const statusProvider = createAppStatusProvider({
  appName: config.appName,
  version: app.getVersion(),
  electronVersion: process.versions.electron ?? 'unknown',
  nodeVersion: process.versions.node,
  locale: 'ar',
  rtl: true,
  startedAt: new Date(),
});

function log(message: string): void {
  console.log(`[drug-manager] ${message}`);
}

/**
 * Registers the IPC handlers.
 *
 * Stage 7: the three authentication channels keep their Stage 2/3 behaviour -
 * the same `SignInResult` shape, the same `AuthenticationError` codes, the same
 * Arabic wording - but they now call the application service instead of the auth
 * service directly, so a successful sign-in also establishes the advisory display
 * name and role from the backend.
 *
 * The five data channels come from the handler factory, which is where the
 * "handlers call application services, never repositories" rule is enforced.
 */
function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appStatus, () => statusProvider());

  ipcMain.handle(IPC_CHANNELS.authSignIn, async (_event, credentials: unknown) => {
    return application.auth.signIn(credentials);
  });

  ipcMain.handle(IPC_CHANNELS.authSignOut, async () => {
    application.auth.signOut();
  });

  ipcMain.handle(IPC_CHANNELS.authGetState, async () => {
    return application.auth.getState();
  });

  const applicationHandlers = createIpcHandlers({
    application,
    onDiagnostic: (message) => log(`ipc: ${message}`),
  });
  for (const [channel, handler] of Object.entries(applicationHandlers)) {
    ipcMain.handle(channel, handler);
  }

  log(`ipc handlers registered: status + auth channels + ${Object.keys(applicationHandlers).length} application channels`);
}

/** Denies every optional permission (camera, geolocation, notifications, ...). */
function hardenSession(): void {
  const defaultSession = session.defaultSession;
  defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    log(`denied permission request: ${permission}`);
    callback(false);
  });
  defaultSession.setPermissionCheckHandler(() => false);
  log('session hardening applied (all permission requests denied)');
}

/** Blocks navigation, pop-up windows and webview attachment for every web contents. */
function installContentGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      log(`blocked window.open request: ${url}`);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      event.preventDefault();
      log(`blocked navigation request: ${url}`);
    });
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
      log('blocked webview attachment');
    });
  });
}

/** Creates the single hardened manager window and loads the local UI. */
function createMainWindow(): BrowserWindow {
  const webPreferences = createSecureWebPreferences({ preloadPath, isDevelopment });
  assertSecureWebPreferences(webPreferences);

  const mainWindow = new BrowserWindow(createWindowOptions(config, webPreferences));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    log('window shown');
  });
  mainWindow.on('closed', () => {
    log('window closed');
  });

  void mainWindow.loadFile(config.indexPath);
  log(`loading local UI: ${config.indexPath}`);
  return mainWindow;
}

/**
 * Records every request that is NOT a local file request. During the
 * self-test this list must stay empty unless mock endpoints are invoked.
 */
function installNetworkObserver(observedExternalRequests: string[]): void {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (!details.url.startsWith('file:')) {
      observedExternalRequests.push(details.url);
      log(`observed external request: ${details.url}`);
    }
    callback({});
  });
}

/** Result of the DOM probe executed inside the renderer during the self-test. */
interface SelfTestProbe {
  readonly statusText: string;
  readonly statusCodePoints: readonly number[];
  readonly appTitleText: string;
  readonly documentDir: string | null;
  readonly documentLang: string | null;
  readonly apiVersion: string | null;
  readonly infoRowCount: number;
  readonly authModuleExposed: boolean;
  readonly authStateIsSafe: boolean;
  readonly nodeGlobalsAbsent: boolean;
}

/** Read-only DOM probe used by the self-test (it never modifies the UI). */
const SELF_TEST_PROBE_SCRIPT = `(async () => {
  const statusElement = document.getElementById('status-value');
  const titleElement = document.getElementById('app-title');
  const infoList = document.getElementById('info-list');
  const api = window.drugManager ? window.drugManager : null;
  const statusText = statusElement && statusElement.textContent ? statusElement.textContent : '';
  const authModuleExposed = !!(api && api.auth && typeof api.auth.signIn === 'function' && typeof api.auth.signOut === 'function');
  let authStateIsSafe = false;
  if (authModuleExposed) {
    try {
      const state = await api.auth.getState();
      authStateIsSafe = typeof state === 'object' && state !== null && typeof state.authenticated === 'boolean' && typeof state.refreshToken === 'undefined';
    } catch (e) {
      authStateIsSafe = false;
    }
  }
  return {
    statusText,
    statusCodePoints: Array.from(statusText, (character) => character.codePointAt(0) || 0),
    appTitleText: titleElement && titleElement.textContent ? titleElement.textContent : '',
    documentDir: document.documentElement.getAttribute('dir'),
    documentLang: document.documentElement.getAttribute('lang'),
    apiVersion: api ? api.apiVersion : null,
    infoRowCount: infoList ? infoList.querySelectorAll('dd').length : 0,
    authModuleExposed,
    authStateIsSafe,
    nodeGlobalsAbsent: typeof window.require === 'undefined' && typeof window.process === 'undefined'
  };
})()`;

/** Resolves as soon as the local UI finished loading, or rejects after a timeout. */
function waitForRendererReady(mainWindow: BrowserWindow, timeoutMs: number): Promise<void> {
  const { webContents } = mainWindow;
  if (!webContents.isLoadingMainFrame()) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onFinished = (): void => {
      clearTimeout(timer);
      webContents.removeListener('did-finish-load', onFinished);
      resolve();
    };
    const timer = setTimeout(() => {
      webContents.removeListener('did-finish-load', onFinished);
      reject(new Error(`renderer did not finish loading within ${timeoutMs} ms (url=${webContents.getURL()})`));
    }, timeoutMs);
    webContents.once('did-finish-load', onFinished);
  });
}

/** Waits until the window is actually visible (polls, so it cannot miss the event). */
async function waitForWindowShown(mainWindow: BrowserWindow, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!mainWindow.isDestroyed() && mainWindow.isVisible()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !mainWindow.isDestroyed() && mainWindow.isVisible();
}

/** Runs the machine-verifiable self-test, then exits with a status code. */
async function runSelfTest(mainWindow: BrowserWindow, observedExternalRequests: readonly string[]): Promise<void> {
  await waitForRendererReady(mainWindow, SELF_TEST_TIMEOUT_MS);
  const windowShown = await waitForWindowShown(mainWindow, 5000);

  const probe = (await mainWindow.webContents.executeJavaScript(SELF_TEST_PROBE_SCRIPT, true)) as SelfTestProbe;
  const payload = statusProvider();
  const expectedStatusText = `${payload.heading}: ${payload.label}`;

  const checks: Record<string, boolean> = {
    windowCreated: !mainWindow.isDestroyed(),
    windowVisible: windowShown,
    documentIsRtl: probe.documentDir === 'rtl',
    documentIsArabic: probe.documentLang === 'ar',
    appTitleRenderedAsArabic: containsArabicCharacters(probe.appTitleText),
    statusRenderedAsArabic: containsArabicCharacters(probe.statusText),
    statusTextComesFromMainViaIpc: probe.statusText === expectedStatusText,
    preloadApiVersionMatches: probe.apiVersion === DRUG_MANAGER_API_VERSION,
    infoRowsRenderedFromIpc: probe.infoRowCount > 0,
    authModuleExposedToRenderer: probe.authModuleExposed,
    authStateIsSafeAndTokensHidden: probe.authStateIsSafe,
    rendererHasNoNodeGlobals: probe.nodeGlobalsAbsent,
    noExternalNetworkRequests: observedExternalRequests.length === 0,
  };

  const failedChecks = Object.keys(checks).filter((name) => checks[name] !== true);
  const allPassed = failedChecks.length === 0;

  console.log(JSON.stringify({
    selfTest: allPassed ? 'PASS' : 'FAIL',
    failedChecks,
    checks,
    windowTitleCodePoints: toCodePoints(config.windowTitle),
    expectedStatusTextCodePoints: toCodePoints(expectedStatusText),
    actualStatusTextCodePoints: probe.statusCodePoints,
    observedExternalRequests,
    appName: payload.appName,
    appVersion: payload.version,
    electronVersion: payload.electronVersion,
    nodeVersion: payload.nodeVersion,
    indexPath: config.indexPath,
  }, null, 2));

  setTimeout(() => {
    app.exit(allPassed ? 0 : 1);
  }, 300);
}

function reportSelfTestFailure(error: unknown): void {
  console.log(JSON.stringify({
    selfTest: 'FAIL',
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  setTimeout(() => {
    app.exit(1);
  }, 300);
}

app.on('window-all-closed', () => {
  app.quit();
});

void app.whenReady().then(() => {
  log(`starting ${config.appName} ${app.getVersion()} (electron ${process.versions.electron ?? 'unknown'}, dev=${String(isDevelopment)})`);

  const observedExternalRequests: string[] = [];
  if (isSelfTestRun) {
    installNetworkObserver(observedExternalRequests);
  }

  installContentGuards();
  hardenSession();
  registerIpcHandlers();

  const mainWindow = createMainWindow();

  if (isSelfTestRun) {
    runSelfTest(mainWindow, observedExternalRequests).catch(reportSelfTestFailure);
    return;
  }

  log('stage 7 ready - application layer + IPC boundary over Firebase Auth REST + Firestore REST');
  log(`firestore target: ${describeFirestoreTarget()} (rules-enforced REST, no SDK, no privileged credentials)`);
});