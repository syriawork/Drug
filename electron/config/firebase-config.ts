/**
 * Firebase project & authentication configuration.
 * Kept strictly decoupled from authentication logic.
 *
 * Supports:
 * - Production / Project Web API Key and Project ID
 * - Firebase Auth Emulator (FIREBASE_AUTH_EMULATOR_HOST)
 * - Custom REST endpoint overrides for staging or test harness
 */

export interface FirebaseAuthConfig {
  readonly mode: 'development' | 'production';
  readonly apiKey: string;
  readonly projectId: string;
  /** When defined, requests target the local Firebase Auth Emulator. */
  readonly emulatorHost?: string | undefined;
  /** HTTPS override on the official Identity Toolkit host, for production routing. */
  readonly identityToolkitBaseUrl?: string | undefined;
  /** HTTPS override on the official Secure Token host, for production routing. */
  readonly secureTokenBaseUrl?: string | undefined;
}

export class FirebaseConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FirebaseConfigError';
  }
}

/** Standard Google Identity Toolkit v1 endpoint. */
export const DEFAULT_IDENTITY_TOOLKIT_BASE_URL = 'https://identitytoolkit.googleapis.com/v1';

/** Standard Google Secure Token v1 endpoint for refresh. */
export const DEFAULT_SECURE_TOKEN_BASE_URL = 'https://securetoken.googleapis.com/v1';

/**
 * Loads Firebase configuration for the explicit packaged/development mode.
 * Emulator routing is opt-in and mutually exclusive with production mode.
 */
export function resolveFirebaseAuthConfig(
  mode: FirebaseAuthConfig['mode'],
  env: NodeJS.ProcessEnv = process.env,
): FirebaseAuthConfig {
  const emulatorHost = env['FIREBASE_AUTH_EMULATOR_HOST']?.trim() || undefined;
  const apiKey = env['FIREBASE_API_KEY']?.trim() || (emulatorHost ? 'fake-emulator-api-key' : '');
  const projectId = env['FIREBASE_PROJECT_ID']?.trim() || (emulatorHost ? 'demo-drug-project' : '');
  const identityToolkitBaseUrl = env['FIREBASE_AUTH_BASE_URL']?.trim() || undefined;
  const secureTokenBaseUrl = env['FIREBASE_TOKEN_BASE_URL']?.trim() || undefined;

  const config: FirebaseAuthConfig = {
    mode,
    apiKey,
    projectId,
    emulatorHost,
    identityToolkitBaseUrl,
    secureTokenBaseUrl,
  };

  validateFirebaseAuthEndpoints(config);
  return Object.freeze(config);
}

function loopbackHostname(url: URL): boolean {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function validateEmulatorHost(emulatorHost: string): void {
  let url: URL;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(emulatorHost)
      ? emulatorHost
      : `http://${emulatorHost}`;
    url = new URL(candidate);
  } catch {
    throw new FirebaseConfigError('FIREBASE_AUTH_EMULATOR_HOST must be a valid loopback host');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || !loopbackHostname(url)
    || url.username.length > 0
    || url.password.length > 0
    || (url.pathname !== '/' && url.pathname.length > 0)
    || url.search.length > 0
    || url.hash.length > 0
  ) {
    throw new FirebaseConfigError(
      'FIREBASE_AUTH_EMULATOR_HOST must use HTTP(S) on localhost, 127.0.0.1, or ::1 without a path',
    );
  }
}

function validateProductionEndpoint(
  endpoint: string | undefined,
  approvedHostname: string,
  variableName: string,
): void {
  if (endpoint === undefined) {
    return;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new FirebaseConfigError(`${variableName} must be an approved HTTPS Firebase endpoint`);
  }
  if (
    url.protocol !== 'https:'
    || url.hostname.toLowerCase() !== approvedHostname
    || url.port.length > 0
    || url.username.length > 0
    || url.password.length > 0
    || (url.pathname !== '/v1' && url.pathname !== '/v1/')
    || url.search.length > 0
    || url.hash.length > 0
  ) {
    throw new FirebaseConfigError(`${variableName} must be an approved HTTPS Firebase endpoint`);
  }
}

/** Validates endpoint mode and routing before any credentials can be sent. */
export function validateFirebaseAuthEndpoints(config: FirebaseAuthConfig): void {
  if (config.mode !== 'development' && config.mode !== 'production') {
    throw new FirebaseConfigError('Firebase Auth mode must be explicitly development or production');
  }
  if (config.emulatorHost !== undefined) {
    if (config.mode !== 'development') {
      throw new FirebaseConfigError('Firebase Auth Emulator cannot be used in production mode');
    }
    if (config.identityToolkitBaseUrl !== undefined || config.secureTokenBaseUrl !== undefined) {
      throw new FirebaseConfigError('Firebase Auth Emulator mode cannot use endpoint overrides');
    }
    validateEmulatorHost(config.emulatorHost);
    return;
  }
  validateProductionEndpoint(
    config.identityToolkitBaseUrl,
    'identitytoolkit.googleapis.com',
    'FIREBASE_AUTH_BASE_URL',
  );
  validateProductionEndpoint(
    config.secureTokenBaseUrl,
    'securetoken.googleapis.com',
    'FIREBASE_TOKEN_BASE_URL',
  );
}

/** Validates configuration before issuing requests. */
export function validateFirebaseAuthConfig(config: FirebaseAuthConfig): void {
  validateFirebaseAuthEndpoints(config);
  if (config.emulatorHost === undefined && config.apiKey.trim().length === 0) {
    throw new FirebaseConfigError('FIREBASE_API_KEY is required when not using an emulator');
  }
}

/** Builds the URL for signInWithPassword. */
export function buildSignInWithPasswordUrl(config: FirebaseAuthConfig): string {
  validateFirebaseAuthEndpoints(config);
  if (config.emulatorHost) {
    const emulatorUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(config.emulatorHost)
      ? config.emulatorHost
      : `http://${config.emulatorHost}`;
    const host = new URL(emulatorUrl).origin;
    return `${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`;
  }
  const base = (config.identityToolkitBaseUrl ?? DEFAULT_IDENTITY_TOOLKIT_BASE_URL).replace(/\/+$/, '');
  return `${base}/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`;
}

/** Builds the URL for token refresh. */
export function buildTokenRefreshUrl(config: FirebaseAuthConfig): string {
  validateFirebaseAuthEndpoints(config);
  if (config.emulatorHost) {
    const emulatorUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(config.emulatorHost)
      ? config.emulatorHost
      : `http://${config.emulatorHost}`;
    const host = new URL(emulatorUrl).origin;
    return `${host}/securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.apiKey)}`;
  }
  const base = (config.secureTokenBaseUrl ?? DEFAULT_SECURE_TOKEN_BASE_URL).replace(/\/+$/, '');
  return `${base}/token?key=${encodeURIComponent(config.apiKey)}`;
}