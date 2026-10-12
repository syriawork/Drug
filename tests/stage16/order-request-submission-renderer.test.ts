import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRendererHarness, FakeEvent, type FakeSafeAuthState } from '../stage8/helpers/renderer-harness';

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

async function openForm(options: Parameters<typeof createRendererHarness>[0] = {}) {
  const harness = await createRendererHarness({
    stateOnStartup: EMPLOYEE,
    medicinesList: { ok: true, medicines: MEDICINES },
    ...options,
  });
  await harness.openRequestSubmission();
  return harness;
}

describe('Stage 16 employee request submission UI', () => {
  it('creates a request using only medicineId and quantity and explains it is pending', async () => {
    const harness = await openForm();
    harness.chooseRequestMedicine('med-1');
    harness.typeRequestQuantity('2');
    harness.addRequestItem();
    assert.deepEqual(harness.requestItems(), [['دواء من الكتالوج', '2', 'حذف']]);

    await harness.clickRequestSubmit();

    const call = harness.callsTo('orderRequests.submit')[0];
    assert.deepEqual(JSON.parse(JSON.stringify(call?.args)) as unknown, [{
      items: [{ medicineId: 'med-1', quantity: 2 }],
    }]);
    assert.equal(harness.requestSubmitState(), 'success');
    assert.match(harness.requestSubmitMessage(), /أُنشئ الطلب request-created-1/);
    assert.match(harness.requestSubmitMessage(), /قيد الانتظار للمراجعة/);
    assert.match(harness.requestSubmitMessage(), /لم تتم معالجته بعد/);
    assert.equal(harness.callsTo('orders.process').length, 0);
  });

  it('shows basic validation errors without calling the submission service', async () => {
    const harness = await openForm();
    harness.chooseRequestMedicine('med-1');
    harness.typeRequestQuantity('1.5');
    harness.addRequestItem();

    assert.equal(harness.requestSubmitState(), 'validation');
    assert.match(harness.requestSubmitMessage(), /كمية صحيحة أكبر من صفر/);
    assert.equal(harness.callsTo('orderRequests.submit').length, 0);

    await harness.clickRequestSubmit();
    assert.equal(harness.requestSubmitState(), 'validation');
    assert.equal(harness.callsTo('orderRequests.submit').length, 0);
  });

  it('shows application failures using the safe result message', async () => {
    const harness = await openForm({
      orderRequestSubmit: {
        ok: false,
        error: { code: 'AUTHORIZATION_DENIED', message: 'رفضته قواعد الأمان', retryable: false },
      },
    });
    harness.chooseRequestMedicine('med-1');
    harness.typeRequestQuantity('1');
    harness.addRequestItem();
    await harness.clickRequestSubmit();

    assert.equal(harness.requestSubmitState(), 'error');
    assert.equal(harness.requestSubmitMessage(), 'رفضته قواعد الأمان');
    assert.equal(harness.element('request-submit-retry').hidden, true);
  });

  it('shows a safe message when the named preload operation rejects in transit', async () => {
    const harness = await openForm({ throwOnOrderRequestSubmit: true });
    harness.chooseRequestMedicine('med-1');
    harness.typeRequestQuantity('1');
    harness.addRequestItem();
    await harness.clickRequestSubmit();

    assert.equal(harness.requestSubmitState(), 'error');
    assert.match(harness.requestSubmitMessage(), /تعذر إرسال الطلب/);
    assert.equal(harness.requestSubmitMessage().includes('transport failed'), false);
  });

  it('drops accidental duplicate clicks while submission is in progress', async () => {
    let releaseSubmission: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseSubmission = resolve;
    });
    const harness = await openForm({ orderRequestSubmitGate: gate });
    harness.chooseRequestMedicine('med-1');
    harness.typeRequestQuantity('1');
    harness.addRequestItem();

    harness.element('request-submit').dispatchEvent(new FakeEvent('click'));
    harness.element('request-submit').dispatchEvent(new FakeEvent('click'));
    await harness.settle();
    assert.equal(harness.callsTo('orderRequests.submit').length, 1);
    assert.equal(harness.requestSubmitState(), 'submitting');

    releaseSubmission?.();
    await harness.settle();
    assert.equal(harness.requestSubmitState(), 'success');
  });
});
