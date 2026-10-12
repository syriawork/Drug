import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FakeMedicinesRepository, FakeOrderRequestsRepository, makeMedicine, rulesDenied } from '../stage7/helpers/fakes';
import { buildApplication } from '../stage9/helpers';

const VALID_ITEMS = [{ medicineId: 'med-1', quantity: 2 }] as const;

function buildSubmissionApplication(options: {
  readonly medicines?: FakeMedicinesRepository;
  readonly requests?: FakeOrderRequestsRepository;
} = {}) {
  const medicines = options.medicines ?? new FakeMedicinesRepository([
    makeMedicine({ id: 'med-1', name: 'الاسم من الكتالوج' }),
  ]);
  const requests = options.requests ?? new FakeOrderRequestsRepository();
  return {
    application: buildApplication(undefined, medicines, requests),
    medicines,
    requests,
  };
}

describe('Stage 16 application submission', () => {
  it('uses the trusted session uid, resolves the medicine name, and returns the repository id', async () => {
    const { application, requests } = buildSubmissionApplication();

    const result = await application.orderRequests.submitPendingRequest({ items: VALID_ITEMS });

    assert.deepEqual(result, { ok: true, value: { requestId: 'req-generated-stage16' } });
    assert.equal(requests.submitted.length, 1);
    assert.equal(requests.submitted[0]?.uid, 'uid-admin');
    assert.deepEqual(requests.submitted[0]?.items, [{
      medicineId: 'med-1',
      medicineName: 'الاسم من الكتالوج',
      quantity: 2,
    }]);
  });

  it('preserves duplicate medicine lines for Stage 6 aggregation', async () => {
    const { application, requests } = buildSubmissionApplication();

    const result = await application.orderRequests.submitPendingRequest({
      items: [
        { medicineId: 'med-1', quantity: 2 },
        { medicineId: 'med-1', quantity: 3 },
      ],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(requests.submitted[0]?.items.map((item) => item.quantity), [2, 3]);
  });

  it('drops a second in-flight application submission', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests = new FakeOrderRequestsRepository([], null, 'req-once', null, gate);
    const { application } = buildSubmissionApplication({ requests });
    const first = application.orderRequests.submitPendingRequest({ items: VALID_ITEMS });
    const second = await application.orderRequests.submitPendingRequest({ items: VALID_ITEMS });

    assert.equal(second.ok, false);
    assert.equal(!second.ok ? second.error.code : null, 'VALIDATION_FAILED');
    assert.deepEqual(requests.submitted, []);
    release?.();
    assert.deepEqual(await first, { ok: true, value: { requestId: 'req-once' } });
    assert.equal(requests.submitted.length, 1);
  });

  it('rejects renderer-controlled identity and stored request fields before repository access', async () => {
    const hostilePayloads: readonly unknown[] = [
      { items: VALID_ITEMS, uid: 'uid-victim' },
      { items: VALID_ITEMS, status: 'processed' },
      { items: VALID_ITEMS, requestDate: '2026-01-01T00:00:00.000Z' },
      { items: VALID_ITEMS, requestId: 'chosen-id' },
      { items: VALID_ITEMS, orderId: 'chosen-order' },
      { items: [{ medicineId: 'med-1', medicineName: 'forged', quantity: 2 }] },
      { items: [{ medicineId: 'med-1', quantity: 2, stock: 100 }] },
      { items: VALID_ITEMS, document: {}, path: 'order_requests/victim' },
    ];
    const { application, medicines, requests } = buildSubmissionApplication();

    for (const payload of hostilePayloads) {
      const result = await application.orderRequests.submitPendingRequest(payload);
      assert.equal(result.ok, false);
      assert.equal(!result.ok ? result.error.code : null, 'VALIDATION_FAILED');
    }
    assert.deepEqual(requests.submitted, []);
    assert.deepEqual(medicines.getMedicineCalls, [], 'malformed payloads must be rejected before catalogue reads');
  });

  it('rejects empty lists, malformed items, invalid quantities, and more than five raw lines', async () => {
    const malformed: readonly unknown[] = [
      { items: [] },
      null,
      [],
      { items: [null] },
      { items: [{}] },
      { items: [{ medicineId: '', quantity: 1 }] },
      { items: [{ medicineId: 'med-1', quantity: 0 }] },
      { items: [{ medicineId: 'med-1', quantity: -1 }] },
      { items: [{ medicineId: 'med-1', quantity: 1.5 }] },
      { items: [{ medicineId: 'med-1', quantity: Number.MAX_SAFE_INTEGER + 1 }] },
      { items: Array.from({ length: 6 }, () => ({ medicineId: 'med-1', quantity: 1 })) },
    ];
    const { application, requests } = buildSubmissionApplication();

    for (const payload of malformed) {
      const result = await application.orderRequests.submitPendingRequest(payload);
      assert.equal(result.ok, false, `payload ${JSON.stringify(payload)} must be refused`);
      assert.equal(!result.ok ? result.error.code : null, 'VALIDATION_FAILED');
    }
    assert.deepEqual(requests.submitted, []);
  });

  it('returns NOT_FOUND when a medicine is absent and never submits the request', async () => {
    const { application, requests } = buildSubmissionApplication({
      medicines: new FakeMedicinesRepository([]),
    });

    const result = await application.orderRequests.submitPendingRequest({ items: VALID_ITEMS });

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'NOT_FOUND');
    assert.deepEqual(requests.submitted, []);
  });

  it('maps repository and Rules failures into the safe application envelope', async () => {
    const { application } = buildSubmissionApplication({
      requests: new FakeOrderRequestsRepository([], null, 'unused', rulesDenied('order_requests/hidden')),
    });

    const result = await application.orderRequests.submitPendingRequest({ items: VALID_ITEMS });

    assert.deepEqual(result, {
      ok: false,
      error: {
        code: 'AUTHORIZATION_DENIED',
        message: 'ليست لديك صلاحية تنفيذ هذه العملية وفق قواعد أمان Firebase',
        retryable: false,
      },
    });
  });
});
