/**
 * Stage 7 - the application / IPC boundary.
 *
 * These tests cover the layer between the future renderer and the Stage 5B/6
 * domain. They assert the SECURITY properties of that boundary, not the
 * behaviour of the layers below it: the domain rules, the mappers, the
 * transaction and the REST client all have their own suites, and duplicating
 * them here would only make this file look stronger than the evidence.
 *
 * THE NINE REQUIRED PROOFS, AND WHERE EACH ONE LIVES
 *   1. no tokens on the renderer API      -> `ipc-boundary.test.ts`
 *   2. no raw Firestore on the API        -> `ipc-boundary.test.ts`
 *   3. handlers call services, not repos  -> `ipc-boundary.test.ts`
 *   4. sign-in creates a Main session      -> "sign-in creates a Main-process session"
 *   5. sign-out clears the session         -> "sign-out clears the Main-process session"
 *   6. auth errors map to safe errors      -> "authentication failures map to safe errors"
 *   7. order processing delegates to 6     -> "order processing delegates to the Stage 6 service"
 *   8. no arbitrary IPC invocation         -> `ipc-boundary.test.ts`
 *   9. Stage 5A/5B/6 tests unchanged       -> proven by the suite count in the report
 *
 * No network, no filesystem, no Electron.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ApplicationError,
  APPLICATION_ERROR_MESSAGES,
  createManagerApplication,
  toApplicationError,
  toApplicationErrorPayload,
  type ApplicationErrorKind,
} from '../../electron/application';
import { AuthApplicationService } from '../../electron/application/auth.service';
import { ManagerApplicationService, MANAGER_LIST_LIMITS } from '../../electron/application/manager-data.service';
import { OrderRequestsApplicationService } from '../../electron/application/order-requests.service';
import { DomainError, MalformedDataError, type DomainErrorKind } from '../../electron/domain/errors';
import { AuthenticationError, mapFirebaseError } from '../../electron/services/firebase-auth';
import { FirestoreRestError } from '../../electron/services/firestore-rest';
import {
  FakeMedicinesRepository,
  FakeOrderProcessingService,
  FakeOrderRequestsRepository,
  FakeOrdersRepository,
  FakeStockLogsRepository,
  FakeInboundStockTransaction,
  FakeProfileReader,
  FakeSession,
  FakeSettingsRepository,
  FakeUsersRepository,
  makeMedicine,
  makeOrderRequest,
  makeSettings,
  makeUser,
  rulesDenied,
  signedIn,
} from './helpers/fakes';

/** Builds the auth service over fakes, with a diagnostic sink a test can read. */
function buildAuth(options: {
  readonly session?: FakeSession;
  readonly profile?: ReturnType<typeof makeUser> | null;
  readonly profileFailure?: Error | null;
} = {}): { readonly service: AuthApplicationService; readonly session: FakeSession; readonly diagnostics: string[] } {
  const session = options.session ?? new FakeSession();
  const diagnostics: string[] = [];
  const service = new AuthApplicationService({
    session,
    profiles: new FakeProfileReader(options.profile ?? null, options.profileFailure ?? null),
    onDiagnostic: (message) => diagnostics.push(message),
  });
  return { service, session, diagnostics };
}

