/**
 * Stage 9 - user management against the REAL Firestore Security Rules.
 *
 * Stage 5B already proved an employee is refused `approveUser`. This suite adds
 * the coverage Stage 9 actually depends on, because the users SCREEN exposes
 * five distinct writes and one reader:
 *
 *   1. an admin can rename, approve, reject, grant and revoke
 *   2. an ASSISTANT can do the same - firestore.rules defines isAdmin() as
 *      admin OR assistant, so treating them differently would be a bug
 *   3. an employee is refused EVERY one of them, with the document unchanged
 *   4. a masked write does not erase the `lastOrder*` summary
 *   5. the denial is produced by the RULES, not by the client
 *
 * Point 5 matters most. The Windows UI disables its edit buttons for a
 * non-manager as a USABILITY measure; this suite proves the server refuses
 * regardless, so that convenience can never become the authority. Every
 * "employee" call below goes through the SAME repository an admin would use -
 * the only difference is whose token is attached.
 *
 * Nothing is mocked and no production project is involved.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '../../electron/domain/errors';
import { FirestoreTimestamp } from '../../electron/services/firestore-codec';
import { FirestoreUsersRepository } from '../../electron/repositories/firestore/users-repository';
import {
  DEMO_PASSWORD,
  EmulatorHarness,
  type ActorSession,
  probeEmulators,
  readEmulatorEnvironment,
} from '../helpers/firestore-emulator-harness';

/** The Arabic-Indic form a real production document actually stores (conflict D1). */
const D1_LEGACY_MONTH = '\u0660\u0666-\u0662\u0660\u0662\u0666';

