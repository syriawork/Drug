/**
 * Stage 13 - System Settings against the REAL Firestore emulator.
 *
 * WHY THIS SUITE IS NOT A UNIT TEST
 * Stage 13 adds a PAGE, no backend code: the read path already existed. What no
 * fakes-based suite can answer is whether the REAL Android rules allow that read,
 * and whether an absent document is genuinely reported as absent rather than
 * silently substituted. Only the emulator answers it, because the answer depends on
 * a rules file this suite must not modify.
 *
 * THE FOUR QUESTIONS THAT MATTER
 *  1. Can an admin really read `settings/app`?
 *  2. Can an EMPLOYEE really read it too? The rules say any authenticated user may
 *     read, so a rule tightened to admins-only would break this page for every
 *     employee who opens it - and only the emulator would notice.
 *  3. Does an ABSENT document read as absent, rather than as a page of invented
 *     defaults that look stored?
 *  4. Does NOTHING this stage does WRITE? The document is read back through raw REST
 *     before and after, so the read-only claim rests on observed bytes rather than on
 *     the absence of a code path somebody remembered to check.
 *
 * NO FAKE REPOSITORY. `FirestoreSettingsRepository` is the production class wired
 * exactly as `main.ts` wires it, so a stand-in could never fail here.
 *
 * The rules fingerprint is pinned in the final section, so a suite that "passed"
 * against edited rules fails loudly instead of quietly proving something else.
 *
 * No production project is involved: the project id is a "demo-" id that Firebase
 * can only resolve locally.
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
  FirestoreStockLogsRepository,
  FirestoreSettingsRepository,
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

const ADMIN_EMAIL = 'admin.stage13@drug-manager.demo';
const EMPLOYEE_EMAIL = 'employee.stage13@drug-manager.demo';

let harness: EmulatorHarness;
let admin: ActorSession;
let employee: ActorSession;
let adminUid = '';
let employeeUid = '';

/** Every document this suite creates, so the flush between cases is exact. */
const suiteDocuments: string[] = [];

/** The single settings document the whole suite reads. */
const SETTINGS_PATH = 'settings/app';

/**
 * The stored document.
 *
 * Every value differs from the fallbacks (15 / 06:00 / 10:00) and from the other
 * fields, so a projection that substituted a default - or shifted a value into its
 * neighbour - could not pass.
 */
const STORED = {
  minDaysBetweenOrders: 7,
  maxDailyOrders: 42,
  allowFridayOrders: true,
  startTime: '07:30',
  endTime: '15:45',
  assistantId: 'EMP-777',
} as const;

/**
 * Builds the application the way `main.ts` does, for one session.
 *
 * Only the `session` is narrowed to the actor's safe state, because the emulator
 * session already holds the token in Main-only memory and the application layer must
 * never see one.
 */
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
        displayName: role === 'admin' ? 'المدير' : 'موظف',
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

    // Stage 14: wired so the audit screen can be built, never used by these suites.

    stockLogsRepository: new FirestoreStockLogsRepository(context),
  // Stage 15: real factory, so the receipt path is buildable; these suites never call it.
  inboundStockTransactionFactory: createInboundStockTransactionFactory(session.client),
    orderProcessing: new FirestoreOrderProcessingService(
      createOrderProcessingTransactionFactory(session.client),
    ),
  });
}

/** Reads `settings/app` through raw REST as the emulator owner, bypassing the rules. */
async function storedBytes(): Promise<Record<string, unknown> | null> {
  return harness.readAsEmulatorOwner(SETTINGS_PATH);
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

  await harness.seedDocument(SETTINGS_PATH, { ...STORED });
  suiteDocuments.push(SETTINGS_PATH);
});