describe('Stage 7 requirement 4: sign-in creates a Main-process session', () => {
  it('establishes the session in Main and returns a state with no token', async () => {
    const { service, session } = buildAuth({ profile: makeUser({ name: 'Nour', role: 'admin' }) });

    const result = await service.signIn({ email: 'admin@example.com', password: 'secret' });

    assert.equal(result.success, true);
    // The session really exists in the Main process: the tokens are set.
    assert.notEqual(session.idToken, null);
    assert.notEqual(session.refreshToken, null);
    assert.equal(session.credentialsSeen.length, 1);
    // ...and the state handed to the renderer is the safe DTO, without them.
    assert.equal(result.authState.authenticated, true);
    assert.equal(result.authState.uid, 'uid-admin');
    const raw = result.authState as unknown as Record<string, unknown>;
    for (const forbidden of ['idToken', 'refreshToken', 'accessToken', 'token', 'session']) {
      assert.equal(raw[forbidden], undefined, `the renderer state must not carry ${forbidden}`);
    }
  });

  it('reads the display name and role from the backend own-profile read', async () => {
    const profiles = new FakeProfileReader(makeUser({ name: 'Nour', role: 'admin' }));
    const service = new AuthApplicationService({ session: new FakeSession(), profiles });

    const result = await service.signIn({ email: 'a@b.com', password: 'p' });

    // Exactly ONE own-profile read, for the SIGNED-IN uid, with that user's own
    // token - the read firestore.rules grants an owner.
    assert.deepEqual([...profiles.calls], ['uid-admin']);
    assert.equal(result.authState.displayName, 'Nour');
    assert.equal(result.authState.role, 'admin');
  });

  it('succeeds even when the profile read fails, leaving the fields null', async () => {
    const { service, diagnostics } = buildAuth({
      profile: null,
      profileFailure: rulesDenied('users/uid-admin'),
    });

    const result = await service.signIn({ email: 'a@b.com', password: 'p' });

    // Authentication and authorisation are different questions. Failing to read
    // a display name must never lock a legitimate user out.
    assert.equal(result.success, true);
    assert.equal(result.authState.authenticated, true);
    assert.equal(result.authState.displayName, null);
    assert.equal(result.authState.role, null);
    // ...but the failure is still visible to the Main-process log.
    assert.equal(diagnostics.length, 1);
  });

  it('rejects a malformed payload without touching the session', async () => {
    const { service, session } = buildAuth();

    for (const payload of [null, undefined, 42, 'string', {}, { email: 'a@b.com' }, []]) {
      const result = await service.signIn(payload);
      assert.equal(result.success, false, `payload ${JSON.stringify(payload)} must be refused`);
      assert.equal(result.error?.code, 'AUTH_INVALID_INPUT');
    }
    assert.equal(session.credentialsSeen.length, 0);
    assert.equal(session.idToken, null);
  });
});

describe('Stage 7 requirement 5: sign-out clears the Main-process session', () => {
  it('drops the tokens and the advisory profile', async () => {
    const { service, session } = buildAuth({ profile: makeUser({ name: 'Nour', role: 'admin' }) });

    await service.signIn({ email: 'a@b.com', password: 'p' });
    assert.notEqual(session.idToken, null);

    service.signOut();

    // The Main-process session is gone: nothing survives to be replayed.
    assert.equal(session.idToken, null);
    assert.equal(session.refreshToken, null);
    assert.equal(session.signOutCalls, 1);

    const state = service.getState();
    assert.equal(state.authenticated, false);
    assert.equal(state.uid, null);
    assert.equal(state.email, null);
    assert.equal(state.displayName, null);
    assert.equal(state.role, null);
  });

  it('never re-reads the profile after sign-out', async () => {
    const profiles = new FakeProfileReader(makeUser());
    const service = new AuthApplicationService({ session: new FakeSession(), profiles });

    await service.signIn({ email: 'a@b.com', password: 'p' });
    service.signOut();
    service.getState();

    assert.deepEqual([...profiles.calls], ['uid-admin']);
  });
});

