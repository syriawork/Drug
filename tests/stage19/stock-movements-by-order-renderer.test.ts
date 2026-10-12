import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRendererHarness, type FakeSafeAuthState } from '../stage8/helpers/renderer-harness';

const SIGNED_IN: FakeSafeAuthState = {
  authenticated: true,
  uid: 'uid-admin',
  email: 'admin@example.com',
  emailVerified: true,
  expirationTimeIso: '2026-12-31T23:59:59.000Z',
  displayName: 'Nour',
  role: 'admin',
};

function historyRow(id: string): Record<string, unknown> {
  return {
    id,
    userId: 'uid-employee',
    employeeName: 'أحمد',
    items: [],
    itemCount: 0,
    dateIso: '2026-06-03T08:00:00.000Z',
    monthYear: '06-2026',
    monthYearDisplay: '06-2026',
    status: 'accepted',
    isExceptionOrder: false,
    requestId: `req-${id}`,
  };
}

function movement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'log-1',
    medicineId: 'med-42',
    label: 'stored description',
    quantity: 7,
    type: 'outward',
    dateIso: '2026-06-04T08:30:00.000Z',
    actorUid: 'uid-employee',
    requestId: 'req-9',
    orderId: 'ord-2',
    ...overrides,
  };
}

async function openedHarness(options: Parameters<typeof createRendererHarness>[0] = {}) {
  const harness = await createRendererHarness({
    stateOnStartup: SIGNED_IN,
    ordersList: { ok: true, orders: [historyRow('ord-1'), historyRow('ord-2')] },
    ...options,
  });
  await harness.openOrdersHistory();
  return harness;
}

describe('Stage 19: selected-order stock movement details', () => {
  it('shows loading then every stored field from the selected order only', async () => {
    const harness = await openedHarness({
      stockLogsByOrder: { ok: true, movements: [movement()] },
    });
    harness.openOrderHistoryDialog('ord-2');

    assert.equal(harness.orderHistoryMovementsState(), 'loading');
    await harness.settle();

    assert.equal(harness.orderHistoryMovementsState(), 'ready');
    const stockLogsCall = harness.calls.find((call) => call.name === 'stockLogs.listByOrder');
    assert.ok(stockLogsCall);
    assert.equal(stockLogsCall.args.length, 1);
    assert.deepEqual({ ...stockLogsCall.args[0] as Record<string, unknown> }, { orderId: 'ord-2' });
    const row = harness.orderHistoryMovementRows()[0];
    assert.notEqual(row, undefined);
    assert.deepEqual(row?.children.map((cell) => cell.textContent), [
      'log-1',
      'med-42',
      'stored description',
      'صادر من المخزون',
      '7',
      '2026-06-04T08:30:00.000Z',
      'uid-employee',
      'ord-2',
      'req-9',
    ]);
    assert.equal(harness.calls.some((call) => call.name.startsWith('stockLogs.') && call.name !== 'stockLogs.listByOrder'), false);
  });

  it('shows empty without fabricating rows when the selected order has no movements', async () => {
    const harness = await openedHarness({ stockLogsByOrder: { ok: true, movements: [] } });
    harness.openOrderHistoryDialog('ord-1');
    await harness.settle();

    assert.equal(harness.orderHistoryMovementsState(), 'empty');
    assert.equal(harness.orderHistoryMovementRows().length, 0);
    assert.equal(harness.element('order-history-movements-state-message').textContent, 'لا توجد حركات مخزون مسجّلة لهذا الطلب.');
  });

  it('shows the safe refusal and never converts it to an empty result', async () => {
    const harness = await openedHarness({
      stockLogsByOrder: {
        ok: false,
        error: { code: 'AUTHORIZATION_DENIED', message: 'ليست لديك صلاحية', retryable: false },
      },
    });
    harness.openOrderHistoryDialog('ord-2');
    await harness.settle();

    assert.equal(harness.orderHistoryMovementsState(), 'error');
    assert.equal(harness.orderHistoryMovementsError(), 'ليست لديك صلاحية');
    assert.equal(harness.orderHistoryMovementRows().length, 0);
  });

  it('shows a generic safe error for a thrown bridge failure', async () => {
    const harness = await openedHarness({ throwOnStockLogsByOrder: true });
    harness.openOrderHistoryDialog('ord-2');
    await harness.settle();

    assert.equal(harness.orderHistoryMovementsState(), 'error');
    assert.notEqual(harness.orderHistoryMovementsError(), '');
    assert.equal(harness.orderHistoryMovementsError()?.includes('transport failed'), false);
  });

  it('ignores a late result after the selected dialog is closed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = await openedHarness({
      stockLogsByOrder: { ok: true, movements: [movement()] },
      stockLogsByOrderGate: gate,
    });
    harness.openOrderHistoryDialog('ord-2');
    assert.equal(harness.orderHistoryMovementsState(), 'loading');
    harness.closeOrderHistoryDialog();
    release();
    await harness.settle();

    assert.equal(harness.orderHistoryDialogOpen(), false);
    assert.equal(harness.orderHistoryMovementsState(), 'idle');
    assert.equal(harness.orderHistoryMovementRows().length, 0);
  });
});
