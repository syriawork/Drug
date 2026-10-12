import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '../../electron/domain/errors';
import { FirestoreTimestamp } from '../../electron/services/firestore-codec';
import {
  FirestoreMedicinesRepository,
  FirestoreSettingsRepository,
} from '../../electron/repositories/firestore/medicines-repository';
import {
  FirestoreOrderRequestsRepository,
  FirestoreOrdersRepository,
  FirestoreStockLogsRepository,
} from '../../electron/repositories/firestore/order-repository';
import { FirestoreUsersRepository } from '../../electron/repositories/firestore/users-repository';
import {
  DEMO_PASSWORD,
  EmulatorHarness,
  type ActorSession,
  probeEmulators,
  readEmulatorEnvironment,
} from '../helpers/firestore-emulator-harness';

/**
 * Stage 5B (PART 13-L, N) - the REPOSITORIES against the REAL Firestore Emulator.
 *
 * The unit suite proves the wire shape; THIS suite proves that the wire shape
 * works against a Firestore that executes the Android security rules, and that
 * going through a repository does not weaken them: an employee calling an
 * admin-only repository method still gets 403, surfaced as a typed DomainError.
 *
 * Nothing here is mocked, and no production project is involved.
 */

const suiteDocuments: readonly string[] = [
  'medicines/repo-med-1',
  'orders/repo-order-1',
  'orders/repo-order-2',
  'stock_logs/repo-log-1',
  'order_requests/repo-req-pending',
  'order_requests/repo-req-processed',
  'order_requests/repo-req-orphan',
  'settings/app',
];
describe('Stage 5B repositories on the REAL Firestore Emulator (isolated suite)', async () => {
  const environment = readEmulatorEnvironment();
  const availability = await probeEmulators(environment);

  if (!availability.available) {
    if (environment.requiresEmulator) {
      it('fails loudly because a live local emulator is required', () => {
        assert.fail(`the local Firebase emulators are required but unreachable: ${availability.detail}`);
      });
    } else {
      it('is skipped: no local emulator detected on this machine', (context) => {
        context.diagnostic(`emulators unreachable: ${availability.detail}`);
      });
    }
    return;
  }

  const harness = new EmulatorHarness(environment);

  const adminUid = await harness.ensureAuthUser('admin.stage5b@drug-manager.demo', DEMO_PASSWORD);
  const employeeUid = await harness.ensureAuthUser('employee.stage5b@drug-manager.demo', DEMO_PASSWORD);
  const pendingUid = await harness.ensureAuthUser('employee.pending.stage5b@drug-manager.demo', DEMO_PASSWORD);

  const fixtureUsers: readonly string[] = [`users/${employeeUid}`, `users/${pendingUid}`];
  await harness.flush([...suiteDocuments, ...fixtureUsers]);

  await harness.seedUserProfile({
    uid: adminUid, name: 'Ù…Ø¯ÙŠØ±', employeeId: 'EMP-000', role: 'admin', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: employeeUid, name: 'ØµÙŠØ¯Ù„Ø§Ù†ÙŠ', employeeId: 'EMP-200', role: 'employee', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: pendingUid, name: 'Ù‚ÙŠØ¯ Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹Ø©', employeeId: 'EMP-201', role: 'employee', status: 'pending', hasException: false,
  });

  await harness.seedDocument('medicines/repo-med-1', {
    name: 'Ø¨Ø§Ø±Ø§Ø³ÙŠØªØ§Ù…ÙˆÙ„', maxQuantity: 5, stock: 10, totalInward: 20, totalOutward: 5,
  });
  await harness.seedDocument('orders/repo-order-1', {
    userId: employeeUid, userName: 'ØµÙŠØ¯Ù„Ø§Ù†ÙŠ',
    items: [{ medicineId: 'repo-med-1', medicineName: 'Ø¨Ø§Ø±Ø§Ø³ÙŠØªØ§Ù…ÙˆÙ„', quantity: 1 }],
    date: new Date('2026-06-03T08:00:00Z'), monthYear: '06-2026', status: 'accepted',
    isExceptionOrder: false, requestId: 'repo-req-processed',
  });
  await harness.seedDocument('orders/repo-order-2', {
    userId: pendingUid, userName: 'Ù‚ÙŠØ¯ Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹Ø©', items: [],
    date: new Date('2026-06-02T08:00:00Z'), monthYear: '06-2026', status: 'pending',
  });
  await harness.seedDocument('stock_logs/repo-log-1', {
    uid: employeeUid, medicineId: 'repo-med-1', medicineName: 'Ø¨Ø§Ø±Ø§Ø³ÙŠØªØ§Ù…ÙˆÙ„', quantity: 1,
    type: 'outward', date: new Date('2026-06-03T08:00:00Z'),
    userName: 'ØµÙŠØ¯Ù„Ø§Ù†ÙŠ', requestId: 'repo-req-processed', orderId: 'repo-order-1',
  });
  await harness.seedDocument('order_requests/repo-req-pending', {
    uid: employeeUid, items: [{ medicineId: 'repo-med-1', medicineName: 'Ø¨Ø§Ø±Ø§Ø³ÙŠØªØ§Ù…ÙˆÙ„', quantity: 1 }],
    status: 'pending', requestDate: new Date('2026-06-03T08:00:00Z'),
  });
  await harness.seedDocument('order_requests/repo-req-processed', {
    uid: employeeUid, items: [{ medicineId: 'repo-med-1', medicineName: 'Ø¨Ø§Ø±Ø§Ø³ÙŠØªØ§Ù…ÙˆÙ„', quantity: 1 }],
    status: 'processed', requestDate: new Date('2026-06-03T08:00:00Z'),
    orderId: 'repo-order-1', processedBy: adminUid, processedAt: new Date('2026-06-03T08:01:00Z'),
  });
  await harness.seedDocument('settings/app', {
    minDaysBetweenOrders: 20, maxDailyOrders: 50, allowFridayOrders: false,
    startTime: '07:00', endTime: '09:00', assistantId: 'EMP-001',
  });

  const admin: ActorSession = await harness.openSession('admin.stage5b@drug-manager.demo', DEMO_PASSWORD);
  const employee: ActorSession = await harness.openSession('employee.stage5b@drug-manager.demo', DEMO_PASSWORD);
  const pending: ActorSession = await harness.openSession('employee.pending.stage5b@drug-manager.demo', DEMO_PASSWORD);

  const adminRepos = {
    users: new FirestoreUsersRepository({ client: admin.client }),
    medicines: new FirestoreMedicinesRepository({ client: admin.client }),
    settings: new FirestoreSettingsRepository({ client: admin.client }),
    requests: new FirestoreOrderRequestsRepository({ client: admin.client }),
    orders: new FirestoreOrdersRepository({ client: admin.client }),
    logs: new FirestoreStockLogsRepository({ client: admin.client }),
  };
  const employeeRepos = {
    users: new FirestoreUsersRepository({ client: employee.client }),
    medicines: new FirestoreMedicinesRepository({ client: employee.client }),
    settings: new FirestoreSettingsRepository({ client: employee.client }),
    requests: new FirestoreOrderRequestsRepository({ client: employee.client }),
    orders: new FirestoreOrdersRepository({ client: employee.client }),
    logs: new FirestoreStockLogsRepository({ client: employee.client }),
  };
  const pendingRepos = {
    requests: new FirestoreOrderRequestsRepository({ client: pending.client }),
  };

  // ---------------------------------------------------------------- reads (L)

  describe('reads through the repository return real domain models', () => {
    it('reads a user profile with its order summary', async (context) => {
      const user = await adminRepos.users.getUser(employeeUid);
      assert.ok(user, 'the profile must be readable by an admin');
      assert.equal(user?.uid, employeeUid);
      assert.equal(user?.role, 'employee');
      assert.equal(user?.status, 'approved');
      context.diagnostic(`mapped user: ${user?.name} / ${user?.role} / ${user?.status}`);
    });

    it('reads a medicine with all five fields', async () => {
      const medicine = await adminRepos.medicines.getMedicine('repo-med-1');
      assert.equal(medicine?.name, 'Ø¨Ø§Ø±Ø§Ø³ÙŠØªØ§Ù…ÙˆÙ„');
      assert.equal(medicine?.maxQuantity, 5);
      assert.equal(medicine?.stock, 10);
      assert.equal(medicine?.totalInward, 20);
      assert.equal(medicine?.totalOutward, 5);
    });

    it('reads settings/app with the stored values', async () => {
      const settings = await adminRepos.settings.getAppSettings();
      assert.equal(settings?.minDaysBetweenOrders, 20);
      assert.equal(settings?.startTime, '07:00');
      assert.equal(settings?.endTime, '09:00');
    });

    it('reads an order request and preserves requestDate as a timestamp', async () => {
      const request = await adminRepos.requests.getOrderRequest('repo-req-pending');
      assert.equal(request?.uid, employeeUid);
      assert.equal(request?.status, 'pending');
      assert.ok(request?.requestDate instanceof FirestoreTimestamp);
      assert.notEqual(typeof request?.requestDate, 'string');
    });

    it('reads a processed request including its processing fields', async () => {
      const request = await adminRepos.requests.getOrderRequest('repo-req-processed');
      assert.equal(request?.status, 'processed');
      assert.equal(request?.orderId, 'repo-order-1');
      assert.equal(request?.processedBy, adminUid);
      assert.ok(request?.processedAt instanceof FirestoreTimestamp);
    });

    it('lists pending order requests through the EQUAL filter', async (context) => {
      const pendingRequests = await adminRepos.requests.listPendingOrderRequests(50);
      assert.deepEqual(pendingRequests.map((request) => request.id), ['repo-req-pending']);
      context.diagnostic('the EQUAL filter returned exactly the seeded pending request');
    });

    it('a document without `status` is NOT matched by the EQUAL filter', async (context) => {
      // Verified against the real emulator: a Firestore `EQUAL` filter does NOT
      // match documents that omit the field. That means the pending queue cannot
      // pick up a malformed request, and this repository needs no defensive
      // skip - the query itself excludes the shape.
      await harness.seedDocument('order_requests/repo-req-orphan', {
        uid: employeeUid, requestDate: new Date('2026-06-03T08:00:00Z'),
      });

      const pendingRequests = await adminRepos.requests.listPendingOrderRequests(50);
      assert.equal(
        pendingRequests.some((request) => request.id === 'repo-req-orphan'),
        false,
        'a document with no status must not appear in the pending queue',
      );
      context.diagnostic('an orphan document without status is excluded by the query itself');
    });

    it("lists a user's orders through the ownership filter", async () => {
      const orders = await adminRepos.orders.listOrdersByUser(employeeUid, 50);
      assert.equal(orders.length, 1);
      assert.equal(orders[0]?.id, 'repo-order-1');
      assert.equal(orders[0]?.status, 'accepted');
    });

    it('maps a stock log, exposing userName as label', async () => {
      const logs = await adminRepos.logs.listStockLogs(50);
      const found = logs.find((log) => log.id === 'repo-log-1');
      assert.ok(found, 'the seeded log must be listed');
      assert.equal(found?.type, 'outward');
      assert.equal(found?.label, 'ØµÙŠØ¯Ù„Ø§Ù†ÙŠ');
      assert.equal(found?.actorUid, employeeUid);
    });

    it('returns null for a document that does not exist', async () => {
      assert.equal(await adminRepos.medicines.getMedicine('repo-missing'), null);
      assert.equal(await adminRepos.requests.getOrderRequest('repo-missing'), null);
    });
  });

  // ------------------------------------------------------- rules through repos (N)

  describe('the repository does not weaken firestore.rules', () => {
    it('an employee CAN read the shared catalogue and settings', async (context) => {
      const medicine = await employeeRepos.medicines.getMedicine('repo-med-1');
      const settings = await employeeRepos.settings.getAppSettings();
      assert.equal(medicine?.stock, 10);
      assert.equal(settings?.minDaysBetweenOrders, 20);
      context.diagnostic('both reads are allowed for any authenticated user, as the rules state');
    });

    it('an employee is DENIED another user profile, as a typed DomainError', async () => {
      await assert.rejects(
        () => employeeRepos.users.getUser(adminUid),
        (error: unknown) => {
          assert.ok(error instanceof DomainError, 'the repository must translate, not leak');
          assert.equal(error.kind, 'NOT_AUTHORIZED');
          return true;
        },
      );
    });

    it('an employee is DENIED the admin-only stock_logs collection', async () => {
      await assert.rejects(
        () => employeeRepos.logs.listStockLogs(50),
        (error: unknown) => error instanceof DomainError && error.kind === 'NOT_AUTHORIZED',
      );
    });

    it('an employee is DENIED approveUser (admin-only write)', async () => {
      await assert.rejects(
        () => employeeRepos.users.approveUser(pendingUid),
        (error: unknown) => error instanceof DomainError && error.kind === 'NOT_AUTHORIZED',
      );
    });

    it('the denial did NOT change the target document', async () => {
      const target = await adminRepos.users.getUser(pendingUid);
      assert.equal(target?.status, 'pending', 'a denied write must leave the data untouched');
    });
  });

  // ------------------------------------------------- writes through the repo (M)

  describe('writes through the repository', () => {
    it('an approved employee CAN submit, and Firestore stamps requestDate', async (context) => {
      const requestId = await employeeRepos.requests.submitPendingRequest({
        uid: employeeUid,
        items: [{ medicineId: 'repo-med-1', medicineName: 'Ø¨Ø§Ø±Ø§Ø³ÙŠØªØ§Ù…ÙˆÙ„', quantity: 1 }],
      });

      assert.match(requestId, /^[A-Za-z0-9]{20}$/);
      const stored = await adminRepos.requests.getOrderRequest(requestId);
      assert.equal(stored?.status, 'pending');
      assert.equal(stored?.uid, employeeUid);
      assert.ok(stored?.requestDate instanceof FirestoreTimestamp);
      assert.notEqual(stored?.requestDate.isoValue, 'REQUEST_TIME');
      context.diagnostic(`server-stamped requestDate: ${stored?.requestDate.isoValue}`);

      await harness.flush([`order_requests/${requestId}`]);
    });

    it('a NON-approved employee is DENIED submission, proving isApproved() still governs', async () => {
      await assert.rejects(
        () => pendingRepos.requests.submitPendingRequest({
          uid: pendingUid,
          items: [{ medicineId: 'repo-med-1', medicineName: 'x', quantity: 1 }],
        }),
        (error: unknown) => error instanceof DomainError && error.kind === 'NOT_AUTHORIZED',
      );
    });

    it('an admin CAN approve, and the lastOrder* summary is NOT wiped', async (context) => {
      // Give the target a summary first, so an unmasked update would destroy it.
      await harness.seedDocument(`users/${pendingUid}`, {
        uid: pendingUid, role: 'employee', name: 'Ù‚ÙŠØ¯ Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹Ø©', employeeId: 'EMP-201', status: 'pending',
        hasException: false, lastOrderId: 'seeded-order', lastOrderMonthYear: 'Ù Ù¥-Ù¢Ù Ù¢Ù¦',
        lastOrderStatus: 'rejected', lastOrderIsException: true,
        lastOrderDate: new Date('2026-05-04T08:00:00Z'),
      });

      await adminRepos.users.approveUser(pendingUid);

      const updated = await adminRepos.users.getUser(pendingUid);
      assert.equal(updated?.status, 'approved');
      // This is the Stage 5A C5 guarantee, observed through a repository write.
      assert.equal(updated?.lastOrderId, 'seeded-order', 'the summary must survive a masked status update');
      assert.equal(updated?.lastOrderMonthYear, 'Ù Ù¥-Ù¢Ù Ù¢Ù¦', 'including the legacy Arabic-Indic value');
      assert.equal(updated?.lastOrderStatus, 'rejected');
      assert.equal(updated?.lastOrderIsException, true);
      assert.ok(updated?.lastOrderDate instanceof FirestoreTimestamp);
      context.diagnostic('a masked approve preserved every lastOrder* field');
    });

    it('an admin CAN save settings/app, and the read reflects it', async () => {
      await adminRepos.settings.saveAppSettings({
        minDaysBetweenOrders: 25, maxDailyOrders: 50, allowFridayOrders: true,
        startTime: '06:30', endTime: '08:30', assistantId: 'EMP-002',
      });

      const reloaded = await adminRepos.settings.getAppSettings();
      assert.equal(reloaded?.minDaysBetweenOrders, 25);
      assert.equal(reloaded?.allowFridayOrders, true);
      assert.equal(reloaded?.startTime, '06:30');
    });
  });

  describe('cleanup', () => {
    it('removes every document the suite created', async () => {
      // NOTE: this suite and tests/firestore-rules-emulator.test.ts share ONE
      // Firestore Emulator, and each flushes only its own documents. Running both
      // CONCURRENTLY in the same `node --test` process would let one suite delete
      // the other's fixtures mid-run, so they are executed separately. The
      // package script `test:emulator:repositories` runs this file alone.
      await harness.flush([...suiteDocuments, ...fixtureUsers]);
    });
  });
});