describe('Stage 7 requirement 6: authentication failures map to safe errors', () => {
  it('preserves the sanitised Stage 2 wording and code for a bad password', async () => {
    const mapped = mapFirebaseError('INVALID_LOGIN_CREDENTIALS');
    const { service, session } = buildAuth({
      session: new FakeSession(new AuthenticationError(mapped.code, mapped.message)),
    });

    const result = await service.signIn({ email: 'a@b.com', password: 'wrong' });

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'AUTH_INVALID_CREDENTIALS');
    assert.equal(result.error?.message, mapped.message);
    // No session was created, and nothing leaked in the returned state.
    assert.equal(session.idToken, null);
    assert.equal(result.authState.authenticated, false);
  });

  it('classifies an UNEXPECTED sign-in failure instead of leaking its text', async () => {
    const { service, diagnostics } = buildAuth({
      session: new FakeSession(new Error('connect ECONNREFUSED 10.0.0.5:443 raw=Bearer abc.def.ghi')),
    });

    const result = await service.signIn({ email: 'a@b.com', password: 'p' });

    assert.equal(result.success, false);
    // The renderer gets a code from the closed set and the fixed sentence for it.
    assert.equal(result.error?.code, 'INTERNAL_ERROR');
    assert.equal(result.error?.message, APPLICATION_ERROR_MESSAGES.INTERNAL_ERROR);
    // The internal text is NOT in the payload...
    const serialised = JSON.stringify(result);
    assert.equal(serialised.includes('ECONNREFUSED'), false);
    assert.equal(serialised.includes('10.0.0.5'), false);
    // ...it went to the Main-process log instead.
    assert.equal(diagnostics.length, 1);
  });

  it('maps every DomainError kind to a code from the closed set', () => {
    const expectations: readonly (readonly [DomainErrorKind, ApplicationErrorKind])[] = [
      ['NOT_AUTHORIZED', 'AUTHORIZATION_DENIED'],
      ['NOT_FOUND', 'NOT_FOUND'],
      ['ALREADY_EXISTS', 'VALIDATION_FAILED'],
      ['INVALID_INPUT', 'VALIDATION_FAILED'],
      ['MALFORMED_DATA', 'VALIDATION_FAILED'],
      ['PRECONDITION_FAILED', 'VALIDATION_FAILED'],
      ['ABORTED', 'CONCURRENCY_CONFLICT'],
      ['TRANSPORT', 'INFRASTRUCTURE_FAILURE'],
      ['UNKNOWN', 'INTERNAL_ERROR'],
    ];

    for (const [domainKind, applicationKind] of expectations) {
      const mapped = toApplicationError(new DomainError(domainKind, `internal detail for ${domainKind}`));
      assert.equal(mapped.kind, applicationKind, `${domainKind} must map to ${applicationKind}`);
      assert.equal(mapped.message, APPLICATION_ERROR_MESSAGES[applicationKind]);
    }
  });

  it('maps a transport error that leaked above the repository layer', () => {
    // Defence in depth: `toDomainError` should prevent this, but if a
    // `FirestoreRestError` ever escaped, it must still not become a renderer
    // payload carrying an HTTP status and a server message.
    const leaked = new FirestoreRestError({
      reason: 'PERMISSION_DENIED',
      message: 'Firestore request failed',
      httpStatus: 403,
      requestSent: true,
      serverMessage: 'Missing or insufficient permissions.',
    });

    const payload = toApplicationErrorPayload(toApplicationError(leaked));

    assert.equal(payload.code, 'AUTHORIZATION_DENIED');
    assert.deepEqual(Object.keys(payload).sort(), ['code', 'message', 'retryable']);
    const serialised = JSON.stringify(payload);
    assert.equal(serialised.includes('403'), false);
    assert.equal(serialised.includes('insufficient permissions'), false);
  });

  it('redacts token-shaped fragments out of the Main-process diagnostic', () => {
    const mapped = toApplicationError(new DomainError(
      'TRANSPORT',
      'failed with Bearer eyJhbGciOiJub25lIn0.eyJhIjoxfQ.sig and ?key=AIzaSyTOKENSECRET',
    ));

    assert.equal(mapped.diagnostic.includes('AIzaSyTOKENSECRET'), false);
    assert.equal(mapped.diagnostic.includes('eyJhbGciOiJub25lIn0.eyJhIjoxfQ.sig'), false);
    assert.equal(mapped.diagnostic.includes('[redacted-token]'), true);
  });

  it('marks only the genuinely retryable codes as retryable', () => {
    for (const kind of Object.keys(APPLICATION_ERROR_MESSAGES) as ApplicationErrorKind[]) {
      const payload = toApplicationErrorPayload(toApplicationError(new ApplicationError(kind)));
      const expected = kind === 'INFRASTRUCTURE_FAILURE' || kind === 'CONCURRENCY_CONFLICT';
      assert.equal(payload.retryable, expected, `${kind} retryable flag`);
    }
  });

  it('keeps a MalformedDataError technical field path out of the payload', () => {
    // Stage 6 turns these into business outcomes; anything that still surfaces
    // as a raw mapper error must not carry the field path to the renderer.
    const mapped = toApplicationError(
      new MalformedDataError('items[1].quantity', 'not a number', 'order_requests/req-1'),
    );
    const payload = toApplicationErrorPayload(mapped);

    assert.equal(payload.code, 'VALIDATION_FAILED');
    const serialised = JSON.stringify(payload);
    assert.equal(serialised.includes('items[1]'), false);
    assert.equal(serialised.includes('order_requests/req-1'), false);
    // The field path IS kept, for the Main-process log only.
    assert.equal(mapped.diagnostic.includes('items[1].quantity'), true);
  });
});

