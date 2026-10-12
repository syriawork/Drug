import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createManagerApplication, type ManagerApplication } from '../../electron/application';
import { DomainError } from '../../electron/domain/errors';
import {
  FirestoreMedicinesRepository,
  FirestoreOrderRequestsRepository,
  FirestoreOrdersRepository,
  FirestoreSettingsRepository,
  FirestoreStockLogsRepository,
  FirestoreUsersRepository,
  type RepositoryContext,
  createInboundStockTransactionFactory,
  createOrderProcessingTransactionFactory,
} from '../../electron/repositories';
import { FirestoreOrderProcessingService } from '../../electron/services/order-processing.service';
import { FirestoreRestClient } from '../../electron/services/firestore-rest';
import { FirestoreTimestamp } from '../../electron/services/firestore-codec';
import {
  DEMO_PASSWORD,
  EmulatorHarness,
  probeEmulators,
  readEmulatorEnvironment,
  type ActorSession,
} from '../helpers/firestore-emulator-harness';

const ADMIN_EMAIL = 'admin.stage16@drug-manager.demo';
const EMPLOYEE_EMAIL = 'employee.stage16@drug-manager.demo';
const PENDING_EMAIL = 'pending.stage16@drug-manager.demo';
const RIVAL_EMAIL = 'rival.stage16@drug-manager.demo';
const MEDICINE_ID = 'stage16-medicine';
const EXPECTED_REQUEST_KEYS = ['items', 'requestDate', 'status', 'uid'];

let harness: EmulatorHarness | null = null;
let admin: ActorSession | null = null;
let employee: ActorSession | null = null;
let pending: ActorSession | null = null;
let adminUid = '';
let employeeUid = '';
let pendingUid = '';
let rivalUid = '';
const createdPaths: string[] = [];

function applicationFor(session: ActorSession): ManagerApplication {
  const context: RepositoryContext = { client: session.client, onWarning: () => undefined };
  return createManagerApplication({
    session: session.authService,
    usersRepository: new FirestoreUsersRepository(context),
    medicinesRepository: new FirestoreMedicinesRepository(context),
    settingsRepository: new FirestoreSettingsRepository(context),
    orderRequestsRepository: new FirestoreOrderRequestsRepository(context),
    ordersRepository: new FirestoreOrdersRepository(context),
    stockLogsRepository: new FirestoreStockLogsRepository(context),
    inboundStockTransactionFactory: createInboundStockTransactionFactory(session.client),
    orderProcessing: new FirestoreOrderProcessingService(createOrderProcessingTransactionFactory(session.client)),
  });
}

async function listRequestIds(session: ActorSession): Promise<string[]> {
  const activeHarness = harness;
  if (activeHarness === null) {
    throw new Error('emulator harness was not initialized');
  }
  const response = await fetch(activeHarness.documentUrl('order_requests'), {
    headers: { Authorization: `Bearer ${session.idToken}` },
  });
  assert.equal(response.status, 200, `unexpected order_requests listing status ${response.status}`);
  const body = await response.json() as { documents?: { name: string }[] };
  return (body.documents ?? []).map((document) => document.name.split('/').pop() ?? '');
}

async function expectRulesDenied(action: () => Promise<unknown>): Promise<void> {
  await assert.rejects(action, (error: unknown) =>
    error instanceof DomainError && error.kind === 'NOT_AUTHORIZED');
}

before(async () => {
  const environment = readEmulatorEnvironment();
  const availability = await probeEmulators(environment);
  if (!availability.available) {
    if (environment.requiresEmulator) {
      assert.fail(`the required Firebase emulators are unavailable: ${availability.detail}`);
    }
    return;
  }

  harness = new EmulatorHarness(environment);
  adminUid = await harness.ensureAuthUser(ADMIN_EMAIL, DEMO_PASSWORD);
  employeeUid = await harness.ensureAuthUser(EMPLOYEE_EMAIL, DEMO_PASSWORD);
  pendingUid = await harness.ensureAuthUser(PENDING_EMAIL, DEMO_PASSWORD);
  rivalUid = await harness.ensureAuthUser(RIVAL_EMAIL, DEMO_PASSWORD);

  const profilePaths = [`users/${adminUid}`, `users/${employeeUid}`, `users/${pendingUid}`, `users/${rivalUid}`];
  await harness.flush([...profilePaths, `medicines/${MEDICINE_ID}`]);
  await harness.seedUserProfile({
    uid: adminUid, name: 'مدير المرحلة 16', employeeId: 'S16-A', role: 'admin', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: employeeUid, name: 'موظف المرحلة 16', employeeId: 'S16-E', role: 'employee', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: pendingUid, name: 'مستخدم غير معتمد', employeeId: 'S16-P', role: 'employee', status: 'pending', hasException: false,
  });
  await harness.seedUserProfile({
    uid: rivalUid, name: 'موظف آخر', employeeId: 'S16-R', role: 'employee', status: 'approved', hasException: false,
  });
  await harness.seedDocument(`medicines/${MEDICINE_ID}`, {
    id: MEDICINE_ID,
    name: 'اسم الدواء المخزَّن',
    maxQuantity: 5,
    stock: 10,
    totalInward: 15,
    totalOutward: 5,
  });

  admin = await harness.openSession(ADMIN_EMAIL, DEMO_PASSWORD);
  employee = await harness.openSession(EMPLOYEE_EMAIL, DEMO_PASSWORD);
  pending = await harness.openSession(PENDING_EMAIL, DEMO_PASSWORD);
});

