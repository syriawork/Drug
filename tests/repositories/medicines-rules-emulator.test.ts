/**
 * Stage 10 - medicine management against the REAL Firestore Security Rules.
 *
 * Stage 9 proved the users screen's five writes. Stage 10 needs a separate suite
 * because its central claim is a claim about what does NOT change, and that can
 * only be checked against a real engine:
 *
 *   1. an admin (and an ASSISTANT) CAN set `maxQuantity`
 *   2. an employee is refused, and the document is bit-for-bit unchanged
 *   3. `name`, `stock`, `totalInward` and `totalOutward` all SURVIVE the write
 *   4. the mask genuinely works: the PATCH does not replace the document
 *
 * Point 4 is the one that cannot be proven by any fake. A Firestore REST `PATCH`
 * without an update mask REPLACES the whole document and silently deletes every
 * field not named in the body - so a masked `maxQuantity` edit and a mask-less one
 * have visibly different outcomes here: the first keeps the name, the second
 * erases it. The `mask-less PATCH` case below performs that destructive patch
 * and then restores the fixture, precisely so the difference is DEMONSTRATED
 * rather than assumed.
 *
 * Point 2 matters more here than in Stage 9. The Windows UI shows the cap input
 * to every signed-in user, including an employee. If the client were the
 * authority, an employee could set any cap they liked. This suite runs the SAME
 * repository with only the token swapped, so the refusal can only come from the
 * Rules.
 *
 * Nothing is mocked and no production project is involved.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '../../electron/domain/errors';
import { FirestoreMedicinesRepository } from '../../electron/repositories/firestore/medicines-repository';
import {
  DEMO_PASSWORD,
  EmulatorHarness,
  type ActorSession,
  probeEmulators,
  readEmulatorEnvironment,
} from '../helpers/firestore-emulator-harness';

const MEDICINE_ID = 'stage10-med-1';

/** The fixture: a complete, internally INCONSISTENT medicine. */
const FIXTURE: Readonly<Record<string, unknown>> = Object.freeze({
  name: 'بنادول',
  maxQuantity: 5,
  stock: 20,
  // Deliberately inconsistent with `stock` (20), so an accidental rewrite of a
  // counter is visible rather than coincidentally equal.
  totalInward: 137,
  totalOutward: 42,
});

