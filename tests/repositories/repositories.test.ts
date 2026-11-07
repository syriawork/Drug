import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_FIRESTORE_DATABASE_ID, type FirestoreRestConfig } from '../../electron/config/firestore-config';
import { DomainError, OrderRequestSubmissionError } from '../../electron/domain/errors';
import { FirestoreTimestamp, encodeFields } from '../../electron/services/firestore-codec';
import { FirestoreRestClient } from '../../electron/services/firestore-rest';
import { FirestoreMedicinesRepository, FirestoreSettingsRepository } from '../../electron/repositories/firestore/medicines-repository';
import { FirestoreUsersRepository } from '../../electron/repositories/firestore/users-repository';
import {
  FirestoreOrderRequestsRepository,
  FirestoreOrdersRepository,
  FirestoreStockLogsRepository,
} from '../../electron/repositories/firestore/order-repository';

/**
 * Stage 5B (PART 13-L, M, N) - repository tests with an INJECTED fetch.
 *
 * These prove two things a Firestore mock could not:
 *  - the repository builds the RIGHT URL, method and body for a given intent;
 *  - the repository TRANSLATES failures into `DomainError` and never leaks a
 *    `FirestoreRestError` above the repository layer.
 *
 * They deliberately do NOT assert security decisions - "is this caller allowed?"
 * is answered by firestore.rules and is proven against the real emulator in
 * tests/repositories/repository-emulator.test.ts.
 */

const TEST_CONFIG: FirestoreRestConfig = Object.freeze({
  projectId: 'demo-unit-repositories',
  databaseId: DEFAULT_FIRESTORE_DATABASE_ID,
  emulatorHost: '127.0.0.1:8080',
  requestTimeoutMs: 5000,
});
const TEST_TOKEN = 'eyJhbGciOiJub25lIn0.eyJ1c2VyX2lkIjoidWlkLTEifQ.signature';

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
}

interface Repositories {
  readonly users: FirestoreUsersRepository;
  readonly medicines: FirestoreMedicinesRepository;
  readonly settings: FirestoreSettingsRepository;
  readonly requests: FirestoreOrderRequestsRepository;
  readonly orders: FirestoreOrdersRepository;
  readonly logs: FirestoreStockLogsRepository;
}

function createClient(handler: (request: CapturedRequest) => { status: number; body?: unknown }): {
  readonly repositories: Repositories;
  readonly captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];

  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const request: CapturedRequest = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    };
    captured.push(request);
    const result = handler(request);
    return new Response(result.body === undefined ? '' : JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const client = new FirestoreRestClient({
    config: TEST_CONFIG,
    getAccessToken: async () => TEST_TOKEN,
    fetchImpl,
    allowRemoteTarget: false,
  });
  const context = { client };
  return {
    repositories: {
      users: new FirestoreUsersRepository(context),
      medicines: new FirestoreMedicinesRepository(context),
      settings: new FirestoreSettingsRepository(context),
      requests: new FirestoreOrderRequestsRepository(context),
      orders: new FirestoreOrdersRepository(context),
      logs: new FirestoreStockLogsRepository(context),
    },
    captured,
  };
}

function documentBody(relativePath: string, data: Record<string, unknown>): unknown {
  return {
    name: `projects/${TEST_CONFIG.projectId}/databases/${TEST_CONFIG.databaseId}/documents/${relativePath}`,
    fields: encodeFields(data),
    createTime: '2026-01-01T00:00:00.000000Z',
    updateTime: '2026-01-01T00:00:00.000000Z',
  };
}

const SEED_MEDICINE = { name: 'Ø¨Ø§Ø±Ø§Ø³ÙŠØªØ§Ù…ÙˆÙ„', maxQuantity: 5, stock: 10, totalInward: 20, totalOutward: 5 };
const SEED_USER = { uid: 'u1', role: 'employee', name: 'ØµÙŠØ¯Ù„Ø§Ù†ÙŠ', employeeId: '100', status: 'approved' };
const NOT_FOUND = { status: 404, body: { error: { code: 404, status: 'NOT_FOUND', message: 'missing' } } };
const COMMIT_OK = { status: 200, body: { commitTime: '2026-06-03T08:00:00.000Z', writeResults: [] } };