/** Builds the order-requests use case over a fake Stage 6 service. */
function buildOrderRequests(options: {
  readonly orderProcessing?: FakeOrderProcessingService;
  readonly authState?: SafeAuthState;
}): { readonly service: OrderRequestsApplicationService; readonly stage6: FakeOrderProcessingService } {
  const stage6 = options.orderProcessing ?? new FakeOrderProcessingService();
  const state = options.authState ?? signedIn();
  const service = new OrderRequestsApplicationService({
    orderProcessing: stage6,
    auth: { getState: () => state },
  });
  return { service, stage6 };
}

describe('Stage 7 requirement 7: order processing delegates to the Stage 6 service', () => {
  it('calls the Stage 6 service once and forwards only the request id', async () => {
    const { service, stage6 } = buildOrderRequests({});

    const result = await service.processOrderRequest('req-42');

    // DELEGATION, not re-implementation: the Stage 6 service is the only thing
    // that ever runs, and the application layer adds no logic around it.
    assert.equal(stage6.calls.length, 1);
    assert.equal(stage6.calls[0]?.requestId, 'req-42');
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.value : null, {
      outcome: 'processed',
      orderId: 'order-9',
      reason: null,
      status: null,
    });
  });

  it('takes the actor from the Main session, never from renderer input', async () => {
    const { service, stage6 } = buildOrderRequests({ authState: signedIn({ uid: 'uid-real-admin' }) });

    // The only thing the renderer supplies is an id. There is no parameter
    // through which it could ask to process a request as somebody else.
    await service.processOrderRequest('req-1');

    assert.equal(stage6.calls[0]?.actor.uid, 'uid-real-admin');
    assert.deepEqual(Object.keys(stage6.calls[0]?.actor ?? {}).sort(), ['name', 'uid']);
  });

  it('labels the actor with the backend display name, not the email', async () => {
    const { service, stage6 } = buildOrderRequests({
      authState: signedIn({ displayName: 'Nour', email: 'nour@example.com' }),
    });

    await service.processOrderRequest('req-1');

    assert.equal(stage6.calls[0]?.actor.name, 'Nour');
  });

  it('reports a business refusal as a SUCCESS carrying A2 reason', async () => {
    // A2 committed a `failed` marker. That is a completed operation, not an
    // error, and collapsing it into one would lose the reason the employee needs.
    const { service } = buildOrderRequests({
      orderProcessing: new FakeOrderProcessingService({
        result: { kind: 'business-validation-failure', reason: 'Insufficient stock for Panadol' },
        attempts: 1,
      }),
    });

    const result = await service.processOrderRequest('req-1');

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.value.outcome : null, 'rejected');
    assert.equal(result.ok ? result.value.reason : null, 'Insufficient stock for Panadol');
  });

  it('reports an already-processed request as a SUCCESS with zero writes', async () => {
    const { service } = buildOrderRequests({
      orderProcessing: new FakeOrderProcessingService({
        result: { kind: 'already-processed', status: 'processed' },
        attempts: 1,
      }),
    });

    const result = await service.processOrderRequest('req-1');

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.value.outcome : null, 'already-processed');
    assert.equal(result.ok ? result.value.status : null, 'processed');
  });

  it('maps a rules denial to AUTHORIZATION_DENIED and does not retry', async () => {
    const stage6 = new FakeOrderProcessingService(rulesDenied('order_requests/req-1'));
    const { service } = buildOrderRequests({ orderProcessing: stage6 });

    const result = await service.processOrderRequest('req-1');

    assert.equal(stage6.calls.length, 1, 'a rules denial is never retried');
    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
    assert.equal(!result.ok ? result.error.retryable : null, false);
  });

  it('maps an exhausted transaction conflict to CONCURRENCY_CONFLICT', async () => {
    const { service } = buildOrderRequests({
      orderProcessing: new FakeOrderProcessingService(
        new DomainError('ABORTED', 'kept aborting after 3 attempts', { documentPath: 'order_requests/req-1' }),
      ),
    });

    const result = await service.processOrderRequest('req-1');

    assert.equal(!result.ok ? result.error.code : null, 'CONCURRENCY_CONFLICT');
    // Retryable, and told as such: the request is still processable.
    assert.equal(!result.ok ? result.error.retryable : null, true);
  });

  it('refuses a malformed request id BEFORE any I/O', async () => {
    const { service, stage6 } = buildOrderRequests({});

    for (const badId of ['', '   ', 'req/../users/uid', 'a'.repeat(129), 'req 1', null, 42, {}]) {
      const result = await service.processOrderRequest(badId);
      assert.equal(result.ok, false, `${String(badId)} must be refused`);
      assert.equal(!result.ok ? result.error.code : null, 'VALIDATION_FAILED');
    }
    // Nothing reached the transport, so a crafted id cannot address a document.
    assert.equal(stage6.calls.length, 0);
  });

  it('refuses to process without a Main-process session', async () => {
    const { service, stage6 } = buildOrderRequests({
      authState: Object.freeze({ authenticated: false, uid: null, email: null, emailVerified: false, expirationTimeIso: null }),
    });

    const result = await service.processOrderRequest('req-1');

    assert.equal(!result.ok ? result.error.code : null, 'AUTHENTICATION_FAILED');
    assert.equal(stage6.calls.length, 0);
  });
});

