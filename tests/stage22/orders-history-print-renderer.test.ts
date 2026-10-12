import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRendererHarness, type FakeSafeAuthState } from '../stage8/helpers/renderer-harness';

const ADMIN: FakeSafeAuthState = {
  authenticated: true,
  uid: 'admin-a',
  email: 'admin@example.com',
  emailVerified: true,
  expirationTimeIso: null,
  role: 'admin',
};

function order(
  id: string,
  status: 'pending' | 'accepted' | 'rejected',
  employeeName: string,
  medicineName: string,
): Record<string, unknown> {
  return {
    id,
    userId: `uid-${id}`,
    employeeName,
    items: [{ medicineId: `med-${id}`, medicineName, quantity: 2 }],
    itemCount: 1,
    dateIso: '2026-06-03T08:00:00.000Z',
    monthYear: '06-2026',
    monthYearDisplay: '06-2026',
    status,
    isExceptionOrder: false,
    requestId: `req-${id}`,
  };
}

describe('Stage 22 administrator order-history print report', () => {
  it('prints only filtered rows with report metadata and no additional backend reads', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: ADMIN,
      ordersList: {
        ok: true,
        orders: [
          order('order-print-1', 'accepted', 'أحمد', 'بانادول'),
          order('order-print-2', 'rejected', 'ليلى', 'أمبيكس'),
        ],
        hasMore: true,
      },
    });

    await harness.openOrdersHistory();
    harness.filterOrdersHistoryByStatus('accepted');
    harness.searchOrdersHistory('بانادول');
    const callsBeforePrint = harness.calls.length;

    harness.clickOrdersHistoryPrint();

    assert.equal(harness.printCalls(), 1);
    assert.equal(harness.calls.length, callsBeforePrint);
    assert.deepEqual(harness.orderHistoryRows().map((row) => harness.orderHistoryRowCells(row)), [[
      'أحمد',
      'order-print-1',
      '2026-06-03T08:00:00.000Z',
      '06-2026',
      'مقبول',
      '1',
      'req-order-print-1',
      'عرض',
    ]]);
    assert.equal(harness.element('orders-history-report-title').textContent, 'تقرير سجل الطلبات الإداري');
    assert.equal(harness.element('orders-history-report-filters').textContent, 'البحث: بانادول؛ الحالة: مقبول');
    assert.equal(harness.element('orders-history-report-count').textContent, 'عدد النتائج المعروضة: 1');
    assert.match(harness.element('orders-history-report-generated-at').textContent, /تاريخ ووقت إنشاء التقرير/);
    assert.match(harness.element('orders-history-report-scope').textContent, /الطلبات المحمّلة والمصفّاة محليًا حاليًا/);
    assert.match(harness.element('orders-history-report-scope').textContent, /قد تتوفر صفحات إضافية/);
    assert.match(harness.element('orders-history-report-scope').textContent, /لا يُضمن الترتيب الزمني/);
    assert.match(harness.element('orders-history-report-scope').textContent, /اتساق اللقطة/);
  });

  it('prints an empty filtered result count with accurate window scope and no extra history read', async () => {
    const harness = await createRendererHarness({
      stateOnStartup: ADMIN,
      ordersList: {
        ok: true,
        orders: [order('order-print-3', 'pending', 'سارة', 'دواء')],
      },
    });

    await harness.openOrdersHistory();
    harness.searchOrdersHistory('غير موجود');
    harness.clickOrdersHistoryPrint();

    assert.equal(harness.printCalls(), 1);
    assert.equal(harness.orderHistoryRows().length, 0);
    assert.equal(harness.element('orders-history-report-count').textContent, 'عدد النتائج المعروضة: 0');
    assert.equal(harness.element('orders-history-report-empty').hidden, false);
    assert.match(harness.element('orders-history-report-empty').textContent, /لا توجد طلبات تطابق عوامل التصفية/);
    assert.match(harness.element('orders-history-report-filters').textContent, /البحث: غير موجود/);
    assert.equal(harness.calls.filter((call) => call.name === 'orders.list').length, 1);
  });
});