describe('Stage 5B/L: repository reads build the intended request', () => {
  it('getUser issues GET users/{uid}', async () => {
    const { repositories, captured } = createClient(() => ({ status: 200, body: documentBody('users/u1', SEED_USER) }));
    const user = await repositories.users.getUser('u1');

    assert.ok(captured[0]?.url.endsWith('/documents/users/u1'), captured[0]?.url);
    assert.equal(captured[0]?.method, 'GET');
    assert.equal(user?.uid, 'u1');
    assert.equal(user?.role, 'employee');
  });

  it('getUser returns null for a missing document (404 is not an error here)', async () => {
    const { repositories } = createClient(() => NOT_FOUND);
    assert.equal(await repositories.users.getUser('ghost'), null);
  });

  it('getMedicine issues GET medicines/{id} and maps the counters', async () => {
    const { repositories, captured } = createClient(() => ({ status: 200, body: documentBody('medicines/m1', SEED_MEDICINE) }));
    const medicine = await repositories.medicines.getMedicine('m1');

    assert.ok(captured[0]?.url.endsWith('/documents/medicines/m1'), captured[0]?.url);
    assert.equal(medicine?.stock, 10);
    assert.equal(medicine?.maxQuantity, 5);
  });

  it('getAppSettings always targets settings/app, never settings/schedule (D9)', async () => {
    const { repositories, captured } = createClient(() => ({
      status: 200,
      body: documentBody('settings/app', { minDaysBetweenOrders: 20, startTime: '08:00' }),
    }));
    const settings = await repositories.settings.getAppSettings();

    assert.ok(captured[0]?.url.endsWith('/documents/settings/app'), captured[0]?.url);
    assert.equal(settings?.minDaysBetweenOrders, 20);
    assert.equal(settings?.endTime, '10:00', 'absent fields use the Android fallbacks');
  });

  it('getAppSettings returns null when the document does not exist', async () => {
    const { repositories } = createClient(() => NOT_FOUND);
    assert.equal(await repositories.settings.getAppSettings(), null, 'absence is reported, not invented');
  });

  it('getOrderRequest maps the creation fields plus the processing fields', async () => {
    const { repositories, captured } = createClient(() => ({
      status: 200,
      body: documentBody('order_requests/r1', {
        uid: 'u1',
        items: [{ medicineId: 'm1', medicineName: 'x', quantity: 1 }],
        status: 'processed',
        requestDate: FirestoreTimestamp.parse('2026-06-03T08:00:00.000Z'),
        orderId: 'o1',
        processedBy: 'admin1',
      }),
    }));
    const request = await repositories.requests.getOrderRequest('r1');

    assert.ok(captured[0]?.url.endsWith('/documents/order_requests/r1'), captured[0]?.url);
    assert.equal(request?.uid, 'u1');
    assert.equal(request?.orderId, 'o1');
    assert.equal(request?.requestDate.isoValue, '2026-06-03T08:00:00.000Z');
  });

  it('getOrder maps monthYear verbatim and defaults isExceptionOrder', async () => {
    const { repositories } = createClient(() => ({
      status: 200,
      body: documentBody('orders/o1', {
        userId: 'u1',
        items: [],
        date: FirestoreTimestamp.parse('2026-06-03T08:00:00.000Z'),
        monthYear: 'Ù Ù¦-Ù¢Ù Ù¢Ù¦',
        status: 'accepted',
      }),
    }));
    const order = await repositories.orders.getOrder('o1');
    assert.equal(order?.monthYear, 'Ù Ù¦-Ù¢Ù Ù¢Ù¦');
    assert.equal(order?.isExceptionOrder, false);
  });

  it('listStockLogs maps the A4 descriptive userName into label', async () => {
    const { repositories } = createClient(() => ({
      status: 200,
      body: { documents: [documentBody('stock_logs/l1', {
        uid: 'admin1', medicineId: 'm1', medicineName: 'x', quantity: 3, type: 'inward',
        date: FirestoreTimestamp.parse('2026-06-03T08:00:00.000Z'),
        userName: 'Ø§Ù„Ù…Ø¯ÙŠØ± (Ø¯ÙˆØ§Ø¡ Ø¬Ø¯ÙŠØ¯)',
      })] },
    }));
    const logs = await repositories.logs.listStockLogs(10);
    assert.equal(logs[0]?.label, 'Ø§Ù„Ù…Ø¯ÙŠØ± (Ø¯ÙˆØ§Ø¡ Ø¬Ø¯ÙŠØ¯)');
    assert.equal(logs[0]?.actorUid, 'admin1');
  });
});

