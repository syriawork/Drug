import {
  type FirestoreRestConfig,
  buildFirestoreDocumentsUrlPrefix,
} from '../../electron/config/firestore-config';
import { decodeFields, encodeFields } from '../../electron/services/firestore-codec';
import { FirebaseAuthService } from '../../electron/services/firebase-auth';
import { FirestoreRestClient } from '../../electron/services/firestore-rest';

/**
 * Test harness for the REAL local Firebase emulators (Auth + Firestore).
 *
 * Two clearly separated capabilities:
 *
 *  1. FIXTURE SETUP (this file only, never in application code):
 *     users are created through the real Auth Emulator REST API, and the
 *     `users/{uid}` profile documents are written with the emulator's documented
 *     admin bypass ("Authorization: Bearer owner"). That bypass exists in the
 *     local emulator ONLY; it is not a service account, not a production
 *     credential, and it is never used for a security assertion - it only
 *     prepares data before the rules are exercised.
 *
 *  2. SECURITY ASSERTIONS (the integration test):
 *     every rule-relevant request goes through the application's own Stage 2
 *     authentication layer (FirebaseAuthService -> real ID token) and the Stage 3
 *     FirestoreRestClient, i.e. real HTTP with a real Firebase ID token.
 */

/** Password used for the local demo accounts (never a real credential). */
export const DEMO_PASSWORD = 'Stage3-Local!2026';

/** API key is ignored by the emulator, but the REST endpoints require a value. */
const EMULATOR_API_KEY = 'demo-emulator-api-key';

/** Lets a Firestore transaction lock time out before the next fixture call. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export const DEFAULT_LAB_PROJECT_ID = 'demo-drug-manager-stage3';

/**
 * Document used for the "no Authorization header" evidence request.
 *
 * It deliberately uses an ordinary id: Firestore RESERVES any document id that
 * starts or ends with "__", and rejects such a request with HTTP 400
 * INVALID_ARGUMENT ("Resource id ... is invalid because it is reserved") BEFORE
 * any security rule is evaluated. Using a reserved id would therefore hide the
 * very rule decision this probe exists to observe.
 */
export const UNAUTHENTICATED_PROBE_PATH = 'users/stage3-unauthenticated-probe';

export interface EmulatorEnvironment {
  readonly authHost: string;
  readonly firestoreHost: string;
  readonly projectId: string;
  /** True when the test process must fail (not skip) without a live emulator. */
  readonly requiresEmulator: boolean;
}

function trimmed(value: string | undefined): string {

  return typeof value === 'string' ? value.trim() : '';
}

export function readEmulatorEnvironment(env: NodeJS.ProcessEnv = process.env): EmulatorEnvironment {
  return {
    authHost: trimmed(env['FIREBASE_AUTH_EMULATOR_HOST']),
    firestoreHost: trimmed(env['FIRESTORE_EMULATOR_HOST']),
    projectId: trimmed(env['FIREBASE_PROJECT_ID']) || DEFAULT_LAB_PROJECT_ID,
    requiresEmulator: trimmed(env['DRUG_MANAGER_REQUIRE_FIRESTORE_EMULATOR']) === '1',
  };
}

export interface ActorSession {
  readonly email: string;
  readonly uid: string;
  /** Real Firebase ID token issued by the real Auth Emulator. Main-process memory only. */
  readonly idToken: string;
  readonly authService: FirebaseAuthService;
  readonly client: FirestoreRestClient;
}

export interface RawRestResult {
  readonly status: number;
  readonly body: string;
}

export interface SeedProfile {
  readonly uid: string;
  readonly name: string;
  readonly employeeId: string;
  readonly role: 'admin' | 'assistant' | 'employee';
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly hasException: boolean;
}

export class EmulatorHarness {
  public readonly environment: EmulatorEnvironment;
  private readonly config: FirestoreRestConfig;

