/**
 * Stage 14 - the READ-ONLY Stock Movement Audit page in the renderer.
 *
 * These tests drive the REAL compiled bundle against the REAL shipped markup, the
 * way Stages 11, 12 and 13 do, because the questions here are behavioural:
 *
 *  - does the page read through the ONE argument-free named operation?
 *  - does it print every stored field EXACTLY as the bridge returned it?
 *  - does it compute NOTHING - no sum, no net, no balance?
 *  - does a failure leave the page honest instead of showing stale rows?
 *  - is there ANY control here that could change a movement?
 *
 * The last question is why this file exists. A read-only claim checked only in the
 * markup would still hold if the renderer had attached a write handler to a
 * control added later.
 *
 * THE AGGREGATION QUESTION IS THE POINT OF THIS STAGE. `quantity` is a positive
 * magnitude in both directions, so a sum would report every outward movement as an
 * inflow. The count line is asserted to be a COUNT of rows and never a sum, and the
 * absence of any total is asserted directly.
 *
 * No network, no Electron runtime, no production backend.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRendererHarness, type FakeSafeAuthState } from '../stage8/helpers/renderer-harness';

type Harness = Awaited<ReturnType<typeof createRendererHarness>>;

const SIGNED_IN: FakeSafeAuthState = {
  authenticated: true,
  uid: 'uid-admin',
  email: 'admin@example.com',
  emailVerified: true,
  expirationTimeIso: '2026-12-31T23:59:59.000Z',
  displayName: 'Nour',
  role: 'admin',
};

/**
 * One stored movement, exactly as Main projects it.
 *
 * The quantity is POSITIVE for an OUTWARD movement on purpose: that is the real
 * shape, and a page that assumed a signed number would show it wrongly.
 */
function storedMovement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'log-1',
    medicineId: 'med-42',
    label: 'صرف طلب Allison',
    quantity: 7,
    type: 'outward',
    dateIso: '2026-06-04T08:30:00.000Z',
    actorUid: 'uid-employee',
    requestId: 'req-9',
    orderId: 'ord-3',
    ...overrides,
  };
}

/** Builds the harness signed in, with the given `stockLogs.list()` answer. */
async function openMovements(
  movements: readonly unknown[],
  options: Parameters<typeof createRendererHarness>[0] = {},
): Promise<Harness> {
  const harness = await createRendererHarness({
    stateOnStartup: SIGNED_IN,
    stockLogsList: { ok: true, movements },
    ...options,
  });
  await harness.openStockMovements();
  return harness;
}

/** Every `stockLogs.*` call the page made, as `[name, argumentCount]`. */
function movementCalls(harness: Harness): (readonly [string, number])[] {
  return harness.calls
    .filter((call) => call.name.startsWith('stockLogs.'))
    .map((call) => [call.name, call.args.length] as const);
}
describe('Stage 14 requirement 1: the page reads through ONE argument-free operation', () => {
  it('reads once, with no argument at all', async () => {
    const harness = await openMovements([storedMovement()]);

    // Zero arguments, not one: there is no id, filter or page size a renderer
    // could pass to aim the read at something narrower.
    assert.deepEqual(movementCalls(harness), [['stockLogs.list', 0]]);
  });

  it('re-reads on refresh rather than re-rendering its cache', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      stockLogsListSequence: [
        { ok: true, movements: [storedMovement({ id: 'first' })] },
        { ok: true, movements: [storedMovement({ id: 'first' }), storedMovement({ id: 'second' })] },
      ],
    });

    await harness.openStockMovements();
    assert.equal(harness.stockRows().length, 1);

    await harness.clickStockRefresh();

    // A second call really happened and the new row appeared - so the page is
    // showing what the SERVER holds, not a cache it decided was current.
    assert.deepEqual(movementCalls(harness), [['stockLogs.list', 0], ['stockLogs.list', 0]]);
    assert.equal(harness.stockRows().length, 2);
  });
});

