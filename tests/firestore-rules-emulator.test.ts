import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { FirebaseAuthService } from '../electron/services/firebase-auth';
import {
  FirestoreTimestamp,
  SERVER_TIMESTAMP,
} from '../electron/services/firestore-codec';
import {
  type FirestoreDocument,
  FirestoreRestClient,
  FirestoreRestError,
} from '../electron/services/firestore-rest';
import {
  DEMO_PASSWORD,
  EmulatorHarness,
  type ActorSession,
  UNAUTHENTICATED_PROBE_PATH,
  probeEmulators,
  readEmulatorEnvironment,
  readServerError,
} from './helpers/firestore-emulator-harness';

/**
 * Stage 3 core security suite - REAL Firebase emulators only.
 *
 * Every rule-relevant request in this file is a real HTTP request to the real
 * Firestore Emulator, carrying a real Firebase ID token issued by the real Auth
 * Emulator and obtained through the application's own Stage 2 auth layer.
 * Nothing here mocks Firestore, simulates rule evaluation, or uses a fake HTTP
 * server; authorization decisions are produced by the emulator executing
 * emulator-lab/firestore.rules (a byte-identical copy of the Android project's
 * authoritative rules).
 */

const projectRoot = join(__dirname, '..', '..');
const labFirebaseConfigPath = join(projectRoot, 'emulator-lab', 'firebase.json');
const labRulesPath = join(projectRoot, 'emulator-lab', 'firestore.rules');

/** Authoritative rules of the Android project (read-only, never modified). */
const authoritativeRulesPath = process.env['DRUG_MANAGER_ANDROID_RULES_PATH']
  ?? join('E:', 'programs and applications', 'mobile', 'drug', 'firestore.rules');

/** Every document the suite writes, flushed before and after the run. */
const suiteDocuments: readonly string[] = [
  'medicines/med-1',
  'medicines/med-admin-created',
  'medicines/med-admin-tx',
  'medicines/med-employee-attempt',
  'orders/order-a',
  'orders/order-b',
  'orders/order-employee-attempt',
  'orders/order-admin-created',
  'stock_logs/log-1',
  'stock_logs/log-assistant',
  'stock_logs/forbidden-tx',
  'settings/schedule',
  'order_requests/req-of-a',
  'order_requests/req-of-b',
  'order_requests/req-a-valid',
  'order_requests/req-a-extra-key',
  'order_requests/req-a-wrong-status',
  'order_requests/req-a-wrong-uid',
  'order_requests/req-pending-attempt',
  'order_requests/req-fresh-attempt',
  'order_requests/req-fresh-valid',
  // --- Stage 5A (updateMask / server timestamps) ---
  'medicines/med-mask-partial',
  'medicines/med-mask-multi',
  'medicines/med-mask-nested',
  'medicines/med-mask-tx',
  'medicines/med-ts-literal',
  'medicines/med-ts-literal-string',
  'medicines/med-ts-server',
  'medicines/med-ts-tx',
  'medicines/med-mask-wipe-probe',
  'orders/order-mask-create',
];

interface RuleDecision {
  readonly testCase: string;
  readonly actor: string;
  readonly request: string;
  readonly expected: string;
  readonly observed: string;
  readonly matched: boolean;
}

/** Full evidence table of every rule decision observed during the run. */
const observedDecisions: RuleDecision[] = [];

function recordDecision(decision: Omit<RuleDecision, 'matched'> & { readonly matched: boolean }): void {
  observedDecisions.push(decision);
}

function sha256OfFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function describeError(error: unknown): string {
  if (error instanceof FirestoreRestError) {
    return `FirestoreRestError(${error.reason}, HTTP ${error.httpStatus})`;
  }
  return error instanceof Error ? `Error(${error.message})` : String(error);
}