  public constructor(environment: EmulatorEnvironment) {
    this.environment = environment;
    this.config = Object.freeze({
      projectId: environment.projectId,
      databaseId: '(default)',
      emulatorHost: environment.firestoreHost,
      requestTimeoutMs: 10000,
    });
  }

  public get firestoreConfig(): FirestoreRestConfig {
    return this.config;
  }

  /** ".../projects/{p}/databases/(default)/documents" */
  public get documentsPrefix(): string {
    return buildFirestoreDocumentsUrlPrefix(this.config);
  }

  public documentUrl(relativePath: string): string {
    return `${this.documentsPrefix}/${relativePath}`;
  }

  /** Base URL of the emulator document path (used by raw evidence requests). */
  public rawUrl(relativePath: string): string {
    return this.documentUrl(relativePath);
  }

  // ------------------------------------------------------------- auth fixtures

  private async authRequest(endpoint: string, body: unknown): Promise<RawRestResult> {
    const url = `http://${this.environment.authHost}/identitytoolkit.googleapis.com/v1/${endpoint}`
      + `?key=${EMULATOR_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.text() };
  }

  /** Creates the fixture account with the real Auth Emulator (or reuses an existing uid). */
  public async ensureAuthUser(email: string, password: string): Promise<string> {
    const signUp = await this.authRequest('accounts:signUp', { email, password, returnSecureToken: true });
    if (signUp.status === 200) {
      const parsed = JSON.parse(signUp.body) as { localId?: string };
      if (typeof parsed.localId === 'string' && parsed.localId.length > 0) {
        return parsed.localId;
      }
      throw new Error(`auth emulator signUp returned no localId for ${email}: ${signUp.body}`);
    }

    const signIn = await this.authRequest('accounts:signInWithPassword', {
      email,
      password,
      returnSecureToken: true,
    });
    if (signIn.status === 200) {
      const parsed = JSON.parse(signIn.body) as { localId?: string };
      if (typeof parsed.localId === 'string' && parsed.localId.length > 0) {
        return parsed.localId;
      }
    }

    throw new Error(
      `could not prepare fixture user ${email} (signUp=${signUp.status}: ${signUp.body}; `
      + `signIn=${signIn.status}: ${signIn.body})`,
    );
  }

  /**
   * Signs in through the application's own Stage 2 REST auth layer and exposes a
   * Stage 3 client that pulls its token from that session. This is the exact
   * production wiring (Main process -> Auth REST -> ID token -> Firestore REST).
   */
  public async openSession(email: string, password: string): Promise<ActorSession> {
    const authService = new FirebaseAuthService({
      mode: 'development',
      apiKey: EMULATOR_API_KEY,
      projectId: this.environment.projectId,
      emulatorHost: this.environment.authHost,
    });

    const safeState = await authService.signInWithEmailAndPassword({ email, password });
    const idToken = await authService.getValidIdToken();
    if (!safeState.authenticated || safeState.uid === null || idToken === null) {
      throw new Error(`sign-in through the application auth layer failed for ${email}`);
    }

    const client = new FirestoreRestClient({
      config: this.config,
      getAccessToken: () => authService.getValidIdToken(),
      allowRemoteTarget: false,
    });

    return { email, uid: safeState.uid, idToken, authService, client };
  }

  // -------------------------------------------------- emulator fixture plumbing

  /**
   * Writes/reads a document with the emulator's documented admin bypass.
   * LOCAL EMULATOR ONLY. It is not a credential, not a service account, and it is
   * never used for a security assertion - only to prepare fixture data.
   */
  private async ownerBypassRequest(
    method: 'GET' | 'PATCH' | 'DELETE',
    relativePath: string,
    body?: unknown,
  ): Promise<RawRestResult> {
    const headers: Record<string, string> = { Authorization: 'Bearer owner' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(this.documentUrl(relativePath), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.text() };
  }

  public async seedDocument(relativePath: string, data: Record<string, unknown>): Promise<void> {
    const result = await this.ownerBypassRequest('PATCH', relativePath, { fields: encodeFields(data) });
    if (result.status !== 200) {
      throw new Error(`fixture seeding failed for ${relativePath}: HTTP ${result.status} ${result.body}`);
    }
  }

  /**
   * Issues a RAW, MASK-LESS `PATCH` and reports the status, without throwing.
   *
   * LOCAL EMULATOR ONLY, and deliberately dangerous, so it is named to make the
   * hazard obvious at every call site. It exists for exactly one purpose: to let a
   * suite DEMONSTRATE that a Firestore `PATCH` without an `updateMask` REPLACES
   * the document. Every use must re-seed the fixture afterwards.
   *
   * `seedDocument` above already goes through a mask-less PATCH - which is why a
   * suite must pass the WHOLE document to it, and why two partial seeds would
   * erase each other.
   */
  public async rawMaskLessPatch(
    relativePath: string,
    fields: Record<string, unknown>,
  ): Promise<RawRestResult> {
    return this.ownerBypassRequest('PATCH', relativePath, { fields });
  }

  /** Seeds the users/{uid} document with exactly the fields the Rules reference. */
  public async seedUserProfile(profile: SeedProfile): Promise<void> {
    await this.seedDocument(`users/${profile.uid}`, {
      uid: profile.uid,
      name: profile.name,
      employeeId: profile.employeeId,
      role: profile.role,
      status: profile.status,
      hasException: profile.hasException,
    });
  }

  public async deleteDocument(relativePath: string): Promise<void> {
    const result = await this.ownerBypassRequest('DELETE', relativePath);
    // A 409 here is Firestore's "transaction lock timeout": a leaked or
    // still-open transaction is holding the document. The Stage 6 suite creates
    // real transactions, so cleanup must not fail on a lock that is about to
    // expire on its own - the next run's seeding would then be the thing that
    // breaks, with a far less obvious message.
    if (result.status === 409) {
      await sleep(250);
      const retry = await this.ownerBypassRequest('DELETE', relativePath);
      if (retry.status === 200 || retry.status === 404 || retry.status === 409) {
        return;
      }
      throw new Error(`fixture delete failed for ${relativePath}: HTTP ${retry.status} ${retry.body}`);
    }
    if (result.status !== 200 && result.status !== 404) {
      throw new Error(`fixture delete failed for ${relativePath}: HTTP ${result.status} ${result.body}`);
    }
  }

  /** Best-effort cleanup so every run starts from the same state. */
  public async flush(relativePaths: readonly string[]): Promise<void> {
    for (const relativePath of relativePaths) {
      await this.deleteDocument(relativePath);
    }
  }

  public async readAsEmulatorOwner(relativePath: string): Promise<Record<string, unknown> | null> {
    const result = await this.ownerBypassRequest('GET', relativePath);
    if (result.status === 404) {
      return null;
    }
    if (result.status !== 200) {
      throw new Error(`owner read failed for ${relativePath}: HTTP ${result.status} ${result.body}`);
    }
    const parsed = JSON.parse(result.body) as { fields?: Parameters<typeof decodeFields>[0] };
    return { ...decodeFields(parsed.fields) };
  }

  /**
   * Raw HTTP request straight to the emulator REST API. Used for evidence tests
   * (identical request with/without a token) so the client wrapper itself is not
   * part of the measured behaviour.
   */
  public async rawRequest(
    relativePath: string,
    options: {
      readonly method: 'GET' | 'POST' | 'PATCH';
      readonly token?: string | null;
      readonly body?: unknown;
    },
  ): Promise<RawRestResult> {
    const headers: Record<string, string> = {};
    if (options.token !== undefined && options.token !== null) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(this.documentUrl(relativePath), {
      method: options.method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.text() };
  }
}

/** Parses a Firestore/Google REST error envelope. */
export function readServerError(body: string): {
  code: number | null;
  status: string | null;
  message: string | null;
} {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; status?: string; message?: string } };
    return {
      code: typeof parsed.error?.code === 'number' ? parsed.error.code : null,
      status: typeof parsed.error?.status === 'string' ? parsed.error.status : null,
      message: typeof parsed.error?.message === 'string' ? parsed.error.message : null,
    };
  } catch {
    return { code: null, status: null, message: null };
  }
}

export interface EmulatorAvailability {
  readonly available: boolean;
  readonly authReachable: boolean;
  readonly firestoreReachable: boolean;
  /** HTTP status of an unauthenticated Firestore REST read (401/403 when rules are loaded). */
  readonly firestoreStatus: number | null;
  readonly firestoreServerMessage: string | null;
  readonly detail: string;
}

async function probe(url: string, timeoutMs = 3000): Promise<{ reachable: boolean; status: number | null; text: string }> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    return { reachable: true, status: response.status, text };
  } catch {
    return { reachable: false, status: null, text: '' };
  }
}

/** Verifies that both emulators answer HTTP on the expected hosts. */
export async function probeEmulators(
  environment: EmulatorEnvironment,
  options: { readonly maxAttempts?: number; readonly delayMs?: number } = {},
): Promise<EmulatorAvailability> {
  // The Firestore emulator loads its rules and opens its port noticeably later
  // than the Auth emulator, and `firebase emulators:exec` releases the test
  // process as soon as the FIRST emulator is listening. A single probe taken at
  // that instant therefore reports "firestore unreachable" on a perfectly
  // healthy lab - a race that has nothing to do with the code under test.
  // Retrying turns a startup race into a bounded wait while keeping the
  // "emulator missing => hard failure" guarantee this probe exists for.
  const maxAttempts = Math.max(1, options.maxAttempts ?? 10);
  const delayMs = Math.max(0, options.delayMs ?? 500);
  let last: EmulatorAvailability | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await probeEmulatorsOnce(environment);
    if (last.available) {
      return last;
    }
    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }
  // `last` is always assigned because maxAttempts is at least 1.
  return last as EmulatorAvailability;
}

async function probeEmulatorsOnce(environment: EmulatorEnvironment): Promise<EmulatorAvailability> {
  if (environment.authHost.length === 0 || environment.firestoreHost.length === 0) {
    return {
      available: false,
      authReachable: false,
      firestoreReachable: false,
      firestoreStatus: null,
      firestoreServerMessage: null,
      detail: 'FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST are not set in this process',
    };
  }

  const authProbe = await probe(`http://${environment.authHost}/`);
  const firestoreUrl = `http://${environment.firestoreHost}/v1/projects/${environment.projectId}`
    + `/databases/(default)/documents/${UNAUTHENTICATED_PROBE_PATH}`;
  const firestoreProbe = await probe(firestoreUrl);

  let firestoreServerMessage: string | null = null;
  if (firestoreProbe.status !== null && firestoreProbe.text.trim().length > 0) {
    try {
      const parsed = JSON.parse(firestoreProbe.text) as { error?: { message?: string } };
      firestoreServerMessage = parsed.error?.message ?? null;
    } catch {
      firestoreServerMessage = null;
    }
  }

  const available = authProbe.reachable && firestoreProbe.reachable;
  const detail = available
    ? `auth=${environment.authHost} (HTTP ${authProbe.status ?? 0}), `
      + `firestore=${environment.firestoreHost} (HTTP ${firestoreProbe.status ?? 0})`
    : `auth reachable=${String(authProbe.reachable)}, firestore reachable=${String(firestoreProbe.reachable)}`;

  return {
    available,
    authReachable: authProbe.reachable,
    firestoreReachable: firestoreProbe.reachable,
    firestoreStatus: firestoreProbe.status,
    firestoreServerMessage,
    detail,
  };
}