describe('Stage 14 requirement 2: every stored field is printed EXACTLY as received', () => {
  it('shows all seven stored columns, verbatim', async () => {
    const harness = await openMovements([storedMovement()]);

    const rows = harness.stockRows();
    assert.equal(rows.length, 1);
    assert.deepEqual(harness.stockRowCells(rows[0]!), [
      'med-42',                        // medicineId, verbatim
      'صرف طلب Allison',                // the stored descriptive label (D10)
      'صادر من المخزون',                // type, translated - not a business decision
      '7',                             // quantity, the STORED magnitude
      '2026-06-04T08:30:00.000Z',      // dateIso, verbatim
      'uid-employee',                  // actorUid, an identifier not a name
      'ord-3',                         // the order reference
    ]);
  });

  it('never signs a positive outward quantity', async () => {
    // The single most important display decision on this page: an outward movement
    // of 7 is stored as `quantity: 7, type: 'outward'`. Printing `-7` would
    // contradict the document, and printing `+7` would be an invented sign.
    const harness = await openMovements([storedMovement({ type: 'outward', quantity: 7 })]);

    const cells = harness.stockRowCells(harness.stockRows()[0]!);

    assert.equal(cells[3], '7');
    assert.equal(cells[3]?.includes('-'), false, 'no sign may be prepended to a stored magnitude');
    assert.equal(cells[3]?.includes('+'), false, 'no sign may be prepended to a stored magnitude');
  });

  it('falls back to the medicine id when the stored label is empty', async () => {
    // An empty label is a real state, not a missing one; substituting nothing at
    // all would leave a blank cell the manager could not act on.
    const harness = await openMovements([storedMovement({ label: '' })]);

    const cells = harness.stockRowCells(harness.stockRows()[0]!);

    assert.equal(cells[1], 'med-42');
  });

  it('shows the documented "unspecified" label for an absent actor and reference', async () => {
    const harness = await openMovements([
      storedMovement({ orderId: null, requestId: null, actorUid: null }),
    ]);

    const cells = harness.stockRowCells(harness.stockRows()[0]!);

    // `UNKNOWN_LABEL` is the project's existing Arabic neutral marker - the same
    // one the Stage 11 and Stage 12 pages use - so an absent value reads as
    // "unspecified" rather than as an empty cell a manager could misread.
    assert.equal(cells[5], 'غير محدد', 'an absent actor is the neutral label, never an empty guess');
    assert.equal(cells[6], 'غير محدد', 'an absent reference is the neutral label');
  });

  it('shows the request id when no order id exists', async () => {
    // A mobile-app adjustment carries a request but no order. Showing one and not
    // the other would hide which reference actually exists.
    const harness = await openMovements([storedMovement({ orderId: null, requestId: 'req-7' })]);

    assert.equal(harness.stockRowCells(harness.stockRows()[0]!)[6], 'req-7');
  });
});
describe('Stage 14 requirement 3: the page derives NO number and claims NO order', () => {
  it('counts ROWS and never sums quantities', async () => {
    const harness = await openMovements([
      storedMovement({ id: 'a', type: 'inward', quantity: 100 }),
      storedMovement({ id: 'b', type: 'outward', quantity: 60 }),
      storedMovement({ id: 'c', type: 'outward', quantity: 40 }),
    ]);

    // 3 documents. A sum would be 200, a net would be 0, and a balance computed
    // from these three would be a number the database never stored.
    assert.equal(harness.stockCount(), 'عدد الحركات: 3');
    assert.equal(harness.stockCount().includes('200'), false);
    assert.equal(harness.stockCount().includes('0'), false, 'a net of zero is exactly the invented number');
  });

  it('shows NO total, no balance and no per-medicine subtotal anywhere', async () => {
    const harness = await openMovements([
      storedMovement({ id: 'a', medicineId: 'med-1', type: 'inward', quantity: 5 }),
      storedMovement({ id: 'b', medicineId: 'med-1', type: 'outward', quantity: 3 }),
    ]);

    // One row per document, never grouped. Two med-1 documents stay two rows.
    assert.equal(harness.stockRows().length, 2);
    const wholePage = harness.stockMarkup();
    for (const invented of ['totalInward', 'totalOutward', 'الرصيد', 'الإجمالي']) {
      assert.equal(
        wholePage.includes(invented),
        false,
        `the movement panel must show no "${invented}"`,
      );
    }
  });

  it('keeps the rows in the order the bridge delivered them', async () => {
    // Deliberately NOT date order: the oldest row is first. A sort would have put
    // `newest` first, which is an ordering the transport cannot promise.
    const harness = await openMovements([
      storedMovement({ id: 'oldest', dateIso: '2026-06-01T00:00:00.000Z' }),
      storedMovement({ id: 'newest', dateIso: '2026-06-09T00:00:00.000Z' }),
      storedMovement({ id: 'middle', dateIso: '2026-06-05T00:00:00.000Z' }),
    ]);

    const rendered = harness.stockRows().map((row) => row.getAttribute('data-stock-log-id'));

    assert.deepEqual(rendered, ['oldest', 'newest', 'middle']);
  });

  it('filters LOCALLY, sending no request for either control', async () => {
    const harness = await openMovements([
      storedMovement({ id: 'a', medicineId: 'med-1', type: 'inward' }),
      storedMovement({ id: 'b', medicineId: 'med-2', type: 'outward' }),
      storedMovement({ id: 'c', medicineId: 'med-1', type: 'outward' }),
    ]);
    const callsAfterLoad = movementCalls(harness).length;

    harness.filterStockMovementsByDirection('outward');
    harness.searchStockMovements('med-1');

    // Rows narrowed to the one movement that is both outward AND med-1...
    const ids = harness.stockRows().map((row) => row.getAttribute('data-stock-log-id'));
    assert.deepEqual(ids, ['c']);
    // ...while the backend was never asked again. A keystroke must not become a
    // query the REST transport could not express anyway.
    assert.equal(movementCalls(harness).length, callsAfterLoad);
  });

  it('widens the view again when a filter value it does not know arrives', async () => {
    const harness = await openMovements([
      storedMovement({ id: 'a', type: 'inward' }),
      storedMovement({ id: 'b', type: 'outward' }),
    ]);

    harness.filterStockMovementsByDirection('sideways');

    // A tampered `<select>` value must widen the page, never narrow it to something
    // the domain never defined.
    assert.equal(harness.stockRows().length, 2);
  });
});
describe('Stage 14 requirement 4: failures leave the page honest', () => {
  it('shows the safe error and NO rows when the rules refuse the read', async () => {
    // What an employee really gets: `stock_logs` is admin-only (rules line 86).
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      stockLogsList: {
        ok: false,
        error: { code: 'AUTHORIZATION_DENIED', message: 'ليست لديك صلاحية لعرض سجل المخزون.', retryable: false },
      },
    });

    await harness.openStockMovements();

    assert.equal(harness.stockViewState(), 'error');
    assert.equal(harness.stockError(), 'ليست لديك صلاحية لعرض سجل المخزون.');
    // Crucially, no rows at all: an empty page would tell the employee there is
    // nothing to audit, which is a different claim from "you may not look".
    assert.equal(harness.stockRows().length, 0);
  });

  it('survives a thrown transport failure without claiming success', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      throwOnStockLogsList: true,
    });

    await harness.openStockMovements();

    assert.equal(harness.stockViewState(), 'error');
    assert.equal(harness.stockRows().length, 0);
  });

  it('says so plainly when the trail is empty', async () => {
    const harness = await openMovements([]);

    assert.equal(harness.stockViewState(), 'empty');
    assert.equal(harness.stockRows().length, 0);
    assert.equal(harness.stockCount(), 'عدد الحركات: 0');
  });

  it('clears stale rows when a refresh fails after a successful load', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      stockLogsListSequence: [
        { ok: true, movements: [storedMovement({ id: 'a' })] },
        { ok: false, error: { code: 'INFRASTRUCTURE_FAILURE', message: 'تعذر الاتصال.', retryable: true } },
      ],
    });

    await harness.openStockMovements();
    assert.equal(harness.stockRows().length, 1);

    await harness.clickStockRefresh();

    // The row from the failed read is gone. Leaving it would let a manager read
    // an audit trail that no longer reflects anything the server said.
    assert.equal(harness.stockViewState(), 'error');
    assert.equal(harness.stockRows().length, 0);
  });

  it('recovers through the retry control', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      stockLogsListSequence: [
        { ok: false, error: { code: 'INFRASTRUCTURE_FAILURE', message: 'تعذر الاتصال.', retryable: true } },
        { ok: true, movements: [storedMovement({ id: 'a' })] },
      ],
    });

    await harness.openStockMovements();
    assert.equal(harness.stockViewState(), 'error');

    await harness.clickStockRetry();

    assert.equal(harness.stockViewState(), 'ready');
    assert.equal(harness.stockRows().length, 1);
  });
});

