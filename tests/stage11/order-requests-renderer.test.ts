/**
 * Stage 11 - the orders page, exercised against the REAL compiled bundle.
 *
 * The same `node:vm` harness the Stage 8/9/10 suites use runs
 * `dist/renderer/renderer.js` against a DOM parsed from the shipped `index.html`,
 * so every assertion below is about BEHAVIOUR: clicking the navigation entry,
 * typing in the search box, confirming, watching the row change.
 *
 * What that buys over reading the source: a renderer that computed stock, summed
 * a total, decided eligibility, or issued two writes for one double-click would
 * pass every static check and fail here.
 *
 * The four Stage 6 outcomes get one section each, because merging them is the
 * defect this stage exists to prevent: a rejected request and a rules denial look
 * identical to a user unless they are rendered differently.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRendererHarness, type FakeSafeAuthState } from '../stage8/helpers/renderer-harness';

type Harness = Awaited<ReturnType<typeof createRendererHarness>>;

/** The signed-in manager who drives every orders test. */
const MANAGER: FakeSafeAuthState = {
  authenticated: true,
  uid: 'uid-admin',
  email: 'admin@example.com',
  emailVerified: true,
  expirationTimeIso: '2026-10-01T09:00:00.000Z',
  displayName: 'مدير',
  role: 'admin',
};

/**
 * A queue whose request carries QUANTITIES THAT MUST NOT BE SUMMED.
 *
 * The two lines total 5. A renderer that aggregated would show "5"; the queue is
 * supposed to show a count of 2 LINES, because aggregating is Stage 6's job.
 */
function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'req-1',
    uid: 'uid-emp',
    employeeName: 'سارة العامري',
    items: [
      { medicineId: 'med-1', medicineName: 'بنادول', quantity: 3 },
      { medicineId: 'med-2', medicineName: 'فيتامين', quantity: 2 },
    ],
    status: 'pending',
    requestDateIso: '2026-06-03T08:00:00.000Z',
    orderId: null,
    error: null,
    processedBy: null,
    processedAtIso: null,
    ...overrides,
  };
}

const QUEUE = [
  request(),
  request({ id: 'req-2', uid: 'uid-other', employeeName: 'أحمد الحلبي', status: 'processed', orderId: 'order-9' }),
  request({
    id: 'req-3',
    uid: 'uid-third',
    employeeName: null,
    status: 'failed',
    error: 'الكمية غير كافية',
  }),
];

/** Builds a harness signed in, with the orders page open and loaded. */
async function openOrdersPage(
  options: Parameters<typeof createRendererHarness>[0] = {},
): Promise<Harness> {
  const harness = await createRendererHarness({
    stateOnStartup: MANAGER,
    orderRequestsList: { ok: true, orders: QUEUE },
    ...options,
  });
  await harness.openOrders();
  return harness;
}

/** The rendered cells of one row, by request id. */
function cellsOf(harness: Harness, requestId: string): readonly string[] {
  const row = harness.orderRows().find((candidate) => candidate.getAttribute('data-request-id') === requestId);
  assert.notEqual(row, undefined, `no rendered row for ${requestId}`);
  return [...harness.orderRowCells(row as never)];
}

describe('Stage 11 requirement 7: clicking طلبات الأدوية opens the queue', () => {
  it('shows the page and hides every other view', async () => {
    const harness = await openOrdersPage();

    assert.equal(harness.element('orders-view').hidden, false);
    assert.equal(harness.element('dashboard-view').hidden, true);
    assert.equal(harness.element('users-view').hidden, true);
    assert.equal(harness.element('medicines-view').hidden, true);
  });

  it('loads the queue through the NAMED read, and never a write', async () => {
    const harness = await openOrdersPage();

    assert.equal(harness.callsTo('orderRequests.list').length, 1);
    assert.equal(harness.callsTo('orders.process').length, 0);
    assert.equal(harness.callsTo('orderRequests.get').length, 0, 'a page load is not a single read');
  });
});