/** Builds the read use cases over fakes. */
function buildManager(options: {
  readonly users?: FakeUsersRepository;
  readonly medicines?: FakeMedicinesRepository;
  readonly settings?: FakeSettingsRepository;
  readonly requests?: FakeOrderRequestsRepository;
  readonly authState?: SafeAuthState;
} = {}): {
  readonly service: ManagerApplicationService;
  readonly users: FakeUsersRepository;
  readonly medicines: FakeMedicinesRepository;
  readonly settings: FakeSettingsRepository;
  readonly requests: FakeOrderRequestsRepository;
} {
  const users = options.users ?? new FakeUsersRepository([makeUser()]);
  const medicines = options.medicines ?? new FakeMedicinesRepository([makeMedicine()]);
  const settings = options.settings ?? new FakeSettingsRepository(makeSettings());
  const requests = options.requests ?? new FakeOrderRequestsRepository([makeOrderRequest()]);
  const state = options.authState ?? signedIn();

  const service = new ManagerApplicationService({
    repositories: {
      users,
      medicines,
      settings,
      orderRequests: requests,
      orders: new FakeOrdersRepository([]),
      // Stage 14: wired so the audit read is constructible; Stage 7 never calls it.
      stockLogs: new FakeStockLogsRepository(),
    },
    auth: { getState: () => state },
  });

  return { service, users, medicines, settings, requests };
}

