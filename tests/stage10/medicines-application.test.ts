/**
 * Stage 10 - the medicine application layer AND the repository write mapping.
 *
 * Two things are proven here, and the second is the one this stage turns on:
 *
 *  1. THE USE CASE IS NARROW. The application layer accepts exactly one update
 *     shape, refuses every other field BEFORE any I/O, and delegates to exactly
 *     one repository method.
 *
 *  2. THE UPDATE MASK ACTUALLY PROTECTS THE OTHER FIELDS. The mapper is
 *     asserted directly: the mask must name `maxQuantity` and nothing else, and
 *     the payload must carry no `stock`, no `totalInward` and no `totalOutward`.
 *     A mask-less edit would be a whole-document replacement, and the Stage 5A
 *     "G3" finding proved a raw `PATCH {"fields":{}}` returns HTTP 200 and leaves
 *     zero fields behind. That regression is pinned by an assertion here, and
 *     proven against a real Firestore by the Stage 10 emulator suite.
 *
 * No network, no Electron runtime, no production backend.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { APPLICATION_ERROR_MESSAGES } from '../../electron/application/application-error';
import { MedicinesManagementService } from '../../electron/application/medicines-management.service';
import { DomainError } from '../../electron/domain/errors';
import {
  MEDICINE_MAX_QUANTITY_MASK,
  mapMedicineMaxQuantityWrite,
} from '../../electron/repositories/firestore/mappers/medicine-mapper';
import { FakeMedicinesRepository, makeMedicine, rulesDenied, signedIn } from '../stage7/helpers/fakes';
import { buildApplication } from '../stage9/helpers';

/** A session whose own role is an ordinary employee: writes must still be attempted. */
const EMPLOYEE_SESSION = signedIn({ uid: 'uid-employee', role: 'employee' });

function buildMedicinesService(options: {
  readonly medicines?: FakeMedicinesRepository;
  readonly state?: ReturnType<typeof signedIn>;
} = {}): { readonly service: MedicinesManagementService; readonly medicines: FakeMedicinesRepository } {
  const medicines = options.medicines ?? new FakeMedicinesRepository([makeMedicine()]);
  const service = new MedicinesManagementService({
    medicines,
    auth: { getState: () => options.state ?? EMPLOYEE_SESSION },
  });
  return { service, medicines };
}

/** Recursively collects every own key of a value that matches `pattern`. */
function findKeys(value: unknown, pattern: RegExp): string[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const found: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (pattern.test(key)) {
      found.push(key);
    }
    found.push(...findKeys(nested, pattern));
  }
  return found;
}

describe('Stage 10 requirement 1: the medicine list delegates to the repository', () => {
  it('reaches listMedicines once, with the application-owned limit', async () => {
    const medicines = new FakeMedicinesRepository([makeMedicine({ name: 'Ø¨Ù†Ø§Ø¯ÙˆÙ„', stock: 20 })]);

    const result = await buildApplication(undefined, medicines).manager.listMedicines();

    assert.deepEqual([...medicines.limits], [500], 'the renderer must not choose the limit');
    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.value[0]?.name : null, 'Ø¨Ù†Ø§Ø¯ÙˆÙ„');
  });

  it('returns the four inventory figures EXACTLY as stored', async () => {
    // `stock` is NOT derived from the counters: the Stage 6 processor writes it as
    // an absolute value, so a subtraction here would contradict the engine that
    // owns the number. This case is deliberately SKewed so the difference is wrong.
    const skewed = new FakeMedicinesRepository([
      makeMedicine({ name: 'Ø¯ÙˆØ§Ø¡', stock: 4, maxQuantity: 5, totalInward: 10, totalOutward: 6 }),
    ]);

    const result = await buildApplication(undefined, skewed).manager.listMedicines();

    const first = result.ok ? result.value[0] : undefined;
    assert.equal(first?.stock, 4, 'stock must be read, never computed as 10 - 6');
    assert.equal(first?.maxQuantity, 5);
    assert.equal(first?.totalInward, 10);
    assert.equal(first?.totalOutward, 6);
  });
});