describe('Stage 10 medicines on the REAL Firestore Rules (isolated suite)', async () => {
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
  const medicinePath = `medicines/${MEDICINE_ID}`;

  const adminUid = await harness.ensureAuthUser('admin.stage10@drug-manager.demo', DEMO_PASSWORD);
  const assistantUid = await harness.ensureAuthUser('assistant.stage10@drug-manager.demo', DEMO_PASSWORD);
  const employeeUid = await harness.ensureAuthUser('employee.stage10@drug-manager.demo', DEMO_PASSWORD);

  const paths: readonly string[] = [
    `users/${adminUid}`, `users/${assistantUid}`, `users/${employeeUid}`, medicinePath,
  ];
  await harness.flush(paths);

  await harness.seedUserProfile({
    uid: adminUid, name: 'Manager', employeeId: 'EMP-000', role: 'admin', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: assistantUid, name: 'Assistant', employeeId: 'EMP-100', role: 'assistant', status: 'approved', hasException: false,
  });
  await harness.seedUserProfile({
    uid: employeeUid, name: 'Employee', employeeId: 'EMP-200', role: 'employee', status: 'approved', hasException: false,
  });

  /**
   * Re-seeds the whole document in ONE call.
   *
   * A mask-less `PATCH` REPLACES rather than merges, so two sequential partial
   * seeds would erase each other's fields. One complete document, one write.
   */
  const seedMedicine = async (overrides: Record<string, unknown> = {}): Promise<void> => {
    await harness.seedDocument(medicinePath, { ...FIXTURE, ...overrides });
  };
  await seedMedicine();

  const admin: ActorSession = await harness.openSession('admin.stage10@drug-manager.demo', DEMO_PASSWORD);
  const assistant: ActorSession = await harness.openSession('assistant.stage10@drug-manager.demo', DEMO_PASSWORD);
  const employee: ActorSession = await harness.openSession('employee.stage10@drug-manager.demo', DEMO_PASSWORD);

  const adminMedicines = new FirestoreMedicinesRepository({ client: admin.client });
  const assistantMedicines = new FirestoreMedicinesRepository({ client: assistant.client });
  const employeeMedicines = new FirestoreMedicinesRepository({ client: employee.client });
  it('an admin CAN set the cap, and the inventory fields SURVIVE', async () => {
    await seedMedicine();

    await adminMedicines.setMaxQuantity(MEDICINE_ID, 9);

    const read = await adminMedicines.getMedicine(MEDICINE_ID);
    assert.equal(read?.maxQuantity, 9, 'the cap is the field that changed');
    assert.equal(read?.name, FIXTURE['name'], 'a masked write must not erase the name');
    assert.equal(read?.stock, FIXTURE['stock'], 'a masked write must not move the stock');
    assert.equal(read?.totalInward, FIXTURE['totalInward']);
    assert.equal(read?.totalOutward, FIXTURE['totalOutward']);
  });

  it('an ASSISTANT can do the same, because isAdmin() covers both roles', async () => {
    await seedMedicine();

    await assistantMedicines.setMaxQuantity(MEDICINE_ID, 7);

    const read = await assistantMedicines.getMedicine(MEDICINE_ID);
    assert.equal(read?.maxQuantity, 7);
    assert.equal(read?.stock, FIXTURE['stock'], 'the inventory must survive an assistant write too');
    assert.equal(read?.name, FIXTURE['name']);
  });

  it('an employee is refused the cap write, as a typed DomainError', async () => {
    await seedMedicine();

    // The SAME repository an admin uses - only the token differs. If the client
    // were substituting for the rules, this would succeed.
    await assert.rejects(
      employeeMedicines.setMaxQuantity(MEDICINE_ID, 999),
      (error: unknown) => {
        assert.ok(error instanceof DomainError, 'must raise a DomainError');
        assert.equal(error.kind, 'NOT_AUTHORIZED', 'must be refused as NOT_AUTHORIZED');
        return true;
      },
    );
  });

  it('the employee refusal left the document COMPLETELY unchanged', async () => {
    const raw = await harness.readAsEmulatorOwner(medicinePath);

    assert.equal(raw?.['maxQuantity'], FIXTURE['maxQuantity'], 'the refused write must not have applied');
    assert.equal(raw?.['name'], FIXTURE['name']);
    assert.equal(raw?.['stock'], FIXTURE['stock']);
    assert.equal(raw?.['totalInward'], FIXTURE['totalInward']);
    assert.equal(raw?.['totalOutward'], FIXTURE['totalOutward']);
  });

  it('an employee CAN read the catalogue, because the Rules allow any authenticated read', async () => {
    const catalogue = await employeeMedicines.listMedicines(50);
    const found = catalogue.find((medicine) => medicine.id === MEDICINE_ID);

    assert.ok(found !== undefined, 'the catalogue must be readable by an employee');
    assert.equal(found?.stock, FIXTURE['stock']);
  });
it('the mask genuinely works: a mask-less PATCH WOULD erase the name', async () => {
    await seedMedicine();

    // The demonstration is deliberately destructive and immediately repaired. It
    // exists because "the mask is in the code" and "the mask protects the
    // document" are different claims, and only a real engine can tell us which
    // one the wire format honours.
    const destroyed = await harness.rawMaskLessPatch(medicinePath, {
      maxQuantity: { integerValue: '9' },
    });
    assert.equal(destroyed.status, 200, 'the mask-less patch should be ACCEPTED by the server');

    const erased = await harness.readAsEmulatorOwner(medicinePath);
    assert.equal(erased?.['name'], undefined, 'a mask-less PATCH replaces the document, which is the hazard');
    assert.equal(erased?.['stock'], undefined);

    // ...and the masked repository call that Stage 10 actually ships does NOT.
    await seedMedicine();
    await adminMedicines.setMaxQuantity(MEDICINE_ID, 9);
    const repaired = await harness.readAsEmulatorOwner(medicinePath);
    assert.equal(repaired?.['name'], FIXTURE['name'], 'the shipped masked write keeps every other field');
    assert.equal(repaired?.['stock'], FIXTURE['stock']);
    assert.equal(repaired?.['maxQuantity'], 9);
  });

  it('a cap of zero is stored, because no source of truth forbids one', async () => {
    await seedMedicine();

    // Android (A4) writes `toIntOrNull()` with no range check, and the Functions
    // processor merely compares against the cap. This pins the Windows client to
    // that evidence instead of to an invented policy.
    await adminMedicines.setMaxQuantity(MEDICINE_ID, 0);

    const raw = await harness.readAsEmulatorOwner(medicinePath);
    assert.equal(raw?.['maxQuantity'], 0, 'zero is stored, not silently replaced by a default');
    assert.equal(raw?.['name'], FIXTURE['name']);
  });

  it('a cap above 1000 is stored, because the Android screen allows it', async () => {
    await seedMedicine();

    await adminMedicines.setMaxQuantity(MEDICINE_ID, 5000);

    const read = await adminMedicines.getMedicine(MEDICINE_ID);
    assert.equal(read?.maxQuantity, 5000, 'an invented upper bound would have refused this edit');
  });

  it('removes every document the suite created', async () => {
    await harness.flush(paths);
  });
});