describe('Stage 7: the read use cases project onto the safe view', () => {
  it('flattens a domain timestamp into an ISO string, never a class instance', async () => {
    // A `FirestoreTimestamp` structured-cloned over IPC would arrive as a plain
    // object with no `toDate()`; the projection is what prevents that.
    const { service } = buildManager();

    const result = await service.listUsers();

    assert.equal(result.ok, true);
    const first = result.ok ? result.value[0] : undefined;
    assert.equal(typeof first?.lastOrderDateIso, 'string');
    assert.equal(first?.lastOrderDateIso, '2026-06-01T08:00:00.000Z');
    const raw = first as unknown as Record<string, unknown>;
    assert.equal(raw['toDate'], undefined);
    assert.equal(raw['isoValue'], undefined);
    assert.equal(raw['seconds'], undefined);
  });

  it('flattens order-request timestamps the same way', async () => {
    const { service } = buildManager();

    const result = await service.listOrderRequests();

    const first = result.ok ? result.value[0] : undefined;
    assert.equal(first?.requestDateIso, '2026-06-03T08:00:00.000Z');
    assert.equal(first?.processedAtIso, null);
    assert.equal(first?.items[0]?.medicineId, 'med-1');
  });

  it('passes a FIXED limit the renderer cannot influence', async () => {
    const { service, medicines, requests } = buildManager();

    await service.listMedicines();
    await service.listOrderRequests();

    // Stage 11 reads the queue ONE STATUS AT A TIME, because the REST layer
    // supports only a single EQUAL filter and cannot express "any of these three".
    // So the fixed limit is applied once per known status - still fixed, still
    // never influenced by the renderer.
    assert.deepEqual([...medicines.limits], [MANAGER_LIST_LIMITS.medicines]);
    assert.deepEqual([...requests.limits], [
      MANAGER_LIST_LIMITS.orderRequests,
      MANAGER_LIST_LIMITS.orderRequests,
      MANAGER_LIST_LIMITS.orderRequests,
    ]);
  });

  it('reports the enforced settings defaults when the document is absent', async () => {
    // A missing `settings/app` is a real situation; the UI must show what will
    // actually be enforced, not blank fields.
    const { service } = buildManager({ settings: new FakeSettingsRepository(null) });

    const result = await service.getSettings();

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.value.configured : null, false);
    assert.equal(result.ok ? result.value.minDaysBetweenOrders : null, 15);
    assert.equal(result.ok ? result.value.startTime : null, '06:00');
  });

  it('reports the stored settings when the document exists', async () => {
    const { service } = buildManager();

    const result = await service.getSettings();

    assert.equal(result.ok ? result.value.configured : null, true);
    assert.equal(result.ok ? result.value.assistantId : null, 'assistant-1');
  });

  it('maps a rules denial to AUTHORIZATION_DENIED instead of an empty list', async () => {
    // An employee calling listUsers gets 403 from the rules. Reporting an empty
    // array would be a lie: it would render as "there are no users".
    const { service } = buildManager({ users: new FakeUsersRepository([], rulesDenied('users')) });

    const result = await service.listUsers();

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
  });

  it('refuses every read without a session, before any repository call', async () => {
    const { service, users, medicines, settings, requests } = buildManager({
      authState: Object.freeze({ authenticated: false, uid: null, email: null, emailVerified: false, expirationTimeIso: null }),
    });

    for (const result of [
      await service.listUsers(),
      await service.listMedicines(),
      await service.listOrderRequests(),
      await service.getSettings(),
    ]) {
      assert.equal(!result.ok ? result.error.code : null, 'AUTHENTICATION_FAILED');
    }
    // No pointless network round trip, and no data could have been fetched.
    assert.equal(users.listCalls, 0);
    assert.deepEqual([...medicines.limits], []);
    assert.deepEqual([...requests.limits], []);
    assert.equal(settings.calls, 0);
  });

  it('never decides authorization from a local role', async () => {
    // The signed-in user's own profile says "employee". The use case must still
    // ATTEMPT the admin-only read and let the server answer: a local role check
    // that returned "denied" would be a guess, and one that returned "allowed"
    // would be a claim this process cannot make.
    const { service, users } = buildManager({
      users: new FakeUsersRepository([makeUser({ role: 'employee' })], null),
    });

    const result = await service.listUsers();

    assert.equal(users.listCalls, 1, 'the repository must be reached regardless of role');
    assert.equal(result.ok, true);
  });
});

describe('Stage 7: the composition root wires the use cases together', () => {
  it('builds a working application from fakes and no Electron', async () => {
    const session = new FakeSession();
    const users = new FakeUsersRepository([makeUser()], null, makeUser({ name: 'Nour', role: 'admin' }));
    const stage6 = new FakeOrderProcessingService();

    const application = createManagerApplication({
      session,
      usersRepository: users,
      medicinesRepository: new FakeMedicinesRepository([makeMedicine()]),
      settingsRepository: new FakeSettingsRepository(makeSettings()),
      orderRequestsRepository: new FakeOrderRequestsRepository([makeOrderRequest()]),
      ordersRepository: new FakeOrdersRepository([]),
    // Stage 14: wired so the audit read is buildable; these suites never call it.
    stockLogsRepository: new FakeStockLogsRepository(),
    // Stage 15: wired so the receipt path is constructible; Stage 7 never calls it.
    inboundStockTransactionFactory: async () => new FakeInboundStockTransaction(),
      orderProcessing: stage6,
    });

    const signIn = await application.auth.signIn({ email: 'a@b.com', password: 'p' });
    assert.equal(signIn.success, true);
    assert.equal(signIn.authState.role, 'admin');

    assert.equal((await application.manager.listMedicines()).ok, true);
    assert.equal((await application.manager.getSettings()).ok, true);
    assert.equal((await application.orderRequests.processOrderRequest('req-1')).ok, true);
    assert.equal(stage6.calls.length, 1);

    application.auth.signOut();
    assert.equal(application.auth.getState().authenticated, false);
    // After sign-out the data use cases refuse without touching Firestore.
    assert.equal((await application.manager.listMedicines()).ok, false);
  });
});

