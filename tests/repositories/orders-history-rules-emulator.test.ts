/**
 * Stage 12 - Orders History against the REAL Firestore emulator.
 *
 * WHY THIS SUITE IS NOT A UNIT TEST
 * Stage 12 adds one READ. The interesting claim is not what the code does with the
 * rows - the Stage 12 unit suites cover that exhaustively - but whether the REAL
 * Android rules would actually let this read happen. Only the emulator can answer
 * that, because the answer depends on a rules file this suite must not modify.
 *
 * THE THREE QUESTIONS THAT MATTER
 *  1. Can an admin really list EVERY order, across employees?
 *  2. Is an employee's UNFILTERED list genuinely refused by the rules? A read-only
 *     screen is only safe if the server refuses what it should; a client-side
 *     "hide the page" would prove nothing.
 *  3. Does nothing this stage adds WRITE? Counting documents before and after is
 *     what makes that checkable rather than assumed.
 *
 * NO FAKE REPOSITORY. `FirestoreOrdersRepository` is the production class wired
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

const ADMIN_EMAIL = 'admin.stage12@drug-manager.demo';
const EMPLOYEE_EMAIL = 'employee.stage12@drug-manager.demo';
/** A second employee: the history must span BOTH, not just the signed-in one. */
const RIVAL_EMAIL = 'rival.stage12@drug-manager.demo';

let harness: EmulatorHarness;
let admin: ActorSession;
let employee: ActorSession;
/**
 * The rival employee's UID, needed to prove the history spans more than one owner.
 *
 * A SESSION for them is deliberately not opened: nothing here acts as the rival,
 * because a rival session would only be used to assert something this stage does
 * not claim - and an unused session is the easiest kind of fixture to rot.
 */
let rivalUid = '';
let adminUid = '';
let employeeUid = '';

/** Every document this suite creates, so the flush between cases is exact. */
const suiteDocuments: string[] = [];

/**
 * Builds the Stage 12 application the way `main.ts` does, for one session.
 *
 * The repositories and the Stage 6 engine are the production classes wired exactly
 * as `main.ts` wires them; only the `session` is narrowed to the actor's safe state,
 * because the emulator session already holds the token in Main-only memory and the
 * application layer must never see one.
 *
 * The Stage 6 service IS wired even though this suite never calls it: the
 * dependency is required by the contract, and the no-writes section below proves
 * the point that matters - that nothing HERE reaches it.
 */