describe('Stage 11 requirement 8: the queue shows the stored facts only', () => {
  it('renders one row per request across all three statuses', async () => {
    const harness = await openOrdersPage();

    assert.equal(harness.orderRows().length, 3);
    assert.deepEqual(
      harness.orderRows().map((row) => row.getAttribute('data-request-id')),
      ['req-1', 'req-2', 'req-3'],
    );
  });

  it('counts LINES and never sums their quantities', async () => {
    const harness = await openOrdersPage();
    const cells = cellsOf(harness, 'req-1');

    // 3 + 2 = 5. The fourth column must be the line count, never that sum.
    assert.equal(cells[3], '2');
    assert.notEqual(cells[3], '5');
  });


describe('Stage 11 requirement 9: search and filtering stay LOCAL', () => {
  it('filters by employee without asking the bridge again', async () => {
    const harness = await openOrdersPage();

    harness.searchOrders('أحمد');

    assert.equal(harness.orderRows().length, 1);
    assert.equal(harness.orderRows()[0]?.getAttribute('data-request-id'), 'req-2');
    assert.equal(harness.callsTo('orderRequests.list').length, 1, 'a keystroke must not hit the transport');
  });

  it('matches a medicine name as well as the employee', async () => {
    const harness = await openOrdersPage();

    harness.searchOrders('فيتامين');

    // Every request names the medicine, so all three survive - which proves the
    // term reached the item list rather than only the employee column.
    assert.equal(harness.orderRows().length, 3);
  });

  it('narrows the same queue with a status filter, still locally', async () => {
    const harness = await openOrdersPage();

    harness.filterOrdersByStatus('failed');

    assert.equal(harness.orderRows().length, 1);
    assert.equal(harness.orderRows()[0]?.getAttribute('data-request-id'), 'req-3');
    assert.equal(harness.callsTo('orderRequests.list').length, 1);
  });

  it('combines the search term and the status filter', async () => {
    const harness = await openOrdersPage();

    harness.filterOrdersByStatus('pending');
    harness.searchOrders('سارة');

    assert.equal(harness.orderRows().length, 1);
    assert.equal(harness.orderRows()[0]?.getAttribute('data-request-id'), 'req-1');
  });

  it('ignores a filter value it does not recognise instead of blanking the queue', async () => {
    const harness = await openOrdersPage();

    harness.filterOrdersByStatus('nonsense-status');

    assert.equal(harness.orderRows().length, 3, 'an unknown value falls back to "all"');
  });

  it('refreshes the queue through the named read on demand', async () => {
    const harness = await openOrdersPage();

    await harness.clickOrdersRefresh();

    assert.equal(harness.callsTo('orderRequests.list').length, 2);
    assert.equal(harness.ordersViewState(), 'ready');
  });
});

describe('Stage 11 requirement 10: a request is read-only until it is confirmed', () => {
  it('opens a details dialog that changes nothing', async () => {
    const harness = await openOrdersPage();

    harness.openOrderDialog('req-1');

    assert.equal(harness.orderDialogOpen(), true);
    assert.equal(harness.callsTo('orderRequests.get').length, 0, 'opening reads the cached row, not the store');
    assert.equal(harness.callsTo('orders.process').length, 0);
  });

  it('shows the requested lines WITHOUT predicting an outcome', async () => {
    const harness = await openOrdersPage();

    harness.openOrderDialog('req-1');

    // Exactly the stored lines, one row each, in their stored quantities.
    assert.deepEqual(harness.orderDetailItems(), [
      ['بنادول', '3'],
      ['فيتامين', '2'],
    ]);
    // No stock figure, no total and no verdict may be invented locally.
    assert.equal(harness.orderDetailStatus(), orderStatusLabel('pending'));
    assert.equal(harness.orderDetailOrderId(), '—');
  });

  it('asks for confirmation BEFORE any processing attempt', async () => {
    const harness = await openOrdersPage();
    harness.openOrderDialog('req-1');

    await harness.clickProcessOrder();

    assert.equal(harness.orderConfirmOpen(), true);
    // The decisive assertion: a confirmation dialog, and not one write.
    assert.equal(harness.callsTo('orders.process').length, 0);
  });

  it('sends exactly ONE request id once the manager confirms', async () => {
    const harness = await openOrdersPage({
      ordersProcess: { ok: true, outcome: { outcome: 'processed', orderId: 'order-9', reason: null, status: null } },
    });
    harness.openOrderDialog('req-1');
    await harness.clickProcessOrder();

    await harness.clickConfirmOrder();

    const calls = harness.callsTo('orders.process');
    assert.equal(calls.length, 1, 'one confirmation, one attempt');
    // The payload crossed the `node:vm` boundary, so it is compared
    // STRUCTURALLY: its key set and its one value are the whole claim. A loose
    // deep-equal here would also pass for `{requestId, role}`, which is exactly
    // what must be impossible.
    const payload = calls[0]?.args[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ['requestId']);
    assert.equal(payload['requestId'], 'req-1');
  });

  it('does not process a request that is already processed', async () => {
    const harness = await openOrdersPage();
    harness.openOrderDialog('req-2');

    await harness.clickProcessOrder();

    assert.equal(harness.orderConfirmOpen(), false, 'nothing pending is offered for confirmation');
    assert.equal(harness.callsTo('orders.process').length, 0);
  });
});
  it('falls back to the uid when no employee name is available', async () => {
    const harness = await openOrdersPage();

    assert.equal(cellsOf(harness, 'req-3')[0], 'uid-third');
    assert.equal(cellsOf(harness, 'req-1')[0], 'سارة العامري');
  });

  it('shows a dash rather than inventing an order id for a pending request', async () => {
    const harness = await openOrdersPage();

    assert.equal(cellsOf(harness, 'req-1')[4], '—');
    assert.equal(cellsOf(harness, 'req-2')[4], 'order-9');
  });
});

