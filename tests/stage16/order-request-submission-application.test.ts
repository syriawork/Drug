import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { OrderRequestJournal } from '../../electron/application';
import { DomainError } from '../../electron/domain/errors';
import { OperationJournal } from '../../electron/journal/operation-journal';
import {
  FakeMedicinesRepository,
  FakeOrderRequestsRepository,
  FakeSession,
  makeMedicine,
  rulesDenied,
} from '../stage7/helpers/fakes';
import { buildApplication } from '../stage9/helpers';
import {
  createStage36a2IdentityFactory,
  MemoryOrderRequestJournal,
} from './order-request-journal-fake';

const VALID_ITEMS = [{ medicineId: 'med-1', quantity: 2 }] as const;

class FailOnceOrderRequestsRepository extends FakeOrderRequestsRepository {
  private failNext = true;

  public override async submitPendingRequest(
    input: Parameters<FakeOrderRequestsRepository['submitPendingRequest']>[0],
  ): Promise<'created' | 'reconciled' | 'identity-conflict'> {
    if (this.failNext) {
      this.failNext = false;
      throw new DomainError('TRANSPORT', 'connection reset after request send');
    }
    return super.submitPendingRequest(input);
  }
}

function buildSubmissionApplication(options: {
  readonly medicines?: FakeMedicinesRepository;
  readonly requests?: FakeOrderRequestsRepository;
  readonly journal?: OrderRequestJournal;
  readonly sessionUid?: string;
  readonly events?: string[];
} = {}) {
  const medicines = options.medicines ?? new FakeMedicinesRepository([
    makeMedicine({ id: 'med-1', name: 'الاسم من الكتالوج' }),
  ]);
  const requests = options.requests ?? new FakeOrderRequestsRepository();
  const journal = options.journal ?? new MemoryOrderRequestJournal(options.events);
  return {
    application: buildApplication(
      undefined,
      medicines,
      requests,
      undefined,
      options.sessionUid === undefined ? undefined : FakeSession.signedIn(options.sessionUid),
      journal,
      createStage36a2IdentityFactory(),
    ),
    medicines,
    requests,
    journal,
  };
}