describe('Stage 3 - Firestore REST on the REAL emulators, authorized by the Android Firestore Rules', async () => {
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
        context.diagnostic('run "npm run emulator:start" then "npm run emulator:test" to execute this suite');
      });
    }
    return;
  }

  const harness = new EmulatorHarness(environment);

  // ---------------------------------------------------------------- fixtures
  // Accounts come from the real Auth Emulator; profiles are written with the
  // emulator-only admin bypass BEFORE any rule assertion is made.
  const adminUid = await harness.ensureAuthUser('admin.stage3@drug-manager.demo', DEMO_PASSWORD);
  const assistantUid = await harness.ensureAuthUser('assistant.stage3@drug-manager.demo', DEMO_PASSWORD);
  const employeeAUid = await harness.ensureAuthUser('employee.a.stage3@drug-manager.demo', DEMO_PASSWORD);
  const employeeBUid = await harness.ensureAuthUser('employee.b.stage3@drug-manager.demo', DEMO_PASSWORD);
  const employeePendingUid = await harness.ensureAuthUser('employee.pending.stage3@drug-manager.demo', DEMO_PASSWORD);
  const employeeRejectedUid = await harness.ensureAuthUser('employee.rejected.stage3@drug-manager.demo', DEMO_PASSWORD);
  const employeeFreshUid = await harness.ensureAuthUser('employee.fresh.stage3@drug-manager.demo', DEMO_PASSWORD);
  const approvalTargetUid = await harness.ensureAuthUser('employee.target.stage3@drug-manager.demo', DEMO_PASSWORD);

  // Deterministic start state for every run.
  await harness.flush([...suiteDocuments, `users/${employeeFreshUid}`]);

  await harness.seedUserProfile({ uid: adminUid, name: 'مدير النظام', employeeId: 'EMP-000', role: 'admin', status: 'approved', hasException: false });
  await harness.seedUserProfile({ uid: assistantUid, name: 'مساعد المدير', employeeId: 'EMP-001', role: 'assistant', status: 'approved', hasException: false });
  await harness.seedUserProfile({ uid: employeeAUid, name: 'صيدلاني أول', employeeId: 'EMP-100', role: 'employee', status: 'approved', hasException: false });
  await harness.seedUserProfile({ uid: employeeBUid, name: 'صيدلاني ثانٍ', employeeId: 'EMP-101', role: 'employee', status: 'approved', hasException: false });
  await harness.seedUserProfile({ uid: employeePendingUid, name: 'موظف بانتظار الاعتماد', employeeId: 'EMP-102', role: 'employee', status: 'pending', hasException: false });
  await harness.seedUserProfile({ uid: employeeRejectedUid, name: 'موظف مرفوض', employeeId: 'EMP-103', role: 'employee', status: 'rejected', hasException: false });
  await harness.seedUserProfile({ uid: approvalTargetUid, name: 'موظف قيد المراجعة', employeeId: 'EMP-104', role: 'employee', status: 'pending', hasException: false });
  // employeeFresh intentionally has no users/{uid} document (create-rule testing).

  await harness.seedDocument('medicines/med-1', { name: 'باراسيتامول', stock: 10, price: 2.5 });
  await harness.seedDocument('settings/schedule', { openTime: '08:00', closeTime: '20:00' });
  await harness.seedDocument('stock_logs/log-1', { medicineId: 'med-1', delta: 5, actorUid: adminUid });
  await harness.seedDocument('orders/order-a', { userId: employeeAUid, items: ['med-1'], total: 2.5, status: 'final' });
  await harness.seedDocument('orders/order-b', { userId: employeeBUid, items: ['med-1'], total: 2.5, status: 'final' });
  await harness.seedDocument('order_requests/req-of-a', { uid: employeeAUid, items: ['med-1'], status: 'pending', requestDate: 1_760_000_000_000 });
  await harness.seedDocument('order_requests/req-of-b', { uid: employeeBUid, items: ['med-1'], status: 'pending', requestDate: 1_760_000_000_000 });

  // ------------------------------------------------- Stage 5A (mask / timestamps)
  // A medicine-like document with the FULL Android field set, so a masked
  // update that accidentally replaced the document would be immediately visible.
  const seedMaskedMedicine = async (relativePath: string): Promise<void> => {
    await harness.seedDocument(relativePath, {
      name: 'باراسيتامول ٥٠٠',
      stock: 100,
      maxQuantity: 5,
      totalInward: 250,
      totalOutward: 150,
    });
  };
  await seedMaskedMedicine('medicines/med-mask-partial');
  await seedMaskedMedicine('medicines/med-mask-multi');
  await seedMaskedMedicine('medicines/med-mask-tx');
  await seedMaskedMedicine('medicines/med-ts-tx');
  // NOTE: 'medicines/med-ts-server' is deliberately NOT seeded: the server
  // timestamp test creates it, so it must not exist beforehand.
  await harness.seedDocument('medicines/med-mask-nested', {
    name: 'أوميغا ٣',
    stock: 40,
    maxQuantity: 2,
    totalInward: 90,
    totalOutward: 50,
    meta: { supplier: 'الشركة المتعددة', batch: 'B-1' },
  });

  // Sessions are created through the application's own Stage 2 auth layer.
  const admin: ActorSession = await harness.openSession('admin.stage3@drug-manager.demo', DEMO_PASSWORD);
  const assistant: ActorSession = await harness.openSession('assistant.stage3@drug-manager.demo', DEMO_PASSWORD);
  const employeeA: ActorSession = await harness.openSession('employee.a.stage3@drug-manager.demo', DEMO_PASSWORD);
  const employeeB: ActorSession = await harness.openSession('employee.b.stage3@drug-manager.demo', DEMO_PASSWORD);
  const employeePending: ActorSession = await harness.openSession('employee.pending.stage3@drug-manager.demo', DEMO_PASSWORD);
  const employeeRejected: ActorSession = await harness.openSession('employee.rejected.stage3@drug-manager.demo', DEMO_PASSWORD);
  const employeeFresh: ActorSession = await harness.openSession('employee.fresh.stage3@drug-manager.demo', DEMO_PASSWORD);

  // ------------------------------------------------------- assertion helpers

  /** Asserts that the emulator (i.e. the Rules) ALLOWED the operation. */
  async function expectAllowed(
    testCase: string,
    actor: string,
    request: string,
    operation: Promise<unknown>,
  ): Promise<unknown> {
    try {
      const result = await operation;
      recordDecision({ testCase, actor, request, expected: 'allowed', observed: 'allowed (HTTP 200)', matched: true });
      return result;
    } catch (error: unknown) {
      recordDecision({ testCase, actor, request, expected: 'allowed', observed: describeError(error), matched: false });
      throw error;
    }
  }

  /** Asserts that Firestore Security Rules DENIED the operation with HTTP 403. */
  async function expectDenied(
    testCase: string,
    actor: string,
    request: string,
    operation: Promise<unknown>,
    expectedStatus = 403,
  ): Promise<FirestoreRestError> {
    const expected = `denied (HTTP ${expectedStatus} PERMISSION_DENIED)`;
    try {
      await operation;
    } catch (error: unknown) {
      const matched = error instanceof FirestoreRestError
        && error.httpStatus === expectedStatus
        && error.reason === 'PERMISSION_DENIED'
        && error.requestSent;
      recordDecision({ testCase, actor, request, expected, observed: describeError(error), matched });

      assert.ok(error instanceof FirestoreRestError, `${testCase}: expected FirestoreRestError, got ${describeError(error)}`);
      assert.equal(error.requestSent, true, `${testCase}: the request must really have reached the emulator`);
      assert.equal(
        error.httpStatus,
        expectedStatus,
        `${testCase}: expected HTTP ${expectedStatus}, received HTTP ${error.httpStatus} (${error.serverMessage ?? 'no server message'})`,
      );
      assert.equal(error.reason, 'PERMISSION_DENIED', `${testCase}: expected PERMISSION_DENIED, got ${error.reason}`);
      return error;
    }

    recordDecision({ testCase, actor, request, expected, observed: 'allowed (no error thrown)', matched: false });
    assert.fail(`${testCase}: the emulator ALLOWED an operation that Firestore Security Rules deny`);
  }

  // ============================================================ rules identity

  describe('rules source of truth', () => {
    it('uses a lab rules file that is byte-identical to the authoritative Android rules', () => {
      assert.ok(existsSync(labRulesPath), `missing lab rules file: ${labRulesPath}`);
      assert.ok(existsSync(authoritativeRulesPath), `missing authoritative rules file: ${authoritativeRulesPath}`);

      const labHash = sha256OfFile(labRulesPath);
      const authoritativeHash = sha256OfFile(authoritativeRulesPath);
      assert.equal(
        labHash,
        authoritativeHash,
        `the emulator would NOT be enforcing the authoritative rules (lab=${labHash}, android=${authoritativeHash})`,
      );
    });

    it('starts the emulator with that rules file through the isolated lab configuration', () => {
      const labConfig = JSON.parse(readFileSync(labFirebaseConfigPath, 'utf8')) as {
        firestore?: { rules?: string };
      };
      assert.equal(labConfig.firestore?.rules, 'firestore.rules');

      const runnerScript = readFileSync(
        join(projectRoot, 'emulator-lab', 'scripts', 'run-emulator-tests.mjs'),
        'utf8',
      );
      assert.ok(
        runnerScript.includes('labFirebaseConfigPath') && runnerScript.includes('emulators:exec'),
        'the integration runner must start the emulators with the lab configuration',
      );
    });

    it('proves the emulator enforces the rules: an unauthenticated REST read is denied', async (context) => {
      const raw = await harness.rawRequest(UNAUTHENTICATED_PROBE_PATH, { method: 'GET', token: null });
      const serverError = readServerError(raw.body);
      context.diagnostic(
        `GET ${harness.rawUrl(UNAUTHENTICATED_PROBE_PATH)} (no Authorization header) -> `
        + `HTTP ${raw.status} status=${String(serverError.status)} message=${String(serverError.message)}`,
      );

      // The document does not exist, so a permissive rule would answer 404. Anything
      // other than 200 proves the rules refused to serve the read at all, and the
      // rules that apply here (users: isOwner || isAdmin) both require
      // request.auth, i.e. a null auth is denied.
      assert.notEqual(
        raw.status,
        200,
        `an unauthenticated read returned data; the rules must deny it (body: ${raw.body})`,
      );
      assert.ok(
        raw.status === 401 || raw.status === 403,
        `an unauthenticated read must be denied with HTTP 401/403, received HTTP ${raw.status} `
        + `(${serverError.message ?? 'no server message'})`,
      );
      recordDecision({
        testCase: 'unauthenticated read denied (request.auth == null)',
        actor: 'anonymous',
        request: `GET ${UNAUTHENTICATED_PROBE_PATH}`,
        expected: 'denied (HTTP 401/403)',
        observed: `HTTP ${raw.status} ${serverError.status ?? ''}`,
        matched: true,
      });
    });
  });

  // =================================================================== ADMIN

  describe('admin authorization (role = admin)', () => {
    it('reads another user private profile that only isAdmin() allows', async (context) => {
      const document = await expectAllowed(
        'admin reads a foreign users/{uid} document',
        'admin',
        `GET users/${employeeBUid}`,
        admin.client.getDocument(`users/${employeeBUid}`),
      ) as FirestoreDocument;

      context.diagnostic(`admin GET users/${employeeBUid} -> 200 (role=${String(document.data['role'])})`);
      assert.equal(document.data['employeeId'], 'EMP-101');
    });

    it('updates any user profile (admin-only operation)', async (context) => {
      const document = await expectAllowed(
        'admin updates a foreign user status to approved',
        'admin',
        `PATCH users/${approvalTargetUid} {status: approved}`,
        admin.client.patchDocument(`users/${approvalTargetUid}`, { status: 'approved' }),
      ) as FirestoreDocument;

      context.diagnostic(`admin PATCH users/${approvalTargetUid} -> 200 (status=${String(document.data['status'])})`);
      assert.equal(document.data['status'], 'approved');
    });

    it('creates a medicine document (medicines write is admin-only)', async (context) => {
      const document = await expectAllowed(
        'admin creates medicines/med-admin-created',
        'admin',
        'POST medicines?documentId=med-admin-created',
        admin.client.createDocument('medicines', { name: 'أموكسيسيلين', stock: 4, price: 7.25 }, 'med-admin-created'),
      ) as FirestoreDocument;

      context.diagnostic(`admin created ${document.relativePath} -> 200`);
      assert.equal(document.relativePath, 'medicines/med-admin-created');

      const readBack = await expectAllowed(
        'admin reads back medicines/med-admin-created',
        'admin',
        'GET medicines/med-admin-created',
        admin.client.getDocument('medicines/med-admin-created'),
      ) as FirestoreDocument;
      assert.equal(readBack.data['stock'], 4);
    });

    it('writes settings and reads the stock_logs audit trail', async () => {
      await expectAllowed(
        'admin updates settings/schedule',
        'admin',
        'PATCH settings/schedule {openTime}',
        admin.client.patchDocument('settings/schedule', { openTime: '09:00' }, { updateMaskPaths: ['openTime'] }),
      );

      const log = await expectAllowed(
        'admin reads stock_logs/log-1 (admin-only read)',
        'admin',
        'GET stock_logs/log-1',
        admin.client.getDocument('stock_logs/log-1'),
      ) as FirestoreDocument;
      assert.equal(log.data['medicineId'], 'med-1');
    });

    it('creates an order for another user', async (context) => {
      const order = await expectAllowed(
        'admin creates orders/order-admin-created for another user',
        'admin',
        'POST orders?documentId=order-admin-created',
        admin.client.createDocument(
          'orders',
          { userId: employeeAUid, items: ['med-1'], total: 2.5, status: 'final' },
          'order-admin-created',
        ),
      ) as FirestoreDocument;

      context.diagnostic(`admin created ${order.relativePath} (userId=${employeeAUid}) -> 200`);
    });
  });

  // =============================================================== ASSISTANT

  describe('assistant authorization (role = assistant counts as isAdmin())', () => {
    it('reads a foreign user profile and the admin-only stock_logs collection', async () => {
      const foreign = await expectAllowed(
        'assistant reads a foreign users/{uid} document',
        'assistant',
        `GET users/${employeeAUid}`,
        assistant.client.getDocument(`users/${employeeAUid}`),
      ) as FirestoreDocument;
      assert.equal(foreign.data['uid'], employeeAUid);

      await expectAllowed(
        'assistant reads stock_logs/log-1',
        'assistant',
        'GET stock_logs/log-1',
        assistant.client.getDocument('stock_logs/log-1'),
      );
    });

    it('writes the admin-only stock_logs collection', async () => {
      await expectAllowed(
        'assistant creates stock_logs/log-assistant',
        'assistant',
        'POST stock_logs?documentId=log-assistant',
        assistant.client.createDocument(
          'stock_logs',
          { medicineId: 'med-1', delta: -1, actorUid: assistantUid },
          'log-assistant',
        ),
      );
    });
  });

  // ================================================================ EMPLOYEE

  describe('employee authorization (role = employee, status = approved)', () => {
    it('reads its own profile document', async (context) => {
      const own = await expectAllowed(
        'employee reads its own users/{uid} document',
        'employeeA',
        `GET users/${employeeAUid}`,
        employeeA.client.getDocument(`users/${employeeAUid}`),
      ) as FirestoreDocument;

      context.diagnostic(`employeeA GET users/${employeeAUid} -> 200`);
      assert.equal(own.data['uid'], employeeAUid);
    });

    it('is denied reading another user private profile (HTTP 403)', async (context) => {
      const error = await expectDenied(
        'employee reads a FOREIGN users/{uid} document',
        'employeeA',
        `GET users/${employeeBUid}`,
        employeeA.client.getDocument(`users/${employeeBUid}`),
      );
      context.diagnostic(
        `employeeA GET users/${employeeBUid} -> HTTP ${error.httpStatus} (${error.serverMessage ?? 'no message'})`,
      );
    });

    it('reads the shared catalog and settings (any authenticated user)', async () => {
      const medicine = await expectAllowed(
        'employee reads medicines/med-1',
        'employeeA',
        'GET medicines/med-1',
        employeeA.client.getDocument('medicines/med-1'),
      ) as FirestoreDocument;
      assert.equal(medicine.data['name'], 'باراسيتامول');

      await expectAllowed(
        'employee reads settings/schedule',
        'employeeA',
        'GET settings/schedule',
        employeeA.client.getDocument('settings/schedule'),
      );
    });

    it('is denied the admin-only stock_logs collection', async (context) => {
      const error = await expectDenied(
        'employee reads stock_logs/log-1',
        'employeeA',
        'GET stock_logs/log-1',
        employeeA.client.getDocument('stock_logs/log-1'),
      );
      context.diagnostic(`employeeA GET stock_logs/log-1 -> HTTP ${error.httpStatus}`);
    });

    it('is denied CREATING a stock log (admin-only write)', async (context) => {
      // A forged audit row is the highest-value attack on this collection: it
      // would poison the very trail the audit screen renders as truth. The read
      // denial above proves employees cannot SEE the trail; this proves they
      // cannot ADD to it either (firestore.rules line 86: read, write admin-only).
      const error = await expectDenied(
        'employee creates stock_logs/log-employee-attempt',
        'employeeA',
        'POST stock_logs?documentId=log-employee-attempt',
        employeeA.client.createDocument(
          'stock_logs',
          { medicineId: 'med-1', delta: 999, actorUid: employeeAUid },
          'log-employee-attempt',
        ),
      );
      assert.equal(
        await harness.readAsEmulatorOwner('stock_logs/log-employee-attempt'),
        null,
        'the refused log must not exist afterwards',
      );
      context.diagnostic(`employeeA POST stock_logs -> HTTP ${error.httpStatus}`);
    });

    it('is denied creating a medicine (write is admin-only)', async (context) => {
      const error = await expectDenied(
        'employee creates medicines/med-employee-attempt',
        'employeeA',
        'POST medicines?documentId=med-employee-attempt',
        employeeA.client.createDocument(
          'medicines',
          { name: 'دواء غير مصرح', stock: 1, price: 1 },
          'med-employee-attempt',
        ),
      );
      context.diagnostic(`employeeA POST medicines -> HTTP ${error.httpStatus}`);
    });

    it('updates the allowed fields of its own profile', async () => {
      const updated = await expectAllowed(
        'employee updates own users/{uid} name (allowed field)',
        'employeeA',
        `PATCH users/${employeeAUid} {name} mask=[name]`,
        employeeA.client.patchDocument(
          `users/${employeeAUid}`,
          { name: 'صيدلاني أول - محدث' },
          { updateMaskPaths: ['name'] },
        ),
      ) as FirestoreDocument;

      assert.equal(updated.data['name'], 'صيدلاني أول - محدث');
    });

    it('is denied escalating its own role to admin', async (context) => {
      const error = await expectDenied(
        'employee changes own role to admin',
        'employeeA',
        `PATCH users/${employeeAUid} {role} mask=[role]`,
        employeeA.client.patchDocument(
          `users/${employeeAUid}`,
          { role: 'admin' },
          { updateMaskPaths: ['role'] },
        ),
      );
      context.diagnostic(`employeeA role escalation -> HTTP ${error.httpStatus}`);
    });

    it('is denied changing its own employeeId', async () => {
      await expectDenied(
        'employee changes own employeeId',
        'employeeA',
        `PATCH users/${employeeAUid} {employeeId} mask=[employeeId]`,
        employeeA.client.patchDocument(
          `users/${employeeAUid}`,
          { employeeId: 'EMP-999' },
          { updateMaskPaths: ['employeeId'] },
        ),
      );
    });

    it('is denied self-approving its own account status', async (context) => {
      const error = await expectDenied(
        'pending employee tries to approve itself',
        'employeePending',
        `PATCH users/${employeePendingUid} {status} mask=[status]`,
        employeePending.client.patchDocument(
          `users/${employeePendingUid}`,
          { status: 'approved' },
          { updateMaskPaths: ['status'] },
        ),
      );
      context.diagnostic(`employeePending self-approval -> HTTP ${error.httpStatus}`);
    });

    it('is denied updating another user profile', async () => {
      await expectDenied(
        'employee updates a FOREIGN users/{uid} document',
        'employeeA',
        `PATCH users/${employeeBUid} {name}`,
        employeeA.client.patchDocument(
          `users/${employeeBUid}`,
          { name: 'تعديل غير مصرح' },
          { updateMaskPaths: ['name'] },
        ),
      );
    });

    it('is denied creating orders (admin-only write)', async () => {
      await expectDenied(
        'employee creates orders/order-employee-attempt',
        'employeeA',
        'POST orders?documentId=order-employee-attempt',
        employeeA.client.createDocument(
          'orders',
          { userId: employeeAUid, items: ['med-1'], total: 2.5, status: 'final' },
          'order-employee-attempt',
        ),
      );
    });

    it('is denied updating its own order_request (admin-only update)', async () => {
      await expectDenied(
        'employee updates own order_requests/{id}',
        'employeeA',
        'PATCH order_requests/req-of-a {status}',
        employeeA.client.patchDocument(
          'order_requests/req-of-a',
          { status: 'approved' },
          { updateMaskPaths: ['status'] },
        ),
      );
    });

    it('is denied updating even its OWN order (admin-only write)', async () => {
      // Orders are created exclusively by the Stage 6 trusted flow under a
      // manager session; if an employee could PATCH even their own order, the
      // stored totals/statuses would no longer be trustworthy audit data.
      await expectDenied(
        'employee updates own orders/order-a',
        'employeeA',
        'PATCH orders/order-a {status} mask=[status]',
        employeeA.client.patchDocument(
          'orders/order-a',
          { status: 'void' },
          { updateMaskPaths: ['status'] },
        ),
      );
    });

    it('is denied deleting its own order_request (admin-only delete)', async () => {
      // The rules grant `update, delete` to admins only (firestore.rules
      // line 102). The Stage 3 client has no delete verb, so this evidence
      // request goes straight to the emulator REST API with a REAL employee
      // ID token - the exact request a tampering client would send.
      const response = await fetch(harness.documentUrl('order_requests/req-of-a'), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${employeeA.idToken}` },
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 403, 'the rules must refuse an employee DELETE');
      assert.equal(
        await harness.readAsEmulatorOwner('order_requests/req-of-a') !== null,
        true,
        'the request must still exist after the refused delete',
      );
    });
  });

  // ================================================================ OWNERSHIP

  describe('ownership (request.auth.uid / resource.data.userId / resource.data.uid)', () => {
    it('employeeA reads its own order but not the order of employeeB', async (context) => {
      const own = await expectAllowed(
        'employeeA reads orders/order-a (userId = employeeA)',
        'employeeA',
        'GET orders/order-a',
        employeeA.client.getDocument('orders/order-a'),
      ) as FirestoreDocument;
      assert.equal(own.data['userId'], employeeAUid);

      const error = await expectDenied(
        'employeeA reads orders/order-b (userId = employeeB)',
        'employeeA',
        'GET orders/order-b',
        employeeA.client.getDocument('orders/order-b'),
      );
      context.diagnostic(`employeeA GET orders/order-b -> HTTP ${error.httpStatus}`);
    });

    it('employeeB reads its own order (mirror image of the same rule)', async () => {
      const own = await expectAllowed(
        'employeeB reads orders/order-b (userId = employeeB)',
        'employeeB',
        'GET orders/order-b',
        employeeB.client.getDocument('orders/order-b'),
      ) as FirestoreDocument;
      assert.equal(own.data['userId'], employeeBUid);
    });

    it('applies the same ownership rule to order_requests, while admin reads every request', async () => {
      await expectAllowed(
        'employeeA reads its own order_requests/req-of-a',
        'employeeA',
        'GET order_requests/req-of-a',
        employeeA.client.getDocument('order_requests/req-of-a'),
      );

      await expectDenied(
        'employeeA reads a FOREIGN order_requests/req-of-b',
        'employeeA',
        'GET order_requests/req-of-b',
        employeeA.client.getDocument('order_requests/req-of-b'),
      );

      await expectAllowed(
        'admin reads any order_requests/req-of-b',
        'admin',
        'GET order_requests/req-of-b',
        admin.client.getDocument('order_requests/req-of-b'),
      );
    });
  });

  // ================================================ CREATE RULE + isApproved()

  describe('new-user create rule and status-driven authorization', () => {
    it('allows an owner read of a not-yet-created profile (NOT_FOUND, not 403)', async (context) => {
      const document = await employeeFresh.client.getDocumentOrNull(`users/${employeeFreshUid}`);
      assert.equal(document, null, 'the profile must not exist yet at this point of the run');

      recordDecision({
        testCase: 'owner read of own missing users/{uid} document',
        actor: 'employeeFresh',
        request: `GET users/${employeeFreshUid}`,
        expected: 'allowed by rules, document absent (NOT_FOUND)',
        observed: 'no authorization error, empty result',
        matched: true,
      });
      context.diagnostic('the Rules allowed the owner read; the document simply does not exist yet');
    });

    it('denies creating a profile with a privileged role', async () => {
      await expectDenied(
        'new user creates own profile with role=admin',
        'employeeFresh',
        `POST users?documentId=${employeeFreshUid} {role: admin}`,
        employeeFresh.client.createDocument(
          'users',
          { uid: employeeFreshUid, name: 'منتحل', employeeId: 'EMP-200', role: 'admin', status: 'pending', hasException: false },
          employeeFreshUid,
        ),
      );
    });

    it('denies creating a profile that is already approved', async () => {
      await expectDenied(
        'new user creates own profile with status=approved',
        'employeeFresh',
        `POST users?documentId=${employeeFreshUid} {status: approved}`,
        employeeFresh.client.createDocument(
          'users',
          { uid: employeeFreshUid, name: 'موظف جديد', employeeId: 'EMP-200', role: 'employee', status: 'approved', hasException: false },
          employeeFreshUid,
        ),
      );
    });

    it('denies creating a profile that claims another uid', async () => {
      await expectDenied(
        'new user creates a profile for a foreign uid',
        'employeeFresh',
        'POST users?documentId=ghost-uid-0001 {uid: ghost-uid-0001}',
        employeeFresh.client.createDocument(
          'users',
          { uid: 'ghost-uid-0001', name: 'انتحال', employeeId: 'EMP-201', role: 'employee', status: 'pending', hasException: false },
          'ghost-uid-0001',
        ),
      );
    });

    it('creates its own profile as employee/pending (create rule satisfied)', async () => {
      const created = await expectAllowed(
        'new user creates own profile (employee, pending, hasException=false)',
        'employeeFresh',
        `POST users?documentId=${employeeFreshUid}`,
        employeeFresh.client.createDocument(
          'users',
          { uid: employeeFreshUid, name: 'موظف جديد', employeeId: 'EMP-200', role: 'employee', status: 'pending', hasException: false },
          employeeFreshUid,
        ),
      ) as FirestoreDocument;

      assert.equal(created.data['role'], 'employee');
      assert.equal(created.data['status'], 'pending');
    });
  });

  // ================================== order_requests write rules (isApproved)

  describe('order_requests write rules (isApproved() and payload shape)', () => {
    it('allows an approved employee and denies the IDENTICAL payload for a non-approved employee', async (context) => {
      const payload = (uid: string): Record<string, unknown> => ({
        uid,
        items: [{ medicineId: 'med-1', quantity: 2 }],
        status: 'pending',
        requestDate: new Date().toISOString(),
      });

      const created = await expectAllowed(
        'approved employeeA creates order_requests/req-a-valid',
        'employeeA',
        'POST order_requests?documentId=req-a-valid',
        employeeA.client.createDocument('order_requests', payload(employeeAUid), 'req-a-valid'),
      ) as FirestoreDocument;
      assert.equal(created.data['uid'], employeeAUid);

      const error = await expectDenied(
        'pending employeePending creates the IDENTICAL payload',
        'employeePending',
        'POST order_requests?documentId=req-pending-attempt',
        employeePending.client.createDocument('order_requests', payload(employeePendingUid), 'req-pending-attempt'),
      );
      context.diagnostic(
        `employeeA (status=approved) -> HTTP 200 while employeePending (status=pending) -> HTTP ${error.httpStatus} `
        + 'for the same request body: authorization depends on users/{uid}.status in the Rules',
      );
    });

    it('denies a request carrying a field outside the allowed key set', async () => {
      await expectDenied(
        'employeeA creates order_requests/req-a-extra-key with an extra field',
        'employeeA',
        'POST order_requests?documentId=req-a-extra-key',
        employeeA.client.createDocument(
          'order_requests',
          {
            uid: employeeAUid,
            items: [{ medicineId: 'med-1', quantity: 1 }],
            status: 'pending',
            requestDate: new Date().toISOString(),
            adminNote: 'حقل غير مسموح',
          },
          'req-a-extra-key',
        ),
      );
    });

    it('denies a request created with a status other than pending', async () => {
      await expectDenied(
        'employeeA creates order_requests/req-a-wrong-status with status=approved',
        'employeeA',
        'POST order_requests?documentId=req-a-wrong-status',
        employeeA.client.createDocument(
          'order_requests',
          {
            uid: employeeAUid,
            items: [{ medicineId: 'med-1', quantity: 1 }],
            status: 'approved',
            requestDate: new Date().toISOString(),
          },
          'req-a-wrong-status',
        ),
      );
    });

    it('denies a request that claims another employee uid', async () => {
      await expectDenied(
        'employeeA creates order_requests/req-a-wrong-uid for employeeB',
        'employeeA',
        'POST order_requests?documentId=req-a-wrong-uid',
        employeeA.client.createDocument(
          'order_requests',
          {
            uid: employeeBUid,
            items: [{ medicineId: 'med-1', quantity: 1 }],
            status: 'pending',
            requestDate: new Date().toISOString(),
          },
          'req-a-wrong-uid',
        ),
      );
    });

    it('allows only the rejected -> pending status transition for an employee', async () => {
      await expectAllowed(
        'rejected employee resets own status to pending',
        'employeeRejected',
        `PATCH users/${employeeRejectedUid} {status: pending}`,
        employeeRejected.client.patchDocument(
          `users/${employeeRejectedUid}`,
          { status: 'pending' },
          { updateMaskPaths: ['status'] },
        ),
      );

      await expectDenied(
        'rejected employee escalates own status to approved',
        'employeeRejected',
        `PATCH users/${employeeRejectedUid} {status: approved}`,
        employeeRejected.client.patchDocument(
          `users/${employeeRejectedUid}`,
          { status: 'approved' },
          { updateMaskPaths: ['status'] },
        ),
      );
    });
  });

  // ================================= approval changes authorization mid-session

  describe('approval changes authorization for the very same ID token', () => {
    it('cannot create an order_request while its status is pending', async () => {
      await expectDenied(
        'pending employeeFresh creates order_requests/req-fresh-attempt',
        'employeeFresh',
        'POST order_requests?documentId=req-fresh-attempt',
        employeeFresh.client.createDocument(
          'order_requests',
          {
            uid: employeeFreshUid,
            items: [{ medicineId: 'med-1', quantity: 1 }],
            status: 'pending',
            requestDate: new Date().toISOString(),
          },
          'req-fresh-attempt',
        ),
      );
    });

    it('is approved by an admin (admin update rule)', async () => {
      const updated = await expectAllowed(
        'admin approves the new user',
        'admin',
        `PATCH users/${employeeFreshUid} {status: approved}`,
        admin.client.patchDocument(
          `users/${employeeFreshUid}`,
          { status: 'approved' },
          { updateMaskPaths: ['status'] },
        ),
      ) as FirestoreDocument;

      assert.equal(updated.data['status'], 'approved');
    });

    it('can create an order_request after approval without re-authenticating', async (context) => {
      const created = await expectAllowed(
        'approved employeeFresh creates order_requests/req-fresh-valid',
        'employeeFresh',
        'POST order_requests?documentId=req-fresh-valid',
        employeeFresh.client.createDocument(
          'order_requests',
          {
            uid: employeeFreshUid,
            items: [{ medicineId: 'med-1', quantity: 1 }],
            status: 'pending',
            requestDate: new Date().toISOString(),
          },
          'req-fresh-valid',
        ),
      ) as FirestoreDocument;

      context.diagnostic(
        'the ID token was issued while the user was still pending, so the Rules must have '
        + 're-read users/{uid}.status from Firestore on this request',
      );
      assert.equal(created.data['uid'], employeeFreshUid);
    });
  });

  // ======================================== query / list (rules are not filters)

  describe('query and list semantics (rules are not filters)', () => {
    it('employeeA can run a query that provably matches only its own orders', async (context) => {
      const documents = await expectAllowed(
        'employeeA runs a structured query on orders filtered by its own uid',
        'employeeA',
        'POST :runQuery orders where userId == auth.uid',
        employeeA.client.runQuery({
          collectionId: 'orders',
          where: { field: 'userId', op: 'EQUAL', value: employeeAUid },
          limit: 10,
        }),
      ) as readonly FirestoreDocument[];

      context.diagnostic(`filtered runQuery returned ${documents.length} document(s)`);
      assert.ok(documents.length >= 1, 'the owner-filtered query must return the own order');
      for (const document of documents) {
        assert.equal(document.data['userId'], employeeAUid);
      }
    });

    it('employeeA is denied the same query without the ownership filter', async (context) => {
      const error = await expectDenied(
        'employeeA runs an UNFILTERED query on orders',
        'employeeA',
        'POST :runQuery orders (no filter)',
        employeeA.client.runQuery({ collectionId: 'orders', limit: 10 }),
      );
      context.diagnostic(
        `unfiltered orders query -> HTTP ${error.httpStatus} (${error.serverMessage ?? 'no message'})`,
      );
    });

    it('admin can run the unfiltered query', async () => {
      const documents = await expectAllowed(
        'admin runs an unfiltered query on orders',
        'admin',
        'POST :runQuery orders (no filter)',
        admin.client.runQuery({ collectionId: 'orders', limit: 10 }),
      ) as readonly FirestoreDocument[];
      assert.ok(documents.length >= 2);
    });

    it('listDocuments follows the same rule: employees cannot list users, admins can', async () => {
      await expectDenied(
        'employeeA lists the users collection',
        'employeeA',
        'GET documents/users',
        employeeA.client.listDocuments('users', { pageSize: 10 }),
      );

      const listedUsers = await expectAllowed(
        'admin lists the users collection',
        'admin',
        'GET documents/users',
        admin.client.listDocuments('users', { pageSize: 25 }),
      ) as { readonly documents: readonly FirestoreDocument[] };
      assert.ok(listedUsers.documents.length >= 3);

      const listedMedicines = await expectAllowed(
        'employeeA lists the medicines collection (authenticated read)',
        'employeeA',
        'GET documents/medicines',
        employeeA.client.listDocuments('medicines', { pageSize: 10 }),
      ) as { readonly documents: readonly FirestoreDocument[] };
      assert.ok(listedMedicines.documents.length >= 1);
    });
  });

  // ==================================================== token handling evidence

  describe('token handling (real ID tokens, Main process only)', () => {
    it('uses real Firebase ID tokens issued by the Auth Emulator', async (context) => {
      const sessions: readonly (readonly [string, ActorSession])[] = [
        ['admin', admin],
        ['employeeA', employeeA],
        ['employeeB', employeeB],
      ];

      for (const [name, session] of sessions) {
        const segments = session.idToken.split('.');
        assert.equal(segments.length, 3, `${name}: the ID token must be a three-part JWT`);

        const decoded = Buffer.from((segments[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
          .toString('utf8');
        const claims = JSON.parse(decoded) as { user_id?: string; aud?: string; iss?: string };

        assert.equal(claims.user_id, session.uid, `${name}: the token must belong to the signed-in uid`);
        assert.equal(claims.aud, environment.projectId, `${name}: the token audience must be the lab project`);
        context.diagnostic(
          `${name}: JWT user_id=${String(claims.user_id)} aud=${String(claims.aud)} iss=${String(claims.iss)}`,
        );
      }
    });

    it('keeps the ID token out of every error object produced by the client', async () => {
      const error = await expectDenied(
        'token-free error surface check (denied read)',
        'employeeA',
        `GET users/${employeeBUid}`,
        employeeA.client.getDocument(`users/${employeeBUid}`),
      );

      const surface = [
        error.message,
        error.serverMessage ?? '',
        error.stack ?? '',
        JSON.stringify({ ...error }),
      ].join(' | ');

      assert.equal(surface.includes(employeeA.idToken), false, 'the raw ID token leaked into the error surface');
      assert.equal(
        surface.includes(employeeA.idToken.slice(0, 20)),
        false,
        'a token fragment leaked into the error surface',
      );
    });

    it('refuses to send a Firestore request when there is no session', async (context) => {
      const anonymousAuth = new FirebaseAuthService({
        mode: 'development',
        apiKey: 'demo-emulator-api-key',
        projectId: environment.projectId,
        emulatorHost: environment.authHost,
      });
      const anonymousClient = new FirestoreRestClient({
        config: harness.firestoreConfig,
        getAccessToken: () => anonymousAuth.getValidIdToken(),
        allowRemoteTarget: false,
      });

      await assert.rejects(
        () => anonymousClient.getDocument('medicines/med-1'),
        (error: unknown) => error instanceof FirestoreRestError
          && error.reason === 'UNAUTHENTICATED'
          && error.requestSent === false,
      );
      context.diagnostic('the client never issues an unauthenticated Firestore request');
    });

    it('treats a forged token as an unknown principal that gains no privilege', async (context) => {
      // KNOWN EMULATOR LIMITATION (documented in docs/firestore-rest-architecture.md):
      // the Firestore Emulator does NOT verify JWT signatures. It decodes the payload
      // and trusts the claimed principal. It is therefore NOT a token-authenticity
      // oracle, and this suite must not pretend otherwise. What the emulator DOES prove
      // - and what is asserted here - is that a token carrying an identity which has no
      // users/{uid} document earns no privilege at all, because isAdmin() is evaluated
      // SERVER-SIDE against users/{request.auth.uid}.
      const forgedToken = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.`
        + `${Buffer.from(JSON.stringify({ user_id: 'forged-uid', aud: environment.projectId })).toString('base64url')}.`;

      // The catalog is readable by any authenticated principal, so the emulator
      // answers 200: it accepted the CLAIMED identity, it did not verify it.
      const catalog = await harness.rawRequest('medicines/med-1', { method: 'GET', token: forgedToken });

      // users/{employeeBUid}: isOwner(employeeBUid) is false and isAdmin() is false
      // because users/forged-uid does not exist -> denied.
      const foreignProfile = await harness.rawRequest(`users/${employeeBUid}`, { method: 'GET', token: forgedToken });

      // stock_logs: allow read: if isAdmin() -> denied.
      const stockLogs = await harness.rawRequest('stock_logs/log-1', { method: 'GET', token: forgedToken });

      // settings write: allow write: if isAdmin() -> denied.
      // The document is snapshotted first because an earlier admin test creates it;
      // the real requirement is that the DENIED write changes nothing.
      const settingsBefore = await harness.readAsEmulatorOwner('settings/schedule');
      const settingsWrite = await harness.rawRequest('settings/schedule', {
        method: 'PATCH',
        token: forgedToken,
        body: { fields: { startTime: { stringValue: '00:00' } } },
      });
      const settingsAfter = await harness.readAsEmulatorOwner('settings/schedule');

      const foreignProfileError = readServerError(foreignProfile.body);
      context.diagnostic(
        'forged token (user_id="forged-uid", alg=none, empty signature) -> '
        + `medicines=${catalog.status} (catalog is open to any authenticated principal), `
        + `users/${employeeBUid}=${foreignProfile.status} (${foreignProfileError.message ?? 'no message'}), `
        + `stock_logs=${stockLogs.status}, settings PATCH=${settingsWrite.status}`,
      );

      assert.equal(catalog.status, 200, 'the emulator accepts the claimed identity without verifying the signature');

      assert.equal(
        foreignProfile.status,
        403,
        `a forged identity must not read another user's private document, received HTTP ${foreignProfile.status}`,
      );
      assert.equal(
        stockLogs.status,
        403,
        `a forged identity must not read the admin-only stock_logs, received HTTP ${stockLogs.status}`,
      );
      assert.equal(
        settingsWrite.status,
        403,
        `a forged identity must not perform an admin-only write, received HTTP ${settingsWrite.status}`,
      );

      // The settings document must be byte-for-byte unchanged by the denied write.
      assert.deepEqual(
        settingsAfter,
        settingsBefore,
        'the denied admin-only write must not have changed the settings document',
      );

      recordDecision({
        testCase: 'forged token is an unknown principal with no privilege',
        actor: 'forged-token (no users/forged-uid document)',
        request: 'GET users/{employeeBUid}, GET stock_logs/log-1, PATCH settings/schedule',
        expected: '200 (catalog), 403, 403, 403 and no write took effect',
        observed: `${catalog.status}, ${foreignProfile.status}, ${stockLogs.status}, ${settingsWrite.status}`,
        matched: true,
      });
    });

    it('produces the same decision as a plain REST call (the client is a thin REST layer)', async (context) => {
      const asEmployee = await harness.rawRequest(`users/${employeeBUid}`, {
        method: 'GET',
        token: employeeA.idToken,
      });
      const asAdmin = await harness.rawRequest(`users/${employeeBUid}`, {
        method: 'GET',
        token: admin.idToken,
      });

      context.diagnostic(
        `raw REST GET users/${employeeBUid}: employeeA -> HTTP ${asEmployee.status}, admin -> HTTP ${asAdmin.status}`,
      );
      assert.equal(asEmployee.status, 403);
      assert.equal(asAdmin.status, 200);

      recordDecision({
        testCase: 'identical request, different token => different decision (server-side rules)',
        actor: 'employeeA vs admin',
        request: `GET users/${employeeBUid}`,
        expected: '403 for employeeA, 200 for admin',
        observed: `${asEmployee.status} / ${asAdmin.status}`,
        matched: true,
      });
    });
  });

  // ================================================= REST transaction primitives

  describe('REST transaction primitives (begin / batchGet / commit / rollback)', () => {
    it('admin: begin, authenticated read, allowed commit, verified write', async (context) => {
      const transaction = await admin.client.beginTransaction();
      assert.ok(transaction.length > 0, 'beginTransaction must return a transaction id');

      const read = await expectAllowed(
        'admin reads medicines/med-1 inside a transaction',
        'admin',
        'POST :batchGet (transaction)',
        admin.client.batchGetDocuments(['medicines/med-1'], transaction),
      ) as readonly (FirestoreDocument | null)[];
      assert.equal(read.length, 1);
      assert.ok(read[0] !== null, 'the transactional read must return the document');

      const commit = await expectAllowed(
        'admin commits a create inside the transaction',
        'admin',
        'POST :commit (transaction)',
        admin.client.commitWrites(
          [{ relativePath: 'medicines/med-admin-tx', data: { name: 'دواء المعاملة', stock: 3, price: 9.5 }, kind: 'create' }],
          transaction,
        ),
      ) as { readonly writeCount: number; readonly commitTime: string | null };

      assert.equal(commit.writeCount, 1);
      context.diagnostic(`admin committed inside a transaction (commitTime=${String(commit.commitTime)})`);

      const stored = await admin.client.getDocument('medicines/med-admin-tx');
      assert.equal(stored.data['stock'], 3, 'the committed write must be readable');
    });

    it('employee: a transactional read of a foreign private document is denied', async (context) => {
      const transaction = await employeeA.client.beginTransaction();

      const error = await expectDenied(
        'employeeA reads a foreign users/{uid} inside a transaction',
        'employeeA',
        'POST :batchGet (transaction)',
        employeeA.client.batchGetDocuments([`users/${employeeBUid}`], transaction),
      );
      context.diagnostic(`transactional read of a foreign profile -> HTTP ${error.httpStatus}`);

      await employeeA.client.rollback(transaction);
    });

    it('employee: an unauthorized commit is denied and changes nothing', async (context) => {
      const transaction = await employeeA.client.beginTransaction();

      const error = await expectDenied(
        'employeeA commits a stock_logs create inside a transaction',
        'employeeA',
        'POST :commit (transaction)',
        employeeA.client.commitWrites(
          [{ relativePath: 'stock_logs/forbidden-tx', data: { medicineId: 'med-1', delta: 99, actorUid: employeeAUid }, kind: 'create' }],
          transaction,
        ),
      );
      context.diagnostic(`unauthorized commit -> HTTP ${error.httpStatus}`);

      const afterwards = await admin.client.getDocumentOrNull('stock_logs/forbidden-tx');
      assert.equal(afterwards, null, 'a denied commit must not write any data');
      recordDecision({
        testCase: 'no data change after a denied commit',
        actor: 'admin (verification read)',
        request: 'GET stock_logs/forbidden-tx',
        expected: 'document absent',
        observed: afterwards === null ? 'absent' : 'present',
        matched: afterwards === null,
      });
    });

    it('employee: an allowed commit inside a transaction still obeys field-level rules', async (context) => {
      const currentProfile = await harness.readAsEmulatorOwner(`users/${employeeAUid}`);
      assert.ok(currentProfile !== null, 'the fixture profile must exist');
      assert.equal(currentProfile['role'], 'employee');

      const transaction = await employeeA.client.beginTransaction();
      const commit = await expectAllowed(
        'employeeA commits an allowed own-profile name change inside a transaction',
        'employeeA',
        'POST :commit (transaction)',
        employeeA.client.commitWrites(
          [{
            relativePath: `users/${employeeAUid}`,
            data: { ...currentProfile, name: 'صيدلاني أول - معاملة' },
            kind: 'update',
          }],
          transaction,
        ),
      ) as { readonly writeCount: number };

      assert.equal(commit.writeCount, 1);
      const stored = await admin.client.getDocument(`users/${employeeAUid}`);
      assert.equal(stored.data['name'], 'صيدلاني أول - معاملة');
      assert.equal(stored.data['role'], 'employee', 'the transactional write must not touch the role');
      context.diagnostic('the allowed transactional write was applied and the role stayed employee');
    });

    it('rollback invalidates the transaction: a later commit fails and writes nothing', async (context) => {
      const transaction = await admin.client.beginTransaction();
      await admin.client.rollback(transaction);

      let observed = 'no error';
      try {
        await admin.client.commitWrites(
          [{
            relativePath: 'medicines/med-admin-tx',
            data: { name: 'دواء المعاملة', stock: 42, price: 9.5 },
            kind: 'update',
          }],
          transaction,
        );
      } catch (error: unknown) {
        observed = describeError(error);
      }

      context.diagnostic(`commit after rollback -> ${observed}`);
      const stored = await admin.client.getDocument('medicines/med-admin-tx');
      const unchanged = stored.data['stock'] !== 42;

      recordDecision({
        testCase: 'commit after rollback fails and writes nothing',
        actor: 'admin',
        request: 'POST :commit (rolled-back transaction)',
        expected: 'error returned and no data change',
        observed,
        matched: observed !== 'no error' && unchanged,
      });

      assert.notEqual(observed, 'no error', 'committing a rolled-back transaction must fail');
      assert.equal(unchanged, true, 'a rolled-back transaction must not change data');
    });
  });

  // ================================================ Stage 5A: updateMask on the
  // REAL Firestore Emulator. These prove the emulator actually honours the mask
  // the client builds (a mocked fetch could never prove that).

  describe('Stage 5A: updateMask is a real partial update (A, B)', () => {
    it('A. updating only stock leaves every other field untouched', async (context) => {
      const before = await admin.client.getDocument('medicines/med-mask-partial');
      assert.equal(before.data['stock'], 100);
      assert.equal(before.data['name'], 'باراسيتامول ٥٠٠');
      assert.equal(before.data['maxQuantity'], 5);
      assert.equal(before.data['totalInward'], 250);
      assert.equal(before.data['totalOutward'], 150);

      await expectAllowed(
        'admin commits a masked partial update of stock only',
        'admin',
        'POST :commit (updateMask=[stock])',
        admin.client.commitWrites([
          { relativePath: 'medicines/med-mask-partial', data: { stock: 42 }, kind: 'update' },
        ]),
      );

      const after = await admin.client.getDocument('medicines/med-mask-partial');
      assert.equal(after.data['stock'], 42, 'the masked field must be written');
      assert.equal(after.data['name'], 'باراسيتامول ٥٠٠', 'name must survive a masked update');
      assert.equal(after.data['maxQuantity'], 5, 'maxQuantity must survive a masked update');
      assert.equal(after.data['totalInward'], 250, 'totalInward must survive a masked update');
      assert.equal(after.data['totalOutward'], 150, 'totalOutward must survive a masked update');
      assert.deepEqual(
        Object.keys(after.data).sort(),
        ['maxQuantity', 'name', 'stock', 'totalInward', 'totalOutward'],
      );
      context.diagnostic('a stock-only update preserved all four sibling fields');
    });

    it('B. updating stock AND totalOutward leaves the unrelated fields untouched', async (context) => {
      await expectAllowed(
        'admin commits a masked update of stock + totalOutward',
        'admin',
        'POST :commit (updateMask=[stock,totalOutward])',
        admin.client.commitWrites([
          {
            relativePath: 'medicines/med-mask-multi',
            data: { stock: 7, totalOutward: 151 },
            kind: 'update',
            updateMaskPaths: ['stock', 'totalOutward'],
          },
        ]),
      );

      const after = await admin.client.getDocument('medicines/med-mask-multi');
      assert.equal(after.data['stock'], 7);
      assert.equal(after.data['totalOutward'], 151);
      assert.equal(after.data['name'], 'باراسيتامول ٥٠٠', 'name is outside the mask and must be unchanged');
      assert.equal(after.data['maxQuantity'], 5, 'maxQuantity is outside the mask and must be unchanged');
      assert.equal(after.data['totalInward'], 250, 'totalInward is outside the mask and must be unchanged');
      context.diagnostic('a two-field mask wrote exactly those two fields');
    });

    it('B2. a nested masked path updates only the nested field', async (context) => {
      await expectAllowed(
        'admin commits a nested masked update of meta.batch',
        'admin',
        'POST :commit (updateMask=[meta.batch])',
        admin.client.commitWrites([
          {
            relativePath: 'medicines/med-mask-nested',
            data: { meta: { batch: 'B-2' } },
            kind: 'update',
            updateMaskPaths: ['meta.batch'],
          },
        ]),
      );

      const after = await admin.client.getDocument('medicines/med-mask-nested');
      const meta = after.data['meta'] as Record<string, unknown> | undefined;
      assert.ok(meta, 'the meta map must still exist');
      assert.equal(meta['batch'], 'B-2', 'the nested masked field must be written');
      assert.equal(meta['supplier'], 'الشركة المتعددة', 'the sibling nested field must be unchanged');
      assert.equal(after.data['stock'], 40, 'top-level fields must be unchanged by a nested mask');
      assert.equal(after.data['name'], 'أوميغا ٣');
      context.diagnostic('meta.batch changed while meta.supplier and every top-level field survived');
    });
  });

  // ==================================== Stage 5A: timestamps on the REAL emulator
  describe('Stage 5A: literal timestamp and server timestamp (C, D)', () => {
    it('C. a literal timestamp is stored and read back as a Firestore timestamp', async (context) => {
      // A LITERAL timestamp: the caller supplies the instant. It is encoded as a
      // Firestore timestampValue, NOT as the string that happens to spell it.
      const literal = FirestoreTimestamp.parse('2026-03-04T05:06:07.123456Z');

      await expectAllowed(
        'admin creates a document with a literal timestamp',
        'admin',
        'POST :commit (create, timestampValue)',
        admin.client.commitWrites([
          { relativePath: 'medicines/med-ts-literal', data: { name: 'طابع ثابت', createdAt: literal }, kind: 'create' },
        ]),
      );

      const stored = await admin.client.getDocument('medicines/med-ts-literal');
      const value = stored.data['createdAt'];
      assert.ok(value instanceof FirestoreTimestamp, `expected a FirestoreTimestamp, got ${typeof value}`);
      assert.equal(
        value.isoValue.startsWith('2026-03-04T05:06:07.123456'),
        true,
        `unexpected instant: ${value.isoValue}`,
      );
      assert.notEqual(typeof value, 'string', 'a timestamp must not come back as a string');
      context.diagnostic(`literal timestamp round-tripped as ${value.isoValue}`);
    });

    it('C2. the same characters sent as a plain string stay a string (types are not conflated)', async (context) => {
      await expectAllowed(
        'admin creates a document with a string that looks like a timestamp',
        'admin',
        'POST :commit (create, stringValue)',
        admin.client.commitWrites([
          {
            relativePath: 'medicines/med-ts-literal-string',
            data: { name: 'نص يشبه الطابع', note: '2026-03-04T05:06:07.123456Z' },
            kind: 'create',
          },
        ]),
      );

      const stored = await admin.client.getDocument('medicines/med-ts-literal-string');
      assert.equal(typeof stored.data['note'], 'string', 'a string must stay a stringValue');
      assert.ok(
        !(stored.data['note'] instanceof FirestoreTimestamp),
        'a string must never be decoded as a timestamp',
      );
      context.diagnostic('a timestamp-shaped string stayed a string: the two types stay distinct');
    });

    it('D. REQUEST_TIME is resolved by Firestore itself, not by the local clock', async (context) => {
      const before = Date.now();

      await expectAllowed(
        'admin creates a document with a server timestamp',
        'admin',
        'POST :commit (create, REQUEST_TIME)',
        admin.client.commitWrites([
          {
            relativePath: 'medicines/med-ts-server',
            data: { name: 'طابع الخادم', processedAt: SERVER_TIMESTAMP },
            kind: 'create',
          },
        ]),
      );

      const after = Date.now();
      const stored = await admin.client.getDocument('medicines/med-ts-server');
      const value = stored.data['processedAt'];

      assert.ok(value instanceof FirestoreTimestamp, `expected a FirestoreTimestamp, got ${typeof value}`);
      assert.notEqual(value.isoValue, 'REQUEST_TIME', 'the field must not be the literal string REQUEST_TIME');

      // The server value must lie inside the window of this test run, which
      // proves the LOCAL clock was not the source either.
      const serverMillis = value.toDate().getTime();
      assert.ok(
        serverMillis >= before - 60_000 && serverMillis <= after + 60_000,
        `the server timestamp ${value.isoValue} is outside the run window`,
      );
      assert.equal(stored.data['name'], 'طابع الخادم', 'the ordinary sibling field must be written too');
      context.diagnostic(`Firestore generated ${value.isoValue} (local clock was NOT used)`);
    });

    it('D2. a masked server-timestamp update keeps the other fields intact', async (context) => {
      // Seed the FULL document first, so a masked transform that wrongly cleared
      // a sibling field would be immediately visible.
      await harness.seedDocument('medicines/med-ts-server', {
        name: 'طابع الخادم',
        stock: 100,
        maxQuantity: 5,
        totalInward: 250,
        totalOutward: 150,
      });

      await expectAllowed(
        'admin updates processedAt via a transform with an explicit mask',
        'admin',
        'POST :commit (updateMask=[processedAt], REQUEST_TIME)',
        admin.client.commitWrites([
          {
            relativePath: 'medicines/med-ts-server',
            data: { processedAt: SERVER_TIMESTAMP },
            kind: 'update',
            updateMaskPaths: ['processedAt'],
          },
        ]),
      );

      const stored = await admin.client.getDocument('medicines/med-ts-server');
      assert.ok(stored.data['processedAt'] instanceof FirestoreTimestamp);
      assert.equal(stored.data['name'], 'طابع الخادم', 'the mask must not clear the sibling field');
      assert.equal(stored.data['stock'], 100, 'the mask must not clear other seeded fields');
      assert.equal(stored.data['maxQuantity'], 5);
      assert.equal(stored.data['totalInward'], 250);
      assert.equal(stored.data['totalOutward'], 150);
      context.diagnostic('a transform-only masked update added ONE field and cleared nothing');
    });
  });

  // ============================ Stage 5A: masks/transforms inside transactions
  describe('Stage 5A: updateMask and transforms inside a transaction (E, F)', () => {
    it('E. a masked partial update inside a transaction preserves unrelated fields', async (context) => {
      const transaction = await admin.client.beginTransaction();

      const read = await expectAllowed(
        'admin reads the document inside the transaction',
        'admin',
        'POST :batchGet (transaction)',
        admin.client.batchGetDocuments(['medicines/med-mask-tx'], transaction),
      ) as readonly (FirestoreDocument | null)[];
      assert.ok(read[0] !== null, 'the transactional read must return the document');

      await expectAllowed(
        'admin commits a masked partial update inside the transaction',
        'admin',
        'POST :commit (transaction, updateMask=[stock])',
        admin.client.commitWrites(
          [{ relativePath: 'medicines/med-mask-tx', data: { stock: 13 }, kind: 'update' }],
          transaction,
        ),
      );

      const after = await admin.client.getDocument('medicines/med-mask-tx');
      assert.equal(after.data['stock'], 13, 'the masked field must be written');
      assert.equal(after.data['name'], 'باراسيتامول ٥٠٠', 'name must survive a transactional masked update');
      assert.equal(after.data['maxQuantity'], 5);
      assert.equal(after.data['totalInward'], 250);
      assert.equal(after.data['totalOutward'], 150);
      context.diagnostic('a transactional masked update touched only the masked field');
    });

    it('F. a server timestamp written inside a transaction is a real timestamp', async (context) => {
      const transaction = await admin.client.beginTransaction();

      await expectAllowed(
        'admin commits a server timestamp inside the transaction',
        'admin',
        'POST :commit (transaction, REQUEST_TIME)',
        admin.client.commitWrites(
          [{
            relativePath: 'medicines/med-ts-tx',
            data: { processedAt: SERVER_TIMESTAMP },
            kind: 'update',
            updateMaskPaths: ['processedAt'],
          }],
          transaction,
        ),
      );

      const stored = await admin.client.getDocument('medicines/med-ts-tx');
      const value = stored.data['processedAt'];
      assert.ok(value instanceof FirestoreTimestamp, `expected a FirestoreTimestamp, got ${typeof value}`);
      assert.notEqual(value.isoValue, 'REQUEST_TIME');
      assert.equal(stored.data['name'], 'باراسيتامول ٥٠٠', 'the transaction must not clear sibling fields');
      assert.equal(stored.data['stock'], 100);
      context.diagnostic(`transactional server timestamp = ${value.isoValue}`);
    });
  });

  // ================================= Stage 5A: controlled failure, no silent change
  describe('Stage 5A: unsafe writes fail without changing data (G)', () => {
    it('G1. a delete-shaped mask is rejected locally and changes nothing', async (context) => {
      const before = await admin.client.getDocument('medicines/med-mask-partial');

      const error = await admin.client.commitWrites([
        {
          relativePath: 'medicines/med-mask-partial',
          data: { stock: 1 },
          kind: 'update',
          updateMaskPaths: ['stock', 'name'],
        },
      ]).then(
        () => null,
        (thrown: unknown) => thrown,
      );

      assert.ok(error instanceof FirestoreRestError, 'a typed client error is expected');
      assert.equal(error.requestSent, false, 'the request must never leave the process');
      assert.equal(error.reason, 'INVALID_ARGUMENT');

      const after = await admin.client.getDocument('medicines/med-mask-partial');
      const unchanged = JSON.stringify(after.data) === JSON.stringify(before.data);
      assert.equal(unchanged, true, 'a refused write must not change the document at all');

      recordDecision({
        testCase: 'delete-shaped mask refused locally, document unchanged',
        actor: 'admin',
        request: 'POST :commit (never sent)',
        expected: 'typed INVALID_ARGUMENT, requestSent=false, no data change',
        observed: `requestSent=${String(error.requestSent)}, unchanged=${String(unchanged)}`,
        matched: error.requestSent === false && unchanged,
      });
      context.diagnostic('a delete-shaped mask was refused locally and changed nothing');
    });

    it('G2. an unmasked upsert that would wipe fields is still a full replace (documented)', async (context) => {
      // Proves the C5 fix did NOT silently convert every write into a partial
      // one: an upsert without a mask keeps its full-replacement semantics.
      await expectAllowed(
        'admin creates a masked order document',
        'admin',
        'POST :commit (create)',
        admin.client.commitWrites([
          {
            relativePath: 'orders/order-mask-create',
            data: { userId: employeeAUid, total: 2.5, status: 'final' },
            kind: 'create',
          },
        ]),
      );

      const stored = await admin.client.getDocument('orders/order-mask-create');
      assert.deepEqual(Object.keys(stored.data).sort(), ['status', 'total', 'userId']);
      context.diagnostic('create semantics are unchanged by the mask work');
    });

    it('G3. the emulator ACCEPTS an empty PATCH body and really wipes the document', async (context) => {
      // This is the exact hazard Stage 5A protects against, demonstrated against
      // the real emulator: an update body with no fields is NOT rejected by
      // Firestore - it is accepted (HTTP 200) and every field is destroyed.
      //
      // The client is therefore the only line of defence, which is why
      // patchDocument/commitWrites refuse such a write before sending it.
      await harness.seedDocument('medicines/med-mask-wipe-probe', {
        name: 'دواء محمي',
        stock: 11,
        maxQuantity: 3,
        totalInward: 20,
        totalOutward: 9,
      });
      const before = await admin.client.getDocument('medicines/med-mask-wipe-probe');
      assert.equal(Object.keys(before.data).length, 5, 'the probe must start with a full document');

      // Raw request, deliberately bypassing the client guard.
      const result = await harness.rawRequest('medicines/med-mask-wipe-probe', {
        method: 'PATCH',
        token: admin.idToken,
        body: { fields: {} },
      });
      assert.equal(result.status, 200, `the emulator accepts an empty body (observed HTTP ${result.status})`);

      const after = await admin.client.getDocument('medicines/med-mask-wipe-probe');
      assert.equal(
        Object.keys(after.data).length,
        0,
        'an empty update body really does erase every field - the server does not protect us',
      );

      recordDecision({
        testCase: 'raw empty PATCH wipes the document (server-side hazard confirmed)',
        actor: 'admin (raw REST, client guard bypassed)',
        request: 'PATCH (raw, empty fields)',
        expected: 'observed: HTTP 200 and all fields deleted',
        observed: `HTTP ${result.status}, ${Object.keys(after.data).length} field(s) left`,
        matched: result.status === 200 && Object.keys(after.data).length === 0,
      });
      context.diagnostic(
        'an unguarded empty PATCH is accepted by Firestore and DELETES every field - '
        + 'this is precisely why the client refuses empty writes locally',
      );
    });

    it('G3b. the client refuses that same empty write before it can wipe anything', async (context) => {
      await harness.seedDocument('medicines/med-mask-wipe-probe', {
        name: 'دواء محمي',
        stock: 11,
        maxQuantity: 3,
        totalInward: 20,
        totalOutward: 9,
      });

      const error = await admin.client.patchDocument('medicines/med-mask-wipe-probe', {}).then(
        () => null,
        (thrown: unknown) => thrown,
      );

      assert.ok(error instanceof FirestoreRestError, 'the client must refuse the empty patch');
      assert.equal(error.requestSent, false, 'the request must never be sent');
      assert.equal(error.reason, 'INVALID_ARGUMENT');

      const after = await admin.client.getDocument('medicines/med-mask-wipe-probe');
      assert.equal(Object.keys(after.data).length, 5, 'the document must be fully intact');
      context.diagnostic('the client-side guard prevented the wipe the raw call performed');
    });

    it('G4. a malformed field path never reaches the network', async (context) => {
      const error = await admin.client.commitWrites([
        {
          relativePath: 'medicines/med-mask-multi',
          data: { stock: 1 },
          kind: 'update',
          updateMaskPaths: ['stock..name'],
        },
      ]).then(
        () => null,
        (thrown: unknown) => thrown,
      );

      assert.ok(error instanceof FirestoreRestError, 'a typed client error is expected');
      assert.equal(error.requestSent, false, 'a malformed mask must be caught before any request');
      assert.equal(error.reason, 'INVALID_ARGUMENT');
      context.diagnostic(`malformed field path refused locally: ${error.message}`);
    });
  });

  // ============================================================= evidence report

  describe('evidence report', () => {
    it('every rules decision observed during the run matched the expectation', (context) => {
      const mismatched = observedDecisions.filter((decision) => !decision.matched);

      context.diagnostic(`${observedDecisions.length} rules decisions observed against the real emulator`);
      for (const decision of observedDecisions) {
        context.diagnostic(
          `${decision.matched ? 'OK      ' : 'MISMATCH'} | ${decision.actor} | ${decision.request} `
          + `| expected ${decision.expected} | observed ${decision.observed}`,
        );
      }

      assert.equal(mismatched.length, 0, `unexpected rule decisions: ${JSON.stringify(mismatched)}`);
      assert.ok(
        observedDecisions.length >= 40,
        `expected a substantial decision table, observed ${observedDecisions.length}`,
      );
    });

    it('cleans up the documents the suite created', async () => {
      await harness.flush([...suiteDocuments, `users/${employeeFreshUid}`, 'users/ghost-uid-0001']);
    });
  });
});








