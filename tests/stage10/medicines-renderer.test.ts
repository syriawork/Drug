/**
 * Stage 10 - the medicines page, exercised against the REAL compiled bundle.
 *
 * The same `node:vm` harness the Stage 8/9 suites use runs
 * `dist/renderer/renderer.js` against a DOM parsed from the shipped
 * `index.html`, so these assertions are about BEHAVIOUR: clicking the navigation
 * entry, typing in the search box, pressing save.
 *
 * What that buys over reading the source: a renderer that quietly sent a request
 * per keystroke, derived `stock` from the counters, offered a stock input, or
 * issued two writes for one double-click would pass every static check and fail
 * here.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRendererHarness, type FakeSafeAuthState } from '../stage8/helpers/renderer-harness';

/** The signed-in administrator who drives every medicines test. */
const ADMIN: FakeSafeAuthState = {
  authenticated: true,
  uid: 'uid-admin',
  email: 'admin@example.com',
  emailVerified: true,
  expirationTimeIso: '2026-10-01T09:00:00.000Z',
  displayName: 'مدير',
  role: 'admin',
};

/** A `MedicineListItemView` exactly as the Main process projects it. */
function medicine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'med-1',
    name: 'بنادول',
    maxQuantity: 5,
    stock: 20,
    totalInward: 40,
    totalOutward: 20,
    ...overrides,
  };
}

/**
 * A catalogue whose counters do NOT add up to the stored stock.
 *
 * `totalInward - totalOutward` is 3 here while `stock` is 20. A renderer that
 * derived one from the other would print 3, and the inventory assertion below
 * would fail - which is the whole reason for seeding it this way.
 */
const CATALOGUE = [
  medicine(),
  medicine({ id: 'med-2', name: 'Paracetamol', maxQuantity: 10, stock: 20, totalInward: 9, totalOutward: 6 }),
  medicine({ id: 'med-3', name: 'أحمد', maxQuantity: 2, stock: 20, totalInward: 100, totalOutward: 90 }),
];

/** Builds a harness signed in, with the medicines page open and loaded. */
async function openMedicinesPage(
  options: Parameters<typeof createRendererHarness>[0] = {},
): Promise<Awaited<ReturnType<typeof createRendererHarness>>> {
  const harness = await createRendererHarness({
    stateOnStartup: ADMIN,
    medicinesList: { ok: true, medicines: CATALOGUE },
    ...options,
  });
  await harness.openMedicines();
  return harness;
}

/** The first `count` cell texts of a rendered catalogue row. */
function cellsOf(
  harness: Awaited<ReturnType<typeof createRendererHarness>>,
  index: number,
  count: number,
): readonly string[] {
  const row = harness.medicineRows()[index];
  return [...harness.medicineRowCells(row ?? { children: [] } as never)].slice(0, count);
}

/** The first `count` cell texts of the row belonging to one medicine. */
function cellsOfId(
  harness: Awaited<ReturnType<typeof createRendererHarness>>,
  medicineId: string,
  count: number,
): readonly string[] {
  const row = harness.medicineRows().find((candidate) => candidate.getAttribute('data-medicine-id') === medicineId);
  return [...harness.medicineRowCells(row ?? { children: [] } as never)].slice(0, count);
}

describe('Stage 10 requirement 12: clicking الأدوية opens the medicine page', () => {
  it('shows the page and hides the dashboard and the users page', async () => {
    const harness = await openMedicinesPage();

    assert.equal(harness.element('medicines-view').hidden, false);
    assert.equal(harness.element('dashboard-view').hidden, true);
    assert.equal(harness.element('users-view').hidden, true);
    assert.equal(harness.element('placeholder-view').hidden, true);
  });
});

