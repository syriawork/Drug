import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRendererHarness, type FakeSafeAuthState, type RendererHarness } from '../stage8/helpers/renderer-harness';

const EMPLOYEE: FakeSafeAuthState = {
  authenticated: true,
  uid: 'uid-employee',
  email: 'employee@example.com',
  emailVerified: true,
  expirationTimeIso: '2026-10-01T09:00:00.000Z',
  displayName: 'موظف',
  role: 'employee',
};

const MEDICINES = [{
  id: 'med-1',
  name: 'دواء من الكتالوج',
  maxQuantity: 5,
  stock: 20,
  totalInward: 30,
  totalOutward: 10,
}];

function requestReadArguments(harness: RendererHarness): unknown {
  return JSON.parse(JSON.stringify(harness.callsTo('orderRequests.get').map((call) => call.args))) as unknown;
}

function storedRequest(id: string, status: 'pending' | 'processed' | 'failed'): Record<string, unknown> {
  return {
    id,
    uid: 'uid-employee',
    items: [{ medicineId: 'med-1', medicineName: 'دواء من الكتالوج', quantity: 2 }],
    status,
    requestDateIso: '2026-10-08T06:00:00.000Z',
    orderId: null,
    error: null,
    processedBy: null,
    processedAtIso: null,
  };
}

async function openForm(options: Parameters<typeof createRendererHarness>[0] = {}) {
  const harness = await createRendererHarness({
    stateOnStartup: EMPLOYEE,
    medicinesList: { ok: true, medicines: MEDICINES },
    ...options,
  });
  await harness.openRequestSubmission();
  harness.chooseRequestMedicine('med-1');
  harness.typeRequestQuantity('2');
  harness.addRequestItem();
  return harness;
}