after(async () => {
  await harness.flush(suiteDocuments);
});
describe('Stage 13 requirement 6: the settings read is permitted by the REAL rules', () => {
  it('lets an admin read the stored document', async () => {
    const result = await applicationFor(admin, 'admin').manager.getSettings();

    assert.equal(result.ok, true, 'an admin must be able to read settings/app');
    assert.deepEqual(result.ok ? result.value : null, { ...STORED, configured: true });
  });

  it('lets an EMPLOYEE read it too, exactly as the rules state', async () => {
    // The rules grant `read` to any authenticated user, not only admins. A rule
    // quietly tightened to admins-only would leave every employee who opens this
    // page staring at an error, and only the emulator would say so.
    const result = await applicationFor(employee, 'employee').manager.getSettings();

    assert.equal(result.ok, true, 'the rules allow any authenticated user to read settings');
    assert.deepEqual(result.ok ? result.value : null, { ...STORED, configured: true });
  });

  it('returns the stored values verbatim, in every field', async () => {
    // Asserted field by field and against the RAW document, so a projection that
    // renamed, coerced or shifted a value into a neighbour could not pass.
    const stored = await storedBytes();
    const result = await applicationFor(admin, 'admin').manager.getSettings();
    const view = result.ok ? result.value : null;

    for (const [field, value] of Object.entries(STORED)) {
      assert.equal(stored?.[field], value, `the document must really hold ${field}`);
      assert.equal(view?.[field as keyof typeof STORED], value, `${field} must reach the page as stored`);
    }
    assert.equal(view?.configured, true, 'a stored document must be reported as configured');
  });

  it('reports an ABSENT document as absent, with no invented values', async () => {
    // The most important read on this page. A page that showed the fallbacks as if
    // they were stored would let a manager believe a configuration that does not
    // exist, which is precisely what the advisory banner exists to prevent.
    await harness.deleteDocument(SETTINGS_PATH);

    const result = await applicationFor(admin, 'admin').manager.getSettings();

    assert.equal(result.ok, true, 'an absent document is not an error');
    assert.equal(
      result.ok ? result.value.configured : null,
      false,
      'the page must be told the document is missing',
    );
    // `configured === false` is what raises the banner. Values without that flag
    // would be a lie; a bare `null` document plus a false flag is the honest shape.
    assert.equal(await storedBytes(), null, 'the document must really be absent');
  });
});
describe('Stage 13 requirement 11: reading the settings changes nothing', () => {
  it('leaves every stored byte exactly as it was', async () => {
    await harness.seedDocument(SETTINGS_PATH, { ...STORED });

    const before = await storedBytes();
    const application = applicationFor(admin, 'admin');

    for (let read = 0; read < 3; read += 1) {
      const result = await application.manager.getSettings();
      assert.equal(result.ok, true);
    }

    // Three reads, and the document is byte-identical. The read-only claim rests on
    // observed bytes, not on the absence of a code path somebody remembered to check.
    assert.deepEqual(await storedBytes(), before, 'reading must not change a single field');
    assert.deepEqual(before, { ...STORED }, 'and the fixture must be what was seeded');
  });

  it('still changes nothing when the document is absent', async () => {
    await harness.deleteDocument(SETTINGS_PATH);

    const result = await applicationFor(admin, 'admin').manager.getSettings();

    assert.equal(result.ok, true);
    // The failure branch must not create the document it did not find - a very easy
    // thing for a "save the defaults" fallback to do silently.
    assert.equal(await storedBytes(), null, 'reading an absent document must not create it');
  });

  it('records that the RULES would permit an admin write, so the page design carries the weight', async () => {
    // The rules allow `write` for admins, so the SERVER would accept a write from an
    // admin. That is exactly why the read-only claim cannot rest on the rules alone:
    // it rests on the page having no channel to try. This asserts the half the rules
    // CAN prove, so a later change making settings admin-editable would be visible
    // here as the deliberate gap it is.
    const response = await harness.rawRequest(SETTINGS_PATH, {
      method: 'PATCH',
      token: admin.idToken,
      body: { fields: { minDaysBetweenOrders: { integerValue: '1' } } },
    });

    assert.equal(
      response.status < 300,
      true,
      'the rules permit an admin write, as recorded; the page is read-only by design, not by rule',
    );
    // Restore the fixture the assertion just changed, so the no-write proof above it
    // is not silently invalidated for anyone reading this file top to bottom.
    await harness.seedDocument(SETTINGS_PATH, { ...STORED });
  });
});
describe('Stage 13: the emulator ran the established rules', () => {
  /**
   * The fingerprint of the authoritative Android rules.
   *
   * ANY edit to the rules - by this stage or a later one - fails loudly instead of
   * silently changing the security posture the suite just proved.
   *
   * Stored in UPPER CASE, matching the recorded value. `digest('hex')` emits lower
   * case, so the helper folds its output to upper case instead. Case carries no
   * meaning for a hex digest, so folding it cannot weaken the comparison: all 64
   * characters must match exactly.
   */
  const ESTABLISHED_RULES_SHA256 =
    '1FA3C6076BBA8DA4F0E10138B9E61E62257943C3C689B01964F4EAB402CDC63B';

  function sha256Of(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
  }

  it('matches the established fingerprint exactly', () => {
    const projectRoot = join(__dirname, '..', '..', '..');
    const labRules = join(projectRoot, 'emulator-lab', 'firestore.rules');

    assert.equal(existsSync(labRules), true, 'the lab rules copy must exist');
    assert.equal(sha256Of(labRules), ESTABLISHED_RULES_SHA256);
  });

  it('the lab copy is byte-identical to the authoritative Android rules', () => {
    const projectRoot = join(__dirname, '..', '..', '..');
    const labRules = join(projectRoot, 'emulator-lab', 'firestore.rules');
    const androidRules = process.env['DRUG_MANAGER_ANDROID_RULES_PATH']
      ?? join('E:', 'programs and applications', 'mobile', 'drug', 'firestore.rules');

    // The suite is only meaningful if the emulator ran the REAL Android rules, not
    // an edited copy. When the Android file is absent (a machine without the mobile
    // project) the comparison is skipped rather than faked.
    if (!existsSync(androidRules)) {
      return;
    }
    assert.equal(sha256Of(labRules), sha256Of(androidRules), 'the lab copy must be the Android rules');
    assert.equal(sha256Of(androidRules), ESTABLISHED_RULES_SHA256);
  });
});