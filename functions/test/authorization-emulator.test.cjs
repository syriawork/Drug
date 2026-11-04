const assert = require('node:assert/strict');
const net = require('node:net');
const { after, before, describe, it } = require('node:test');

const API_KEY = 'demo-emulator-api-key';
const PASSWORD = 'Stage34C-Emulator-Only!2026';
const RUN_ID = `${Date.now()}-${process.pid}`;
const EMULATOR_REQUEST_TIMEOUT_MS = 60000;

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || '';
const eventarcHost = process.env.CLOUD_EVENTARC_EMULATOR_HOST || '';
const tasksHost = process.env.CLOUD_TASKS_EMULATOR_HOST || '';
const projectId = process.env.FIREBASE_PROJECT_ID || '';

const users = new Map();
const profileUids = [];

function assertLoopbackEndpoint(value, expectedPort, label) {
  const match = /^(127\.0\.0\.1|localhost|\[?::1\]?):(\d+)$/.exec(value);
  assert.ok(match, `${label} must use a loopback address`);
  assert.equal(Number(match[2]), expectedPort, `${label} must use its dedicated local port`);
}

async function assertListening(endpoint, label) {
  const [host, rawPort] = endpoint.replace(/^https?:\/\//, '').split(':');
  const port = Number(rawPort);
  const remoteAddress = await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(3000);
    socket.once('connect', () => {
      const address = socket.remoteAddress;
      socket.destroy();
      resolve(address);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`${label} did not accept a local connection`));
    });
    socket.once('error', () => reject(new Error(`${label} is unavailable at its configured loopback port`)));
  });
  assert.ok(remoteAddress === '127.0.0.1' || remoteAddress === '::1', `${label} resolved to a non-loopback address`);
}

function authUrl(path) {
  return `http://${authHost}/identitytoolkit.googleapis.com/v1/${path}?key=${API_KEY}`;
}

function firestoreDocumentUrl(uid) {
  return `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
}

function callableUrl() {
  return `http://${functionsHost}/${projectId}/us-central1/authorizationProbe`;
}

async function requestJson(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(EMULATOR_REQUEST_TIMEOUT_MS),
  });
}

async function createAuthUser(label) {
  const email = `stage34c-${RUN_ID}-${label}@example.test`;
  const response = await requestJson(authUrl('accounts:signUp'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, 'Auth emulator did not create an isolated test user');
  assert.equal(typeof body.localId, 'string');
  assert.equal(typeof body.idToken, 'string');
  assert.equal(body.aud, undefined);
  const tokenClaims = JSON.parse(Buffer.from(body.idToken.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(tokenClaims.aud, projectId, 'Auth emulator token project differs from the lab project');

  const user = { uid: body.localId, idToken: body.idToken };
  users.set(label, user);
  return user;
}

function firestoreFields(profile) {
  const fields = {};
  for (const [key, value] of Object.entries(profile)) {
    fields[key] = { stringValue: value };
  }
  return { fields };
}

async function writeProfile(user, profile) {
  const response = await requestJson(firestoreDocumentUrl(user.uid), {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer owner',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(firestoreFields(profile)),
  });
  assert.equal(response.status, 200, 'Firestore emulator fixture write failed');
  if (!profileUids.includes(user.uid)) profileUids.push(user.uid);
}

async function callable(capability, user, extraData = {}, authenticated = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (authenticated && user) headers.Authorization = `Bearer ${user.idToken}`;
  const response = await requestJson(callableUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ data: { capability, ...extraData } }),
  });
  const rawBody = await response.text();
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    assert.fail(`Functions emulator returned non-JSON HTTP ${response.status}`);
  }
  return { response, body };
}

async function expectGranted(capability, user) {
  const { response, body } = await callable(capability, user);
  assert.equal(response.status, 200);
  assert.deepEqual(body.result, { capability, granted: true });
  assert.equal('uid' in body.result, false);
  assert.equal('profile' in body.result, false);
}