describe('Stage 10 requirement 13: medicines load through the typed IPC boundary', () => {
  it('loads the catalogue through the named operation', async () => {
    const harness = await openMedicinesPage();

    assert.equal(harness.callsTo('medicines.list').length, 1);
    // The catalogue is reached by NAME; no write is involved in a read.
    assert.equal(harness.callsTo('medicines.updateMaxQuantity').length, 0);
  });

  it('renders one row per medicine with the five established fields', async () => {
    const harness = await openMedicinesPage();

    assert.equal(harness.medicineRows().length, 3);
    assert.deepEqual(cellsOf(harness, 0, 5), ['بنادول', '20', '5', '40', '20']);
  });

  it('shows stock EXACTLY as stored, never derived from the counters', async () => {
    const harness = await openMedicinesPage();

    // Row 2 stores stock 20 while its counters imply 9 - 6 = 3.
    assert.deepEqual(cellsOf(harness, 1, 3), ['Paracetamol', '20', '10']);
    // Row 3 stores stock 20 while its counters imply 100 - 90 = 10.
    assert.deepEqual(cellsOf(harness, 2, 3), ['أحمد', '20', '2']);
  });

  it('reports the catalogue count', async () => {
    const harness = await openMedicinesPage();

    assert.equal(harness.element('medicines-count').textContent, 'عدد الأدوية: 3');
  });
});
describe('Stage 10 requirement 14: local search filters without extra calls', () => {
  it('filters by an Arabic name fragment', async () => {
    const harness = await openMedicinesPage();

    harness.searchMedicines('بنادول');

    assert.equal(harness.medicineRows().length, 1);
    assert.equal(cellsOf(harness, 0, 1)[0], 'بنادول');
  });

  it('filters by a Latin name, case-insensitively', async () => {
    const harness = await openMedicinesPage();

    harness.searchMedicines('paracetamol');
    assert.equal(harness.medicineRows().length, 1);

    harness.searchMedicines('PARACETAMOL');
    assert.equal(harness.medicineRows().length, 1);
  });

  it('filters by an Arabic name typed WITH diacritics', async () => {
    const harness = await openMedicinesPage();

    harness.searchMedicines('أحمد');

    assert.equal(harness.medicineRows().length, 1);
  });

  it('sends NO request while the user types', async () => {
    const harness = await openMedicinesPage();
    const before = harness.calls.length;

    harness.searchMedicines('ب');
    harness.searchMedicines('بن');
    harness.searchMedicines('بنادول');

    assert.equal(harness.calls.length, before, 'the whole point of a local filter: no round trip');
  });

  it('never mutates the stored medicine name', async () => {
    const harness = await openMedicinesPage();

    harness.searchMedicines('paracetamol');
    harness.searchMedicines('');

    // The row still shows the original capitalisation from the backend.
    const row = harness.medicineRows().find((candidate) => candidate.getAttribute('data-medicine-id') === 'med-2');
    assert.equal(harness.medicineRowCells(row ?? { children: [] } as never)[0], 'Paracetamol');
  });

  it('shows an empty state and a filtered count when nothing matches', async () => {
    const harness = await openMedicinesPage();

    harness.searchMedicines('لا يوجد');

    assert.equal(harness.medicineRows().length, 0);
    assert.equal(harness.medicinesViewState(), 'empty');
    assert.equal(harness.element('medicines-count').textContent, 'عدد النتائج: 0 من 3');
  });
});

describe('Stage 10 requirements 15 & 16: empty and error states are visible', () => {
  it('shows an empty state when the catalogue has no medicines', async () => {
    const harness = await openMedicinesPage({ medicinesList: { ok: true, medicines: [] } });

    assert.equal(harness.medicinesViewState(), 'empty');
    assert.equal(harness.medicineRows().length, 0);
    assert.ok(harness.element('medicines-state-message').textContent.length > 0);
  });

  it('shows the safe Arabic message and a retry action on a rules denial', async () => {
    const harness = await openMedicinesPage({
      medicinesList: {
        ok: false,
        error: { code: 'AUTHORIZATION_DENIED', message: 'ليست لديك صلاحية تنفيذ هذه العملية وفق قواعد أمان Firebase', retryable: false },
      },
    });

    assert.equal(harness.medicinesViewState(), 'error');
    assert.equal(
      harness.element('medicines-state-message').textContent,
      'ليست لديك صلاحية تنفيذ هذه العملية وفق قواعد أمان Firebase',
    );
    // The technical code is for logs, never for the screen.
    assert.equal(harness.element('medicines-state-message').textContent.includes('AUTHORIZATION_DENIED'), false);
    assert.equal(harness.element('medicines-retry').hidden, false);
  });

  it('shows a safe message when the load itself fails', async () => {
    const harness = await openMedicinesPage({ throwOnMedicinesList: true });

    assert.equal(harness.medicinesViewState(), 'error');
    const shown = harness.element('medicines-state-message').textContent;
    assert.ok(shown.length > 0);
    assert.equal(shown.includes('transport failed'), false);
  });
});