/** Opens the dialog for `req-1`, presses process, and confirms. */
async function processFirstRequest(harness: Harness): Promise<void> {
  harness.openOrderDialog('req-1');
  await harness.clickProcessOrder();
  await harness.clickConfirmOrder();
}

/** The Arabic label the queue and the dialog print for one stored status. */
function orderStatusLabel(status: string): string {
  return { pending: 'قيد الانتظار', processed: 'تمت المعالجة', failed: 'فشل' }[status] ?? status;
}

/**
 * The status the SERVER must hold once `outcome` has been applied.
 *
 * Derived from the outcome rather than written into each test, because the
 * interesting property is that the document and the screen agree - asserting a
 * literal per test would let the two drift apart while both suites stayed green.
 * `processed` and `rejected` are both COMMITTED writes; `already-processed`
 * commits nothing, so the document is simply left where it already was.
 */
function storedStatusAfter(outcome: Record<string, unknown>): string {
  switch (outcome['outcome']) {
    case 'processed':
      return 'processed';
    case 'rejected':
      return 'failed';
    default:
      // Nothing was written, so no new status may be claimed for the document.
      return 'pending';
  }
}

describe('Stage 11 requirement 11: a processed request re-reads the truth', () => {
  /** The staged success every case in this section shares. */
  const PROCESSED = {
    outcome: 'processed',
    orderId: 'order-9',
    reason: null,
    status: null,
  } as Record<string, unknown>;

  it('shows the order id the engine returned, and re-reads the request', async () => {
    const harness = await openOrdersPage({ ordersProcess: { ok: true, outcome: PROCESSED } });

    await processFirstRequest(harness);

    const message = harness.orderOutcomeMessage();
    assert.equal(message !== null && message.includes(String(PROCESSED['orderId'])), true, 'the order id must be shown');
    // The screen may only claim what the server stored, so the document is re-read.
    assert.equal(harness.callsTo('orderRequests.get').length, 1);
    assert.equal(harness.callsTo('orderRequests.list').length, 2, 'the queue is refreshed too');
  });

  it('leaves the SERVER holding processed, with the order id it reported', async () => {
    const harness = await openOrdersPage({ ordersProcess: { ok: true, outcome: PROCESSED } });

    await processFirstRequest(harness);

    // Asserted on the stored document, not on the screen: W1-W5 committed.
    const stored = harness.storedOrder('req-1');
    assert.equal(stored?.['status'], storedStatusAfter(PROCESSED));
    assert.equal(stored?.['orderId'], PROCESSED['orderId']);
  });

  it('moves the row to the status the re-read returned, not to the outcome', async () => {
    const harness = await openOrdersPage({
      // The server ends up `processed`, and the single read reports exactly that.
      ordersProcess: { ok: true, outcome: PROCESSED },
      orderRequestsGet: {
        ok: true,
        order: { ...request(), status: 'processed', orderId: 'order-9', processedBy: 'uid-admin' },
      },
    });

    await processFirstRequest(harness);

    assert.equal(cellsOf(harness, 'req-1')[2], orderStatusLabel(storedStatusAfter(PROCESSED)));
    assert.equal(cellsOf(harness, 'req-1')[4], String(PROCESSED['orderId']));
    // The refreshed list must agree with the single read, or one of them is stale.
    assert.equal(harness.orderDetailStatus(), orderStatusLabel('processed'));
  });

  it('shows what the re-read says even when it disagrees with the outcome', async () => {
    // A deliberately inconsistent server: the engine said `processed`, but the
    // document it stored is still `pending`. A renderer that trusted the local
    // outcome would show a success the store does not contain.
    const harness = await openOrdersPage({
      ordersProcess: { ok: true, outcome: PROCESSED },
      orderRequestsGet: { ok: true, order: request() },
    });

    await processFirstRequest(harness);

    assert.equal(harness.orderDetailStatus(), orderStatusLabel('pending'));
    assert.equal(harness.orderDetailOrderId(), '—');
  });

  it('keeps the resolved employee name after the single-request re-read', async () => {
    // The `get` returns no name: it is list-only enrichment. Replacing the row
    // outright would blank the name the manager is looking at.
    const harness = await openOrdersPage({
      ordersProcess: { ok: true, outcome: PROCESSED },
      orderRequestsGet: {
        ok: true,
        order: { ...request(), status: 'processed', orderId: 'order-9', employeeName: null },
      },
    });

    await processFirstRequest(harness);

    assert.equal(cellsOf(harness, 'req-1')[0], 'سارة العامري');
    // The stored document is still authoritative for everything else.
    assert.equal(harness.orderDetailStatus(), orderStatusLabel('processed'));
  });
});

