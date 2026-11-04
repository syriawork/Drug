const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { createAuthorizationService } = require('../lib/auth/authorization.js');
const { HttpsError } = require('firebase-functions/v2/https');

const uid = 'caller-1';
const request = { auth: { uid } };

function profile(overrides = {}) {
  return {
    uid,
    role: 'employee',
    status: 'approved',
    ...overrides,
  };
}

function createService(readProfile, diagnostics = { error() {} }) {
  return createAuthorizationService({
    profiles: { read: readProfile },
    diagnostics,
  });
}

async function expectHttpsError(action, code) {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, code);
    return true;
  });
}

describe('callable authentication and authorization foundation', () => {
  it('rejects a missing callable authentication context', async () => {
    const service = createService(async () => profile());
    await expectHttpsError(service.requireApprovedEmployee({}), 'unauthenticated');
  });

  it('rejects a missing UID in the verified authentication context', async () => {
    const service = createService(async () => profile());
    await expectHttpsError(service.requireApprovedEmployee({ auth: {} }), 'unauthenticated');
  });

  it('returns identity and profile for an existing authenticated caller', async () => {
    const service = createService(async (requestedUid) => profile({ uid: requestedUid }));
    const caller = await service.requireApprovedEmployee(request);
    assert.equal(caller.uid, uid);
    assert.deepEqual(caller.profile, profile());
  });

  it('rejects a missing user profile', async () => {
    const service = createService(async () => null);
    await expectHttpsError(service.requireApprovedEmployee(request), 'not-found');
  });

  it('rejects a profile deleted before the next authorization decision', async () => {
    let currentProfile = profile();
    const service = createService(async () => currentProfile);
    await service.requireApprovedEmployee(request);
    currentProfile = null;
    await expectHttpsError(service.requireApprovedEmployee(request), 'not-found');
  });

  it('rejects malformed or unusable profile fields', async () => {
    const service = createService(async () => profile({ role: 'superuser' }));
    await expectHttpsError(service.requireApprovedEmployee(request), 'failed-precondition');
  });

  it('denies an unapproved employee', async () => {
    const service = createService(async () => profile({ status: 'pending' }));
    await expectHttpsError(service.requireApprovedEmployee(request), 'permission-denied');
  });

  it('allows an approved employee', async () => {
    const service = createService(async () => profile());
    const caller = await service.requireApprovedEmployee(request);
    assert.equal(caller.profile.status, 'approved');
  });

  it('allows an administrator through the administrator Rules capability', async () => {
    const service = createService(async () => profile({ role: 'admin', status: 'pending' }));
    const caller = await service.requireAdministrator(request);
    assert.equal(caller.profile.role, 'admin');
  });

  it('allows an assistant through the same manager Rules capability', async () => {
    const service = createService(async () => profile({ role: 'assistant', status: 'pending' }));
    const caller = await service.requireAssistant(request);
    assert.equal(caller.profile.role, 'assistant');
  });

  it('denies an employee administrator-only authorization attempt', async () => {
    const service = createService(async () => profile());
    await expectHttpsError(service.requireAdministrator(request), 'permission-denied');
  });

  it('preserves Rules approval semantics for an approved administrator', async () => {
    const service = createService(async () => profile({ role: 'admin' }));
    const caller = await service.requireApprovedEmployee(request);
    assert.equal(caller.profile.role, 'admin');
  });

  it('denies an administrator whose status is not approved from the approval capability', async () => {
    const service = createService(async () => profile({ role: 'admin', status: 'pending' }));
    await expectHttpsError(service.requireApprovedEmployee(request), 'permission-denied');
  });

  it('loads the profile again so a changed role takes effect on the next check', async () => {
    let currentProfile = profile({ role: 'assistant' });
    const service = createService(async () => currentProfile);
    await service.requireAdministrator(request);
    currentProfile = profile({ role: 'employee' });
    await expectHttpsError(service.requireAdministrator(request), 'permission-denied');
  });

  it('loads the profile again so revoked approval takes effect on the next check', async () => {
    let currentProfile = profile();
    const service = createService(async () => currentProfile);
    await service.requireApprovedEmployee(request);
    currentProfile = profile({ status: 'rejected' });
    await expectHttpsError(service.requireApprovedEmployee(request), 'permission-denied');
  });

  it('maps profile-loading failures to a safe internal error and sanitized diagnostics', async () => {
    const entries = [];
    const diagnostics = { error: (message, context) => entries.push({ message, context }) };
    const service = createService(async () => {
      throw new Error('sensitive database details and credential');
    }, diagnostics);

    await assert.rejects(service.requireApprovedEmployee(request), (error) => {
      assert.ok(error instanceof HttpsError);
      assert.equal(error.code, 'internal');
      assert.equal(error.message, 'An unexpected error occurred.');
      assert.equal(error.message.includes('sensitive'), false);
      return true;
    });
    assert.deepEqual(entries, [{
      message: 'Callable operation failed unexpectedly.',
      context: {
        operation: 'requireApprovedEmployee',
        errorType: 'Error',
      },
    }]);
  });

  it('preserves intentional HttpsError responses without logging them as unexpected', async () => {
    const entries = [];
    const diagnostics = { error: (message, context) => entries.push({ message, context }) };
    const service = createService(async () => {
      throw new HttpsError('permission-denied', 'The request is not allowed.');
    }, diagnostics);

    await expectHttpsError(service.requireApprovedEmployee(request), 'permission-denied');
    assert.deepEqual(entries, []);
  });
});