describe('Stage 5B/N: repository errors are translated, never leaked', () => {
  it('translates 403 into DomainError(NOT_AUTHORIZED), preserving the cause', async () => {
    const { repositories } = createClient(() => ({
      status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'denied by rules' } },
    }));

    await assert.rejects(
      () => repositories.users.listAllUsers(),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.kind, 'NOT_AUTHORIZED');
        assert.notEqual(error.cause, undefined, 'the original error is kept for diagnostics');
        return true;
      },
    );
  });

  it('translates 401 into NOT_AUTHORIZED as well (no session)', async () => {
    const { repositories } = createClient(() => ({
      status: 401, body: { error: { code: 401, status: 'UNAUTHENTICATED', message: 'no auth' } },
    }));
    await assert.rejects(
      () => repositories.medicines.listMedicines(5),
      (error: unknown) => error instanceof DomainError && error.kind === 'NOT_AUTHORIZED',
    );
  });

  it('rejects an empty id before any request is sent', async () => {
    const { repositories, captured } = createClient(() => ({ status: 200, body: {} }));
    await assert.rejects(
      () => repositories.users.getUser(''),
      (error: unknown) => error instanceof DomainError && error.kind === 'INVALID_INPUT',
    );
    assert.equal(captured.length, 0, 'no request may be sent for an invalid argument');
  });

  it('rejects a non-positive limit instead of downloading everything', async () => {
    const { repositories, captured } = createClient(() => ({ status: 200, body: {} }));
    await assert.rejects(
      () => repositories.medicines.listMedicines(0),
      (error: unknown) => error instanceof DomainError && error.kind === 'INVALID_INPUT',
    );
    await assert.rejects(
      () => repositories.requests.listPendingOrderRequests(-1),
      (error: unknown) => error instanceof DomainError && error.kind === 'INVALID_INPUT',
    );
    assert.equal(captured.length, 0);
  });
});

describe('Stage 5B/M: administrative writes are masked', () => {
  it('approveUser commits a masked update of status only', async () => {
    const { repositories, captured } = createClient(() => COMMIT_OK);
    await repositories.users.approveUser('u1');

    const body = JSON.parse(captured[0]?.body ?? '{}') as {
      writes: Array<{ updateMask?: { fieldPaths: string[] }; update: { fields: Record<string, unknown> } }>;
    };
    assert.deepEqual(body.writes[0]?.updateMask, { fieldPaths: ['status'] });
    assert.deepEqual(body.writes[0]?.update.fields, { status: { stringValue: 'approved' } });
  });

  it('grantSingleOrderException masks hasException so the lastOrder* summary survives', async () => {
    const { repositories, captured } = createClient(() => COMMIT_OK);
    await repositories.users.grantSingleOrderException('u1');

    const body = JSON.parse(captured[0]?.body ?? '{}') as {
      writes: Array<{ updateMask?: { fieldPaths: string[] } }>;
    };
    assert.deepEqual(body.writes[0]?.updateMask, { fieldPaths: ['hasException'] });
  });

  it('saveAppSettings masks all six fields and targets settings/app', async () => {
    const { repositories, captured } = createClient(() => COMMIT_OK);

    await repositories.settings.saveAppSettings({
      minDaysBetweenOrders: 20, maxDailyOrders: 50, allowFridayOrders: false,
      startTime: '07:00', endTime: '09:00', assistantId: 'EMP-1',
    });

    const body = JSON.parse(captured[0]?.body ?? '{}') as {
      writes: Array<{ update: { name: string }; updateMask?: { fieldPaths: string[] } }>;
    };
    assert.ok(body.writes[0]?.update.name.endsWith('/documents/settings/app'), body.writes[0]?.update.name);
    assert.equal(body.writes[0]?.updateMask?.fieldPaths.length, 6);
  });
});