function applicationFor(session: ActorSession): ManagerApplication {
  const context: RepositoryContext = { client: session.client, onWarning: () => undefined };
  return createManagerApplication({
    session: {
      getSafeState: () => ({
        authenticated: true,
        uid: session.uid,
        email: session.email,
        emailVerified: true,
        expirationTimeIso: '2026-06-04T09:00:00.000Z',
        displayName: session.uid === adminUid ? 'المدير' : 'موظف',
        role: session.uid === adminUid ? 'admin' : 'employee',
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

/** Lists a collection through raw REST, so assertions see what Firestore stored. */
async function listIds(session: ActorSession, collection: string): Promise<string[]> {
  const response = await fetch(harness.documentUrl(collection), {
    headers: { Authorization: `Bearer ${session.idToken}` },
  });
  if (response.status === 404) {
    return [];
  }
  assert.equal(response.status, 200, `unexpected status listing ${collection}: ${response.status}`);
  const body = (await response.json()) as { documents?: { name?: string }[] };
  return (body.documents ?? []).map((document) => String(document.name ?? '').split('/').pop() ?? '');
}

/** How many documents a collection currently holds, read by the admin. */
async function countRaw(session: ActorSession, collection: string): Promise<number> {
  return (await listIds(session, collection)).length;
}
before(async () => {
  harness = new EmulatorHarness(readEmulatorEnvironment());
  adminUid = await harness.ensureAuthUser(ADMIN_EMAIL, DEMO_PASSWORD);
  employeeUid = await harness.ensureAuthUser(EMPLOYEE_EMAIL, DEMO_PASSWORD);
  rivalUid = await harness.ensureAuthUser(RIVAL_EMAIL, DEMO_PASSWORD);
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
  await harness.seedUserProfile({
    uid: rivalUid, name: 'سارة', employeeId: 'EMP-200',
    role: 'employee', status: 'approved', hasException: false,
  });
  suiteDocuments.push(`users/${adminUid}`, `users/${employeeUid}`, `users/${rivalUid}`);

  // A window that is ALWAYS open, so the suite never depends on the wall clock.
  await harness.seedDocument('settings/app', {
    minDaysBetweenOrders: 0, maxDailyOrders: 500, allowFridayOrders: true,
    startTime: '00:00', endTime: '23:59', assistantId: 'EMP-000',
  });
  suiteDocuments.push('settings/app');

  await seedOrder('s12-ord-employee', employeeUid, 'pending', 2);
  await seedOrder('s12-ord-rival', rivalUid, 'accepted', 1);
  await seedOrder('s12-ord-rejected', rivalUid, 'rejected', 3);
});

after(async () => {
  await harness.flush(suiteDocuments);
});

/**
 * Seeds one order document exactly as Stage 6 would have written it.
 *
 * `userName` is included on purpose: the history prefers this HISTORICAL snapshot
 * over the live profile, so a fixture that omitted it could not tell the two apart.
 */
async function seedOrder(
  id: string,
  uid: string,
  status: 'pending' | 'accepted' | 'rejected',
  quantity: number,
): Promise<void> {
  await harness.seedDocument(`orders/${id}`, {
    userId: uid,
    userName: uid === employeeUid ? 'أحمد' : 'سارة',
    items: [{ medicineId: 'med-s12', medicineName: 'Panadol', quantity }],
    status,
    date: new Date('2026-06-03T08:00:00Z'),
    monthYear: '06-2026',
    isExceptionOrder: false,
  });
  suiteDocuments.push(`orders/${id}`);
}
describe('Stage 12 A on the emulator: an admin can list EVERY order', () => {
  it('returns orders belonging to more than one employee', async () => {
    const result = await applicationFor(admin).manager.listOrders();

    assert.equal(result.ok, true, 'the rules grant an admin an unfiltered orders read');
    assert.equal(result.ok ? result.value.length : 0, 3);
    const owners = new Set(result.ok ? result.value.map((order) => order.userId) : []);
    assert.deepEqual([...owners].sort(), [employeeUid, rivalUid].sort());
  });

  it('carries every STORED fact the history screen displays', async () => {
    const result = await applicationFor(admin).manager.listOrders();
    const order = result.ok ? result.value.find((candidate) => candidate.id === 's12-ord-employee') : undefined;

    assert.ok(order, 'the seeded order must be present');
    assert.equal(order.status, 'pending');
    // The seeded order holds ONE line of quantity 2. A count of 1 proves the
    // projection reports LINES and never summed the quantity.
    assert.equal(order.itemCount, 1, 'the count is of LINES, never a quantity sum');
    assert.equal(order.monthYearDisplay, '06-2026', 'the stored month reaches the screen verbatim');
    assert.equal(order.dateIso.length > 0, true, 'the stored date must reach the screen');
    assert.equal(order.employeeName, 'أحمد', 'the historical snapshot supplies the name');
  });

  it('reads the three stored statuses separately, never as one bucket', async () => {
    const result = await applicationFor(admin).manager.listOrders();
    const statuses = result.ok ? result.value.map((order) => order.status).sort() : [];

    assert.deepEqual(statuses, ['accepted', 'pending', 'rejected']);
  });

  it('keeps the order statuses separate from any request status', async () => {
    // `orders` and `order_requests` are separate collections with separate caches.
    // Nothing here seeds a request, so the history must not have conjured one, and
    // the stored `status` values are the ORDER's own.
    assert.equal(await countRaw(admin, 'order_requests'), 0);
    const result = await applicationFor(admin).manager.listOrders();
    // `processed` is a REQUEST status. No order status may ever be that value, so
    // its absence here proves the two vocabularies stayed apart.
    assert.deepEqual(
      (result.ok ? result.value.map((order) => order.status) : ['failed']).sort(),
      ['accepted', 'pending', 'rejected'],
      'the history must report stored ORDER statuses, never request statuses',
    );
  });
});

describe('Stage 12 B on the emulator: an employee is refused by the RULES', () => {
  it('answers AUTHORIZATION_DENIED for an unfiltered list', async () => {
    const result = await applicationFor(employee).manager.listOrders();

    // An unfiltered query cannot prove ownership - "rules are not filters" - so the
    // server refuses it. The denial is the RULES' verdict, not a client-side guess.
    assert.equal(result.ok, false, 'the rules must refuse an unfiltered read for a non-admin');
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
  });

  it('never leaks the server message or a document path', async () => {
    const result = await applicationFor(employee).manager.listOrders();
    const serialized = JSON.stringify(result);

    assert.equal(serialized.includes('s12-ord-employee'), false, 'no document id may leak');
    assert.equal(serialized.toLowerCase().includes('permission'), false);
  });

  it('still lets an employee read THEIR OWN order, and nobody else\'s', async () => {
    // The denial above is about the UNFILTERED list, not about the data. Proving
    // the owner path still works keeps this suite from implying the rules are
    // simply closed - they are precise, and a read-only screen built on them is
    // safe precisely because of that precision.
    //
    // The repository is used DIRECTLY here, because Stage 12 deliberately exposes
    // no single-order use case: the history screen reads a list and opens a row
    // from what it already has. Adding one would enlarge the API for no reason.
    const context: RepositoryContext = { client: employee.client, onWarning: () => undefined };
    const repository = new FirestoreOrdersRepository(context);

    const own = await repository.getOrder('s12-ord-employee');
    assert.ok(own, 'an owner may still read their own order by id');
    assert.equal(own.userId, employeeUid);

    // The rules do not merely hide the rival order - Firestore refuses the read
    // outright and the repository raises `NOT_AUTHORIZED`. Asserting the THROW is
    // stronger than asserting a null: a silent null could equally have come from a
    // client that never asked, which would prove nothing about the rules.
    await assert.rejects(
      repository.getOrder('s12-ord-rival'),
      (error: unknown) => {
        const kind = (error as { kind?: string }).kind;
        assert.equal(kind, 'NOT_AUTHORIZED', "another employee's order must be refused");
        return true;
      },
    );
  });
});
describe('Stage 12 C on the emulator: nothing this stage adds WRITES', () => {
  it('leaves every collection the same size after repeated reads', async () => {
    const collections = ['orders', 'order_requests', 'stock_logs', 'medicines'] as const;
    const before: Record<string, number> = {};
    for (const collection of collections) {
      before[collection] = await countRaw(admin, collection);
    }

    // Read repeatedly, from both actors, including the denied path.
    await applicationFor(admin).manager.listOrders();
    await applicationFor(admin).manager.listOrders();
    await applicationFor(employee).manager.listOrders();

    for (const collection of collections) {
      assert.equal(
        await countRaw(admin, collection),
        before[collection],
        `${collection} must be unchanged by a read-only surface`,
      );
    }
  });

  it('leaves every order document itself unchanged, not merely the count', async () => {
    const before = await harness.readAsEmulatorOwner('orders/s12-ord-employee');

    await applicationFor(admin).manager.listOrders();

    assert.deepEqual(
      await harness.readAsEmulatorOwner('orders/s12-ord-employee'),
      before,
      'a read must not mutate the document it read',
    );
  });

  it('reports what it found as a list, never as a failure', async () => {
    // A read-only surface has one failure mode worth being sure about: reporting
    // "nothing here" as an error would train a manager to distrust an empty page.
    const result = await applicationFor(admin).manager.listOrders();

    assert.equal(result.ok, true);
    assert.equal(Array.isArray(result.ok ? result.value : null), true);
  });
});

describe('Stage 12 D on the emulator: the Android rules are unmodified', () => {
  /**
   * The fingerprint established before Stage 12 existed. It is pinned here so that
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