describe('Stage 11 requirement 12: a business rejection is NOT a malfunction', () => {
  /** The staged business refusal every case in this section shares. */
  const REJECTED = {
    outcome: 'rejected',
    orderId: null,
    reason: 'الكمية غير كافية',
    status: null,
  } as Record<string, unknown>;

  it('shows the engine reason and re-reads the failed marker', async () => {
    const harness = await openOrdersPage({ ordersProcess: { ok: true, outcome: REJECTED } });

    await processFirstRequest(harness);

    // The reason belongs to Stage 6 and must reach the manager verbatim.
    const message = harness.orderOutcomeMessage();
    assert.equal(message !== null && message.includes(String(REJECTED['reason'])), true);
    assert.equal(harness.orderDialogError(), null, 'a committed refusal is not an error banner');
    assert.equal(harness.callsTo('orderRequests.get').length, 1);
  });

  it('leaves the SERVER holding failed, with the reason it committed', async () => {
    const harness = await openOrdersPage({ ordersProcess: { ok: true, outcome: REJECTED } });

    await processFirstRequest(harness);

    // Stage 6 A2 COMMITS the `failed` marker. This is the transition most easily
    // mis-modelled as "nothing happened", so it is asserted on the document.
    const stored = harness.storedOrder('req-1');
    assert.equal(stored?.['status'], storedStatusAfter(REJECTED));
    assert.equal(stored?.['error'], REJECTED['reason']);
    assert.equal(stored?.['orderId'], null, 'a refused request creates no order');
  });

  it('still re-reads, because the status has just changed on the server', async () => {
    const harness = await openOrdersPage({ ordersProcess: { ok: true, outcome: REJECTED } });

    await processFirstRequest(harness);

    // The refreshed queue must agree with the committed marker.
    assert.equal(cellsOf(harness, 'req-1')[2], orderStatusLabel(storedStatusAfter(REJECTED)));
    assert.equal(harness.orderDetailStatus(), orderStatusLabel('failed'));
  });

  it('does NOT offer a retry for a request the engine has already closed', async () => {
    const harness = await openOrdersPage({ ordersProcess: { ok: true, outcome: REJECTED } });

    await processFirstRequest(harness);

    // A second confirmation would be refused by Stage 6 as already-processed.
    await harness.clickProcessOrder();
    assert.equal(harness.orderConfirmOpen(), false);
    assert.equal(harness.callsTo('orders.process').length, 1);
  });
});

