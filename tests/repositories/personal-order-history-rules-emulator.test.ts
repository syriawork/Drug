import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import {
  DEMO_PASSWORD,
  EmulatorHarness,
  probeEmulators,
  readEmulatorEnvironment,
  type ActorSession,
} from '../helpers/firestore-emulator-harness';

const EMPLOYEE_A_EMAIL = 'employee-a.stage17@drug-manager.demo';
const EMPLOYEE_B_EMAIL = 'employee-b.stage17@drug-manager.demo';
const ADMIN_EMAIL = 'admin.stage17@drug-manager.demo';
const ORDER_A_ID = 'stage17-order-a';
const ORDER_B_ID = 'stage17-order-b';

let harness: EmulatorHarness | null = null;
let employeeA: ActorSession | null = null;
let admin: ActorSession | null = null;
let employeeAUid = '';
let employeeBUid = '';
let adminUid = '';
const createdPaths: string[] = [];

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
    orderProcessing: new FirestoreOrderProcessingService(createOrderProcessingTransactionFactory(actor.client)),
  });
}

async function listOrderIds(actor: ActorSession): Promise<string[]> {
  const activeHarness = harness;
  if (activeHarness === null) {
    throw new Error('emulator harness was not initialized');
  }
  const response = await fetch(activeHarness.documentUrl('orders'), {
    headers: { Authorization: `Bearer ${actor.idToken}` },
  });
  assert.equal(response.status, 200, `unexpected orders listing status ${response.status}`);
  const body = await response.json() as { documents?: { name: string }[] };
  return (body.documents ?? []).map((document) => document.name.split('/').pop() ?? '');
}

async function seedOrder(orderId: string, uid: string, medicineName: string): Promise<void> {
  const activeHarness = harness;
  if (activeHarness === null) {
    throw new Error('emulator harness was not initialized');
  }
  await activeHarness.seedDocument(`orders/${orderId}`, {
    userId: uid,
    userName: medicineName,
    items: [{ medicineId: 'stage17-med', medicineName, quantity: 2 }],
    status: 'accepted',
    date: new Date('2026-09-20T10:00:00.000Z'),
    monthYear: '09-2026',
    isExceptionOrder: false,
  });
  createdPaths.push(`orders/${orderId}`);
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
  employeeAUid = await harness.ensureAuthUser(EMPLOYEE_A_EMAIL, DEMO_PASSWORD);
  employeeBUid = await harness.ensureAuthUser(EMPLOYEE_B_EMAIL, DEMO_PASSWORD);
  await harness.flush([
    `users/${adminUid}`,
    `users/${employeeAUid}`,
    `users/${employeeBUid}`,
    `orders/${ORDER_A_ID}`,
    `orders/${ORDER_B_ID}`,
  ]);
  await harness.seedUserProfile({
    uid: adminUid, name: 'مدير Stage 17', employeeId: 'S17-ADMIN', role: 'admin', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: employeeAUid, name: 'الموظف أ', employeeId: 'S17-A', role: 'employee', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: employeeBUid, name: 'الموظف ب', employeeId: 'S17-B', role: 'employee', status: 'approved', hasException: false,
  });
  await seedOrder(ORDER_A_ID, employeeAUid, 'دواء الموظف أ');
  await seedOrder(ORDER_B_ID, employeeBUid, 'دواء الموظف ب');
  employeeA = await harness.openSession(EMPLOYEE_A_EMAIL, DEMO_PASSWORD);
  admin = await harness.openSession(ADMIN_EMAIL, DEMO_PASSWORD);
});

after(async () => {
  if (harness !== null) {
    await harness.flush([
      `users/${adminUid}`,
      `users/${employeeAUid}`,
      `users/${employeeBUid}`,
      ...createdPaths,
    ]);
  }
});

describe('Stage 17 personal order history against real Firestore Rules', () => {
  it('employee A reads only A orders and cannot query B through the owner-scoped Stage 17 operation', async (context) => {
    if (harness === null || employeeA === null) {
      context.skip('Firebase emulators are not available');
      return;
    }
    const result = await applicationFor(employeeA).manager.listMyOrders();
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepEqual(result.value.map((order) => order.id), [ORDER_A_ID]);
    assert.equal(JSON.stringify(result.value).includes(employeeAUid), false);
    assert.equal(JSON.stringify(result.value).includes(employeeBUid), false);
    assert.equal(JSON.stringify(result.value).includes(ORDER_B_ID), false);

    const repository = new FirestoreOrdersRepository({
      client: employeeA.client,
      onWarning: () => undefined,
    });
    await assert.rejects(
      repository.listOrdersByUser(employeeBUid, 500),
      (error: unknown) => error instanceof DomainError && error.kind === 'NOT_AUTHORIZED',
    );
  });

  it('performs no writes and leaves Stage 12 manager-wide history valid', async (context) => {
    if (harness === null || employeeA === null || admin === null) {
      context.skip('Firebase emulators are not available');
      return;
    }
    const beforeIds = await listOrderIds(admin);
    const personal = await applicationFor(employeeA).manager.listMyOrders();
    const managerHistory = await applicationFor(admin).manager.listOrders();
    const afterIds = await listOrderIds(admin);

    assert.equal(personal.ok, true);
    assert.equal(managerHistory.ok, true);
    assert.deepEqual(managerHistory.ok ? managerHistory.value.map((order) => order.id).sort() : [], [ORDER_A_ID, ORDER_B_ID]);
    assert.deepEqual(afterIds.sort(), beforeIds.sort(), 'personal and manager history reads must not mutate orders');
  });

  it('uses the established Firestore Rules fingerprint unchanged', () => {
    const root = join(__dirname, '..', '..', '..');
    const expected = '1FA3C6076BBA8DA4F0E10138B9E61E62257943C3C689B01964F4EAB402CDC63B';
    const labRules = join(root, 'emulator-lab', 'firestore.rules');
    const androidRules = process.env['DRUG_MANAGER_ANDROID_RULES_PATH']
      ?? join('E:', 'programs and applications', 'mobile', 'drug', 'firestore.rules');
    const hash = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();

    assert.equal(existsSync(labRules), true);
    assert.equal(existsSync(androidRules), true);
    assert.equal(hash(labRules), expected);
    assert.equal(hash(androidRules), expected);
  });
});
