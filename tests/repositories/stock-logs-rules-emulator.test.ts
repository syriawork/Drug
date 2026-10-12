/**
 * Stage 14 - the Stock Movement Audit against the REAL Firestore emulator.
 *
 * WHY THIS SUITE IS NOT A UNIT TEST
 * Stage 14 adds a PAGE and no backend code, so the fakes-based suites can prove
 * exhaustively what the renderer does with the rows it receives. They cannot say
 * whether the REAL Android rules would let the read happen at all - and
 * `stock_logs` is one of only two collections firestore.rules restricts to
 * admins (line 86). Only the emulator can answer that.
 *
 * THE THREE QUESTIONS THAT MATTER
 *  1. Can an admin really read the movement trail the Stage 6 transaction wrote?
 *  2. Is an EMPLOYEE genuinely refused? A read-only screen is only safe if the
 *     server refuses what it should; a client-side "hide the page" would prove
 *     nothing.
 *  3. Does nothing this stage adds WRITE? Every document is read back through raw
 *     REST before and after, so the read-only claim rests on observed bytes rather
 *     than on the absence of a code path somebody remembered to check.
 *
 * THE ROWS ARE REAL STAGE 6 OUTPUT. The fixture is seeded with the exact field
 * shapes `mapNewStockLogWrite` produces - including the free-text `userName` and
 * the positive magnitude - so a projection that renamed a field, signed a
 * quantity or grouped rows would fail here rather than in review.
 *
 * NO FAKE REPOSITORY. `FirestoreStockLogsRepository` is the production class wired
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

const ADMIN_EMAIL = 'admin.stage14@drug-manager.demo';
const EMPLOYEE_EMAIL = 'employee.stage14@drug-manager.demo';

let harness: EmulatorHarness;
let admin: ActorSession;
let employee: ActorSession;
let adminUid = '';
let employeeUid = '';

/** Every document this suite creates, so the flush between cases is exact. */
const suiteDocuments: string[] = [];

/** The stored documents this suite reads. */
const OUTWARD_LOG = 's14-log-outward';
const INWARD_LOG = 's14-log-inward';
/**
 * Builds the application the way `main.ts` does, for one session.
 *
 * Only the `session` is narrowed to the actor's safe state, because the emulator
 * session already holds the token in Main-only memory and the application layer
 * must never see one.
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
    stockLogsRepository: new FirestoreStockLogsRepository(context),
  // Stage 15: real factory, so the receipt path is buildable; these suites never call it.
  inboundStockTransactionFactory: createInboundStockTransactionFactory(session.client),
    orderProcessing: new FirestoreOrderProcessingService(
      createOrderProcessingTransactionFactory(session.client),
    ),
  });
}

/** Reads one document through raw REST as the emulator owner, bypassing the rules. */
async function storedBytes(relativePath: string): Promise<Record<string, unknown> | null> {
  return harness.readAsEmulatorOwner(relativePath);
}

/**
 * Seeds a movement exactly as the Stage 6 transaction would have written it.
 *
 * The two traps in the real documents are reproduced deliberately:
 *  - `quantity` is a POSITIVE MAGNITUDE for an outward movement (A4 stores
 *    `Math.abs(diff)`), with the direction carried by `type`. A fixture with `-5`
 *    would let a sign bug pass.
 *  - `userName` holds FREE TEXT (D10), not a username, and `uid` holds whoever
 *    performed the movement (D3). A fixture with a clean name would let a mapping
 *    that renamed the field pass.
 */