describe('Stage 10 requirement 2: a supported update delegates correctly', () => {
  it('calls setMaxQuantity with the validated pair', async () => {
    const medicines = new FakeMedicinesRepository([makeMedicine()]);
    const { service } = buildMedicinesService({ medicines });

    const result = await service.setMaxQuantity({ medicineId: 'med-1', maxQuantity: 9 });

    assert.equal(result.ok, true);
    assert.deepEqual([...medicines.callsTo], [['med-1', 9]]);
  });

  it('returns no data, so the renderer must re-read to learn the truth', async () => {
    const { service } = buildMedicinesService();

    const result = await service.setMaxQuantity({ medicineId: 'med-1', maxQuantity: 3 });

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.value : 'not-null', null);
  });
});
describe('Stage 10 requirements 4 & 5: the update mask protects the other fields', () => {
  it('masks EXACTLY one field: maxQuantity', () => {
    assert.deepEqual([...MEDICINE_MAX_QUANTITY_MASK], ['maxQuantity']);
  });

  it('sends only the masked field in the payload', () => {
    const write = mapMedicineMaxQuantityWrite('med-1', 9);

    assert.equal(write.kind, 'update');
    assert.equal(write.relativePath, 'medicines/med-1');
    assert.deepEqual(write.data, { maxQuantity: 9 });
    assert.deepEqual([...(write.updateMaskPaths ?? [])], ['maxQuantity']);
  });

  it('never carries stock or a counter into the write', () => {
    // This is the regression the whole stage turns on. If an inventory field ever
    // appeared in `data`, the mask would still protect the document - but the
    // intent would have drifted, and a later mask change would be silent.
    const write = mapMedicineMaxQuantityWrite('med-1', 9);

    for (const forbidden of ['stock', 'totalInward', 'totalOutward', 'name', 'id']) {
      assert.equal(forbidden in write.data, false, `the write must not carry ${forbidden}`);
      assert.equal(
        (write.updateMaskPaths ?? []).includes(forbidden),
        false,
        `the mask must not cover ${forbidden}`,
      );
    }
  });

  it('keeps the mask and the payload in lockstep for every value', () => {
    // NO BUSINESS RANGE IS INVENTED. Android (A4) writes whatever
    // `toIntOrNull()` accepts with no bounds, the Cloud Functions processor only
    // compares against the cap, and `requireNumber` demands a whole number. So a
    // cap above 1000 and a cap of zero are BOTH legal here, exactly as they are
    // on the phone. The only refused values are the ones that are not integers
    // or that cannot be represented exactly in a JSON round trip.
    const legalValues: readonly number[] = [
      0, 1, 2, 5, 100, 1000, 1001, 99999, Number.MAX_SAFE_INTEGER,
    ];

    for (const value of legalValues) {
      const write = mapMedicineMaxQuantityWrite('med-anything', value);
      assert.deepEqual(Object.keys(write.data), ['maxQuantity'], `value ${value}`);
      assert.deepEqual([...(write.updateMaskPaths ?? [])], ['maxQuantity'], `value ${value}`);
    }
  });
});