describe('Stage 18 employee request status refresh', () => {
  it('retains the successful submission id and initially displays the stored pending status', async () => {
    const harness = await openForm({
      orderRequestSubmit: { ok: true, requestId: 'request-owned-18' },
      orderRequestsGetSequence: [{ ok: true, order: storedRequest('request-owned-18', 'pending') }],
    });

    await harness.clickRequestSubmit();

    assert.equal(harness.requestSubmitState(), 'success');
    assert.match(harness.requestSubmitMessage(), /request-owned-18/);
    assert.equal(harness.requestStatusRequestId(), 'رقم الطلب: request-owned-18');
    assert.equal(harness.requestStatusState(), 'ready');
    assert.equal(harness.requestStatusMessage(), 'الحالة الحالية: قيد الانتظار');
    assert.deepEqual(requestReadArguments(harness), [
      [{ requestId: 'request-owned-18' }],
    ]);
  });

  it('refreshes that same request and displays the returned processed status without writes', async () => {
    const harness = await openForm({
      orderRequestSubmit: { ok: true, requestId: 'request-owned-18' },
      orderRequestsGetSequence: [
        { ok: true, order: storedRequest('request-owned-18', 'pending') },
        { ok: true, order: storedRequest('request-owned-18', 'processed') },
      ],
    });
    await harness.clickRequestSubmit();

    await harness.clickRequestStatusRefresh();

    assert.equal(harness.requestStatusMessage(), 'الحالة الحالية: تمت المعالجة');
    assert.deepEqual(requestReadArguments(harness), [
      [{ requestId: 'request-owned-18' }],
      [{ requestId: 'request-owned-18' }],
    ]);
    assert.equal(harness.callsTo('orderRequests.submit').length, 1);
    assert.equal(harness.callsTo('orders.process').length, 0);
    assert.equal(harness.callsTo('medicines.addInboundStock').length, 0);
  });

  it('displays the existing failed status returned by the single-request read', async () => {
    const harness = await openForm({
      orderRequestSubmit: { ok: true, requestId: 'request-failed-18' },
      orderRequestsGetSequence: [{ ok: true, order: storedRequest('request-failed-18', 'failed') }],
    });

    await harness.clickRequestSubmit();

    assert.equal(harness.requestStatusMessage(), 'الحالة الحالية: فشل');
    assert.deepEqual(
      JSON.parse(JSON.stringify(harness.callsTo('orderRequests.get')[0]?.args)) as unknown,
      [{ requestId: 'request-failed-18' }],
    );
  });

  it('shows loading while refreshing and then uses the latest stored response', async () => {
    let releaseRead: (() => void) | undefined;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const harness = await openForm({
      orderRequestSubmit: { ok: true, requestId: 'request-owned-18' },
      orderRequestsGetSequence: [
        { ok: true, order: storedRequest('request-owned-18', 'pending') },
        { ok: true, order: storedRequest('request-owned-18', 'processed') },
      ],
      orderRequestsGetGates: [undefined, readGate],
    });
    await harness.clickRequestSubmit();

    const refresh = harness.clickRequestStatusRefresh();
    assert.equal(harness.requestStatusState(), 'loading');
    assert.match(harness.requestStatusMessage(), /جارٍ قراءة الحالة/);
    releaseRead?.();
    await refresh;

    assert.equal(harness.requestStatusState(), 'ready');
    assert.equal(harness.requestStatusMessage(), 'الحالة الحالية: تمت المعالجة');
  });

  it('shows safe application and transport errors without exposing internal details', async () => {
    const applicationFailure = await openForm({
      orderRequestSubmit: { ok: true, requestId: 'request-owned-18' },
      orderRequestsGetSequence: [
        { ok: true, order: storedRequest('request-owned-18', 'pending') },
        { ok: false, error: { code: 'AUTHORIZATION_DENIED', message: 'ليست لديك صلاحية.', retryable: false } },
      ],
    });
    await applicationFailure.clickRequestSubmit();
    await applicationFailure.clickRequestStatusRefresh();
    assert.equal(applicationFailure.requestStatusState(), 'error');
    assert.equal(applicationFailure.requestStatusMessage(), 'ليست لديك صلاحية.');

    const transportFailure = await openForm({
      orderRequestSubmit: { ok: true, requestId: 'request-owned-18' },
      throwOnOrderRequestsGet: true,
    });
    await transportFailure.clickRequestSubmit();
    assert.equal(transportFailure.requestStatusState(), 'error');
    assert.match(transportFailure.requestStatusMessage(), /تعذر تحديث حالة الطلب/);
    assert.equal(transportFailure.requestStatusMessage().includes('transport failed'), false);
  });

  it('uses no arbitrary request id and refresh adds only the existing read call', async () => {
    const harness = await openForm({
      orderRequestSubmit: { ok: true, requestId: 'request-owned-18' },
      orderRequestsGetSequence: [
        { ok: true, order: storedRequest('request-owned-18', 'pending') },
        { ok: true, order: storedRequest('request-owned-18', 'failed') },
      ],
    });
    await harness.clickRequestSubmit();
    const writesBeforeRefresh = harness.calls.filter((call) => [
      'orderRequests.submit',
      'orders.process',
      'medicines.addInboundStock',
    ].includes(call.name)).length;

    await harness.clickRequestStatusRefresh();

    const writesAfterRefresh = harness.calls.filter((call) => [
      'orderRequests.submit',
      'orders.process',
      'medicines.addInboundStock',
    ].includes(call.name)).length;
    assert.equal(writesAfterRefresh, writesBeforeRefresh);
    assert.equal(harness.requestStatusMessage(), 'الحالة الحالية: فشل');
    assert.equal(harness.document.querySelectorAll('input').some((input) => input.id.includes('request-id')), false);
    assert.equal(harness.callsTo('orderRequests.get').length, 2);

    // Keep an explicit DOM interaction guard: there is no field in which another
    // request id could be entered, and the only refresh button accepts no value.
    assert.equal(harness.element('request-status-refresh').tagName, 'button');
  });
});
