/**
 * Stage 12 - the read-only orders-history renderer.
 *
 * These tests drive the REAL compiled bundle against the REAL shipped markup, the
 * way Stage 11's do, because the interesting failures here are behavioural:
 *
 *  - does the page read through the ONE argument-free named operation?
 *  - does filtering stay local, or does it quietly re-query the backend?
 *  - does every cell show a STORED value, with the line COUNT never a sum?
 *  - does the page offer any control that could change an order?
 *
 * The last group is the reason this file exists at all: a read-only claim that is
 * only checked in the markup would still hold if the renderer had attached a
 * write handler to a control added later.
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
 * One history row exactly as the Main process projects it.
 *
 * `itemCount` is written explicitly and separately from `items` so a test that
 * expects the renderer to print `itemCount` cannot accidentally pass because the
 * row happened to contain one line.
 */
function historyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ord-1',
    userId: 'uid-emp',
    employeeName: 'أحمد',
    items: [{ medicineId: 'med-1', medicineName: 'Panadol', quantity: 3 }],
    itemCount: 1,
    dateIso: '2026-06-03T08:00:00.000Z',
    monthYear: '06-2026',
    monthYearDisplay: '06-2026',
    status: 'pending',
    isExceptionOrder: false,
    requestId: 'req-1',
    ...overrides,
  };
}

/** Builds the harness signed in, with the given `orders.list()` answer. */
async function openHistory(
  orders: readonly unknown[],
  options: Parameters<typeof createRendererHarness>[0] = {},
): Promise<Harness> {
  const harness = await createRendererHarness({
    stateOnStartup: SIGNED_IN,
    ordersList: { ok: true, orders },
    ...options,
  });
  await harness.openOrdersHistory();
  return harness;
}

/** The first rendered row, failing loudly rather than indexing `undefined`. */
function firstRow(harness: Harness): ReturnType<Harness['orderHistoryRows']>[number] {
  const row = harness.orderHistoryRows()[0];
  assert.notEqual(row, undefined, 'the history page rendered no rows');
  return row as ReturnType<Harness['orderHistoryRows']>[number];
}

/**
 * Every `orders.*` call the page made, as `[name, argumentCount]`.
 *
 * The argument count is the payload: `0` means the renderer supplied nothing at
 * all, which is the whole Stage 12 claim at the transport level.
 */
function ordersCalls(harness: Harness): (readonly [string, number])[] {
  return harness.calls
    .filter((call) => call.name.startsWith('orders.'))
    .map((call) => [call.name, call.args.length] as const);
}