async function expectCallableError(capability, user, code, options = {}) {
  const { response, body } = await callable(capability, user, options.extraData, options.authenticated);
  assert.notEqual(response.status, 200);
  assert.equal(body.error?.status, code);
  assert.equal(typeof body.error?.message, 'string');
  assert.equal(body.error.message.includes('Stage34C-Emulator-Only'), false);
  assert.equal(body.error.message.includes('stack'), false);
  assert.equal('stack' in body.error, false);
}

async function probe(url) {
  try {
    const response = await requestJson(url, { method: 'GET' });
    await response.arrayBuffer();
    return response.status;
  } catch {
    return null;
  }
}

describe('authorizationProbe against the local Auth, Firestore, and Functions emulators', () => {
  before(async () => {
    assert.ok(projectId.startsWith('demo-'), 'test requires a demo-* project ID');
    assertLoopbackEndpoint(authHost, 9099, 'Auth emulator');
    assertLoopbackEndpoint(firestoreHost, 8080, 'Firestore emulator');
    assertLoopbackEndpoint(functionsHost, 5001, 'Functions emulator');
    assertLoopbackEndpoint(eventarcHost.replace(/^https?:\/\//, ''), 9299, 'Eventarc emulator');
    assertLoopbackEndpoint(tasksHost.replace(/^https?:\/\//, ''), 9499, 'Cloud Tasks emulator');

    const [authStatus, firestoreStatus] = await Promise.all([
      probe(`http://${authHost}/`),
      probe(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/`),
    ]);
    assert.notEqual(authStatus, null, 'Auth emulator unavailable at the configured loopback endpoint');
    assert.notEqual(firestoreStatus, null, 'Firestore emulator unavailable at the configured loopback endpoint');
    assert.ok(firestoreStatus < 500, 'Firestore emulator did not answer a local REST request');
    await Promise.all([
      assertListening(authHost, 'Auth emulator'),
      assertListening(firestoreHost, 'Firestore emulator'),
      assertListening(functionsHost, 'Functions emulator'),
      assertListening(eventarcHost, 'Eventarc emulator'),
      assertListening(tasksHost, 'Cloud Tasks emulator'),
    ]);
    console.log(`[stage34c] local emulator endpoints verified for ${projectId}: auth=${authHost}, firestore=${firestoreHost}, functions=${functionsHost}, eventarc=${eventarcHost}, tasks=${tasksHost}`);

    const fixtures = [
      ['no-profile', null],
      ['malformed', { role: 'unknown', status: 'approved' }],
      ['pending-employee', { role: 'employee', status: 'pending' }],
      ['approved-employee', { role: 'employee', status: 'approved' }],
      ['approved-admin', { role: 'admin', status: 'approved' }],
      ['pending-admin', { role: 'admin', status: 'pending' }],
      ['approved-assistant', { role: 'assistant', status: 'approved' }],
      ['pending-assistant', { role: 'assistant', status: 'pending' }],
    ];

    for (const [label, profile] of fixtures) {
      const user = await createAuthUser(label);
      if (profile !== null) {
        await writeProfile(user, {
          uid: user.uid,
          name: 'Stage 34C emulator fixture',
          employeeId: 'STAGE34C',
          ...profile,
        });
      }
    }
  });

  after(async () => {
    for (const uid of profileUids) {
      const response = await requestJson(firestoreDocumentUrl(uid), {
        method: 'DELETE',
        headers: { Authorization: 'Bearer owner' },
      });
      assert.equal(response.status, 200, 'Firestore fixture cleanup failed');
    }

    for (const user of users.values()) {
      const response = await requestJson(authUrl('accounts:delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: user.idToken }),
      });
      assert.equal(response.status, 200, 'Auth fixture cleanup failed');
    }
  });

  it('rejects an unauthenticated callable request', async () => {
    await expectCallableError('approved-user', null, 'UNAUTHENTICATED', { authenticated: false });
  });

  it('rejects an authenticated user with no profile', async () => {
    await expectCallableError('approved-user', users.get('no-profile'), 'NOT_FOUND');
  });

  it('rejects a malformed profile', async () => {
    await expectCallableError('approved-user', users.get('malformed'), 'FAILED_PRECONDITION');
  });

  it('denies a pending employee the approved-user capability', async () => {
    await expectCallableError('approved-user', users.get('pending-employee'), 'PERMISSION_DENIED');
  });

  it('grants the approved-user capability to an approved employee', async () => {
    await expectGranted('approved-user', users.get('approved-employee'));
  });

  it('grants administrator capability to an approved administrator', async () => {
    await expectGranted('administrator', users.get('approved-admin'));
  });

  it('grants administrator capability to a pending administrator', async () => {
    await expectGranted('administrator', users.get('pending-admin'));
  });

  it('grants assistant capability to an approved assistant', async () => {
    await expectGranted('assistant', users.get('approved-assistant'));
  });

  it('grants assistant capability to a pending assistant', async () => {
    await expectGranted('assistant', users.get('pending-assistant'));
  });

  it('denies an employee administrator capability', async () => {
    await expectCallableError('administrator', users.get('approved-employee'), 'PERMISSION_DENIED');
  });

  it('denies an employee assistant capability', async () => {
    await expectCallableError('assistant', users.get('approved-employee'), 'PERMISSION_DENIED');
  });

  it('grants the approved-user capability to an approved administrator under Rules semantics', async () => {
    await expectGranted('approved-user', users.get('approved-admin'));
  });

  it('grants the approved-user capability to an approved assistant under Rules semantics', async () => {
    await expectGranted('approved-user', users.get('approved-assistant'));
  });

  it('denies the approved-user capability to a pending administrator and assistant', async () => {
    await expectCallableError('approved-user', users.get('pending-admin'), 'PERMISSION_DENIED');
    await expectCallableError('approved-user', users.get('pending-assistant'), 'PERMISSION_DENIED');
  });

  it('applies a role change on the next callable request', async () => {
    const user = users.get('approved-employee');
    await expectCallableError('administrator', user, 'PERMISSION_DENIED');
    await writeProfile(user, {
      uid: user.uid,
      name: 'Stage 34C emulator fixture',
      employeeId: 'STAGE34C',
      role: 'assistant',
      status: 'approved',
    });
    await expectGranted('administrator', user);
  });

  it('applies approval revocation on the next callable request', async () => {
    const user = users.get('approved-assistant');
    await expectGranted('approved-user', user);
    await writeProfile(user, {
      uid: user.uid,
      name: 'Stage 34C emulator fixture',
      employeeId: 'STAGE34C',
      role: 'assistant',
      status: 'rejected',
    });
    await expectCallableError('approved-user', user, 'PERMISSION_DENIED');
  });

  it('does not trust forged UID, role, or status in callable data', async () => {
    const employee = users.get('approved-employee');
    await writeProfile(employee, {
      uid: employee.uid,
      name: 'Stage 34C emulator fixture',
      employeeId: 'STAGE34C',
      role: 'employee',
      status: 'approved',
    });
    await expectCallableError('administrator', employee, 'PERMISSION_DENIED', {
      extraData: {
        uid: users.get('approved-admin').uid,
        role: 'admin',
        status: 'approved',
      },
    });
    await writeProfile(employee, {
      uid: employee.uid,
      name: 'Stage 34C emulator fixture',
      employeeId: 'STAGE34C',
      role: 'employee',
      status: 'pending',
    });
    await expectCallableError('approved-user', employee, 'PERMISSION_DENIED', {
      extraData: {
        uid: users.get('approved-admin').uid,
        role: 'admin',
        status: 'approved',
      },
    });
  });

  it('rejects an unknown capability', async () => {
    await expectCallableError('root', users.get('approved-employee'), 'INVALID_ARGUMENT');
  });
});
