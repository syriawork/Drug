/**
 * Stage 15 inbound stock receipts against the real Firestore emulator.
 *
 * This suite uses the production application, Firestore REST transaction, mapper,
 * and the unchanged Android Rules. Fixture-only operations use the emulator's
 * local owner bypass; every receipt and authorization assertion uses real ID
 * tokens and the production transaction path.
 */
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
  createInboundStockTransactionFactory,
  createOrderProcessingTransactionFactory,
  type FirestoreInboundStockTransactionClient,
} from '../../electron/repositories';
import { FirestoreOrderProcessingService } from '../../electron/services/order-processing.service';
import type { FirestoreDocument, FirestoreWriteRequest } from '../../electron/services/firestore-rest';
import {
  DEMO_PASSWORD,
  EmulatorHarness,
  readEmulatorEnvironment,
  type ActorSession,
  type SeedProfile,
} from '../helpers/firestore-emulator-harness';

const ADMIN_EMAIL = 'admin.stage15@drug-manager.demo';
const ASSISTANT_EMAIL = 'assistant.stage15@drug-manager.demo';
const EMPLOYEE_EMAIL = 'employee.stage15@drug-manager.demo';
const ADMIN_PROFILE: SeedProfile = {
  uid: '',
  name: 'مدير اختبار الوارد',
  employeeId: 'S15-ADMIN',
  role: 'admin',
  status: 'approved',
  hasException: false,
};
const ASSISTANT_PROFILE: SeedProfile = {
  uid: '',
  name: 'مساعد اختبار الوارد',
  employeeId: 'S15-ASST',
  role: 'assistant',
  status: 'approved',
  hasException: false,
};
const EMPLOYEE_PROFILE: SeedProfile = {
  uid: '',
  name: 'موظف اختبار الوارد',
  employeeId: 'S15-EMP',
  role: 'employee',
  status: 'approved',
  hasException: false,
};

let harness: EmulatorHarness;
let admin: ActorSession;
let assistant: ActorSession;
let employee: ActorSession;
let adminProfile: SeedProfile;
let assistantProfile: SeedProfile;
let employeeProfile: SeedProfile;
const suiteDocuments: string[] = [];

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
}

function applicationFor(
  actor: ActorSession,
  transactionClient: FirestoreInboundStockTransactionClient = actor.client,
): ManagerApplication {
  const context = { client: actor.client, onWarning: () => undefined };
  return createManagerApplication({
    session: {
      getSafeState: () => ({
        authenticated: true,
        uid: actor.uid,
        email: actor.email,
        emailVerified: true,
        expirationTimeIso: '2026-10-07T00:00:00.000Z',
      }),
      signInWithEmailAndPassword: async () => ({
        authenticated: true,
        uid: actor.uid,
        email: actor.email,
        emailVerified: true,
        expirationTimeIso: '2026-10-07T00:00:00.000Z',
      }),
      signOut: () => undefined,
    },
    usersRepository: new FirestoreUsersRepository(context),
    medicinesRepository: new FirestoreMedicinesRepository(context),
    settingsRepository: new FirestoreSettingsRepository(context),
    orderRequestsRepository: new FirestoreOrderRequestsRepository(context),
    ordersRepository: new FirestoreOrdersRepository(context),
    stockLogsRepository: new FirestoreStockLogsRepository(context),
    inboundStockTransactionFactory: createInboundStockTransactionFactory(transactionClient),
    orderProcessing: new FirestoreOrderProcessingService(
      createOrderProcessingTransactionFactory(actor.client),
    ),
  });
}

async function prepareApplication(actor: ActorSession): Promise<ManagerApplication> {
  const application = applicationFor(actor);
  const signedIn = await application.auth.signIn({ email: actor.email, password: DEMO_PASSWORD });
  assert.equal(signedIn.success, true, 'the app must establish its trusted profile identity');
  return application;
}

async function readStored(relativePath: string): Promise<Record<string, unknown> | null> {
  return harness.readAsEmulatorOwner(relativePath);
}

