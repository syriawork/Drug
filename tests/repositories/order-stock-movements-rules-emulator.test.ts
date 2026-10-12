/**
 * Stage 19 - order-scoped movement detail against the REAL Firestore emulator.
 *
 * The production manager application and Firestore repository are used end to
 * end. Existing Rules decide access; this suite proves the query scope and that
 * the new read leaves both order and movement documents untouched.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  readEmulatorEnvironment,
  type ActorSession,
} from '../helpers/firestore-emulator-harness';

const projectRoot = join(__dirname, '..', '..', '..');
const labRulesPath = join(projectRoot, 'emulator-lab', 'firestore.rules');
const authoritativeRulesPath = process.env['DRUG_MANAGER_ANDROID_RULES_PATH']
  ?? join('E:', 'programs and applications', 'mobile', 'drug', 'firestore.rules');

const ADMIN_EMAIL = 'admin.stage19@drug-manager.demo';
const EMPLOYEE_EMAIL = 'employee.stage19@drug-manager.demo';
const SELECTED_ORDER_ID = 's19-order-selected';
const OTHER_ORDER_ID = 's19-order-other';
const SELECTED_LOG_ID = 's19-log-selected';
const OTHER_LOG_ID = 's19-log-other';
const EXPECTED_RULES_SHA256 = '1FA3C6076BBA8DA4F0E10138B9E61E62257943C3C689B01964F4EAB402CDC63B';

let harness: EmulatorHarness;
let admin: ActorSession;
let employee: ActorSession;
let adminUid = '';
let employeeUid = '';
const suiteDocuments: string[] = [];

function applicationFor(session: ActorSession, role: 'admin' | 'employee'): ManagerApplication {
  const context: RepositoryContext = { client: session.client, onWarning: () => undefined };
  return createManagerApplication({
    session: {
      getSafeState: () => ({
        authenticated: true,
        uid: session.uid,
        email: session.email,
        emailVerified: true,
        expirationTimeIso: '2026-06-04T09:00:00.000Z',
        displayName: role === 'admin' ? 'المدير' : 'أحمد',
        role,
      }),
      signInWithEmailAndPassword: async () => {
        throw new Error('the emulator suite never signs in through the application');
      },
      signOut: () => undefined,
    },
    usersRepository: new FirestoreUsersRepository(context),
    medicinesRepository: new FirestoreMedicinesRepository(context),
    settingsRepository: new FirestoreSettingsRepository(context),
    orderRequestsRepository: new FirestoreOrderRequestsRepository(context),
    ordersRepository: new FirestoreOrdersRepository(context),
    stockLogsRepository: new FirestoreStockLogsRepository(context),
    inboundStockTransactionFactory: createInboundStockTransactionFactory(session.client),
    orderProcessing: new FirestoreOrderProcessingService(
      createOrderProcessingTransactionFactory(session.client),
    ),
  });
}

async function rawDocument(path: string): Promise<Record<string, unknown> | null> {
  return harness.readAsEmulatorOwner(path);
}

async function seedOrder(id: string, uid: string, userName: string): Promise<void> {
  await harness.seedDocument(`orders/${id}`, {
    userId: uid,
    userName,
    items: [{ medicineId: 'med-s19', medicineName: 'Panadol', quantity: 2 }],
    status: 'accepted',
    date: new Date('2026-06-03T08:00:00Z'),
    monthYear: '06-2026',
    isExceptionOrder: false,
  });
  suiteDocuments.push(`orders/${id}`);
}

async function seedLog(id: string, orderId: string): Promise<void> {
  await harness.seedDocument(`stock_logs/${id}`, {
    medicineId: 'med-s19',
    medicineName: 'Panadol',
    quantity: 2,
    type: 'outward',
    date: new Date('2026-06-03T08:10:00Z'),
    userName: 'صرف طلب Stage 19',
    uid: adminUid,
    requestId: `req-${orderId}`,
    orderId,
  });
  suiteDocuments.push(`stock_logs/${id}`);
}

before(async () => {
  harness = new EmulatorHarness(readEmulatorEnvironment());
  adminUid = await harness.ensureAuthUser(ADMIN_EMAIL, DEMO_PASSWORD);
  employeeUid = await harness.ensureAuthUser(EMPLOYEE_EMAIL, DEMO_PASSWORD);
  admin = await harness.openSession(ADMIN_EMAIL, DEMO_PASSWORD);
  employee = await harness.openSession(EMPLOYEE_EMAIL, DEMO_PASSWORD);

  await harness.seedUserProfile({
    uid: adminUid, name: 'المدير', employeeId: 'EMP-000',
    role: 'admin', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: employeeUid, name: 'أحمد', employeeId: 'EMP-100',
    role: 'employee', status: 'approved', hasException: false,
  });
  suiteDocuments.push(`users/${adminUid}`, `users/${employeeUid}`);
  await seedOrder(SELECTED_ORDER_ID, employeeUid, 'أحمد');
  await seedOrder(OTHER_ORDER_ID, employeeUid, 'أحمد');
  await seedLog(SELECTED_LOG_ID, SELECTED_ORDER_ID);
  await seedLog(OTHER_LOG_ID, OTHER_ORDER_ID);
});

after(async () => {
  await harness.flush(suiteDocuments);
});

describe('Stage 19: selected order scope and existing Rules authorization', () => {
  it('allows an admin to read movements for the order selected from manager history', async () => {
    const application = applicationFor(admin, 'admin');
    const history = await application.manager.listOrders();
    assert.equal(history.ok, true);
    const selected = history.ok ? history.value.find((order) => order.id === SELECTED_ORDER_ID) : undefined;
    assert.ok(selected, 'the selected finalized order is present in manager history');

    const result = await application.manager.listStockMovementsByOrder({ orderId: selected.id });
    assert.equal(result.ok, true, 'existing isAdmin() Rules authorize the manager read');
    assert.deepEqual(result.ok ? result.value.map((row) => row.id) : [], [SELECTED_LOG_ID]);
    assert.equal(result.ok ? result.value[0]?.orderId : null, SELECTED_ORDER_ID);
  });

  it('denies an employee through the unchanged stock_logs Rules', async () => {
    const result = await applicationFor(employee, 'employee').manager
      .listStockMovementsByOrder({ orderId: SELECTED_ORDER_ID });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'AUTHORIZATION_DENIED');
  });

  it('leaves order and movement documents unchanged after both authorized and denied reads', async () => {
    const paths = [
      `orders/${SELECTED_ORDER_ID}`,
      `stock_logs/${SELECTED_LOG_ID}`,
      `stock_logs/${OTHER_LOG_ID}`,
    ];
    const beforeBytes = await Promise.all(paths.map(rawDocument));

    await applicationFor(admin, 'admin').manager.listStockMovementsByOrder({ orderId: SELECTED_ORDER_ID });
    await applicationFor(employee, 'employee').manager.listStockMovementsByOrder({ orderId: SELECTED_ORDER_ID });

    const afterBytes = await Promise.all(paths.map(rawDocument));
    assert.deepEqual(afterBytes, beforeBytes);
  });

  it('runs against the pinned, unchanged Rules copies', () => {
    const desktopHash = createHash('sha256').update(readFileSync(labRulesPath)).digest('hex').toUpperCase();
    const mobileHash = createHash('sha256').update(readFileSync(authoritativeRulesPath)).digest('hex').toUpperCase();
    assert.equal(desktopHash, EXPECTED_RULES_SHA256);
    assert.equal(mobileHash, EXPECTED_RULES_SHA256);
    assert.equal(desktopHash, mobileHash);
  });
});