describe('Stage 12 requirement 6: the page reads through ONE argument-free operation', () => {
  it('opens the page and reads the history', async () => {
    const harness = await openHistory([historyRow(), historyRow({ id: 'ord-2' })]);

    assert.equal(harness.element('orders-history-view').hidden, false);
    assert.equal(harness.element('orders-view').hidden, true, 'the queue page must be hidden');
    assert.equal(harness.orderHistoryRows().length, 2);
    assert.deepEqual(
      harness.calls.filter((call) => call.name === 'orders.list').map((call) => call.args),
      [[]],
      'the history read must carry NO argument',
    );
  });

  it('issues no orders call other than the single argument-free read', async () => {
    const harness = await openHistory([historyRow()]);

    // `getAppStatus` and `auth.getState` belong to startup, not to this page, so
    // the assertion is scoped to the orders namespace - which is the namespace a
    // write would have to travel through.
    assert.deepEqual(ordersCalls(harness), [['orders.list', 0]]);
  });

  it('reads once, then serves from its cache while navigating', async () => {
    const harness = await openHistory([historyRow()]);

    // Leaving and coming back must not re-read: the queue and the history keep
    // SEPARATE caches precisely so neither can mask the other.
    await harness.openOrders();
    await harness.openOrdersHistory();

    assert.equal(harness.calls.filter((call) => call.name === 'orders.list').length, 1);
  });

  it('re-reads only when refresh is asked for', async () => {
    const harness = await openHistory([historyRow()]);

    await harness.clickOrdersHistoryRefresh();

    assert.equal(harness.calls.filter((call) => call.name === 'orders.list').length, 2);
  });

  it('shows an empty state rather than an error when there are no orders', async () => {
    const harness = await openHistory([]);

    assert.equal(harness.ordersHistoryViewState(), 'empty');
    assert.equal(harness.orderHistoryRows().length, 0);
    assert.equal(harness.ordersHistoryError(), null);
  });

  it('shows the safe error on a refusal, and retries on demand', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      ordersList: { ok: false, error: { code: 'AUTHORIZATION_DENIED', message: 'ليست لديك صلاحية', retryable: false } },
    });

    await harness.openOrdersHistory();
    assert.equal(harness.ordersHistoryViewState(), 'error');
    assert.equal(harness.ordersHistoryError(), 'ليست لديك صلاحية');
    assert.equal(harness.orderHistoryRows().length, 0, 'no rows may be invented after a refusal');

    // The retry control is exactly what a manager needs here.
    assert.equal(harness.element('orders-history-retry').hidden, false);
    await harness.clickOrdersHistoryRefresh();
    assert.equal(harness.calls.filter((call) => call.name === 'orders.list').length, 2);
  });

  it('treats a thrown bridge failure as an error, never as an empty page', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: SIGNED_IN,
      throwOnOrdersList: true,
    });

    await harness.openOrdersHistory();

    // "No orders" and "could not read" are different facts, and conflating them
    // would let a manager conclude the audit trail is empty.
    assert.equal(harness.ordersHistoryViewState(), 'error');
    assert.notEqual(harness.ordersHistoryError(), '');
  });
});
describe('Stage 12 requirement 7: search and filtering stay LOCAL', () => {
  it('filters by employee name without asking the bridge again', async () => {
    const harness = await openHistory([
      historyRow({ id: 'ord-1', userId: 'uid-1', employeeName: 'أحمد' }),
      historyRow({ id: 'ord-2', userId: 'uid-2', employeeName: 'ليلى' }),
    ]);

    harness.searchOrdersHistory('ليلى');

    assert.deepEqual(harness.orderHistoryRows().map((row) => row.getAttribute('data-order-id')), ['ord-2']);
    assert.equal(harness.calls.filter((call) => call.name === 'orders.list').length, 1);
  });

  it('falls back to the uid when the order carries no name', async () => {
    const harness = await openHistory([
      historyRow({ id: 'ord-1', userId: 'uid-1', employeeName: 'أحمد' }),
      historyRow({ id: 'ord-2', userId: 'uid-legacy', employeeName: null }),
    ]);

    harness.searchOrdersHistory('uid-legacy');

    // An audit surface must remain searchable for the rows that predate names.
    assert.deepEqual(harness.orderHistoryRows().map((row) => row.getAttribute('data-order-id')), ['ord-2']);
  });

  it('matches a medicine name as well as the employee', async () => {
    const harness = await openHistory([
      historyRow({ id: 'ord-1', employeeName: 'أحمد', items: [{ medicineId: 'med-1', medicineName: 'Panadol', quantity: 1 }] }),
      historyRow({ id: 'ord-2', employeeName: 'ليلى', items: [{ medicineId: 'med-2', medicineName: 'Vitamin C', quantity: 1 }] }),
    ]);

    harness.searchOrdersHistory('vitamin');

    assert.deepEqual(harness.orderHistoryRows().map((row) => row.getAttribute('data-order-id')), ['ord-2']);
    assert.equal(harness.calls.filter((call) => call.name === 'orders.list').length, 1);
  });

  it('narrows by status locally, and combines with the search term', async () => {
    const harness = await openHistory([
      historyRow({ id: 'ord-1', employeeName: 'أحمد', status: 'pending' }),
      historyRow({ id: 'ord-2', employeeName: 'أحمد', status: 'accepted' }),
      historyRow({ id: 'ord-3', employeeName: 'ليلى', status: 'accepted' }),
    ]);

    harness.filterOrdersHistoryByStatus('accepted');
    assert.deepEqual(
      harness.orderHistoryRows().map((row) => row.getAttribute('data-order-id')).sort(),
      ['ord-2', 'ord-3'],
    );

    harness.searchOrdersHistory('أحمد');
    assert.deepEqual(harness.orderHistoryRows().map((row) => row.getAttribute('data-order-id')), ['ord-2']);

    assert.equal(harness.calls.filter((call) => call.name === 'orders.list').length, 1);
  });

  it('ignores a filter value it does not recognise instead of blanking the page', async () => {
    const harness = await openHistory([historyRow({ id: 'ord-1' })]);

    harness.filterOrdersHistoryByStatus('processed');

    // `processed` is a REQUEST status, not an order status. Treating an unknown
    // value as a filter would hide every row; treating it as "all" is safe.
    assert.deepEqual(harness.orderHistoryRows().map((row) => row.getAttribute('data-order-id')), ['ord-1']);
  });

  it('reports how many results the current filter shows', async () => {
    const harness = await openHistory([
      historyRow({ id: 'ord-1', status: 'pending' }),
      historyRow({ id: 'ord-2', status: 'accepted' }),
    ]);

    harness.filterOrdersHistoryByStatus('accepted');

    const summary = harness.ordersHistoryCount();
    assert.match(summary, /1/);
    assert.match(summary, /2/, 'the total must stay visible alongside the filtered count');
  });
});
describe('Stage 12 requirement 8: the table shows stored facts only', () => {
  it('prints the stored name, id, date, month and status', async () => {
    const harness = await openHistory([historyRow()]);

    const cells = harness.orderHistoryRowCells(firstRow(harness));

    assert.equal(cells[0], 'أحمد');
    assert.equal(cells[1], 'ord-1');
    assert.equal(cells[2], '2026-06-03T08:00:00.000Z', 'the ISO date is shown exactly as stored');
    assert.equal(cells[3], '06-2026', 'the month is shown exactly as the application projected it');
    assert.equal(cells[4], 'قيد الانتظار');
  });

  it('prints the item COUNT and never a sum of quantities', async () => {
    const harness = await openHistory([
      historyRow({
        items: [
          { medicineId: 'med-1', medicineName: 'Panadol', quantity: 7 },
          { medicineId: 'med-1', medicineName: 'Panadol', quantity: 5 },
        ],
        itemCount: 2,
      }),
    ]);

    const cells = harness.orderHistoryRowCells(firstRow(harness));

    // The count column says `2`. A total would say `12` - a number the stored
    // order never contained, published by a screen with no right to aggregate.
    assert.equal(cells[5], '2');
    assert.equal(cells.includes('12'), false);
  });

  it('labels all THREE stored order statuses in Arabic', async () => {
    const harness = await openHistory([
      historyRow({ id: 'ord-1', status: 'pending' }),
      historyRow({ id: 'ord-2', status: 'accepted' }),
      historyRow({ id: 'ord-3', status: 'rejected' }),
    ]);

    const statuses = harness.orderHistoryRows().map((row) => harness.orderHistoryRowCells(row)[4]);

    // `orders.status` is the MOBILE app's lifecycle. Relabelling it as a request
    // status would invent a processing history that did not happen.
    assert.deepEqual(statuses, ['قيد الانتظار', 'مقبول', 'مرفوض']);
  });

  it('falls back to the uid when no name is available', async () => {
    const harness = await openHistory([historyRow({ userId: 'uid-legacy', employeeName: null })]);

    assert.equal(harness.orderHistoryRowCells(firstRow(harness))[0], 'uid-legacy');
  });

  it('shows a dash instead of inventing a month or a request id', async () => {
    const harness = await openHistory([historyRow({ monthYear: '', monthYearDisplay: null, requestId: null })]);

    const cells = harness.orderHistoryRowCells(firstRow(harness));

    assert.equal(cells[3], 'غير محدد', 'no month may be derived in the renderer');
    assert.equal(cells[6], 'غير محدد', 'an order with no request must not gain one');
  });

  it('shows the stored request id when the order has one', async () => {
    const harness = await openHistory([historyRow({ requestId: 'req-42' })]);

    assert.equal(harness.orderHistoryRowCells(firstRow(harness))[6], 'req-42');
  });
});
describe('Stage 12 requirement 9: the details dialog is READ-ONLY', () => {
  it('opens from the row and shows every stored field', async () => {
    const harness = await openHistory([historyRow({ requestId: 'req-42', isExceptionOrder: true })]);

    harness.openOrderHistoryDialog('ord-1');

    assert.equal(harness.orderHistoryDialogOpen(), true);
    const details = harness.orderHistoryDetails();
    assert.equal(details['id'], 'ord-1');
    assert.equal(details['employee'], 'أحمد');
    assert.equal(details['date'], '2026-06-03T08:00:00.000Z');
    assert.equal(details['month'], '06-2026');
    assert.equal(details['status'], 'قيد الانتظار');
    assert.equal(details['exception'], 'نعم');
    assert.equal(details['request'], 'req-42');
  });

  it('lists the item snapshots exactly as the order stored them', async () => {
    const harness = await openHistory([
      historyRow({
        items: [
          { medicineId: 'med-1', medicineName: 'Panadol', quantity: 7 },
          { medicineId: 'med-2', medicineName: 'Vitamin C', quantity: 2 },
        ],
        itemCount: 2,
      }),
    ]);

    harness.openOrderHistoryDialog('ord-1');

    // Quantities appear here as stored FACTS about a line, which is different
    // from summing them into a total. Both lines are shown, duplicates intact.
    assert.deepEqual(harness.orderHistoryDetailItems(), [['Panadol', '7'], ['Vitamin C', '2']]);
  });

  it('closes without sending anything to the backend', async () => {
    const harness = await openHistory([historyRow()]);
    harness.openOrderHistoryDialog('ord-1');

    harness.closeOrderHistoryDialog();

    assert.equal(harness.orderHistoryDialogOpen(), false);
    assert.equal(harness.calls.filter((call) => call.name === 'orders.list').length, 1);
  });

  it('offers NO control that could change an order', async () => {
    const harness = await openHistory([
      historyRow({ id: 'ord-1' }),
      historyRow({ id: 'ord-2' }),
    ]);
    harness.openOrderHistoryDialog('ord-1');

    // The shipped controls are read-only: refresh, print, retry, local search and
    // filters, load more, close. The exact list rejects order-changing actions.
    assert.deepEqual(harness.orderHistoryControls().map(([id]) => id).sort(), [
      'order-history-dialog-close',
      'orders-history-load-more',
      'orders-history-print',
      'orders-history-refresh',
      'orders-history-retry',
      'orders-history-search-input',
      'orders-history-status-filter',
    ]);

    // Tags matter as much as ids: a `<form>` in this scope would give a
    // `<button>` a submit meaning it does not have elsewhere.
    assert.deepEqual(
      [...harness.orderHistoryControls()].sort(([a], [b]) => a.localeCompare(b)),
      [
        ['order-history-dialog-close', 'button'],
        ['orders-history-load-more', 'button'],
        ['orders-history-print', 'button'],
        ['orders-history-refresh', 'button'],
        ['orders-history-retry', 'button'],
        ['orders-history-search-input', 'input'],
        ['orders-history-status-filter', 'select'],
      ],
    );

    // The markup alone, read as text with no DOM and no renderer running at all,
    // agrees. This cannot be satisfied by anything living only in the bundle.
    assert.deepEqual([...harness.orderHistoryButtonsInMarkup()].sort(), [
      'order-history-dialog-close',
      'orders-history-load-more',
      'orders-history-print',
      'orders-history-refresh',
      'orders-history-retry',
      'orders-history-search-input',
      'orders-history-status-filter',
    ]);

    // The only controls the renderer adds are the per-row "view" buttons, and it
    // adds nothing else: two rows, two buttons, each addressed by `data-order-id`.
    const rowButtons = harness
      .orderHistoryRows()
      .map((row) => row.children.flatMap((cell) => cell.children))
      .flat();
    assert.deepEqual(
      rowButtons.map((button) => [button.tagName, button.getAttribute('data-order-id')]),
      [['button', 'ord-1'], ['button', 'ord-2']],
    );

    // And the strongest statement available at runtime: with every control in
    // reach, the page issued the named read and nothing else.
    assert.deepEqual(ordersCalls(harness), [['orders.list', 0]]);
  });

  it('calls no orders write even after browsing, filtering and opening rows', async () => {
    const harness = await openHistory([
      historyRow({ id: 'ord-1', status: 'pending' }),
      historyRow({ id: 'ord-2', status: 'accepted' }),
    ]);

    harness.searchOrdersHistory('a');
    harness.filterOrdersHistoryByStatus('accepted');
    harness.openOrderHistoryDialog('ord-2');
    harness.closeOrderHistoryDialog();
    await harness.clickOrdersHistoryRefresh();

    // Only the named read, and it twice - once on entry, once on refresh. Any
    // other `orders.*` call would be a write this page has no right to make.
    assert.deepEqual(ordersCalls(harness), [['orders.list', 0], ['orders.list', 0]]);
  });
});

describe('Stage 12 requirement 10: the page holds nothing after sign-out', () => {
  it('drops the audit trail when the session ends', async () => {
    const harness = await openHistory([
      historyRow({ id: 'ord-1', employeeName: 'أحمد' }),
      historyRow({ id: 'ord-2', employeeName: 'ليلى' }),
    ]);
    harness.openOrderHistoryDialog('ord-1');
    assert.equal(harness.orderHistoryDialogOpen(), true);

    await harness.clickLogout();

    // Every row names an employee and the medicines they asked for. None of it
    // may survive behind the login form.
    assert.equal(harness.orderHistoryRows().length, 0);
    assert.equal(harness.orderHistoryDetailItems().length, 0);
    assert.equal(harness.orderHistoryDialogOpen(), false);
    assert.equal(harness.ordersHistoryCount(), '');
    assert.equal(harness.element('login-view').hidden, false);
  });
});