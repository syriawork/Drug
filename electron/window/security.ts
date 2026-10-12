import type { BrowserWindowConstructorOptions, WebPreferences } from 'electron';
import type { AppConfig } from '../config/app-config';

/**
 * Window / renderer security policy.
 *
 * These invariants are enforced in code (assertSecureWebPreferences) and
 * verified by the automated test-suite, so a future change that weakens them
 * fails the build instead of silently shipping.
 */

export interface SecureWebPreferencesInput {
  /** Absolute path of the compiled preload script. */
  readonly preloadPath: string;
  /** True while running unpackaged from source. */
  readonly isDevelopment: boolean;
}

/** Legacy field kept out of the public type surface but still worth guarding against. */
interface GuardedWebPreferences extends WebPreferences {
  readonly enableRemoteModule?: unknown;
}

/** The security invariants that must always hold for the renderer. */
export const SECURITY_INVARIANTS = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  webviewTag: false,
});

export class SecurityPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SecurityPolicyError';
  }
}

/** Creates the hardened webPreferences used by the manager window. */
export function createSecureWebPreferences(input: SecureWebPreferencesInput): WebPreferences {
  if (input.preloadPath.trim().length === 0) {
    throw new SecurityPolicyError('preloadPath must not be empty');
  }

  return {
    preload: input.preloadPath,
    contextIsolation: SECURITY_INVARIANTS.contextIsolation,
    nodeIntegration: SECURITY_INVARIANTS.nodeIntegration,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: SECURITY_INVARIANTS.sandbox,
    webSecurity: SECURITY_INVARIANTS.webSecurity,
    webviewTag: SECURITY_INVARIANTS.webviewTag,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    spellcheck: false,
    navigateOnDragDrop: false,
    // Developer tools are available while developing and disabled in packaged builds.
    devTools: input.isDevelopment,
  };
}

/** Throws SecurityPolicyError when any invariant is violated. */
export function assertSecureWebPreferences(preferences: WebPreferences): void {
  const violations: string[] = [];
  const guarded = preferences as GuardedWebPreferences;

  if (preferences.contextIsolation !== true) {
    violations.push('contextIsolation must be true');
  }
  if (preferences.nodeIntegration !== false) {
    violations.push('nodeIntegration must be false');
  }
  if (preferences.nodeIntegrationInWorker === true) {
    violations.push('nodeIntegrationInWorker must not be true');
  }
  if (preferences.nodeIntegrationInSubFrames === true) {
    violations.push('nodeIntegrationInSubFrames must not be true');
  }
  if (preferences.sandbox !== true) {
    violations.push('sandbox must be true');
  }
  if (preferences.webSecurity !== true) {
    violations.push('webSecurity must not be disabled');
  }
  if (preferences.webviewTag === true) {
    violations.push('webviewTag must not be enabled');
  }
  if (preferences.allowRunningInsecureContent === true) {
    violations.push('allowRunningInsecureContent must not be enabled');
  }
  if (guarded.enableRemoteModule === true) {
    violations.push('the remote module must never be enabled');
  }
  if (typeof preferences.preload !== 'string' || preferences.preload.trim().length === 0) {
    violations.push('a preload script is required');
  }

  if (violations.length > 0) {
    throw new SecurityPolicyError(`insecure renderer preferences: ${violations.join('; ')}`);
  }
}

/** Builds the BrowserWindow options for the manager window. */
export function createWindowOptions(
  config: AppConfig,
  webPreferences: WebPreferences,
): BrowserWindowConstructorOptions {
  return {
    title: config.windowTitle,
    width: config.windowBounds.width,
    height: config.windowBounds.height,
    minWidth: config.windowBounds.minWidth,
    minHeight: config.windowBounds.minHeight,
    show: false,
    backgroundColor: '#eef2f7',
    autoHideMenuBar: true,
    webPreferences,
  };
}
