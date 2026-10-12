import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type FirebaseAuthConfig,
  buildSignInWithPasswordUrl,
  buildTokenRefreshUrl,
  resolveFirebaseAuthConfig,
  validateFirebaseAuthConfig,
  FirebaseConfigError,
} from '../electron/config/firebase-config';
import { createDrugManagerApi } from '../electron/ipc/api';
import { IPC_CHANNELS } from '../electron/ipc/channels';
import {
  AuthenticationError,
  FirebaseAuthService,
  type HttpFetchFunction,
  mapFirebaseError,
} from '../electron/services/firebase-auth';

const TEST_CONFIG: FirebaseAuthConfig = {
  mode: 'production',
  apiKey: 'test-api-key',
  projectId: 'test-project',
  identityToolkitBaseUrl: 'https://identitytoolkit.googleapis.com/v1',
  secureTokenBaseUrl: 'https://securetoken.googleapis.com/v1',
};

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function signInResponse(input: {
  readonly email: string;
  readonly uid: string;
  readonly idToken: string;
  readonly refreshToken: string;
  readonly expiresIn?: string;
}): Response {
  return new Response(JSON.stringify({
    idToken: input.idToken,
    email: input.email,
    refreshToken: input.refreshToken,
    expiresIn: input.expiresIn ?? '3600',
    localId: input.uid,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function refreshResponse(input: {
  readonly uid: string;
  readonly idToken: string;
  readonly refreshToken: string;
}): Response {
  return new Response(JSON.stringify({
    expires_in: '3600',
    token_type: 'Bearer',
    refresh_token: input.refreshToken,
    id_token: input.idToken,
    user_id: input.uid,
    project_id: 'test-project',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function controlledTimeouts(): {
  readonly createTimeoutSignal: (timeoutMs: number) => AbortSignal;
  readonly abort: (index: number) => void;
  readonly count: () => number;
  readonly timeoutAt: (index: number) => number | undefined;
} {
  const controllers: AbortController[] = [];
  const timeoutDurations: number[] = [];
  return {
    createTimeoutSignal: (timeoutMs) => {
      const controller = new AbortController();
      controllers.push(controller);
      timeoutDurations.push(timeoutMs);
      return controller.signal;
    },
    abort: (index) => {
      controllers[index]?.abort();
    },
    count: () => controllers.length,
    timeoutAt: (index) => timeoutDurations[index],
  };
}

describe('firebase auth configuration & urls', () => {
  it('resolves defaults from environment cleanly', () => {
    const config = resolveFirebaseAuthConfig('production', {});
    assert.equal(config.mode, 'production');
    assert.equal(config.apiKey, '');
    assert.equal(config.projectId, '');
    assert.equal(config.emulatorHost, undefined);
  });

  it('detects emulator host when provided', () => {
    const config = resolveFirebaseAuthConfig('development', {
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    });
    assert.equal(config.emulatorHost, '127.0.0.1:9099');
    assert.equal(config.apiKey, 'fake-emulator-api-key');

    const signInUrl = buildSignInWithPasswordUrl(config);
    assert.ok(signInUrl.startsWith('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword'));

    const refreshUrl = buildTokenRefreshUrl(config);
    assert.ok(refreshUrl.startsWith('http://127.0.0.1:9099/securetoken.googleapis.com/v1/token'));
  });

  it('validates required apiKey when no emulator is configured', () => {
    assert.throws(
      () => validateFirebaseAuthConfig({ mode: 'production', apiKey: '', projectId: '' }),
      FirebaseConfigError,
    );
    assert.doesNotThrow(() => validateFirebaseAuthConfig({ mode: 'production', apiKey: 'key', projectId: 'proj' }));
    assert.doesNotThrow(() => validateFirebaseAuthConfig({
      mode: 'development',
      apiKey: '',
      projectId: '',
      emulatorHost: 'localhost:9099',
    }));
  });

  it('accepts localhost, IPv4, and correctly bracketed IPv6 emulator addresses', () => {
    for (const host of [
      'localhost:9099',
      '127.0.0.1:9099',
      '[::1]:9099',
      'http://[::1]:9099',
      'http://localhost:9099/',
    ]) {
      const config = resolveFirebaseAuthConfig('development', { FIREBASE_AUTH_EMULATOR_HOST: host });
      assert.ok(buildSignInWithPasswordUrl(config).includes('/identitytoolkit.googleapis.com/v1/'));
      assert.ok(buildTokenRefreshUrl(config).includes('/securetoken.googleapis.com/v1/'));
    }
  });

  it('rejects remote, malformed, or non-root emulator endpoints', () => {
    for (const host of [
      'auth.example.com:9099',
      'http://192.168.1.10:9099',
      'http://localhost:bad-port',
      'http://localhost:9099/arbitrary-path',
      'http://user@localhost:9099',
    ]) {
      assert.throws(
        () => resolveFirebaseAuthConfig('development', { FIREBASE_AUTH_EMULATOR_HOST: host }),
        FirebaseConfigError,
      );
    }
  });

  it('rejects emulator configuration in production without falling back', () => {
    assert.throws(
      () => resolveFirebaseAuthConfig('production', { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }),
      FirebaseConfigError,
    );
  });

  it('rejects HTTP and unapproved production endpoint overrides', () => {
    for (const env of [
      { FIREBASE_AUTH_BASE_URL: 'http://identitytoolkit.googleapis.com/v1' },
      { FIREBASE_TOKEN_BASE_URL: 'http://securetoken.googleapis.com/v1' },
      { FIREBASE_AUTH_BASE_URL: 'https://attacker.example/v1' },
      { FIREBASE_TOKEN_BASE_URL: 'https://securetoken.googleapis.com:8443/v1' },
    ]) {
      assert.throws(() => resolveFirebaseAuthConfig('production', env), FirebaseConfigError);
    }
  });

  it('accepts approved HTTPS production endpoints', () => {
    const config = resolveFirebaseAuthConfig('production', {
      FIREBASE_AUTH_BASE_URL: 'https://identitytoolkit.googleapis.com/v1/',
      FIREBASE_TOKEN_BASE_URL: 'https://securetoken.googleapis.com/v1/',
    });
    assert.ok(buildSignInWithPasswordUrl(config).startsWith(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword',
    ));
    assert.ok(buildTokenRefreshUrl(config).startsWith('https://securetoken.googleapis.com/v1/token'));
  });
});

describe('firebase error mapping', () => {
  it('maps common error codes to Arabic application messages without leaking secrets', () => {
    assert.equal(mapFirebaseError('EMAIL_NOT_FOUND').code, 'AUTH_INVALID_CREDENTIALS');
    assert.equal(mapFirebaseError('INVALID_PASSWORD').code, 'AUTH_INVALID_CREDENTIALS');
    assert.equal(mapFirebaseError('INVALID_LOGIN_CREDENTIALS').code, 'AUTH_INVALID_CREDENTIALS');
    assert.equal(mapFirebaseError('USER_DISABLED').code, 'AUTH_USER_DISABLED');
    assert.equal(mapFirebaseError('TOKEN_EXPIRED').code, 'AUTH_SESSION_EXPIRED');
    assert.equal(mapFirebaseError('INVALID_REFRESH_TOKEN').code, 'AUTH_SESSION_EXPIRED');
    assert.equal(mapFirebaseError('UNKNOWN_STRING').code, 'AUTH_FAILED');
  });
});

describe('firebase auth service (REST logic in Main Process)', () => {
  it('starts in unauthenticated state with safe properties', () => {
    const authService = new FirebaseAuthService(TEST_CONFIG);
    const state = authService.getSafeState();

    assert.equal(state.authenticated, false);
    assert.equal(state.uid, null);
    assert.equal(state.email, null);
    assert.equal(state.expirationTimeIso, null);
    // Crucial: ensure no token property exists on SafeAuthState
    const raw = state as unknown as Record<string, unknown>;
    assert.equal(raw['refreshToken'], undefined);
    assert.equal(raw['idToken'], undefined);
  });

  it('handles successful sign-in with email & password', async () => {
    const mockFetch: HttpFetchFunction = async (input, init) => {
      const urlStr = String(input);
      assert.ok(urlStr.includes('accounts:signInWithPassword'));
      assert.equal(init?.method, 'POST');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.email, 'admin@example.com');
      assert.equal(body.password, 'secret123');

      return new Response(
        JSON.stringify({
          idToken: 'mock-id-token-123',
          email: 'admin@example.com',
          refreshToken: 'mock-refresh-token-456',
          expiresIn: '3600',
          localId: 'uid-admin-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const authService = new FirebaseAuthService(TEST_CONFIG, mockFetch);
    const safeState = await authService.signInWithEmailAndPassword({
      email: 'admin@example.com',
      password: 'secret123',
    });

    assert.equal(safeState.authenticated, true);
    assert.equal(safeState.email, 'admin@example.com');
    assert.equal(safeState.uid, 'uid-admin-1');
    assert.ok(safeState.expirationTimeIso);
    // Verify tokens not leaked to safeState
    const raw = safeState as unknown as Record<string, unknown>;
    assert.equal(raw['refreshToken'], undefined);
    assert.equal(raw['idToken'], undefined);

    // Verify Main process private internal valid ID token access
    const validToken = await authService.getValidIdToken();
    assert.equal(validToken, 'mock-id-token-123');
  });

  it('times out sign-in without exposing credentials or creating a session', async () => {
    const timeouts = controlledTimeouts();
    const requestSignals: AbortSignal[] = [];
    const fetch: HttpFetchFunction = async (_input, init) => {
      if (init?.signal) {
        requestSignals.push(init.signal);
      }
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, 'json', {
        value: async () => new Promise<unknown>(() => {}),
      });
      return response;
    };
    const auth = new FirebaseAuthService(TEST_CONFIG, fetch, {
      createTimeoutSignal: timeouts.createTimeoutSignal,
    });
    const signIn = auth.signInWithEmailAndPassword({
      email: 'private@example.com',
      password: 'private-password',
    });
    assert.equal(timeouts.count(), 1);
    assert.equal(timeouts.timeoutAt(0), 15000);
    timeouts.abort(0);

    await assert.rejects(signIn, (error: unknown) => {
      assert.ok(error instanceof AuthenticationError);
      assert.equal(error.code, 'AUTH_TIMEOUT');
      assert.equal(error.message.includes('private-password'), false);
      return true;
    });
    assert.equal(requestSignals[0]?.aborted, true);
    assert.equal(auth.getSafeState().authenticated, false);
  });

  it('rejects sign-in redirects without following them or exposing credentials', async () => {
    let requestCount = 0;
    let redirectTargetCount = 0;
    let redirectPolicy: RequestInit['redirect'];
    const fetch: HttpFetchFunction = async (input, init) => {
      requestCount += 1;
      redirectPolicy = init?.redirect;
      assert.ok(String(input).includes('accounts:signInWithPassword'));
      if (init?.redirect === 'error') {
        throw new TypeError('Redirect response blocked');
      }
      redirectTargetCount += 1;
      return signInResponse({
        email: 'private@example.com',
        uid: 'uid-private',
        idToken: 'unexpected-token',
        refreshToken: 'unexpected-refresh',
      });
    };
    const auth = new FirebaseAuthService(TEST_CONFIG, fetch);

    await assert.rejects(
      auth.signInWithEmailAndPassword({
        email: 'private@example.com',
        password: 'private-password',
      }),
      (error: unknown) => {
        assert.ok(error instanceof AuthenticationError);
        assert.equal(error.code, 'AUTH_NETWORK_ERROR');
        assert.equal(error.message.includes('private-password'), false);
        assert.equal(error.message.includes('identitytoolkit.googleapis.com'), false);
        return true;
      },
    );
    assert.equal(redirectPolicy, 'error');
    assert.equal(requestCount, 1);
    assert.equal(redirectTargetCount, 0);
    assert.equal(auth.getSafeState().authenticated, false);
  });

  it('handles invalid credentials without crashing or leaking sensitive info', async () => {
    const mockFetch: HttpFetchFunction = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: 'INVALID_LOGIN_CREDENTIALS',
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const authService = new FirebaseAuthService(TEST_CONFIG, mockFetch);

    await assert.rejects(
      async () => {
        await authService.signInWithEmailAndPassword({
          email: 'wrong@example.com',
          password: 'badpassword',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof AuthenticationError);
        assert.equal(err.code, 'AUTH_INVALID_CREDENTIALS');
        return true;
      },
    );

    // Ensure state remained unauthenticated
    const state = authService.getSafeState();
    assert.equal(state.authenticated, false);
    assert.equal(state.uid, null);
  });

  it('handles successful token refresh', async () => {
    let callCount = 0;
    const mockFetch: HttpFetchFunction = async (input, init) => {
      callCount++;
      const urlStr = String(input);
      if (urlStr.includes('accounts:signInWithPassword')) {
        return new Response(
          JSON.stringify({
            idToken: 'original-id-token',
            email: 'admin@example.com',
            refreshToken: 'original-refresh-token',
            expiresIn: '3600',
            localId: 'uid-admin-1',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('/token')) {
        assert.ok(String(init?.body).includes('original-refresh-token'));
        return new Response(
          JSON.stringify({
            expires_in: '3600',
            token_type: 'Bearer',
            refresh_token: 'new-refresh-token',
            id_token: 'new-id-token-789',
            user_id: 'uid-admin-1',
            project_id: 'test-project',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const authService = new FirebaseAuthService(TEST_CONFIG, mockFetch);
    await authService.signInWithEmailAndPassword({
      email: 'admin@example.com',
      password: 'secret123',
    });

    const refreshedState = await authService.refreshIdToken();
    assert.equal(refreshedState.authenticated, true);
    assert.equal(refreshedState.uid, 'uid-admin-1');

    const currentToken = await authService.getValidIdToken();
    assert.equal(currentToken, 'new-id-token-789');
    assert.equal(callCount, 2);
  });

  it('does not let User A refresh success replace User B after logout and sign-in', async () => {
    const pendingRefresh = deferred<Response>();
    const fetch: HttpFetchFunction = async (input, init) => {
      const url = String(input);
      if (url.includes('accounts:signInWithPassword')) {
        const credentials = JSON.parse(String(init?.body)) as { email: string };
        return credentials.email === 'a@example.com'
          ? signInResponse({ email: 'a@example.com', uid: 'uid-a', idToken: 'token-a', refreshToken: 'refresh-a' })
          : signInResponse({ email: 'b@example.com', uid: 'uid-b', idToken: 'token-b', refreshToken: 'refresh-b' });
      }
      if (url.includes('/token')) {
        return pendingRefresh.promise;
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const auth = new FirebaseAuthService(TEST_CONFIG, fetch);

    await auth.signInWithEmailAndPassword({ email: 'a@example.com', password: 'a-password' });
    const refresh = auth.refreshIdToken();
    auth.signOut();
    await auth.signInWithEmailAndPassword({ email: 'b@example.com', password: 'b-password' });
    pendingRefresh.resolve(refreshResponse({ uid: 'uid-a', idToken: 'refreshed-a', refreshToken: 'rotated-a' }));

    const staleResult = await refresh;
    assert.equal(staleResult.uid, 'uid-b');
    assert.equal(auth.getSafeState().uid, 'uid-b');
    assert.equal(await auth.getValidIdToken(), 'token-b');
  });

  it('does not let User A refresh failure clear User B after logout and sign-in', async () => {
    const pendingRefresh = deferred<Response>();
    const fetch: HttpFetchFunction = async (input, init) => {
      const url = String(input);
      if (url.includes('accounts:signInWithPassword')) {
        const credentials = JSON.parse(String(init?.body)) as { email: string };
        return credentials.email === 'a@example.com'
          ? signInResponse({ email: 'a@example.com', uid: 'uid-a', idToken: 'token-a', refreshToken: 'refresh-a' })
          : signInResponse({ email: 'b@example.com', uid: 'uid-b', idToken: 'token-b', refreshToken: 'refresh-b' });
      }
      if (url.includes('/token')) {
        return pendingRefresh.promise;
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const auth = new FirebaseAuthService(TEST_CONFIG, fetch);

    await auth.signInWithEmailAndPassword({ email: 'a@example.com', password: 'a-password' });
    const refresh = auth.refreshIdToken();
    auth.signOut();
    await auth.signInWithEmailAndPassword({ email: 'b@example.com', password: 'b-password' });
    pendingRefresh.resolve(new Response(JSON.stringify({
      error: { message: 'INVALID_REFRESH_TOKEN' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));

    await assert.rejects(refresh, (error: unknown) => error instanceof AuthenticationError);
    assert.equal(auth.getSafeState().uid, 'uid-b');
    assert.equal(await auth.getValidIdToken(), 'token-b');
  });

  it('shares one refresh operation between simultaneous token requests for the same session', async () => {
    const pendingRefresh = deferred<Response>();
    let refreshCalls = 0;
    const fetch: HttpFetchFunction = async (input) => {
      const url = String(input);
      if (url.includes('accounts:signInWithPassword')) {
        return signInResponse({
          email: 'admin@example.com',
          uid: 'uid-admin',
          idToken: 'initial-token',
          refreshToken: 'initial-refresh',
          expiresIn: '1',
        });
      }
      if (url.includes('/token')) {
        refreshCalls += 1;
        return pendingRefresh.promise;
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const auth = new FirebaseAuthService(TEST_CONFIG, fetch);
    await auth.signInWithEmailAndPassword({ email: 'admin@example.com', password: 'secret' });

    const first = auth.getValidIdToken();
    const second = auth.getValidIdToken();
    assert.equal(refreshCalls, 1);
    pendingRefresh.resolve(refreshResponse({
      uid: 'uid-admin',
      idToken: 'refreshed-token',
      refreshToken: 'rotated-refresh',
    }));

    assert.deepEqual(await Promise.all([first, second]), ['refreshed-token', 'refreshed-token']);
    assert.equal(refreshCalls, 1);
    assert.equal(auth.getSafeState().uid, 'uid-admin');
  });

  it('clears the current session when its refresh token is invalid', async () => {
    const fetch: HttpFetchFunction = async (input) => {
      const url = String(input);
      if (url.includes('accounts:signInWithPassword')) {
        return signInResponse({
          email: 'admin@example.com',
          uid: 'uid-admin',
          idToken: 'initial-token',
          refreshToken: 'invalid-refresh',
        });
      }
      if (url.includes('/token')) {
        return new Response(JSON.stringify({
          error: { message: 'INVALID_REFRESH_TOKEN' },
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const auth = new FirebaseAuthService(TEST_CONFIG, fetch);
    await auth.signInWithEmailAndPassword({ email: 'admin@example.com', password: 'secret' });

    await assert.rejects(auth.refreshIdToken(), (error: unknown) => error instanceof AuthenticationError);
    assert.equal(auth.getSafeState().authenticated, false);
    assert.equal(auth.getSafeState().uid, null);
    assert.equal(await auth.getValidIdToken(), null);
  });

  it('does not restore a session when sign-out happens during a pending refresh', async () => {
    const pendingRefresh = deferred<Response>();
    const fetch: HttpFetchFunction = async (input) => {
      const url = String(input);
      if (url.includes('accounts:signInWithPassword')) {
        return signInResponse({
          email: 'admin@example.com',
          uid: 'uid-admin',
          idToken: 'initial-token',
          refreshToken: 'initial-refresh',
        });
      }
      if (url.includes('/token')) {
        return pendingRefresh.promise;
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const auth = new FirebaseAuthService(TEST_CONFIG, fetch);
    await auth.signInWithEmailAndPassword({ email: 'admin@example.com', password: 'secret' });
    const refresh = auth.refreshIdToken();

    auth.signOut();
    pendingRefresh.resolve(refreshResponse({
      uid: 'uid-admin',
      idToken: 'late-token',
      refreshToken: 'late-refresh',
    }));

    const refreshResult = await refresh;
    assert.equal(refreshResult.authenticated, false);
    assert.equal(auth.getSafeState().authenticated, false);
    assert.equal(await auth.getValidIdToken(), null);
  });

  it('times out refresh without changing a newer account session', async () => {
    const timeouts = controlledTimeouts();
    const fetch: HttpFetchFunction = async (input, init) => {
      const url = String(input);
      if (url.includes('accounts:signInWithPassword')) {
        const credentials = JSON.parse(String(init?.body)) as { email: string };
        return credentials.email === 'a@example.com'
          ? signInResponse({
            email: 'a@example.com',
            uid: 'uid-a',
            idToken: 'token-a',
            refreshToken: 'refresh-a',
          })
          : signInResponse({
            email: 'b@example.com',
            uid: 'uid-b',
            idToken: 'token-b',
            refreshToken: 'refresh-b',
          });
      }
      if (url.includes('/token')) {
        return new Promise<Response>(() => {});
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const auth = new FirebaseAuthService(TEST_CONFIG, fetch, {
      createTimeoutSignal: timeouts.createTimeoutSignal,
    });

    await auth.signInWithEmailAndPassword({ email: 'a@example.com', password: 'a-password' });
    const refresh = auth.refreshIdToken();
    assert.equal(timeouts.count(), 2);
    assert.equal(timeouts.timeoutAt(1), 15000);
    auth.signOut();
    await auth.signInWithEmailAndPassword({ email: 'b@example.com', password: 'b-password' });
    timeouts.abort(1);

    await assert.rejects(refresh, (error: unknown) => {
      assert.ok(error instanceof AuthenticationError);
      assert.equal(error.code, 'AUTH_TIMEOUT');
      return true;
    });
    assert.equal(auth.getSafeState().uid, 'uid-b');
    assert.equal(await auth.getValidIdToken(), 'token-b');
  });

  it('rejects refresh redirects and preserves a newer user session', async () => {
    const pendingRefresh = deferred<Response>();
    let refreshRequestCount = 0;
    let redirectTargetCount = 0;
    let refreshRedirectPolicy: RequestInit['redirect'];
    const fetch: HttpFetchFunction = async (input, init) => {
      const url = String(input);
      if (url.includes('accounts:signInWithPassword')) {
        const credentials = JSON.parse(String(init?.body)) as { email: string };
        return credentials.email === 'a@example.com'
          ? signInResponse({
            email: 'a@example.com',
            uid: 'uid-a',
            idToken: 'token-a',
            refreshToken: 'refresh-a',
          })
          : signInResponse({
            email: 'b@example.com',
            uid: 'uid-b',
            idToken: 'token-b',
            refreshToken: 'refresh-b',
          });
      }
      if (url.includes('/token')) {
        refreshRequestCount += 1;
        refreshRedirectPolicy = init?.redirect;
        if (init?.redirect === 'error') {
          return pendingRefresh.promise;
        }
        redirectTargetCount += 1;
        return refreshResponse({
          uid: 'uid-a',
          idToken: 'redirected-token',
          refreshToken: 'redirected-refresh',
        });
      }
      throw new Error('Unexpected request');
    };
    const auth = new FirebaseAuthService(TEST_CONFIG, fetch);

    await auth.signInWithEmailAndPassword({ email: 'a@example.com', password: 'a-password' });
    const refresh = auth.refreshIdToken();
    auth.signOut();
    await auth.signInWithEmailAndPassword({ email: 'b@example.com', password: 'b-password' });
    pendingRefresh.reject(new TypeError('Redirect response blocked'));

    await assert.rejects(refresh, (error: unknown) => {
      assert.ok(error instanceof AuthenticationError);
      assert.equal(error.code, 'AUTH_NETWORK_ERROR');
      assert.equal(error.message.includes('refresh-a'), false);
      assert.equal(error.message.includes('redirected-token'), false);
      return true;
    });
    assert.equal(refreshRedirectPolicy, 'error');
    assert.equal(refreshRequestCount, 1);
    assert.equal(redirectTargetCount, 0);
    assert.equal(auth.getSafeState().uid, 'uid-b');
    assert.equal(await auth.getValidIdToken(), 'token-b');
  });

  it('clears state on sign-out', async () => {
    const mockFetch: HttpFetchFunction = async () => {
      return new Response(
        JSON.stringify({
          idToken: 'temp-token',
          email: 'user@example.com',
          refreshToken: 'temp-refresh',
          expiresIn: '3600',
          localId: 'uid-user-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const authService = new FirebaseAuthService(TEST_CONFIG, mockFetch);
    await authService.signInWithEmailAndPassword({
      email: 'user@example.com',
      password: 'secret123',
    });

    assert.equal(authService.getSafeState().authenticated, true);

    authService.signOut();

    const stateAfter = authService.getSafeState();
    assert.equal(stateAfter.authenticated, false);
    assert.equal(stateAfter.uid, null);
    assert.equal(await authService.getValidIdToken(), null);
  });
});

describe('typed IPC bridge for authentication', () => {
  it('exposes auth methods without exposing refresh token', async () => {
    const invokedChannels: string[] = [];
    const mockInvoke = async (channel: string) => {
      invokedChannels.push(channel);
      if (channel === IPC_CHANNELS.authGetState) {
        return {
          authenticated: false,
          uid: null,
          email: null,
          emailVerified: false,
          expirationTimeIso: null,
        } satisfies SafeAuthState;
      }
      if (channel === IPC_CHANNELS.authSignIn) {
        return {
          success: true,
          authState: {
            authenticated: true,
            uid: 'uid-123',
            email: 'user@example.com',
            emailVerified: true,
            expirationTimeIso: new Date().toISOString(),
          },
        } satisfies SignInResult;
      }
      return null;
    };

    const api = createDrugManagerApi(mockInvoke);

    assert.ok(api.auth);
    assert.equal(typeof api.auth.signIn, 'function');
    assert.equal(typeof api.auth.signOut, 'function');
    assert.equal(typeof api.auth.getState, 'function');

    const state = await api.auth.getState();
    assert.equal(state.authenticated, false);
    const rawState = state as unknown as Record<string, unknown>;
    assert.equal(rawState['refreshToken'], undefined);

    const signInRes = await api.auth.signIn({ email: 'a@b.com', password: '123' });
    assert.equal(signInRes.success, true);
    const rawAuth = signInRes.authState as unknown as Record<string, unknown>;
    assert.equal(rawAuth['refreshToken'], undefined);
    const rawRes = signInRes as unknown as Record<string, unknown>;
    assert.equal(rawRes['refreshToken'], undefined);

    await api.auth.signOut();

    assert.deepEqual(invokedChannels, [
      IPC_CHANNELS.authGetState,
      IPC_CHANNELS.authSignIn,
      IPC_CHANNELS.authSignOut,
    ]);
  });
});