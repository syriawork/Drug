import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { describe, it } from 'node:test';
import {
  type FirebaseAuthConfig,
  buildSignInWithPasswordUrl,
  buildTokenRefreshUrl,
} from '../electron/config/firebase-config';
import { FirebaseAuthService } from '../electron/services/firebase-auth';

/**
 * Auth Emulator integration test harness.
 *
 * Runs an HTTP server mimicking the exact REST wire protocol of the Firebase Auth Emulator
 * (or optionally connects to an external emulator when explicitly requested).
 */
describe('firebase auth emulator integration', () => {
  let server: Server | null = null;
  let emulatorPort = 9099;
  let emulatorHost = '127.0.0.1:9099';

  it('performs end-to-end authentication cycle against Auth Emulator endpoints', async () => {
    // The full Firestore emulator runner also sets FIREBASE_AUTH_EMULATOR_HOST,
    // but does not seed this test's account. Keep this REST contract test isolated
    // by default; opt into an external Auth emulator explicitly.
    const externalEmulator = process.env['DRUG_MANAGER_AUTH_TEST_USE_EXTERNAL_EMULATOR'] === '1'
      ? process.env['FIREBASE_AUTH_EMULATOR_HOST']
      : undefined;
    if (externalEmulator) {
      emulatorHost = externalEmulator;
    } else {
      server = createServer((req, res) => {
        const url = req.url || '';
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          if (url.includes('accounts:signInWithPassword')) {
            const parsed = JSON.parse(body || '{}');
            if (parsed.email === 'pharmacist@pharmacy.local' && parsed.password === 'pass1234') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  idToken: 'emulator-mock-id-token-xyz',
                  email: 'pharmacist@pharmacy.local',
                  refreshToken: 'emulator-mock-refresh-token-xyz',
                  expiresIn: '3600',
                  localId: 'mock-user-uid-99',
                  registered: true,
                }),
              );
              return;
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: {
                    code: 400,
                    message: 'EMAIL_NOT_FOUND',
                  },
                }),
              );
              return;
            }
          }

          if (url.includes('/token')) {
            const params = new URLSearchParams(body);
            if (params.get('refresh_token') === 'emulator-mock-refresh-token-xyz') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  expires_in: '3600',
                  token_type: 'Bearer',
                  refresh_token: 'emulator-mock-refresh-token-new',
                  id_token: 'emulator-mock-id-token-refreshed',
                  user_id: 'mock-user-uid-99',
                  project_id: 'demo-drug-project',
                }),
              );
              return;
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: {
                    code: 400,
                    message: 'INVALID_REFRESH_TOKEN',
                  },
                }),
              );
              return;
            }
          }

          res.writeHead(404);
          res.end();
        });
      });

      await new Promise<void>((resolve) => {
        server?.listen(0, '127.0.0.1', () => {
          const address = server?.address();
          if (address && typeof address === 'object') {
            emulatorPort = address.port;
            emulatorHost = `127.0.0.1:${emulatorPort}`;
          }
          resolve();
        });
      });
    }

    try {
      const config: FirebaseAuthConfig = {
        mode: 'development',
        apiKey: 'fake-emulator-key',
        projectId: 'demo-drug-project',
        emulatorHost,
      };

      const signInUrl = buildSignInWithPasswordUrl(config);
      const refreshUrl = buildTokenRefreshUrl(config);

      assert.ok(signInUrl.includes(emulatorHost));
      assert.ok(refreshUrl.includes(emulatorHost));

      const authService = new FirebaseAuthService(config);

      // 1. Initial State
      assert.equal(authService.getSafeState().authenticated, false);

      // 2. Sign In
      const loggedInState = await authService.signInWithEmailAndPassword({
        email: 'pharmacist@pharmacy.local',
        password: 'pass1234',
      });

      assert.equal(loggedInState.authenticated, true);
      assert.equal(loggedInState.email, 'pharmacist@pharmacy.local');
      assert.equal(loggedInState.uid, 'mock-user-uid-99');
      // Tokens must never be on safe state
      assert.equal((loggedInState as unknown as Record<string, unknown>)['refreshToken'], undefined);
      assert.equal((loggedInState as unknown as Record<string, unknown>)['idToken'], undefined);

      // Valid token accessible inside Main process
      const token1 = await authService.getValidIdToken();
      assert.equal(token1, 'emulator-mock-id-token-xyz');

      // 3. Token Refresh
      const refreshedState = await authService.refreshIdToken();
      assert.equal(refreshedState.authenticated, true);
      assert.equal(refreshedState.uid, 'mock-user-uid-99');

      const token2 = await authService.getValidIdToken();
      assert.equal(token2, 'emulator-mock-id-token-refreshed');

      // 4. Sign Out
      authService.signOut();
      assert.equal(authService.getSafeState().authenticated, false);
      assert.equal(await authService.getValidIdToken(), null);
    } finally {
      if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
      }
    }
  });
});