describe('Stage 11 requirement 13: an already-processed request claims nothing', () => {
  /** The staged "the engine wrote nothing" outcome. */
  const ALREADY = {
    outcome: 'already-processed',
    orderId: null,
    reason: null,
    status: 'processed',
  } as Record<string, unknown>;

  it('claims no order id and re-reads the real state', async () => {
    const harness = await openOrdersPage({
      ordersProcess: { ok: true, outcome: ALREADY },
      orderRequestsGet: { ok: true, order: { ...request(), status: 'processed', orderId: 'order-9' } },
    });

    await processFirstRequest(harness);

    const message = harness.orderOutcomeMessage();
    assert.equal(message === null || !message.includes('order-'), true, 'no order may be invented');
    // The truth still has to be fetched, because the local cache was stale.
    assert.equal(harness.callsTo('orderRequests.get').length, 1);
    assert.equal(harness.orderDetailStatus(), orderStatusLabel('processed'));
  });

  it('fabricates NO transition in the stored document', async () => {
    // The decisive case for this section. `already-processed` means Stage 6 wrote
    // NOTHING, so a harness that invented a new state here would let a renderer
    // that mutates locally pass as if it were correct.
    const harness = await openOrdersPage({ ordersProcess: { ok: true, outcome: ALREADY } });

    await processFirstRequest(harness);

    const stored = harness.storedOrder('req-1');
    assert.equal(stored?.['status'], storedStatusAfter(ALREADY), 'the document must be untouched');
    assert.equal(stored?.['orderId'], null, 'no order id may appear');
    assert.equal(stored?.['processedAtIso'], null, 'no processing time may appear');
    assert.equal(stored?.['processedBy'], null, 'no actor may be recorded');
  });
});

describe('Stage 11 requirement 14: an infrastructure failure is an error, not a verdict', () => {
  it('shows the safe message, claims nothing, and re-reads anyway', async () => {
    const harness = await openOrdersPage({
      ordersProcess: {
        ok: false,
        error: { code: 'INFRASTRUCTURE_FAILURE', message: 'تعذر إتمام العملية. يُرجى المحاولة لاحقاً.', retryable: true },
      },
      orderRequestsGet: { ok: true, order: request() },
    });

    await processFirstRequest(harness);

    assert.equal(harness.orderOutcomeMessage(), null, 'a failure must not render a success line');
    assert.equal(harness.orderDialogError(), 'تعذر إتمام العملية. يُرجى المحاولة لاحقاً.');
    // The request is still re-read, so the row shows what is really stored.
    assert.equal(harness.callsTo('orderRequests.get').length, 1);
    assert.equal(cellsOf(harness, 'req-1')[2], orderStatusLabel('pending'));
  });

  it('leaves the stored document completely untouched', async () => {
    // A failure is not a verdict: the request stays `pending` and no order id,
    // error or timestamp may appear. Asserted on the server's copy, not the UI.
    for (const failure of [
      { ok: false, error: { code: 'INFRASTRUCTURE_FAILURE', message: 'خطأ', retryable: true } },
      { ok: false, error: { code: 'AUTHORIZATION_DENIED', message: 'ليست لديك صلاحية.', retryable: false } },
    ]) {
      const harness = await openOrdersPage({ ordersProcess: failure as never });
      await processFirstRequest(harness);

      const stored = harness.storedOrder('req-1');
      assert.equal(stored?.['status'], 'pending', `${failure.error.code} must not fail the request`);
      assert.equal(stored?.['orderId'], null);
      assert.equal(stored?.['processedAtIso'], null);
      assert.equal(stored?.['processedBy'], null);
      assert.equal(stored?.['error'], null);
    }
  });

  it('survives a THROWN bridge error without claiming success or writing', async () => {
    const harness = await openOrdersPage({
      throwOnOrdersProcess: true,
      orderRequestsGet: { ok: true, order: request() },
    });

    await processFirstRequest(harness);

    assert.equal(harness.orderOutcomeMessage(), null);
    assert.notEqual(harness.orderDialogError(), null, 'a thrown error must surface as a message');
    const stored = harness.storedOrder('req-1');
    assert.equal(stored?.['status'], 'pending', 'a thrown transport error changes nothing');
    assert.equal(stored?.['orderId'], null);
  });

  it('offers a retry only for a genuinely retryable failure', async () => {
    const harness = await openOrdersPage({
      ordersProcess: {
        ok: false,
        error: { code: 'AUTHORIZATION_DENIED', message: 'ليست لديك صلاحية.', retryable: false },
      },
      orderRequestsGet: { ok: true, order: request() },
    });

    await processFirstRequest(harness);

    // A denial is final. Showing "try again" would invite an endless refusal.
    assert.equal(harness.orderDialogError(), 'ليست لديك صلاحية.');
    assert.equal(harness.ordersViewState(), 'ready');
  });
});