after(async () => {
  if (harness !== null) {
    await harness.flush([
      `users/${adminUid}`,
      `users/${employeeUid}`,
      `users/${pendingUid}`,
      `users/${rivalUid}`,
      `medicines/${MEDICINE_ID}`,
      ...createdPaths,
    ]);
  }
});

describe('Stage 16 order-request submission against real Firestore Rules', () => {
  it('approved authenticated employee creates one pending request with exact server-owned fields', async (context) => {
    if (harness === null || employee === null || admin === null) {
      context.skip('Firebase emulators are not available');
      return;
    }
    const beforeIds = await listRequestIds(admin);
    const result = await applicationFor(employee).orderRequests.submitPendingRequest({
      items: [{ medicineId: MEDICINE_ID, quantity: 2 }],
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    const requestId = result.value.requestId;
    createdPaths.push(`order_requests/${requestId}`);
    assert.deepEqual((await listRequestIds(admin)).filter((id) => !beforeIds.includes(id)), [requestId]);

    const stored = await harness.readAsEmulatorOwner(`order_requests/${requestId}`);
    assert.notEqual(stored, null);
    assert.deepEqual(Object.keys(stored ?? {}).sort(), EXPECTED_REQUEST_KEYS);
    assert.equal(stored?.['uid'], employeeUid);
    assert.equal(stored?.['status'], 'pending');
    assert.ok(stored?.['requestDate'] instanceof FirestoreTimestamp, 'requestDate must resolve as a Firestore server timestamp');
    assert.equal('requestId' in (stored ?? {}), false);
    const items = stored?.['items'];
    assert.ok(Array.isArray(items));
    assert.deepEqual(items?.[0], {
      medicineId: MEDICINE_ID,
      medicineName: 'اسم الدواء المخزَّن',
      quantity: 2,
    });
  });

  it('approved administrators are authorized by the existing Rules', async (context) => {
    if (harness === null || admin === null) {
      context.skip('Firebase emulators are not available');
      return;
    }
    const result = await applicationFor(admin).orderRequests.submitPendingRequest({
      items: [{ medicineId: MEDICINE_ID, quantity: 1 }],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      createdPaths.push(`order_requests/${result.value.requestId}`);
      const stored = await harness.readAsEmulatorOwner(`order_requests/${result.value.requestId}`);
      assert.equal(stored?.['uid'], adminUid);
    }
  });

  it('unauthenticated repository submission is denied by Firestore Rules', async (context) => {
    if (harness === null || admin === null) {
      context.skip('Firebase emulators are not available');
      return;
    }
    const beforeIds = await listRequestIds(admin);
    const client = new FirestoreRestClient({
      config: harness.firestoreConfig,
      getAccessToken: async () => null,
      allowRemoteTarget: false,
    });
    const contextForNoAuth: RepositoryContext = { client, onWarning: () => undefined };
    await expectRulesDenied(() => new FirestoreOrderRequestsRepository(contextForNoAuth).submitPendingRequest({
      uid: employeeUid,
      items: [{ medicineId: MEDICINE_ID, medicineName: 'اسم الدواء المخزَّن', quantity: 1 }],
    }));
    assert.deepEqual(await listRequestIds(admin), beforeIds);
  });

  it('non-approved authenticated user is denied and leaves no request mutation', async (context) => {
    if (harness === null || pending === null || admin === null) {
      context.skip('Firebase emulators are not available');
      return;
    }
    const beforeIds = await listRequestIds(admin);
    const result = await applicationFor(pending).orderRequests.submitPendingRequest({
      items: [{ medicineId: MEDICINE_ID, quantity: 1 }],
    });
    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
    assert.deepEqual(await listRequestIds(admin), beforeIds);
  });

  it('renderer cannot select another uid, and Rules reject a repository-level uid mismatch', async (context) => {
    if (harness === null || employee === null || admin === null) {
      context.skip('Firebase emulators are not available');
      return;
    }
    const beforeIds = await listRequestIds(admin);
    const applicationResult = await applicationFor(employee).orderRequests.submitPendingRequest({
      uid: rivalUid,
      items: [{ medicineId: MEDICINE_ID, quantity: 1 }],
    });
    assert.equal(applicationResult.ok, false);
    assert.equal(!applicationResult.ok ? applicationResult.error.code : null, 'VALIDATION_FAILED');

    const contextForEmployee: RepositoryContext = { client: employee.client, onWarning: () => undefined };
    await expectRulesDenied(() => new FirestoreOrderRequestsRepository(contextForEmployee).submitPendingRequest({
      uid: rivalUid,
      items: [{ medicineId: MEDICINE_ID, medicineName: 'اسم الدواء المخزَّن', quantity: 1 }],
    }));
    assert.deepEqual(await listRequestIds(admin), beforeIds);
  });
});
