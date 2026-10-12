import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createManagerApplication, type ManagerApplication } from '../../electron/application';
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
import {
  DEMO_PASSWORD,
  EmulatorHarness,
  probeEmulators,
  readEmulatorEnvironment,
  type ActorSession,
} from '../helpers/firestore-emulator-harness';

const EMPLOYEE_A_EMAIL = 'employee-a.stage18@drug-manager.demo';
const EMPLOYEE_B_EMAIL = 'employee-b.stage18@drug-manager.demo';
const REQUEST_IDS = [
  'stage18-own-pending',
  'stage18-own-processed',
  'stage18-own-failed',
  'stage18-rival-pending',
] as const;
const OWN_REQUEST_IDS = REQUEST_IDS.slice(0, 3);
const REQUEST_STATUSES = ['pending', 'processed', 'failed'] as const;

let harness: EmulatorHarness | null = null;
let employeeA: ActorSession | null = null;
let employeeAUid = '';
let employeeBUid = '';

function applicationFor(actor: ActorSession): ManagerApplication {
  const context: RepositoryContext = { client: actor.client, onWarning: () => undefined };
  return createManagerApplication({
    session: actor.authService,
    usersRepository: new FirestoreUsersRepository(context),
    medicinesRepository: new FirestoreMedicinesRepository(context),
    settingsRepository: new FirestoreSettingsRepository(context),
    orderRequestsRepository: new FirestoreOrderRequestsRepository(context),
    ordersRepository: new FirestoreOrdersRepository(context),
    stockLogsRepository: new FirestoreStockLogsRepository(context),
    inboundStockTransactionFactory: createInboundStockTransactionFactory(actor.client),
    orderProcessing: new FirestoreOrderProcessingService(
      createOrderProcessingTransactionFactory(actor.client),
    ),
  });
}

async function seedRequest(id: string, uid: string, status: typeof REQUEST_STATUSES[number]): Promise<void> {
  const activeHarness = harness;
  if (activeHarness === null) {
    throw new Error('emulator harness was not initialized');
  }
  await activeHarness.seedDocument(`order_requests/${id}`, {
    uid,
    items: [{ medicineId: 'stage18-med', medicineName: 'دواء الاختبار', quantity: 2 }],
    status,
    requestDate: new Date('2026-10-08T06:00:00.000Z'),
    orderId: status === 'processed' ? 'stage18-order' : null,
    error: status === 'failed' ? 'رفض العمل' : null,
    processedBy: status === 'pending' ? null : 'stage18-admin',
    processedAt: status === 'pending' ? null : new Date('2026-10-08T07:00:00.000Z'),
  });
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
  employeeAUid = await harness.ensureAuthUser(EMPLOYEE_A_EMAIL, DEMO_PASSWORD);
  employeeBUid = await harness.ensureAuthUser(EMPLOYEE_B_EMAIL, DEMO_PASSWORD);
  await harness.flush([
    `users/${employeeAUid}`,
    `users/${employeeBUid}`,
    ...REQUEST_IDS.map((id) => `order_requests/${id}`),
  ]);
  await harness.seedUserProfile({
    uid: employeeAUid,
    name: 'موظف Stage 18 أ',
    employeeId: 'S18-A',
    role: 'employee',
    status: 'approved',
    hasException: false,
  });
  await harness.seedUserProfile({
    uid: employeeBUid,
    name: 'موظف Stage 18 ب',
    employeeId: 'S18-B',
    role: 'employee',
    status: 'approved',
    hasException: false,
  });
  for (const [index, id] of OWN_REQUEST_IDS.entries()) {
    await seedRequest(id, employeeAUid, REQUEST_STATUSES[index]!);
  }
  await seedRequest(REQUEST_IDS[3], employeeBUid, 'pending');
  employeeA = await harness.openSession(EMPLOYEE_A_EMAIL, DEMO_PASSWORD);
});

after(async () => {
  if (harness !== null) {
    await harness.flush([
      `users/${employeeAUid}`,
      `users/${employeeBUid}`,
      ...REQUEST_IDS.map((id) => `order_requests/${id}`),
    ]);
  }
});

describe('Stage 18 employee request-status reads against real Firestore Rules', () => {
  it('reads the stored status of the exact employee-owned request through the application path', async (context) => {
    if (harness === null || employeeA === null) {
      context.skip('Firebase emulators are not available');
      return;
    }

    const app = applicationFor(employeeA);
    for (const [index, requestId] of OWN_REQUEST_IDS.entries()) {
      const result = await app.orderRequests.getOrderRequest(requestId);
      assert.equal(result.ok, true);
      assert.equal(result.ok ? result.value.id : null, requestId);
      assert.equal(result.ok ? result.value.status : null, REQUEST_STATUSES[index]);
    }
  });

  it('denies employee A access to employee B request without exposing its data', async (context) => {
    if (harness === null || employeeA === null) {
      context.skip('Firebase emulators are not available');
      return;
    }

    const result = await applicationFor(employeeA).orderRequests.getOrderRequest(REQUEST_IDS[3]);
    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
    assert.equal(JSON.stringify(result).includes(REQUEST_IDS[3]), false);
    assert.equal(JSON.stringify(result).includes(employeeBUid), false);
  });

  it('performs read-only refreshes and leaves all request documents unchanged', async (context) => {
    if (harness === null || employeeA === null) {
      context.skip('Firebase emulators are not available');
      return;
    }

    const paths = REQUEST_IDS.map((id) => `order_requests/${id}`);
    const before = await Promise.all(paths.map((path) => harness!.readAsEmulatorOwner(path)));
    const app = applicationFor(employeeA);
    for (const requestId of OWN_REQUEST_IDS) {
      const result = await app.orderRequests.getOrderRequest(requestId);
      assert.equal(result.ok, true);
    }
    const afterReads = await Promise.all(paths.map((path) => harness!.readAsEmulatorOwner(path)));
    assert.deepEqual(afterReads, before);
  });

  it('uses the established Rules fingerprint without changing either copy', () => {
    const projectRoot = join(__dirname, '..', '..', '..');
    const expected = '1FA3C6076BBA8DA4F0E10138B9E61E62257943C3C689B01964F4EAB402CDC63B';
    const labRules = join(projectRoot, 'emulator-lab', 'firestore.rules');
    const androidRules = process.env['DRUG_MANAGER_ANDROID_RULES_PATH']
      ?? join('E:', 'programs and applications', 'mobile', 'drug', 'firestore.rules');
    const hash = (path: string): string => createHash('sha256')
      .update(readFileSync(path))
      .digest('hex')
      .toUpperCase();

    assert.equal(existsSync(labRules), true);
    assert.equal(existsSync(androidRules), true);
    assert.equal(hash(labRules), expected);
    assert.equal(hash(androidRules), expected);
  });
});
