/**
 * Stage 9 - the user-management application layer.
 *
 * Four things are proven here, and they are the four that could plausibly go
 * wrong in a users screen:
 *
 *  1. READS AND WRITES GO THROUGH THE APPLICATION LAYER. The renderer cannot
 *     reach a repository; it calls a named operation, and the operation calls the
 *     repository contract. The fakes record calls, so "delegates to" is an
 *     assertion rather than an assumption.
 *
 *  2. UNSUPPORTED FIELDS ARE UNREACHABLE. This is the important one. The write
 *     surface is exactly the Stage 5B contract - rename, approve/reject,
 *     grant/revoke exception - and nothing else. `role`, `employeeId` and the
 *     `lastOrder*` summary are refused at the boundary rather than silently
 *     ignored, because a silently-dropped field would let a buggy renderer
 *     believe it had promoted somebody.
 *
 *  3. THE SERVER STILL DECIDES. The application layer performs no role check.
 *     A session whose own role is `employee` still reaches the repository, and
 *     the refusal that comes back is the one firestore.rules produced. That is
 *     proved here against a fake repository and, for real, by the Stage 9
 *     emulator suite.
 *
 *  4. NO TOKEN AND NO RAW DATA CROSSES THE BOUNDARY. The payload is a view DTO.
 *
 * No network, no Electron runtime, no production backend.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { APPLICATION_ERROR_MESSAGES } from '../../electron/application/application-error';
import { UsersManagementService } from '../../electron/application/users-management.service';
import { DomainError } from '../../electron/domain/errors';
import { FakeUsersRepository, makeUser, rulesDenied, signedIn } from '../stage7/helpers/fakes';
import { buildApplication } from './helpers';

/**
 * A signed-in session whose OWN profile is an ordinary employee.
 *
 * Every update test runs as this session on purpose: the application layer must
 * still attempt the write and let the server refuse it. A layer that
 * short-circuited on the local role would pass a "denied" test while quietly
 * replacing firestore.rules.
 */
const EMPLOYEE_SESSION = signedIn({ uid: 'uid-employee', role: 'employee', displayName: 'موظف' });

/** Builds the users use case over a recording repository. */
export function buildUsersService(options: {
  readonly users?: FakeUsersRepository;
  readonly state?: ReturnType<typeof signedIn>;
} = {}): { readonly service: UsersManagementService; readonly users: FakeUsersRepository } {
  const users = options.users ?? new FakeUsersRepository([makeUser()]);
  const service = new UsersManagementService({
    users,
    auth: { getState: () => options.state ?? EMPLOYEE_SESSION },
  });
  return { service, users };
}

/** Recursively collects every own key of a value that matches `pattern`. */
function findKeys(value: unknown, pattern: RegExp): string[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const found: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (pattern.test(key)) {
      found.push(key);
    }
    found.push(...findKeys(nested, pattern));
  }
  return found;
}
describe('Stage 9 requirement 1: the users list delegates to the User repository', () => {
  it('reaches the repository and answers with safe view items', async () => {
    const users = new FakeUsersRepository([makeUser({ name: 'نور', role: 'admin' })]);

    const result = await buildApplication(users).manager.listUsers();

    assert.equal(users.listCalls, 1, 'listAllUsers must be reached exactly once');
    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.value[0]?.name : null, 'نور');
    assert.equal(result.ok ? result.value[0]?.role : null, 'admin');
  });

  it('never returns a document path, a class instance or a token', async () => {
    const result = await buildApplication().manager.listUsers();

    const serialised = JSON.stringify(result);
    assert.equal(serialised.includes('users/'), false);
    assert.equal(serialised.includes('isoValue'), false);
    assert.equal(serialised.includes('toDate'), false);
    assert.deepEqual(findKeys(result, /token|secret|credential/i), []);
    // The timestamp arrived as a plain ISO string, not a FirestoreTimestamp.
    assert.equal(result.ok ? result.value[0]?.lastOrderDateIso : null, '2026-06-01T08:00:00.000Z');
  });

  it('normalises the D1 legacy month for display without touching the raw value', async () => {
    // A real production document stores Arabic-Indic digits (conflict D1).
    const legacy = '\u0660\u0666-\u0662\u0660\u0662\u0666';

    const result = await buildApplication(
      new FakeUsersRepository([makeUser({ lastOrderMonthYear: legacy })]),
    ).manager.listUsers();

    const first = result.ok ? result.value[0] : undefined;
    // The raw value survives untouched: normalising a read is not a migration.
    assert.equal(first?.lastOrderMonthYear, legacy);
    // ...and the display form is the ASCII month the domain compares against.
    assert.equal(first?.lastOrderMonthYearDisplay, '06-2026');
  });

  it('reports "never ordered" as null rather than guessing a month', async () => {
    const result = await buildApplication(
      new FakeUsersRepository([makeUser({ lastOrderMonthYear: '' })]),
    ).manager.listUsers();

    assert.equal(result.ok ? result.value[0]?.lastOrderMonthYearDisplay : null, null);
  });
});