async function seedMedicine(
  medicineId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await harness.seedDocument(`medicines/${medicineId}`, {
    name: `Inbound test ${medicineId}`,
    maxQuantity: 7,
    stock: 12,
    totalInward: 30,
    totalOutward: 4,
    unit: 'box',
    unrelatedField: 'preserved',
    ...overrides,
  });
  suiteDocuments.push(`medicines/${medicineId}`);
}

async function listMovementRows(
  application: ManagerApplication,
  medicineId: string,
) {
  const result = await application.manager.listStockMovements();
  assert.equal(result.ok, true, 'admin must be able to inspect the audit trail');
  return result.ok ? result.value.filter((row) => row.medicineId === medicineId) : [];
}

before(async () => {
  harness = new EmulatorHarness(readEmulatorEnvironment());
  const adminUid = await harness.ensureAuthUser(ADMIN_EMAIL, DEMO_PASSWORD);
  const assistantUid = await harness.ensureAuthUser(ASSISTANT_EMAIL, DEMO_PASSWORD);
  const employeeUid = await harness.ensureAuthUser(EMPLOYEE_EMAIL, DEMO_PASSWORD);
  admin = await harness.openSession(ADMIN_EMAIL, DEMO_PASSWORD);
  assistant = await harness.openSession(ASSISTANT_EMAIL, DEMO_PASSWORD);
  employee = await harness.openSession(EMPLOYEE_EMAIL, DEMO_PASSWORD);
  adminProfile = { ...ADMIN_PROFILE, uid: adminUid };
  assistantProfile = { ...ASSISTANT_PROFILE, uid: assistantUid };
  employeeProfile = { ...EMPLOYEE_PROFILE, uid: employeeUid };
  await harness.seedUserProfile(adminProfile);
  await harness.seedUserProfile(assistantProfile);
  await harness.seedUserProfile(employeeProfile);
  suiteDocuments.push(`users/${adminUid}`, `users/${assistantUid}`, `users/${employeeUid}`);
});

after(async () => {
  await harness.flush(suiteDocuments);
});