describe('Stage 9 users on the REAL Firestore Rules (isolated suite)', async () => {
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

  const adminUid = await harness.ensureAuthUser('admin.stage9@drug-manager.demo', DEMO_PASSWORD);
  const assistantUid = await harness.ensureAuthUser('assistant.stage9@drug-manager.demo', DEMO_PASSWORD);
  const employeeUid = await harness.ensureAuthUser('employee.stage9@drug-manager.demo', DEMO_PASSWORD);
  const targetUid = await harness.ensureAuthUser('target.stage9@drug-manager.demo', DEMO_PASSWORD);

  const userPaths: readonly string[] = [
    `users/${adminUid}`, `users/${assistantUid}`, `users/${employeeUid}`, `users/${targetUid}`,
  ];
  await harness.flush(userPaths);

  await harness.seedUserProfile({
    uid: adminUid, name: 'Manager', employeeId: 'EMP-000', role: 'admin', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: assistantUid, name: 'Assistant', employeeId: 'EMP-100', role: 'assistant', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: employeeUid, name: 'Employee', employeeId: 'EMP-200', role: 'employee', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: targetUid, name: 'Target', employeeId: 'EMP-300', role: 'employee', status: 'pending', hasException: false,
  });

  // An order summary the Stage 6 processor would have written.
  const summaryDate = FirestoreTimestamp.fromDate(new Date('2026-06-01T08:00:00Z'));

  /**
   * Seeds the target profile AND its order summary in ONE call.
   *
   * The harness seeds through the emulator's owner bypass, which issues a
   * `PATCH` with NO update mask - and a mask-less PATCH REPLACES the document
   * rather than merging into it (the very hazard Stage 5A C5 documents). Two
   * sequential seeds would therefore erase each other, which is exactly what
   * happened the first time this suite ran. One complete document, one write.
   */
  const seedTarget = async (overrides: Record<string, unknown> = {}): Promise<void> => {
    await harness.seedDocument(`users/${targetUid}`, {
      uid: targetUid,
      name: 'Target',
      employeeId: 'EMP-300',
      role: 'employee',
      status: 'pending',
      hasException: false,
      // An order summary the Stage 6 processor would have written. Every
      // assertion below checks that it SURVIVES a Stage 9 administrative write.
      lastOrderId: 'stage9-order-1',
      lastOrderDate: summaryDate,
      lastOrderMonthYear: '06-2026',
      lastOrderStatus: 'pending',
      lastOrderIsException: false,
      ...overrides,
    });
  };
  await seedTarget();

  const admin: ActorSession = await harness.openSession('admin.stage9@drug-manager.demo', DEMO_PASSWORD);
  const assistant: ActorSession = await harness.openSession('assistant.stage9@drug-manager.demo', DEMO_PASSWORD);
  const employee: ActorSession = await harness.openSession('employee.stage9@drug-manager.demo', DEMO_PASSWORD);

  const adminUsers = new FirestoreUsersRepository({ client: admin.client });
  const assistantUsers = new FirestoreUsersRepository({ client: assistant.client });
  const employeeUsers = new FirestoreUsersRepository({ client: employee.client });
it('an admin CAN rename, and the order summary is NOT erased', async () => {
    await seedTarget();

    await adminUsers.renameUser(targetUid, 'Renamed');

    const read = await adminUsers.getUser(targetUid);
    assert.equal(read?.name, 'Renamed');
    assert.equal(read?.lastOrderId, 'stage9-order-1', 'a masked write must not erase lastOrderId');
    assert.equal(read?.lastOrderMonthYear, '06-2026');
  });

  it('an admin CAN approve and reject', async () => {
    await seedTarget();

    await adminUsers.approveUser(targetUid);
    assert.equal((await adminUsers.getUser(targetUid))?.status, 'approved');

    await adminUsers.rejectUser(targetUid);
    assert.equal((await adminUsers.getUser(targetUid))?.status, 'rejected');
  });

  it('an admin CAN grant and revoke the single-order exception', async () => {
    await seedTarget();

    await adminUsers.grantSingleOrderException(targetUid);
    assert.equal((await adminUsers.getUser(targetUid))?.hasException, true);

    await adminUsers.revokeSingleOrderException(targetUid);
    assert.equal((await adminUsers.getUser(targetUid))?.hasException, false);
  });

  it('an ASSISTANT can do the same, because isAdmin() covers both roles', async () => {
    await seedTarget();

    // firestore.rules defines isAdmin() as `role == 'admin' || role ==
    // 'assistant'`. A client that treated them differently would be wrong.
    await assistantUsers.renameUser(targetUid, 'Renamed by assistant');
    await assistantUsers.approveUser(targetUid);
    await assistantUsers.grantSingleOrderException(targetUid);

    const read = await assistantUsers.getUser(targetUid);
    assert.equal(read?.name, 'Renamed by assistant');
    assert.equal(read?.status, 'approved');
    assert.equal(read?.hasException, true);
    assert.equal(read?.lastOrderId, 'stage9-order-1', 'the summary survives an assistant write too');
  });

  it('an ASSISTANT CAN list every user', async () => {
    const all = await assistantUsers.listAllUsers();
    assert.ok(all.length >= 4, 'the assistant should see the whole collection');
  });

  it('an employee is refused EVERY administrative write, as a typed DomainError', async () => {
    await seedTarget();

    // The SAME repository an admin uses - only the token differs. If the client
    // were substituting for the rules, these would all succeed.
    const attempts: readonly (readonly [string, () => Promise<void>])[] = [
      ['renameUser', () => employeeUsers.renameUser(targetUid, 'Hacked')],
      ['approveUser', () => employeeUsers.approveUser(targetUid)],
      ['rejectUser', () => employeeUsers.rejectUser(targetUid)],
      ['grantSingleOrderException', () => employeeUsers.grantSingleOrderException(targetUid)],
      ['revokeSingleOrderException', () => employeeUsers.revokeSingleOrderException(targetUid)],
    ];

    for (const [label, attempt] of attempts) {
      await assert.rejects(attempt, (error: unknown) => {
        assert.ok(error instanceof DomainError, `${label} must raise a DomainError`);
        assert.equal(error.kind, 'NOT_AUTHORIZED', `${label} must be refused as NOT_AUTHORIZED`);
        return true;
      });
    }
  });

  it('the employee denial did NOT change the target document', async () => {
    const read = await adminUsers.getUser(targetUid);

    assert.equal(read?.name, 'Target');
    assert.equal(read?.status, 'pending');
    assert.equal(read?.hasException, false);
    assert.equal(read?.employeeId, 'EMP-300', 'a frozen field must be unchanged');
  });

  it('an employee is refused the user LIST, so no empty page is shown instead', async () => {
    // The UI distinguishes "denied" from "no users"; that distinction has to be
    // real, so the refusal must actually come back.
    await assert.rejects(employeeUsers.listAllUsers(), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.kind, 'NOT_AUTHORIZED');
      return true;
    });
  });

  it('an employee CAN still read its OWN profile', async () => {
    const own = await employeeUsers.getUser(employeeUid);

    // This asymmetry is deliberate in the Rules and the shell depends on it: the
    // signed-in employee must still be able to render their own identity.
    assert.equal(own?.name, 'Employee');
  });

  it('a D1 legacy month survives an administrative rename unchanged', async () => {
    // A real production document stores Arabic-Indic digits. An administrative
    // edit must not "tidy" it, because tidying a read is a migration.
    await seedTarget({ lastOrderMonthYear: D1_LEGACY_MONTH });

    await adminUsers.renameUser(targetUid, 'Renamed again');

    const read = await adminUsers.getUser(targetUid);
    assert.equal(read?.lastOrderMonthYear, D1_LEGACY_MONTH);
    assert.equal(read?.name, 'Renamed again');
    assert.equal(read?.lastOrderId, 'stage9-order-1', 'the rest of the summary must also survive');
  });

  it('removes every document the suite created', async () => {
    await harness.flush(userPaths);
  });
});