describe('Stage 9 requirement 2: a user update delegates through the Application layer', () => {
  it('maps each permitted transition onto its repository method', async () => {
    const cases: readonly (readonly [string, Record<string, unknown>, string])[] = [
      ['rename', { uid: 'uid-1', name: 'اسم جديد' }, 'renameUser'],
      ['approve', { uid: 'uid-1', approval: 'approve' }, 'approveUser'],
      ['reject', { uid: 'uid-1', approval: 'reject' }, 'rejectUser'],
      ['grant', { uid: 'uid-1', exception: 'grant' }, 'grantSingleOrderException'],
      ['revoke', { uid: 'uid-1', exception: 'revoke' }, 'revokeSingleOrderException'],
    ];

    for (const [label, payload, method] of cases) {
      const users = new FakeUsersRepository([makeUser()]);
      const { service } = buildUsersService({ users });

      const result = await service.updateUser(payload);

      assert.equal(result.ok, true, `${label} should succeed`);
      assert.equal(users.callsTo(method).length, 1, `${label} must call ${method} exactly once`);
    }
  });

  it('trims the name before it reaches the repository', async () => {
    const users = new FakeUsersRepository([makeUser()]);
    const { service } = buildUsersService({ users });

    await service.updateUser({ uid: 'uid-1', name: '  نور الدين  ' });

    assert.deepEqual(users.callsTo('renameUser')[0], [{ uid: 'uid-1', name: 'نور الدين' }]);
  });

  it('applies several changes in a fixed order', async () => {
    const users = new FakeUsersRepository([makeUser()]);
    const { service } = buildUsersService({ users });

    await service.updateUser({ uid: 'uid-1', name: 'جديد', approval: 'approve', exception: 'grant' });

    // The order is the implementation's, not the caller's: predictable beats
    // last-writer-wins when several fields change together.
    assert.deepEqual(users.callOrder, ['renameUser', 'approveUser', 'grantSingleOrderException']);
  });

  it('returns no data, so the renderer must re-read to learn the truth', async () => {
    const { service } = buildUsersService();

    const result = await service.updateUser({ uid: 'uid-1', approval: 'approve' });

    // A write answers "did it work", not "here is the new document". The list is
    // the source of truth because a masked write leaves other fields alone.
    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.value : 'not-null', null);
  });
});
describe('Stage 9 requirement 3: unsupported fields cannot be updated', () => {
  it('refuses every field the Stage 5B contract does not expose', async () => {
    const forbiddenPayloads: readonly (readonly [string, unknown])[] = [
      ['role', { uid: 'uid-1', role: 'admin' }],
      ['employeeId', { uid: 'uid-1', employeeId: 'EMP-999' }],
      ['lastOrderMonthYear', { uid: 'uid-1', lastOrderMonthYear: '07-2026' }],
      ['lastOrderStatus', { uid: 'uid-1', lastOrderStatus: 'accepted' }],
      ['lastOrderId', { uid: 'uid-1', lastOrderId: 'order-9' }],
      ['hasException directly', { uid: 'uid-1', hasException: true }],
      ['a raw status string', { uid: 'uid-1', status: 'approved' }],
      ['a document body', { uid: 'uid-1', document: { name: 'x' } }],
      ['an update mask', { uid: 'uid-1', updateMaskPaths: ['role'] }],
    ];

    for (const [label, payload] of forbiddenPayloads) {
      const users = new FakeUsersRepository([makeUser()]);
      const { service } = buildUsersService({ users });

      const result = await service.updateUser(payload);

      assert.equal(result.ok, false, `${label} must be refused`);
      assert.equal(!result.ok ? result.error.code : null, 'VALIDATION_FAILED', `${label} code`);
      // Refused BEFORE any I/O: an unsupported key must not reach the network.
      assert.equal(users.totalCalls, 0, `${label} must not reach the repository`);
    }
  });

  it('refuses a malformed payload of any shape', async () => {
    const payloads: readonly unknown[] = [
      null, undefined, 42, 'string', [], {}, { uid: '' }, { uid: '  ' },
      { uid: 'users/../settings/app' }, { uid: 'a'.repeat(200) },
      { uid: 'uid-1', approval: 'delete' }, { uid: 'uid-1', exception: 'toggle' },
      { uid: 'uid-1', name: '' }, { uid: 'uid-1', name: '   ' },
      { uid: 'uid-1', name: 42 }, { uid: 'uid-1' },
    ];

    for (const payload of payloads) {
      const { service } = buildUsersService();
      const result = await service.updateUser(payload);
      assert.equal(result.ok, false, `payload ${JSON.stringify(payload) ?? 'undefined'} must be refused`);
    }
  });

  it('never throws, whatever it is handed', async () => {
    const { service } = buildUsersService();

    for (const payload of [null, 42, { uid: 'uid-1', role: 'admin' }]) {
      const result = await service.updateUser(payload);
      assert.equal(typeof result, 'object');
      assert.equal('ok' in result, true);
    }
  });
});
describe('Stage 9 requirement 4: application errors map through the existing taxonomy', () => {
  it('reports a rules denial as AUTHORIZATION_DENIED, not as an empty result', async () => {
    const { service } = buildUsersService({
      users: new FakeUsersRepository([], rulesDenied('users/uid-1')),
    });

    const result = await service.updateUser({ uid: 'uid-1', approval: 'approve' });

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
    assert.deepEqual(!result.ok ? Object.keys(result.error).sort() : [], ['code', 'message', 'retryable']);
  });

  it('never leaks a document path or a server message into the payload', async () => {
    const { service } = buildUsersService({
      users: new FakeUsersRepository([], new DomainError(
        'TRANSPORT',
        'Firestore request failed for users/uid-1: Missing or insufficient permissions.',
        { documentPath: 'users/uid-1' },
      )),
    });

    const result = await service.updateUser({ uid: 'uid-1', name: 'x' });

    const serialised = JSON.stringify(result);
    assert.equal(serialised.includes('users/uid-1'), false);
    assert.equal(serialised.includes('insufficient permissions'), false);
    assert.equal(serialised.includes('Firestore'), false);
    // The renderer gets a code plus the fixed sentence for that code.
    assert.equal(!result.ok ? result.error.message : null, APPLICATION_ERROR_MESSAGES.INFRASTRUCTURE_FAILURE);
  });

  it('maps a transaction-shaped failure to its own code rather than a business one', async () => {
    const { service } = buildUsersService({
      users: new FakeUsersRepository([], new DomainError('ABORTED', 'kept aborting')),
    });

    const result = await service.updateUser({ uid: 'uid-1', name: 'x' });

    assert.equal(!result.ok ? result.error.code : null, 'CONCURRENCY_CONFLICT');
    assert.equal(!result.ok ? result.error.retryable : null, true);
  });

  it('refuses to write without a Main-process session', async () => {
    const users = new FakeUsersRepository([makeUser()]);
    const { service } = buildUsersService({
      users,
      state: Object.freeze({ authenticated: false, uid: null, email: null, emailVerified: false, expirationTimeIso: null }),
    });

    const result = await service.updateUser({ uid: 'uid-1', approval: 'approve' });

    assert.equal(!result.ok ? result.error.code : null, 'AUTHENTICATION_FAILED');
    assert.equal(users.totalCalls, 0);
  });
});

describe('Stage 9: the application layer never substitutes for firestore.rules', () => {
  it('attempts the write even when the signed-in user is an employee', async () => {
    // The session's own role is `employee`. A client-side check would refuse
    // here; the architecture requires the request to go out and the server to
    // answer. This test would FAIL against a local-role implementation.
    const users = new FakeUsersRepository([makeUser()]);
    const { service } = buildUsersService({ users, state: EMPLOYEE_SESSION });

    const result = await service.updateUser({ uid: 'uid-1', approval: 'approve' });

    assert.equal(users.callsTo('approveUser').length, 1, 'the repository must still be reached');
    assert.equal(result.ok, true);
  });

  it('never consults the local role when deciding to write', async () => {
    // A spy whose `role` getter counts its reads: if the service consulted the
    // role for an authorization decision, the count would be non-zero.
    let roleReads = 0;
    const state = Object.defineProperty({ ...EMPLOYEE_SESSION }, 'role', {
      get: (): string => {
        roleReads += 1;
        return 'employee';
      },
    });

    const { service } = buildUsersService({ state: state as never });

    await service.updateUser({ uid: 'uid-1', approval: 'approve' });

    assert.equal(roleReads, 0, 'the application layer must not consult the local role to write');
  });
});