describe('Stage 15 inbound stock emulator: production transaction and current Rules', () => {
  it('updates the two masked totals atomically and creates one correctly attributed log', async () => {
    const medicineId = 's15-admin-med';
    await seedMedicine(medicineId);
    const application = await prepareApplication(admin);

    const receipt = await application.inboundStock.receiveInboundStock({ medicineId, quantity: 5 });

    assert.equal(receipt.ok, true, 'the admin role is authorized by isAdmin()');
    assert.equal(receipt.ok ? receipt.value.newStock : null, 17);
    assert.equal(receipt.ok ? receipt.value.newTotalInward : null, 35);

    const medicine = await readStored(`medicines/${medicineId}`);
    assert.ok(medicine);
    assert.equal(medicine['stock'], 17);
    assert.equal(medicine['totalInward'], 35);
    assert.equal(medicine['totalOutward'], 4);
    assert.equal(medicine['name'], `Inbound test ${medicineId}`);
    assert.equal(medicine['maxQuantity'], 7);
    assert.equal(medicine['unit'], 'box');
    assert.equal(medicine['unrelatedField'], 'preserved');

    const rows = await listMovementRows(application, medicineId);
    assert.equal(rows.length, 1, 'exactly one inbound log is written');
    const row = rows[0]!;
    assert.equal(row.type, 'inward');
    assert.equal(row.quantity, 5);
    assert.equal(row.medicineId, medicineId);
    assert.equal(row.actorUid, admin.uid);
    assert.equal(row.label, adminProfile.name);
    suiteDocuments.push(`stock_logs/${row.id}`);

    const storedLog = await admin.client.getDocument(`stock_logs/${row.id}`);
    assert.equal(storedLog.data['medicineName'], `Inbound test ${medicineId}`);
    assert.equal(storedLog.data['uid'], admin.uid);
    assert.equal(storedLog.data['userName'], adminProfile.name);
    assert.equal('requestId' in storedLog.data, false);
    assert.equal('orderId' in storedLog.data, false);
  });

  it('authorizes assistant when the current Rules define assistant as an administrator', async () => {
    const medicineId = 's15-assistant-med';
    await seedMedicine(medicineId);
    const application = await prepareApplication(assistant);

    const receipt = await application.inboundStock.receiveInboundStock({ medicineId, quantity: 3 });

    assert.equal(receipt.ok, true, 'current isAdmin() explicitly includes assistant');
    const medicine = await readStored(`medicines/${medicineId}`);
    assert.equal(medicine?.['stock'], 15);
    assert.equal(medicine?.['totalInward'], 33);

    const rows = await listMovementRows(applicationFor(admin), medicineId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.actorUid, assistant.uid);
    assert.equal(rows[0]?.label, assistantProfile.name);
    suiteDocuments.push(`stock_logs/${rows[0]!.id}`);
  });

  it('denies employee writes and proves neither side of the transaction changed', async () => {
    const medicineId = 's15-employee-med';
    await seedMedicine(medicineId);
    const beforeMedicine = await readStored(`medicines/${medicineId}`);
    assert.ok(beforeMedicine);
    const adminApplication = await prepareApplication(admin);
    const employeeApplication = await prepareApplication(employee);
    const beforeRows = await listMovementRows(adminApplication, medicineId);

    const receipt = await employeeApplication.inboundStock.receiveInboundStock({ medicineId, quantity: 6 });

    assert.equal(receipt.ok, false);
    assert.equal(receipt.ok ? null : receipt.error.code, 'AUTHORIZATION_DENIED');
    assert.deepEqual(await readStored(`medicines/${medicineId}`), beforeMedicine);
    assert.deepEqual(await listMovementRows(adminApplication, medicineId), beforeRows);
  });

  it('leaves both documents unchanged when Firestore rejects the real commit', async () => {
    const medicineId = 's15-commit-failure-med';
    await seedMedicine(medicineId);
    const beforeMedicine = await readStored(`medicines/${medicineId}`);
    assert.ok(beforeMedicine);
    const adminApplication = await prepareApplication(admin);
    const beforeRows = await listMovementRows(adminApplication, medicineId);
    const realClient = admin.client;
    const rejectAtCommit: FirestoreInboundStockTransactionClient = {
      beginTransaction: () => realClient.beginTransaction(),
      batchGetDocuments: (
        paths: readonly string[],
        transaction?: string,
      ): Promise<readonly (FirestoreDocument | null)[]> =>
        realClient.batchGetDocuments(paths, transaction),
      commitWrites: async (
        writes: readonly FirestoreWriteRequest[],
        transaction?: string,
      ): Promise<unknown> => {
        // Change the trusted role after the transactional read but before the
        // real Firestore commit. Its unchanged Rules must reject this commit.
        await harness.seedUserProfile({ ...adminProfile, role: 'employee' });
        try {
          return await realClient.commitWrites(writes, transaction);
        } finally {
          await harness.seedUserProfile(adminProfile);
        }
      },
      rollback: (transaction: string) => realClient.rollback(transaction),
    };
    const failingApplication = applicationFor(admin, rejectAtCommit);
    const signedIn = await failingApplication.auth.signIn({
      email: admin.email,
      password: DEMO_PASSWORD,
    });
    assert.equal(signedIn.success, true);

    try {
      const receipt = await failingApplication.inboundStock.receiveInboundStock({
        medicineId,
        quantity: 8,
      });

      assert.equal(receipt.ok, false);
      assert.equal(receipt.ok ? null : receipt.error.code, 'AUTHORIZATION_DENIED');
      assert.deepEqual(await readStored(`medicines/${medicineId}`), beforeMedicine);
      assert.deepEqual(await listMovementRows(adminApplication, medicineId), beforeRows);
    } finally {
      await harness.seedUserProfile(adminProfile);
    }
  });

  it('uses the established Firestore Rules fingerprint unchanged', () => {
    const root = join(__dirname, '..', '..', '..');
    const expected = '1FA3C6076BBA8DA4F0E10138B9E61E62257943C3C689B01964F4EAB402CDC63B';
    const labRules = join(root, 'emulator-lab', 'firestore.rules');
    const androidRules = process.env['DRUG_MANAGER_ANDROID_RULES_PATH']
      ?? join('E:', 'programs and applications', 'mobile', 'drug', 'firestore.rules');

    assert.equal(existsSync(labRules), true);
    assert.equal(sha256Of(labRules), expected);
    if (existsSync(androidRules)) {
      assert.equal(sha256Of(androidRules), expected);
    }
  });
});