describe('Stage 14 requirement 5: the page holds nothing after sign-out, and can write nothing', () => {
  it('drops every movement row when the session ends', async () => {
    const harness = await openMovements([storedMovement({ id: 'a' }), storedMovement({ id: 'b' })]);

    assert.equal(harness.stockRows().length, 2);

    await harness.clickLogout();

    // The audit trail belongs to the session that read it.
    assert.equal(harness.stockRows().length, 0);
    assert.equal(harness.stockCount(), '');
  });

  it('offers only the four read-only controls, and no per-row action', async () => {
    const harness = await openMovements([storedMovement()]);

    assert.deepEqual([...harness.stockControls()].map(([id]) => id).sort(), [
      'stock-direction-filter',
      'stock-refresh',
      'stock-retry',
      'stock-search-input',
    ]);
    // And the same set in the SHIPPED markup, so a control added to the HTML but
    // wired to nothing would still fail here.
    assert.deepEqual([...harness.stockButtonsInMarkup()].sort(), [
      'stock-direction-filter',
      'stock-refresh',
      'stock-retry',
      'stock-search-input',
    ]);
  });

  it('never issues a stock write, on any path through the page', async () => {
    const harness = await openMovements([storedMovement()]);

    // Exercise every control the page has, plus navigation away and back.
    await harness.openStockMovements();
    harness.searchStockMovements('med');
    harness.filterStockMovementsByDirection('inward');
    await harness.clickStockRefresh();
    await harness.clickStockRetry();

    // The ONLY backend call this page can make is the read. The fake backend has no
    // write method at all, so any attempt would have thrown rather than recorded.
    const names = new Set(harness.calls.map((call) => call.name));
    for (const name of names) {
      if (name.startsWith('stockLogs.')) {
        assert.equal(name, 'stockLogs.list', `the movement page must only ever read, found ${name}`);
      }
    }
  });
});