describe('Stage 10 requirement 17: refresh reloads the catalogue', () => {
  it('re-reads the catalogue through the named operation', async () => {
    const harness = await openMedicinesPage();

    await harness.clickMedicinesRefresh();

    assert.equal(harness.callsTo('medicines.list').length, 2);
    assert.equal(harness.medicinesViewState(), 'ready');
  });
});
describe('Stage 10 requirement 18 & 19: the edit is supported, and only that', () => {
  it('saves the cap and refreshes the displayed data', async () => {
    const harness = await openMedicinesPage();

    harness.openMedicineDialog('med-1');
    harness.typeMaxQuantity('9');
    await harness.clickMedicineSave();

    const payload = harness.callsTo('medicines.updateMaxQuantity')[0]?.args[0] as Record<string, unknown>;
    // Exactly two keys: an id and a whole number. There is no parameter through
    // which a stock figure, a counter, a document or a mask could be sent.
    assert.deepEqual(Object.keys(payload).sort(), ['maxQuantity', 'medicineId']);
    assert.equal(payload['medicineId'], 'med-1');
    assert.equal(payload['maxQuantity'], 9);

    assert.equal(harness.callsTo('medicines.list').length, 2, 'the catalogue must be re-read after a write');
    assert.deepEqual(cellsOfId(harness, 'med-1', 3), ['بنادول', '20', '9']);
    assert.equal(harness.medicineDialogOpen(), false);
  });

  it('leaves stock and the counters untouched after the save', async () => {
    const harness = await openMedicinesPage();

    harness.openMedicineDialog('med-2');
    harness.typeMaxQuantity('15');
    await harness.clickMedicineSave();

    // Only the cap moved. The inventory figures are exactly what they were, which
    // is what the update mask guarantees on a real Firestore.
    assert.deepEqual(cellsOfId(harness, 'med-2', 5), ['Paracetamol', '20', '15', '9', '6']);
  });

  it('refuses a non-numeric cap in the renderer, without calling the bridge', async () => {
    const harness = await openMedicinesPage();

    harness.openMedicineDialog('med-1');
    harness.typeMaxQuantity('غير رقم');
    await harness.clickMedicineSave();

    assert.equal(harness.callsTo('medicines.updateMaxQuantity').length, 0);
    assert.ok((harness.medicineDialogError() ?? '').length > 0);
    assert.equal(harness.medicineDialogOpen(), true);
  });

  it('exposes ONLY the cap as an input, never stock or a counter', async () => {
    const harness = await openMedicinesPage();

    harness.openMedicineDialog('med-1');

    // Everything else about the medicine is rendered as text.
    for (const id of [
      'medicine-detail-name',
      'medicine-detail-stock',
      'medicine-detail-inward',
      'medicine-detail-outward',
    ]) {
      assert.equal(harness.element(id).tagName, 'dd', `${id} must not be an input`);
    }
    assert.equal(harness.element('medicine-detail-max-quantity').tagName, 'input');
    assert.equal(harness.element('medicine-detail-stock').textContent, '20');
  });
});

describe('Stage 10 requirement 20: duplicate saves are prevented', () => {
  it('issues ONE write for a double-clicked save', async () => {
    const harness = await openMedicinesPage();

    harness.openMedicineDialog('med-1');
    harness.typeMaxQuantity('9');
    await harness.clickMedicineSave();
    await harness.clickMedicineSave();

    assert.equal(harness.callsTo('medicines.updateMaxQuantity').length, 1);
  });

  it('makes the save button usable again for the next edit', async () => {
    const harness = await openMedicinesPage();

    harness.openMedicineDialog('med-1');
    harness.typeMaxQuantity('9');
    await harness.clickMedicineSave();
    assert.equal(harness.medicineDialogOpen(), false);

    harness.openMedicineDialog('med-1');
    assert.equal(harness.element('medicine-save').disabled, false);
  });
});

describe('Stage 10 requirement 21: logout still works', () => {
  it('returns to login and drops the cached catalogue', async () => {
    const harness = await openMedicinesPage();
    assert.equal(harness.visibleView(), 'shell');

    await harness.clickLogout();

    assert.equal(harness.callsTo('auth.signOut').length, 1);
    assert.equal(harness.visibleView(), 'login');
    // No medicine data is left in the DOM behind a login form.
    assert.equal(harness.medicineRows().length, 0);
    assert.equal(harness.element('medicines-count').textContent, '');
  });
});

describe('Stage 10: the medicines module calls nothing beyond its two operations', () => {
  it('uses only medicines.list and medicines.updateMaxQuantity while in use', async () => {
    const harness = await openMedicinesPage();

    harness.searchMedicines('Paracetamol');
    harness.searchMedicines('');
    harness.openMedicineDialog('med-1');
    harness.typeMaxQuantity('9');
    await harness.clickMedicineSave();
    await harness.clickMedicinesRefresh();

    const allowed = new Set([
      'auth.getState', 'auth.signIn', 'auth.signOut', 'getAppStatus',
      'medicines.list', 'medicines.updateMaxQuantity',
    ]);
    for (const name of new Set(harness.calls.map((call) => call.name))) {
      assert.equal(allowed.has(name), true, `the medicines module must not call ${name}`);
    }
  });
});