describe('Stage 10 requirement 3: unsupported fields are rejected', () => {
  it('refuses every inventory and profile field the contract does not expose', async () => {
    const refused: readonly (readonly [string, unknown])[] = [
      ['stock', { medicineId: 'med-1', stock: 999 }],
      ['totalInward', { medicineId: 'med-1', totalInward: 999 }],
      ['totalOutward', { medicineId: 'med-1', totalOutward: 999 }],
      ['name', { medicineId: 'med-1', name: 'Ø§Ø³Ù… Ø¬Ø¯ÙŠØ¯' }],
      ['id', { medicineId: 'med-1', id: 'other' }],
      ['a document body', { medicineId: 'med-1', document: { stock: 1 } }],
      ['an update mask', { medicineId: 'med-1', updateMaskPaths: ['stock'] }],
      ['a delete', { medicineId: 'med-1', delete: true }],
    ];

    for (const [label, payload] of refused) {
      const medicines = new FakeMedicinesRepository([makeMedicine()]);
      const { service } = buildMedicinesService({ medicines });

      const result = await service.setMaxQuantity(payload);

      assert.equal(result.ok, false, `${label} must be refused`);
      assert.equal(!result.ok ? result.error.code : null, 'VALIDATION_FAILED', `${label} code`);
      assert.deepEqual([...medicines.callsTo], [], `${label} must not reach the repository`);
    }
  });

  it('refuses a malformed payload of any shape', async () => {
    const payloads: readonly unknown[] = [
      null, undefined, 42, 'string', [], {}, { maxQuantity: 5 },
      { medicineId: 'med-1' }, { medicineId: 'med-1', maxQuantity: 1.5 },
      { medicineId: 'med-1', maxQuantity: '5' }, { medicineId: 'med-1', maxQuantity: Number.NaN },
      { medicineId: 'med-1', maxQuantity: Number.POSITIVE_INFINITY },
      { medicineId: '', maxQuantity: 5 }, { medicineId: 'medicines/../users/x', maxQuantity: 5 },
    ];

    for (const payload of payloads) {
      const { service } = buildMedicinesService();
      const result = await service.setMaxQuantity(payload);
      assert.equal(result.ok, false, `payload ${JSON.stringify(payload) ?? 'undefined'} must be refused`);
    }
  });

  it('refuses to write without a Main-process session', async () => {
    const medicines = new FakeMedicinesRepository([makeMedicine()]);
    const { service } = buildMedicinesService({
      medicines,
      state: Object.freeze({ authenticated: false, uid: null, email: null, emailVerified: false, expirationTimeIso: null }),
    });

    const result = await service.setMaxQuantity({ medicineId: 'med-1', maxQuantity: 5 });

    assert.equal(!result.ok ? result.error.code : null, 'AUTHENTICATION_FAILED');
    assert.deepEqual([...medicines.callsTo], []);
  });
});
describe('Stage 10 requirement 6: errors use the existing taxonomy', () => {
  it('maps a rules denial to AUTHORIZATION_DENIED', async () => {
    const { service } = buildMedicinesService({
      medicines: new FakeMedicinesRepository([], rulesDenied('medicines/med-1')),
    });

    const result = await service.setMaxQuantity({ medicineId: 'med-1', maxQuantity: 5 });

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
    assert.deepEqual(!result.ok ? Object.keys(result.error).sort() : [], ['code', 'message', 'retryable']);
  });

  it('never leaks a document path or a server message', async () => {
    const { service } = buildMedicinesService({
      medicines: new FakeMedicinesRepository([], new DomainError(
        'TRANSPORT',
        'Firestore request failed for medicines/med-1: Missing or insufficient permissions.',
        { documentPath: 'medicines/med-1' },
      )),
    });

    const result = await service.setMaxQuantity({ medicineId: 'med-1', maxQuantity: 5 });

    const serialised = JSON.stringify(result);
    assert.equal(serialised.includes('medicines/med-1'), false);
    assert.equal(serialised.includes('insufficient permissions'), false);
    assert.equal(!result.ok ? result.error.message : null, APPLICATION_ERROR_MESSAGES.INFRASTRUCTURE_FAILURE);
  });

  it('attempts the write even when the signed-in user is an employee', async () => {
    // The architecture requires the request to go out and firestore.rules to
    // answer. A local-role check would pass a "denied" test while quietly
    // replacing the rules.
    const medicines = new FakeMedicinesRepository([makeMedicine()]);
    const { service } = buildMedicinesService({ medicines, state: EMPLOYEE_SESSION });

    const result = await service.setMaxQuantity({ medicineId: 'med-1', maxQuantity: 5 });

    assert.equal(medicines.callsTo.length, 1, 'the repository must still be reached');
    assert.equal(result.ok, true);
  });

  it('never consults the local role when deciding to write', async () => {
    let roleReads = 0;
    const state = Object.defineProperty({ ...EMPLOYEE_SESSION }, 'role', {
      get: (): string => {
        roleReads += 1;
        return 'employee';
      },
    });
    const { service } = buildMedicinesService({ state: state as never });

    await service.setMaxQuantity({ medicineId: 'med-1', maxQuantity: 5 });

    assert.equal(roleReads, 0, 'the application layer must not consult the local role to write');
  });
});

describe('Stage 10 requirement 7: the renderer never receives raw wire data', () => {
  it('answers with a plain view DTO', async () => {
    const result = await buildApplication(
      undefined,
      new FakeMedicinesRepository([makeMedicine({ stock: 3 })]),
    ).manager.listMedicines();

    assert.deepEqual(findKeys(result, /token|secret|credential/i), []);
    const serialised = JSON.stringify(result);
    assert.equal(serialised.includes('medicines/'), false);
    assert.equal(serialised.includes('stringValue'), false);
    assert.equal(serialised.includes('updateMask'), false);
  });
});