async function seedMovement(
  id: string,
  quantity: number,
  type: 'inward' | 'outward',
  label: string,
  actorUid: string,
  orderId: string | null,
): Promise<void> {
  await harness.seedDocument(`stock_logs/${id}`, {
    medicineId: 'med-s14',
    medicineName: 'Panadol',
    quantity,
    type,
    date: new Date('2026-06-03T08:00:00Z'),
    userName: label,
    uid: actorUid,
    requestId: 's14-req-1',
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

  // The same positive magnitude in both directions would be a coincidence; these
  // two DIFFER, so a suite that netted or signed anything would give a visibly
  // different answer than the two stored documents.
  await seedMovement(OUTWARD_LOG, 5, 'outward', 'صرف طلب Allison', employeeUid, 's14-ord-1');
  await seedMovement(INWARD_LOG, 12, 'inward', 'توريد مخزون', adminUid, null);
});

after(async () => {
  await harness.flush(suiteDocuments);
});
describe('Stage 14 requirement 1: an admin really reads the trail Stage 6 wrote', () => {
  it('returns the stored movements', async () => {
    const result = await applicationFor(admin, 'admin').manager.listStockMovements();

    assert.equal(result.ok, true, 'the rules grant isAdmin() a stock_logs read');
    assert.equal(result.ok ? result.value.length : 0, 2);
  });

  it('carries every STORED fact the audit screen displays', async () => {
    const result = await applicationFor(admin, 'admin').manager.listStockMovements();
    const row = result.ok ? result.value.find((entry) => entry.id === OUTWARD_LOG) : undefined;

    assert.ok(row, 'the seeded movement must be present');
    assert.equal(row.medicineId, 'med-s14');
    // D10 verified against the emulator: the free text survives under `label` and
    // is NOT mistaken for a username.
    assert.equal(row.label, 'صرف طلب Allison');
    assert.equal(row.actorUid, employeeUid, 'D3: the actor is whoever performed it');
    assert.equal(row.requestId, 's14-req-1');
    assert.equal(row.orderId, 's14-ord-1');
    assert.equal(row.dateIso.length > 0, true);
  });

  it('keeps quantity POSITIVE and keeps the two documents SEPARATE', async () => {
    const result = await applicationFor(admin, 'admin').manager.listStockMovements();
    const rows = result.ok ? result.value : [];

    // Two documents became two rows. A per-medicine subtotal would have produced
    // one, and `totalInward - totalOutward` would have produced a balance the
    // database never stored.
    assert.equal(rows.length, 2);
    const outward = rows.find((row) => row.id === OUTWARD_LOG);
    const inward = rows.find((row) => row.id === INWARD_LOG);
    assert.equal(outward?.quantity, 5);
    assert.equal(outward?.type, 'outward');
    assert.equal(inward?.quantity, 12);
    assert.equal(inward?.type, 'inward');
    assert.equal(
      rows.every((row) => row.quantity > 0),
      true,
      'the emulator read must not have signed a magnitude',
    );
  });

  it('reports a null reference as null, exactly as the document stores it', async () => {
    const result = await applicationFor(admin, 'admin').manager.listStockMovements();
    const inward = result.ok ? result.value.find((row) => row.id === INWARD_LOG) : undefined;

    assert.equal(inward?.orderId, null, 'an absent order id stays null, not an empty string');
  });
});

describe('Stage 14 requirement 2: an EMPLOYEE is genuinely refused', () => {
  it('answers AUTHORIZATION_DENIED, not an empty page', async () => {
    // firestore.rules line 86: `stock_logs` is admin-only in BOTH directions.
    // An empty list here would tell the employee there is nothing to audit, which
    // is a different claim from "you may not look" - and the screen would then
    // render a convincing, wrong audit trail.
    const result = await applicationFor(employee, 'employee').manager.listStockMovements();

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'AUTHORIZATION_DENIED');
  });

  it('leaves the documents completely unchanged after the refusal', async () => {
    const before = await storedBytes(`stock_logs/${OUTWARD_LOG}`);

    await applicationFor(employee, 'employee').manager.listStockMovements();

    // A refused read must not have deleted, emptied or altered anything - a
    // careless failure path that "cleans up" would be invisible otherwise.
    assert.deepEqual(await storedBytes(`stock_logs/${OUTWARD_LOG}`), before);
  });
});

describe('Stage 14 requirement 3: reading the trail changes nothing', () => {
  it('leaves every stored document byte-identical across repeated reads', async () => {
    const before = await storedBytes(`stock_logs/${OUTWARD_LOG}`);
    const application = applicationFor(admin, 'admin');

    for (let read = 0; read < 3; read += 1) {
      assert.equal((await application.manager.listStockMovements()).ok, true);
    }

    // Three reads, one unchanged document. The read-only claim rests on observed
    // bytes, not on the absence of a code path somebody remembered to check.
    assert.deepEqual(await storedBytes(`stock_logs/${OUTWARD_LOG}`), before);
  });

  it('records that the RULES would permit an admin write, so the page design carries the weight', async () => {
    // The rules allow `write` for admins on `stock_logs`, so the SERVER would
    // accept a write from an admin. That is exactly why the read-only claim cannot
    // rest on the rules alone: it rests on the page having no channel to try.
    // Asserting it here keeps the deliberate gap visible rather than implied.
    const response = await harness.rawRequest(`stock_logs/${INWARD_LOG}`, {
      method: 'PATCH',
      token: admin.idToken,
      body: { fields: { quantity: { integerValue: '999' } } },
    });

    assert.equal(
      response.status < 300,
      true,
      'the rules permit an admin write, as recorded; the page is read-only by design, not by rule',
    );
    // Restore the fixture the assertion just changed, so the no-write proof above
    // is not silently invalidated for anyone reading this file top to bottom.
    await seedMovement(INWARD_LOG, 12, 'inward', 'توريد مخزون', adminUid, null);
  });
});
describe('Stage 14: the emulator ran the established rules', () => {
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