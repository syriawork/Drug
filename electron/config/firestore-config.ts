/**
 * Firestore REST configuration (Stage 3).
 *
 * The desktop client reaches Firestore exclusively through the public REST API:
 *
 *   https://firestore.googleapis.com/v1/projects/{projectId}/databases/{databaseId}/documents
 *
 * It never uses the Firebase Web SDK, the Firebase Admin SDK,
 * Google.Cloud.Firestore or a service-account credential. Every one of those
 * either replaces the request identity (privileged credentials bypass Firebase
 * Security Rules) or drags a full SDK into a desktop process. Sending a normal
 * per-user Firebase ID token keeps the authoritative rules (the ones shipped
 * with the Android project) as the ONLY authorization boundary.
 *
 * Stage 3 is emulator-only: a non-loopback target is rejected unless the
 * operator explicitly opts in with FIRESTORE_ALLOW_REMOTE_TARGET=true, so this
 * stage can never accidentally contact production Firebase.
 *
 * This module is pure data + URL building. It has no Electron, no network and
 * no Firestore dependency, therefore it is directly unit testable.
 */

export const DEFAULT_FIRESTORE_DATABASE_ID = '(default)';

/** Production REST endpoint base (declared for completeness; unused in Stage 3). */
export const DEFAULT_FIRESTORE_BASE_URL = 'https://firestore.googleapis.com/v1';

export const DEFAULT_FIRESTORE_REQUEST_TIMEOUT_MS = 15000;

/** Default project id used when an emulator host is configured without a project. */
export const DEFAULT_EMULATOR_PROJECT_ID = 'demo-drug-manager-stage3';

export interface FirestoreRestConfig {
  readonly projectId: string;
  /** Firestore database id, normally "(default)". */
  readonly databaseId: string;
  /** When defined (e.g. "127.0.0.1:8080") requests target the Firestore Emulator. */
  readonly emulatorHost?: string | undefined;
  /** Base URL override (test harness / staging). */
  readonly baseUrl?: string | undefined;
  /** Hard timeout for every REST request (milliseconds). */
  readonly requestTimeoutMs: number;
}

export class FirestoreConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FirestoreConfigError';
  }
}