describe('Stage 36A2B order-request idempotency', () => {
  it('uses the Main-owned uid, journals distinct IDs, resolves trusted names, and confirms the result', async () => {
    const { application, requests, journal } = buildSubmissionApplication();

    const result = await application.orderRequests.submitPendingRequest({ items: VALID_ITEMS });

    assert.deepEqual(result, {
      ok: true,
      value: { operationId: 'stage36a2:operation-1', requestId: 'req-generated-stage16-1' },
    });
    assert.equal(requests.submitted.length, 1);
    assert.equal(requests.submitted[0]?.uid, 'uid-admin');
    assert.equal(requests.submitted[0]?.requestId, 'req-generated-stage16-1');
    assert.deepEqual(requests.submitted[0]?.items, [{
      medicineId: 'med-1',
      medicineName: 'الاسم من الكتالوج',
      quantity: 2,
    }]);
    const record = (await journal.listRecords())[0];
    assert.equal(record?.lifecycle.status, 'confirmed');
    assert.equal(record?.lifecycle.originalResultReference, 'order_requests/req-generated-stage16-1');
    assert.deepEqual(await application.orderRequests.listUnresolvedOrderRequests(), { ok: true, value: [] });
  });

  it('confirms a reconciled repository result and records its document reference', async () => {
    class ReconciledOrderRequestsRepository extends FakeOrderRequestsRepository {
      public override async submitPendingRequest(
        input: Parameters<FakeOrderRequestsRepository['submitPendingRequest']>[0],
      ): Promise<'created' | 'reconciled' | 'identity-conflict'> {
        await super.submitPendingRequest(input);
        return 'reconciled';
      }
    }

    const { application, journal } = buildSubmissionApplication({
      requests: new ReconciledOrderRequestsRepository(),
    });

    const result = await application.orderRequests.submitPendingRequest({ items: VALID_ITEMS });

    assert.equal(result.ok, true);
    const record = (await journal.listRecords())[0];
    assert.equal(record?.lifecycle.status, 'confirmed');
    assert.equal(record?.lifecycle.originalResultReference, 'order_requests/req-generated-stage16-1');
  });

  it('records an identity conflict without claiming a confirmed result reference', async () => {
    class ConflictingOrderRequestsRepository extends FakeOrderRequestsRepository {
      public override async submitPendingRequest(
        input: Parameters<FakeOrderRequestsRepository['submitPendingRequest']>[0],
      ): Promise<'created' | 'reconciled' | 'identity-conflict'> {
        await super.submitPendingRequest(input);
        return 'identity-conflict';
      }
    }

    const { application, journal } = buildSubmissionApplication({
      requests: new ConflictingOrderRequestsRepository(),
    });

    const result = await application.orderRequests.submitPendingRequest({ items: VALID_ITEMS });

    assert.equal(result.ok, false);
    const record = (await journal.listRecords())[0];
    assert.equal(record?.lifecycle.status, 'identity_conflict');
    assert.equal(record?.lifecycle.originalResultReference, null);
  });

  it('persists identity and request mapping before Firestore reads, then stores the exact payload before create', async () => {
    const events: string[] = [];
    class TrackedMedicinesRepository extends FakeMedicinesRepository {
      public override async getMedicine(medicineId: string) {
        events.push('firestore:catalogue-read');
        return super.getMedicine(medicineId);
      }
    }
    class TrackedOrderRequestsRepository extends FakeOrderRequestsRepository {
      public override async submitPendingRequest(
        input: Parameters<FakeOrderRequestsRepository['submitPendingRequest']>[0],
      ): Promise<'created' | 'reconciled' | 'identity-conflict'> {
        events.push('firestore:create');
        return super.submitPendingRequest(input);
      }
    }
    const requests = new TrackedOrderRequestsRepository();
    const { application } = buildSubmissionApplication({
      medicines: new TrackedMedicinesRepository([makeMedicine({ id: 'med-1', name: 'الاسم من الكتالوج' })]),
      requests,
      events,
    });

    await application.orderRequests.submitPendingRequest({ items: VALID_ITEMS });

    assert.deepEqual(events, [
      'journal:prepare:stage36a2:operation-1:req-generated-stage16-1',
      'firestore:catalogue-read',
      'journal:payload',
      'journal:status:submission_unknown',
      'firestore:create',
      'journal:status:confirmed',
    ]);
  });

  it('preserves duplicate item lines in the immutable Firestore payload', async () => {
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

  it('gives two identical new submissions fresh identities, including concurrent submissions', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests = new FakeOrderRequestsRepository([], null, 'unused', null, gate);
    const { application } = buildSubmissionApplication({ requests });
    const first = application.orderRequests.submitPendingRequest({ items: VALID_ITEMS });
    const second = application.orderRequests.submitPendingRequest({ items: VALID_ITEMS });
    await Promise.resolve();
    assert.equal(requests.submitted.length, 0);

    release?.();
    const results = await Promise.all([first, second]);

    assert.equal(results.every((result) => result.ok), true);
    assert.deepEqual(
      results.map((result) => result.ok ? result.value.operationId : null),
      ['stage36a2:operation-1', 'stage36a2:operation-2'],
    );
    assert.deepEqual(requests.submitted.map((entry) => entry.requestId), [
      'req-generated-stage16-1',
      'req-generated-stage16-2',
    ]);
  });

  it('resumes an ambiguous attempt with the original operation, request ID, and immutable payload', async () => {
    const requests = new FailOnceOrderRequestsRepository();
    const { application, journal } = buildSubmissionApplication({ requests });
    assert.equal((await application.orderRequests.submitPendingRequest({ items: VALID_ITEMS })).ok, false);

    const unresolved = await application.orderRequests.listUnresolvedOrderRequests();
    const storedBeforeRetry = (await journal.listRecords())[0];
    assert.equal(unresolved.ok && unresolved.value[0]?.operationId, 'stage36a2:operation-1');
    assert.equal(unresolved.ok && unresolved.value[0]?.requestId, 'req-generated-stage16-1');
    assert.equal(unresolved.ok && unresolved.value[0]?.status, 'submission_unknown');
    assert.equal(storedBeforeRetry?.lifecycle.originalResultReference, null);
    assert.deepEqual(storedBeforeRetry?.orderRequest?.payload?.items, [{
      medicineId: 'med-1',
      medicineName: 'الاسم من الكتالوج',
      quantity: 2,
    }]);

    const resumed = await application.orderRequests.resumeOrderRequest('stage36a2:operation-1');

    assert.deepEqual(resumed, {
      ok: true,
      value: { operationId: 'stage36a2:operation-1', requestId: 'req-generated-stage16-1' },
    });
    assert.equal(requests.submitted[0]?.requestId, 'req-generated-stage16-1');
    assert.deepEqual(requests.submitted[0]?.items, storedBeforeRetry?.orderRequest?.payload?.items);
    assert.equal((await journal.listRecords())[0]?.lifecycle.status, 'confirmed');
    assert.equal(
      (await journal.listRecords())[0]?.lifecycle.originalResultReference,
      'order_requests/req-generated-stage16-1',
    );
  });

  it('recovers the unresolved entry after constructing a new journal instance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'drug-manager-stage36a2-restart-'));
    try {
      const firstJournal = new OperationJournal(directory);
      await firstJournal.initialize();
      const first = buildSubmissionApplication({
        requests: new FailOnceOrderRequestsRepository(),
        journal: firstJournal,
      });
      assert.equal((await first.application.orderRequests.submitPendingRequest({ items: VALID_ITEMS })).ok, false);

      const restartedJournal = new OperationJournal(directory);
      await restartedJournal.initialize();
      const requestsAfterRestart = new FakeOrderRequestsRepository();
      const restarted = buildSubmissionApplication({
        requests: requestsAfterRestart,
        journal: restartedJournal,
      });
      const unresolved = await restarted.application.orderRequests.listUnresolvedOrderRequests();
      assert.equal(unresolved.ok && unresolved.value[0]?.operationId, 'stage36a2:operation-1');

      const result = await restarted.application.orderRequests.resumeOrderRequest('stage36a2:operation-1');

      assert.deepEqual(result, {
        ok: true,
        value: { operationId: 'stage36a2:operation-1', requestId: 'req-generated-stage16-1' },
      });
      assert.equal(requestsAfterRestart.submitted[0]?.requestId, 'req-generated-stage16-1');
      assert.deepEqual(
        requestsAfterRestart.submitted[0]?.items,
        (await restartedJournal.get('stage36a2:operation-1'))?.orderRequest?.payload?.items,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not expose or resume another authenticated user’s journal entry', async () => {
    const first = buildSubmissionApplication({ requests: new FailOnceOrderRequestsRepository() });
    await first.application.orderRequests.submitPendingRequest({ items: VALID_ITEMS });
    const otherUser = buildSubmissionApplication({
      requests: new FakeOrderRequestsRepository(),
      journal: first.journal,
      sessionUid: 'uid-other',
    });

    assert.deepEqual(await otherUser.application.orderRequests.listUnresolvedOrderRequests(), {
      ok: true,
      value: [],
    });
    const result = await otherUser.application.orderRequests.resumeOrderRequest('stage36a2:operation-1');
    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'NOT_FOUND');
    assert.deepEqual(otherUser.requests.submitted, []);
  });

  it('rejects renderer-controlled identity and document metadata before repository access', async () => {
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
    assert.deepEqual(medicines.getMedicineCalls, []);
  });

  it('rejects malformed or oversized item lists', async () => {
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
      assert.equal(result.ok, false);
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

  it('maps Rules failures into a safe application envelope', async () => {
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
