import { resolveFirebaseAuthConfig, validateFirebaseAuthConfig } from './firebase-config';
import { resolveFirestoreRestConfig, isFirestoreConfigured, isLoopbackHost } from './firestore-config';

export interface FirebaseBootstrapResult {
  readonly firebaseAuthConfig: ReturnType<typeof resolveFirebaseAuthConfig>;
  readonly firestoreConfig: ReturnType<typeof resolveFirestoreRestConfig>;
}

export function resolveAndValidateFirebaseConfig(
  isDevelopment: boolean,
  env: NodeJS.ProcessEnv = process.env,
): FirebaseBootstrapResult {
  const firebaseAuthConfig = resolveFirebaseAuthConfig(isDevelopment ? 'development' : 'production', env);
  validateFirebaseAuthConfig(firebaseAuthConfig);

  const firestoreConfig = resolveFirestoreRestConfig(env);
  if (!isFirestoreConfigured(firestoreConfig)) {
    throw new Error('FIREBASE_PROJECT_ID is required for Firestore in production mode');
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
  const { firebaseAuthConfig, firestoreConfig } = resolveAndValidateFirebaseConfig(isDevelopment, env);
  const authService = authFactory(firebaseAuthConfig);
  const firestoreClient = firestoreFactory(firestoreConfig, authService);
  return { authService, firestoreClient };
}