describe('Stage 5B/M: submitPendingRequest satisfies the rules create clause', () => {
  it('commits a create with exactly the four allowed keys and a REQUEST_TIME transform', async () => {
    const { repositories, captured } = createClient(() => COMMIT_OK);

    const requestId = 'request-stable-test-1';
    const outcome = await repositories.requests.submitPendingRequest({
      requestId,
      uid: 'u1',
      items: [{ medicineId: 'm1', medicineName: 'x', quantity: 2 }],
    });

    assert.equal(outcome, 'created');

    const body = JSON.parse(captured[0]?.body ?? '{}') as {
      writes: Array<{
        update: { name: string; fields: Record<string, unknown> };
        currentDocument?: { exists: boolean };
        updateTransforms?: Array<{ fieldPath: string; setToServerValue: string }>;
      }>;
    };
    const write = body.writes[0];

    assert.deepEqual(Object.keys(write?.update.fields ?? {}).sort(), ['items', 'status', 'uid']);
    assert.equal(
      'requestDate' in (write?.update.fields ?? {}),
      false,
      'requestDate is a TRANSFORM, never a field value',
    );
    assert.deepEqual(write?.updateTransforms, [
      { fieldPath: 'requestDate', setToServerValue: 'REQUEST_TIME' },
    ]);
    assert.deepEqual(write?.currentDocument, { exists: false }, 'a create precondition, so it cannot overwrite');
    assert.ok(write?.update.name.endsWith(`/documents/order_requests/${requestId}`), write?.update.name);
  });

  it('reconciles ALREADY_EXISTS only after strict raw validation, preserving duplicate item lines', async () => {
    const requestId = 'stable-request-duplicate-lines';
    const existing = documentBody(`order_requests/${requestId}`, {
      uid: 'u1',
      status: 'processed',
      requestDate: FirestoreTimestamp.fromDate(new Date('2021-01-01T00:00:00.000Z')),
      items: [
        { medicineId: 'm1', medicineName: 'renamed display snapshot', quantity: 1 },
        { medicineId: 'm1', medicineName: 'another display snapshot', quantity: 1 },
      ],
    });
    const { repositories, captured } = createClient((request) => request.method === 'POST'
      ? { status: 409, body: { error: { status: 'ALREADY_EXISTS', message: 'exists' } } }
      : { status: 200, body: existing });

    const outcome = await repositories.requests.submitPendingRequest({
      requestId,
      uid: 'u1',
      items: [
        { medicineId: 'm1', medicineName: 'current catalogue name', quantity: 1 },
        { medicineId: 'm1', medicineName: 'current catalogue name', quantity: 1 },
      ],
    });

    assert.equal(outcome, 'reconciled');
    assert.deepEqual(captured.map((request) => request.method), ['POST', 'GET']);
  });

  it('accepts each supported existing order-request status and never compares requestDate to the client clock', async () => {
    for (const status of ['pending', 'processed', 'failed']) {
      const requestId = `stable-status-${status}`;
      const { repositories } = createClient((request) => request.method === 'POST'
        ? { status: 409, body: { error: { status: 'ALREADY_EXISTS', message: 'exists' } } }
        : {
          status: 200,
          body: documentBody(`order_requests/${requestId}`, {
            uid: 'u1',
            status,
            requestDate: FirestoreTimestamp.fromDate(new Date('2001-01-01T00:00:00.000Z')),
            items: [{ medicineId: 'm1', medicineName: 'snapshot', quantity: 2 }],
          }),
        });

      assert.equal(await repositories.requests.submitPendingRequest({
        requestId,
        uid: 'u1',
        items: [{ medicineId: 'm1', medicineName: 'snapshot', quantity: 2 }],
      }), 'reconciled');
    }
  });

  it('marks a different UID or item multiset as an identity conflict', async () => {
    const cases = [
      {
        uid: 'u2',
        storedItems: [{ medicineId: 'm1', medicineName: 'x', quantity: 2 }],
        submittedItems: [{ medicineId: 'm1', medicineName: 'x', quantity: 2 }],
      },
      {
        uid: 'u1',
        storedItems: [{ medicineId: 'm2', medicineName: 'x', quantity: 2 }],
        submittedItems: [{ medicineId: 'm1', medicineName: 'x', quantity: 2 }],
      },
      {
        uid: 'u1',
        storedItems: [
          { medicineId: 'm1', medicineName: 'x', quantity: 2 },
          { medicineId: 'm1', medicineName: 'x', quantity: 2 },
        ],
        submittedItems: [{ medicineId: 'm1', medicineName: 'x', quantity: 2 }],
      },
      {
        uid: 'u1',
        storedItems: [{ medicineId: 'm1', medicineName: 'x', quantity: 2 }],
        submittedItems: [
          { medicineId: 'm1', medicineName: 'x', quantity: 2 },
          { medicineId: 'm1', medicineName: 'x', quantity: 2 },
        ],
      },
      {
        uid: 'u1',
        storedItems: [{ medicineId: 'm1', medicineName: 'x', quantity: 3 }],
        submittedItems: [{ medicineId: 'm1', medicineName: 'x', quantity: 2 }],
      },
    ];
    for (const testCase of cases) {
      const requestId = 'stable-identity-conflict';
      const { repositories } = createClient((request) => request.method === 'POST'
        ? { status: 409, body: { error: { status: 'ALREADY_EXISTS', message: 'exists' } } }
        : {
          status: 200,
          body: documentBody(`order_requests/${requestId}`, {
            uid: testCase.uid,
            status: 'pending',
            requestDate: FirestoreTimestamp.fromDate(new Date('2020-01-01T00:00:00.000Z')),
            items: testCase.storedItems,
          }),
        });
      assert.equal(await repositories.requests.submitPendingRequest({
        requestId,
        uid: 'u1',
        items: testCase.submittedItems,
      }), 'identity-conflict');
    }
  });

  it('fails closed on unknown status, malformed documents, or invalid requestDate', async () => {
    const invalidDocuments = [
      { uid: 'u1', status: 'mystery', requestDate: FirestoreTimestamp.fromDate(new Date()), items: [{ medicineId: 'm1', medicineName: 'x', quantity: 1 }] },
      { uid: 'u1', status: 'pending', items: [{ medicineId: 'm1', medicineName: 'x', quantity: 1 }] },
      { uid: 'u1', status: 'pending', requestDate: null, items: [{ medicineId: 'm1', medicineName: 'x', quantity: 1 }] },
      { uid: 'u1', status: 'pending', requestDate: '2026-01-01', items: [{ medicineId: 'm1', medicineName: 'x', quantity: 1 }] },
      { uid: 'u1', status: 'pending', requestDate: { seconds: '1767225600', nanos: 0 }, items: [{ medicineId: 'm1', medicineName: 'x', quantity: 1 }] },
      { uid: 'u1', status: 'pending', requestDate: FirestoreTimestamp.fromDate(new Date()), items: [{ medicineId: 'm1', medicineName: 'x', quantity: 1 }], unexpected: true },
    ];
    for (const data of invalidDocuments) {
      const requestId = 'stable-malformed-existing';
      const { repositories } = createClient((request) => request.method === 'POST'
        ? { status: 409, body: { error: { status: 'ALREADY_EXISTS', message: 'exists' } } }
        : { status: 200, body: documentBody(`order_requests/${requestId}`, data) });
      await assert.rejects(
        () => repositories.requests.submitPendingRequest({
          requestId,
          uid: 'u1',
          items: [{ medicineId: 'm1', medicineName: 'x', quantity: 1 }],
        }),
        (error: unknown) => error instanceof DomainError && error.kind === 'MALFORMED_DATA',
      );
    }
  });

  it('keeps an ALREADY_EXISTS read failure unresolved rather than converting it into a rejection', async () => {
    const { repositories } = createClient((request) => request.method === 'POST'
      ? { status: 409, body: { error: { status: 'ALREADY_EXISTS', message: 'exists' } } }
      : { status: 503, body: { error: { status: 'UNAVAILABLE', message: 'offline' } } });

    await assert.rejects(
      () => repositories.requests.submitPendingRequest({
        requestId: 'stable-read-failure',
        uid: 'u1',
        items: [{ medicineId: 'm1', medicineName: 'x', quantity: 1 }],
      }),
      (error: unknown) => error instanceof DomainError && error.kind === 'UNKNOWN',
    );
  });

  it('preserves ABORTED, FAILED_PRECONDITION, and permission-denied classifications', async () => {
    const cases = [
      { reason: 'ABORTED', status: 409, kind: 'ABORTED', resolution: 'unknown' },
      { reason: 'FAILED_PRECONDITION', status: 412, kind: 'PRECONDITION_FAILED', resolution: 'definitive_rejection' },
      { reason: 'PERMISSION_DENIED', status: 403, kind: 'NOT_AUTHORIZED', resolution: 'definitive_rejection' },
    ] as const;
    for (const testCase of cases) {
      const { repositories } = createClient(() => ({
        status: testCase.status,
        body: { error: { status: testCase.reason, message: testCase.reason } },
      }));
      await assert.rejects(
        () => repositories.requests.submitPendingRequest({
          requestId: `stable-${testCase.reason.toLowerCase()}`,
          uid: 'u1',
          items: [{ medicineId: 'm1', medicineName: 'x', quantity: 1 }],
        }),
        (error: unknown) => (
          error instanceof OrderRequestSubmissionError
          && error.kind === testCase.kind
          && error.resolution === testCase.resolution
        ),
      );
    }
  });

  it('translates a rules rejection into NOT_AUTHORIZED', async () => {
    const { repositories } = createClient(() => ({
      status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'not approved' } },
    }));

    await assert.rejects(
      () => repositories.requests.submitPendingRequest({
        requestId: 'request-stable-test-2',
        uid: 'u1',
        items: [],
      }),
      (error: unknown) => error instanceof DomainError && error.kind === 'NOT_AUTHORIZED',
    );
  });
});