function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Reads a positive integer from the environment, falling back to the default. */
function positiveIntegerFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = optionalEnv(env, name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Builds the Firestore REST configuration from the environment.
 *
 * Recognized variables:
 *  - FIRESTORE_EMULATOR_HOST      e.g. "127.0.0.1:8080" (emulator target)
 *  - FIRESTORE_BASE_URL           e.g. "http://127.0.0.1:8080/v1" (test harness)
 *  - FIREBASE_PROJECT_ID          Firebase project id
 *  - FIRESTORE_DATABASE_ID        Firestore database id (default "(default)")
 *  - FIRESTORE_REQUEST_TIMEOUT_MS request timeout in milliseconds
 */
export function resolveFirestoreRestConfig(env: NodeJS.ProcessEnv = process.env): FirestoreRestConfig {
  const emulatorHost = optionalEnv(env, 'FIRESTORE_EMULATOR_HOST');
  const baseUrl = optionalEnv(env, 'FIRESTORE_BASE_URL');
  const projectId = optionalEnv(env, 'FIREBASE_PROJECT_ID')
    ?? (emulatorHost !== undefined || baseUrl !== undefined ? DEFAULT_EMULATOR_PROJECT_ID : '');
  const databaseId = optionalEnv(env, 'FIRESTORE_DATABASE_ID') ?? DEFAULT_FIRESTORE_DATABASE_ID;

  const config: FirestoreRestConfig = {
    projectId,
    databaseId,
    emulatorHost,
    baseUrl,
    requestTimeoutMs: positiveIntegerFromEnv(
      env,
      'FIRESTORE_REQUEST_TIMEOUT_MS',
      DEFAULT_FIRESTORE_REQUEST_TIMEOUT_MS,
    ),
  };

  return Object.freeze(config);
}

/** True when the configuration has everything needed to build a request URL. */
export function isFirestoreConfigured(config: FirestoreRestConfig): boolean {
  return config.projectId.trim().length > 0 && config.databaseId.trim().length > 0;
}

/**
 * Extracts the bare hostname out of a "host", "host:port", "[v6]:port" or full URL
 * input. Returns null when nothing usable remains.
 *
 * The IPv6 cases are the reason this is not a `split(':')[0]`: for "[::1]:8080"
 * that expression yields an empty string, and for the bare "::1" it yields an
 * empty string too, which would silently classify a loopback target as remote
 * and break the emulator guard.
 */
function extractHostname(host: string): string | null {
  let value = host.trim().toLowerCase();
  if (value.length === 0) {
    return null;
  }

  // Drop an optional scheme such as "http://".
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');

  // Keep only the authority, without userinfo ("user:pass@host").
  const authority = (value.split(/[/?#]/)[0] ?? '').replace(/^.*@/, '');
  if (authority.length === 0) {
    return null;
  }

  if (authority.startsWith('[')) {
    // Bracketed IPv6 literal: "[::1]" or "[::1]:8080".
    const closingIndex = authority.indexOf(']');
    if (closingIndex < 0) {
      return null;
    }
    const inner = authority.slice(1, closingIndex);
    return inner.length > 0 ? inner : null;
  }

  // A bare IPv6 literal holds more than one colon, so the first one does not
  // terminate the host.
  const firstColonIndex = authority.indexOf(':');
  if (firstColonIndex >= 0 && authority.indexOf(':', firstColonIndex + 1) >= 0) {
    return authority;
  }

  return (firstColonIndex >= 0 ? authority.slice(0, firstColonIndex) : authority).trim() || null;
}

/** True for hosts that stay on the local machine. */
export function isLoopbackHost(host: string): boolean {
  const hostname = extractHostname(host);
  if (hostname === null) {
    return false;
  }

  // RFC 6761: "localhost" and every "*.localhost" name resolve to loopback.
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return true;
  }
  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') {
    return true;
  }
  if (hostname === '0.0.0.0' || hostname === 'host.docker.internal') {
    return true;
  }

  // RFC 1122: the whole 127.0.0.0/8 block is loopback.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4 === null) {
    return false;
  }
  const octets = ipv4.slice(1).map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return octets[0] === 127;
}

/** Normalizes an emulator host into an http origin (accepts "host:port" or a full URL). */
export function resolveEmulatorOrigin(emulatorHost: string): string {
  const trimmed = emulatorHost.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    throw new FirestoreConfigError('emulatorHost must not be empty');
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/**
 * Guards against contacting production Firebase in Stage 3.
 *
 * Throws unless the effective target is:
 *  - a local Firestore Emulator host, or
 *  - a loopback baseUrl, or
 *  - a remote target that the operator explicitly allowed.
 */
export function assertLocalFirestoreTarget(config: FirestoreRestConfig, allowRemoteTarget: boolean): void {
  if (config.emulatorHost !== undefined) {
    const origin = resolveEmulatorOrigin(config.emulatorHost);
    if (!isLoopbackHost(origin)) {
      throw new FirestoreConfigError(
        `FIRESTORE_EMULATOR_HOST must point at the local machine (received: ${config.emulatorHost})`,
      );
    }
    return;
  }

  if (config.baseUrl !== undefined) {
    let host: string;
    try {
      host = new URL(config.baseUrl).host;
    } catch {
      throw new FirestoreConfigError(`FIRESTORE_BASE_URL is not a valid URL (received: ${config.baseUrl})`);
    }
    if (!isLoopbackHost(host)) {
      throw new FirestoreConfigError(
        `FIRESTORE_BASE_URL must point at the local machine (received host: ${host})`,
      );
    }
    return;
  }

  if (!allowRemoteTarget) {
    throw new FirestoreConfigError(
      'Stage 3 is emulator-only: configure FIRESTORE_EMULATOR_HOST (or a loopback FIRESTORE_BASE_URL). '
      + 'Set FIRESTORE_ALLOW_REMOTE_TARGET=true only for a later production stage.',
    );
  }
}

/** Builds the ".../documents" URL prefix for the configured project/database. */
export function buildFirestoreDocumentsUrlPrefix(config: FirestoreRestConfig): string {
  const resource = `/projects/${config.projectId}/databases/${config.databaseId}/documents`;
  if (config.emulatorHost !== undefined) {
    return `${resolveEmulatorOrigin(config.emulatorHost)}/v1${resource}`;
  }
  const base = (config.baseUrl ?? DEFAULT_FIRESTORE_BASE_URL).replace(/\/+$/, '');
  return `${base}${resource}`;
}

/** Builds the full resource name of a document (used by commit writes). */
export function buildFirestoreDocumentResourceName(config: FirestoreRestConfig, relativePath: string): string {
  return `projects/${config.projectId}/databases/${config.databaseId}/documents/${relativePath}`;
}

/**
 * Validates a relative Firestore path such as "users/abc" or "orders/2026/o1".
 * Only a conservative character set is accepted, which also makes URL building
 * injection-free by construction.
 */
export function assertSafeRelativePath(relativePath: string): void {
  if (relativePath.trim().length === 0) {
    throw new FirestoreConfigError('Firestore path must not be empty');
  }
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(relativePath)) {
    throw new FirestoreConfigError(
      `Firestore path contains unsupported characters (received: ${relativePath}); `
      + 'this minimal client accepts letters, digits, "_", "-" and "/" only',
    );
  }
}

/** True when the operator explicitly allowed a non-emulator target. */
export function isRemoteTargetAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return optionalEnv(env, 'FIRESTORE_ALLOW_REMOTE_TARGET')?.toLowerCase() === 'true';
}
