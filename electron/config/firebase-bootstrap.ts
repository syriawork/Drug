import { ALLOW_FIREBASE_EMULATORS } from './build-flags';
import {
  DEFAULT_EMULATOR_API_KEY,
  DEFAULT_EMULATOR_PROJECT_ID,
  resolveFirebaseAuthConfig,
  validateFirebaseAuthConfig,
} from './firebase-config';
import {
  assertLocalFirestoreTarget,
  FirestoreConfigError,
  isLoopbackHost,
  isFirestoreConfigured,
  resolveFirestoreRestConfig,
} from './firestore-config';

const QA_DEFAULT_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const QA_DEFAULT_FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const QA_ALLOWED_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export interface FirebaseBootstrapResult {
  readonly firebaseAuthConfig: ReturnType<typeof resolveFirebaseAuthConfig>;
  readonly firestoreConfig: ReturnType<typeof resolveFirestoreRestConfig>;
}

function isAllowedQaTarget(target: string, allowPath: boolean): boolean {
  let url: URL;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `http://${target}`;
    url = new URL(candidate);
  } catch {
    return false;
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (url.protocol === 'http:' || url.protocol === 'https:')
    && QA_ALLOWED_LOOPBACK_HOSTS.has(hostname)
    && url.username.length === 0
    && url.password.length === 0
    && (allowPath || url.pathname === '/')
    && url.search.length === 0
    && url.hash.length === 0;
}

function createQaEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const qaEnv: NodeJS.ProcessEnv = {
    ...env,
    FIREBASE_AUTH_EMULATOR_HOST:
      env['FIREBASE_AUTH_EMULATOR_HOST']?.trim() || QA_DEFAULT_AUTH_EMULATOR_HOST,
    FIREBASE_API_KEY: DEFAULT_EMULATOR_API_KEY,
    FIREBASE_PROJECT_ID: DEFAULT_EMULATOR_PROJECT_ID,
  };

  if (
    !env['FIRESTORE_EMULATOR_HOST']?.trim()
    && !env['FIRESTORE_BASE_URL']?.trim()
  ) {
    qaEnv['FIRESTORE_EMULATOR_HOST'] = QA_DEFAULT_FIRESTORE_EMULATOR_HOST;
  }

  return qaEnv;
}

function assertQaFirestoreTarget(
  firestoreConfig: ReturnType<typeof resolveFirestoreRestConfig>,
): void {
  if (firestoreConfig.emulatorHost !== undefined && firestoreConfig.baseUrl !== undefined) {
    throw new FirestoreConfigError(
      'QA builds cannot combine FIRESTORE_EMULATOR_HOST with FIRESTORE_BASE_URL',
    );
  }

  assertLocalFirestoreTarget(firestoreConfig, false);

  const target = firestoreConfig.emulatorHost ?? firestoreConfig.baseUrl;
  if (target === undefined || !isAllowedQaTarget(target, firestoreConfig.baseUrl !== undefined)) {
    throw new FirestoreConfigError(
      'QA Firestore must use 127.0.0.1, localhost, or ::1',
    );
  }
}

export function resolveAndValidateFirebaseConfig(
  isDevelopment: boolean,
  env: NodeJS.ProcessEnv = process.env,
  allowFirebaseEmulators: boolean = ALLOW_FIREBASE_EMULATORS,
): FirebaseBootstrapResult {
  const effectiveEnv = allowFirebaseEmulators ? createQaEnvironment(env) : env;
  const firebaseAuthConfig = resolveFirebaseAuthConfig(
    isDevelopment ? 'development' : 'production',
    effectiveEnv,
    allowFirebaseEmulators,
  );
  validateFirebaseAuthConfig(firebaseAuthConfig, allowFirebaseEmulators);

  const firestoreConfig = resolveFirestoreRestConfig(effectiveEnv);
  if (!isFirestoreConfigured(firestoreConfig)) {
    throw new Error('FIREBASE_PROJECT_ID is required for Firestore in production mode');
  }
  if (allowFirebaseEmulators) {
    assertQaFirestoreTarget(firestoreConfig);
  }

  const authUsesEmulator = firebaseAuthConfig.emulatorHost !== undefined;

  let firestoreUsesEmulator = false;
  if (firestoreConfig.emulatorHost !== undefined) {
    firestoreUsesEmulator = true;
  } else if (firestoreConfig.baseUrl !== undefined) {
    try {
      const host = new URL(firestoreConfig.baseUrl).host;
      firestoreUsesEmulator = isLoopbackHost(host);
    } catch {
      firestoreUsesEmulator = false;
    }
  }

  if (authUsesEmulator !== firestoreUsesEmulator) {
    throw new Error(
      'Firebase configuration mismatch: Auth and Firestore must both use emulator or both use production. ' +
      (authUsesEmulator ? 'Auth uses emulator but Firestore does not.' : 'Firestore uses emulator but Auth does not.'),
    );
  }

  if (!authUsesEmulator && !firestoreUsesEmulator) {
    if (firebaseAuthConfig.projectId !== firestoreConfig.projectId) {
      throw new Error(
        'Firebase project ID mismatch: Auth and Firestore must use the same project ID in production mode.',
      );
    }
  }

  return { firebaseAuthConfig, firestoreConfig };
}

export function createFirebaseClients<TAuth, TFirestore>(
  isDevelopment: boolean,
  env: NodeJS.ProcessEnv,
  authFactory: (config: FirebaseBootstrapResult['firebaseAuthConfig']) => TAuth,
  firestoreFactory: (config: FirebaseBootstrapResult['firestoreConfig'], authService: TAuth) => TFirestore,
): { readonly authService: TAuth; readonly firestoreClient: TFirestore } {
  const { firebaseAuthConfig, firestoreConfig } = resolveAndValidateFirebaseConfig(
    isDevelopment,
    env,
    ALLOW_FIREBASE_EMULATORS,
  );
  const authService = authFactory(firebaseAuthConfig);
  const firestoreClient = firestoreFactory(firestoreConfig, authService);
  return { authService, firestoreClient };
}
