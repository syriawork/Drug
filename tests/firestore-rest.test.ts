import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type FirestoreRestConfig,
  DEFAULT_FIRESTORE_DATABASE_ID,
  FirestoreConfigError,
  assertLocalFirestoreTarget,
  assertSafeRelativePath,
  buildFirestoreDocumentResourceName,
  buildFirestoreDocumentsUrlPrefix,
  isLoopbackHost,
  resolveFirestoreRestConfig,
} from '../electron/config/firestore-config';
import {
  FirestoreCodecError,
  FirestoreTimestamp,
  SERVER_TIMESTAMP,
  type FirestoreRawValue,
  decodeFields,
  decodeValue,
  encodeFields,
  encodeFieldPath,
  encodeFieldPathSegment,
  encodeValue,
  extractServerTimestamps,
  isServerTimestamp,
  parseFieldPath,
} from '../electron/services/firestore-codec';
import {
  FirestoreRestClient,
  FirestoreRestError,
  generateAutoId,
  sanitizeServerMessage,
  type FirestoreRestReason,
} from '../electron/services/firestore-rest';

/**
 * Unit tests for the Stage 3 Firestore REST client.
 *
 * These tests use an injected fetch implementation because they verify request
 * *plumbing only* (URLs, headers, encoded bodies, error mapping). Security Rules
 * behaviour is NOT tested here - it is proven exclusively by
 * tests/firestore-rules-emulator.test.ts against the real emulators with real
 * Firebase ID tokens.
 */

const TEST_CONFIG: FirestoreRestConfig = Object.freeze({
  projectId: 'demo-unit-project',
  databaseId: DEFAULT_FIRESTORE_DATABASE_ID,
  emulatorHost: '127.0.0.1:8080',
  requestTimeoutMs: 5000,
});

const TEST_TOKEN = 'eyJhbGciOiJub25lIn0.eyJ1c2VyX2lkIjoidWlkLTEifQ.signature';

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
  readonly redirect: RequestInit['redirect'];
}

interface StubResponse {
  readonly status: number;
  readonly body?: unknown;
}

function createFetchStub(handler: (request: CapturedRequest, index: number) => StubResponse): {
  readonly fetchImpl: typeof fetch;
  readonly captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];

  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    const request: CapturedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : null,
      redirect: init?.redirect,
    };
    captured.push(request);

    const result = handler(request, captured.length - 1);
    return new Response(result.body === undefined ? '' : JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  return { fetchImpl, captured };
}

function createClient(
  fetchImpl: typeof fetch,
  overrides: Partial<FirestoreRestConfig> = {},
  token: string | null = TEST_TOKEN,
): FirestoreRestClient {
  return new FirestoreRestClient({
    config: { ...TEST_CONFIG, ...overrides },
    getAccessToken: async () => token,
    fetchImpl,
    allowRemoteTarget: false,
  });
}

function documentResponse(relativePath: string, data: Record<string, unknown>): StubResponse {
  return {
    status: 200,
    body: {
      name: `projects/${TEST_CONFIG.projectId}/databases/${TEST_CONFIG.databaseId}/documents/${relativePath}`,
      fields: encodeFields(data),
      createTime: '2026-01-01T00:00:00.000000Z',
      updateTime: '2026-01-02T00:00:00.000000Z',
    },
  };
}

describe('firestore rest configuration', () => {
  it('resolves defaults from an empty environment', () => {
    const config = resolveFirestoreRestConfig({});
    assert.equal(config.projectId, '');
    assert.equal(config.databaseId, DEFAULT_FIRESTORE_DATABASE_ID);
    assert.equal(config.emulatorHost, undefined);
    assert.equal(config.requestTimeoutMs, 15000);
  });

  it('resolves the emulator target and a demo project id', () => {
    const config = resolveFirestoreRestConfig({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
    assert.equal(config.emulatorHost, '127.0.0.1:8080');
    assert.equal(config.projectId, 'demo-drug-manager-stage3');
    assert.equal(
      buildFirestoreDocumentsUrlPrefix(config),
      'http://127.0.0.1:8080/v1/projects/demo-drug-manager-stage3/databases/(default)/documents',
    );
  });

  it('builds the resource name used by commit writes', () => {
    assert.equal(
      buildFirestoreDocumentResourceName(TEST_CONFIG, 'users/uid-1'),
      `projects/${TEST_CONFIG.projectId}/databases/${TEST_CONFIG.databaseId}/documents/users/uid-1`,
    );
  });

  it('detects loopback hosts only', () => {
    assert.equal(isLoopbackHost('127.0.0.1:8080'), true);
    assert.equal(isLoopbackHost('http://localhost:8080'), true);
    assert.equal(isLoopbackHost('[::1]:8080'), true);
    assert.equal(isLoopbackHost('firestore.googleapis.com'), false);
    assert.equal(isLoopbackHost('10.0.0.5:8080'), false);
  });

  it('refuses any non-local target during Stage 3', () => {
    assert.throws(
      () => assertLocalFirestoreTarget({ ...TEST_CONFIG, emulatorHost: undefined }, false),
      FirestoreConfigError,
    );
    assert.throws(
      () => assertLocalFirestoreTarget({ ...TEST_CONFIG, emulatorHost: 'db.example.com:8080' }, false),
      FirestoreConfigError,
    );
    assert.throws(
      () => assertLocalFirestoreTarget(
        { ...TEST_CONFIG, emulatorHost: undefined, baseUrl: 'https://firestore.googleapis.com/v1' },
        false,
      ),
      FirestoreConfigError,
    );

    assert.doesNotThrow(() => assertLocalFirestoreTarget(TEST_CONFIG, false));
    assert.doesNotThrow(() => assertLocalFirestoreTarget(
      { ...TEST_CONFIG, emulatorHost: undefined, baseUrl: 'http://127.0.0.1:8080/v1' },
      false,
    ));
  });

  it('validates relative paths to keep URL building injection-free', () => {
    assert.doesNotThrow(() => assertSafeRelativePath('users/uid-1'));
    assert.doesNotThrow(() => assertSafeRelativePath('orders/2026/order-1'));

    for (const invalidPath of ['', '   ', '../users', 'users/../x', 'users//x', 'users/uid 1', 'users/uid?x=1']) {
      assert.throws(() => assertSafeRelativePath(invalidPath), FirestoreConfigError, `accepted: ${invalidPath}`);
    }
  });
});

describe('firestore value codec', () => {
  it('round-trips the supported value types', () => {
    const cases: readonly unknown[] = [
      null,
      true,
      false,
      42,
      -7,
      3.5,
      'مستند تجريبي',
      [],
      [1, 'two', null, { nested: true }],
      { a: 1, b: [true, 'x'], c: { d: null } },
    ];

    for (const value of cases) {
      assert.deepEqual(decodeValue(encodeValue(value)), value);
    }
  });

  it('encodes integers as int64 strings, dates as timestamps and empty arrays correctly', () => {
    assert.deepEqual(encodeValue(5), { integerValue: '5' });
    assert.deepEqual(encodeValue(5.5), { doubleValue: 5.5 });
    assert.deepEqual(
      encodeValue(new Date('2026-01-01T00:00:00.000Z')),
      { timestampValue: '2026-01-01T00:00:00.000Z' },
    );
    assert.deepEqual(encodeValue([]), { arrayValue: {} });
  });

  it('rejects values it cannot represent instead of silently dropping them', () => {
    assert.throws(() => encodeValue(undefined), FirestoreCodecError);
    assert.throws(() => encodeValue(Number.NaN), FirestoreCodecError);
    assert.throws(() => encodeValue(new Date('invalid')), FirestoreCodecError);
    assert.throws(() => decodeValue({ bytesValue: 'AAAA' } as unknown as FirestoreRawValue), FirestoreCodecError);
  });

  it('decodes a missing fields map into an empty object', () => {
    assert.deepEqual(decodeFields(undefined), {});
  });
});

describe('firestore rest client (injected fetch, no network)', () => {
  it('sends an authenticated GET with the ID token and decodes the document', async () => {
    const { fetchImpl, captured } = createFetchStub(
      () => documentResponse('users/uid-1', { role: 'employee', status: 'approved', stock: 3 }),
    );

    const document = await createClient(fetchImpl).getDocument('users/uid-1');

    assert.equal(document.relativePath, 'users/uid-1');
    assert.equal(document.data['role'], 'employee');
    assert.equal(document.data['stock'], 3);
    assert.equal(captured.length, 1);

    const request = captured[0];
    assert.ok(request, 'exactly one request must have been sent');
    assert.equal(request.method, 'GET');
    assert.equal(request.url, `${buildFirestoreDocumentsUrlPrefix(TEST_CONFIG)}/users/uid-1`);
    assert.equal(request.headers['Authorization'], `Bearer ${TEST_TOKEN}`);
    assert.equal(request.headers['Content-Type'], undefined);
    assert.equal(request.body, null);
  });

  it('maps a rules denial (HTTP 403 PERMISSION_DENIED) to a typed error', async () => {
    const { fetchImpl } = createFetchStub(() => ({
      status: 403,
      body: {
        error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' },
      },
    }));

    const error = await createClient(fetchImpl).getDocument('users/other').then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof FirestoreRestError, 'a typed FirestoreRestError is expected');
    assert.equal(error.httpStatus, 403);
    assert.equal(error.reason, 'PERMISSION_DENIED');
    assert.equal(error.isAuthorizationDenied, true);
    assert.equal(error.requestSent, true);
    assert.equal(error.serverMessage, 'Missing or insufficient permissions.');
  });

  it('redacts token-like fragments that a server might echo back', async () => {
    const { fetchImpl } = createFetchStub(() => ({
      status: 403,
      body: {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          message: `denied for Bearer ${TEST_TOKEN} (key=secret-api-key)`,
        },
      },
    }));

    const error = await createClient(fetchImpl).getDocument('users/other').then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof FirestoreRestError);
    assert.equal(error.serverMessage?.includes(TEST_TOKEN), false, 'the token must never appear in an error');
    assert.equal(error.serverMessage?.includes('secret-api-key'), false, 'an api key must never appear in an error');
    assert.ok(error.serverMessage?.includes('[redacted'));
  });

  it('exposes sanitizeServerMessage for token-safe messages', () => {
    const sanitized = sanitizeServerMessage(`Bearer ${TEST_TOKEN} key=abc123`);
    assert.equal(sanitized.includes(TEST_TOKEN), false);
    assert.equal(sanitized.includes('abc123'), false);
  });

  it('maps a 404 to NOT_FOUND and lets getDocumentOrNull return null', async () => {
    const { fetchImpl } = createFetchStub(() => ({
      status: 404,
      body: { error: { code: 404, message: 'Document not found.', status: 'NOT_FOUND' } },
    }));
    const client = createClient(fetchImpl);

    assert.equal(await client.getDocumentOrNull('users/missing'), null);
    await assert.rejects(
      () => client.getDocument('users/missing'),
      (error: unknown) => error instanceof FirestoreRestError && error.reason === 'NOT_FOUND',
    );
  });
});

describe('firestore rest client safety (injected fetch, no network)', () => {
  it('rethrows a rules denial from getDocumentOrNull instead of hiding it', async () => {
    const { fetchImpl } = createFetchStub(() => ({
      status: 403,
      body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' } },
    }));

    await assert.rejects(
      () => createClient(fetchImpl).getDocumentOrNull('users/other'),
      (error: unknown) => error instanceof FirestoreRestError && error.reason === 'PERMISSION_DENIED',
    );
  });

  it('maps a network failure to NETWORK without echoing the failure details', async () => {
    const failingFetch = (async () => {
      throw new TypeError('connect ECONNREFUSED 127.0.0.1:8080');
    }) as typeof fetch;

    await assert.rejects(
      () => createClient(failingFetch).getDocument('users/uid-1'),
      (error: unknown) => error instanceof FirestoreRestError
        && error.reason === 'NETWORK'
        && error.requestSent === true
        && error.message.includes('ECONNREFUSED') === false,
    );
  });

  it('never issues a request when there is no token', async () => {
    const { fetchImpl, captured } = createFetchStub(() => documentResponse('users/uid-1', {}));

    await assert.rejects(
      () => createClient(fetchImpl, {}, null).getDocument('users/uid-1'),
      (error: unknown) => error instanceof FirestoreRestError
        && error.reason === 'UNAUTHENTICATED'
        && error.requestSent === false
        && error.httpStatus === 0,
    );
    assert.equal(captured.length, 0, 'no unauthenticated request may be sent');
  });

  it('refuses a non-local target before sending anything', async () => {
    const { fetchImpl, captured } = createFetchStub(() => documentResponse('users/uid-1', {}));
    const client = createClient(fetchImpl, {
      emulatorHost: undefined,
      baseUrl: 'https://firestore.googleapis.com/v1',
    });

    await assert.rejects(
      () => client.getDocument('users/uid-1'),
      (error: unknown) => error instanceof FirestoreRestError
        && error.reason === 'CONFIGURATION_ERROR'
        && error.requestSent === false,
    );
    assert.equal(captured.length, 0, 'production Firebase must never be contacted in Stage 3');
  });

  it('refuses an incomplete configuration before sending anything', async () => {
    const { fetchImpl, captured } = createFetchStub(() => documentResponse('users/uid-1', {}));

    await assert.rejects(
      () => createClient(fetchImpl, { projectId: '' }).getDocument('users/uid-1'),
      (error: unknown) => error instanceof FirestoreRestError && error.reason === 'CONFIGURATION_ERROR',
    );
    assert.equal(captured.length, 0);
  });

  it('rejects an unsafe path instead of building an unexpected URL', async () => {
    const { fetchImpl, captured } = createFetchStub(() => documentResponse('users/uid-1', {}));

    await assert.rejects(() => createClient(fetchImpl).getDocument('../users/uid-1'), FirestoreConfigError);
    assert.equal(captured.length, 0);
  });
});

describe('firestore rest redirect rejection (injected fetch, no network)', () => {
  it('sends redirect: \'error\' on both a GET and a write request', async () => {
    const { fetchImpl, captured } = createFetchStub((request) => (request.method === 'GET'
      ? documentResponse('medicines/med-1', { stock: 9 })
      : { status: 200, body: { commitTime: '2026-01-01T00:00:00.000000Z', writeResults: [] } }));
    const client = createClient(fetchImpl);

    await client.getDocument('medicines/med-1');
    await client.commitWrites([{ relativePath: 'medicines/med-1', data: { stock: 10 } }]);

    assert.equal(captured.length, 2);
    const getRequest = captured[0];
    const writeRequest = captured[1];
    assert.ok(getRequest && writeRequest);
    assert.equal(getRequest.method, 'GET');
    assert.equal(getRequest.redirect, 'error');
    assert.equal(writeRequest.method, 'POST');
    assert.equal(writeRequest.redirect, 'error');
  });

  it('maps a rejected write redirect to NETWORK with one request and no token/body leak', async () => {
    const secretBodyFragment = 'controlled-substance-ledger-entry';
    const requestUrls: string[] = [];
    const redirectPolicies: Array<RequestInit['redirect']> = [];
    // Mirrors Fetch with `redirect: 'error'`: a 3xx response rejects with a
    // TypeError instead of following the Location header.
    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      requestUrls.push(String(input));
      redirectPolicies.push(init?.redirect);
      if (init?.redirect === 'error') {
        throw new TypeError('redirect response blocked (simulated 302 to https://attacker.example)');
      }
      // Reached only if the client followed the redirect: the attacker would
      // receive the original request's destination and could answer as Firestore.
      return new Response(JSON.stringify({
        commitTime: '2026-01-01T00:00:00.000000Z',
        writeResults: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const error = await createClient(fetchImpl).commitWrites([
      { relativePath: 'orders/order-1', data: { note: secretBodyFragment } },
    ]).then(() => null, (thrown: unknown) => thrown);

    assert.ok(error instanceof FirestoreRestError, 'a typed FirestoreRestError is expected');
    assert.equal(error.reason, 'NETWORK');
    assert.equal(error.requestSent, true);
    assert.equal(error.httpStatus, 0);
    assert.equal(error.serverMessage, null);
    assert.equal(redirectPolicies[0], 'error');
    assert.equal(requestUrls.length, 1, 'no second (redirected) request may be sent');
    assert.equal(error.message.includes(TEST_TOKEN), false, 'the ID token must never appear in an error');
    assert.equal(error.message.includes(secretBodyFragment), false, 'request-body contents must never appear in an error');
    assert.equal(error.message.includes('attacker.example'), false, 'server details must never appear in an error');
    assert.equal(error.message.includes('ECONN'), false);
  });

  it('maps a rejected read redirect to NETWORK with one request and no token leak', async () => {
    const requestUrls: string[] = [];
    const redirectPolicies: Array<RequestInit['redirect']> = [];
    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      requestUrls.push(String(input));
      redirectPolicies.push(init?.redirect);
      if (init?.redirect === 'error') {
        throw new TypeError('redirect response blocked');
      }
      const stub = documentResponse('users/uid-1', { role: 'employee' });
      return new Response(JSON.stringify(stub.body), {
        status: stub.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const error = await createClient(fetchImpl).getDocument('users/uid-1').then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof FirestoreRestError, 'a typed FirestoreRestError is expected');
    assert.equal(error.reason, 'NETWORK');
    assert.equal(error.requestSent, true);
    assert.equal(error.serverMessage, null);
    assert.equal(redirectPolicies[0], 'error');
    assert.equal(requestUrls.length, 1, 'no second (redirected) request may be sent');
    assert.equal(error.message.includes(TEST_TOKEN), false, 'the ID token must never appear in an error');
    assert.equal(error.message.includes('redirect'), false, 'raw Fetch failure details must never appear in an error');
  });
});

describe('firestore rest client read/write plumbing (injected fetch, no network)', () => {
  it('builds a ListDocuments request with paging parameters', async () => {
    const { fetchImpl, captured } = createFetchStub(() => ({
      status: 200,
      body: {
        documents: [documentResponse('users/uid-1', { role: 'employee' }).body],
        nextPageToken: 'tok',
      },
    }));

    const result = await createClient(fetchImpl).listDocuments('users', { pageSize: 5, pageToken: 'p1' });

    const request = captured[0];
    assert.ok(request);
    assert.equal(request.method, 'GET');
    assert.ok(request.url.endsWith('/documents/users?pageSize=5&pageToken=p1'), request.url);
    assert.equal(result.documents.length, 1);
    assert.equal(result.nextPageToken, 'tok');
  });

  it('builds a structured query with an ownership filter and a transaction id', async () => {
    const { fetchImpl, captured } = createFetchStub(() => ({
      status: 200,
      body: [{ document: documentResponse('orders/o1', { userId: 'uid-1' }).body }],
    }));

    const documents = await createClient(fetchImpl).runQuery(
      { collectionId: 'orders', where: { field: 'userId', op: 'EQUAL', value: 'uid-1' }, limit: 3 },
      'tx-base64',
    );

    const request = captured[0];
    assert.ok(request);
    assert.ok(request.url.endsWith('/documents:runQuery'), request.url);

    const body = JSON.parse(request.body ?? '{}') as {
      structuredQuery: {
        from: Array<{ collectionId: string }>;
        limit: number;
        where: { fieldFilter: { field: { fieldPath: string }; op: string; value: unknown } };
      };
      transaction?: string;
    };

    assert.equal(body.structuredQuery.from[0]?.collectionId, 'orders');
    assert.equal(body.structuredQuery.limit, 3);
    assert.equal(body.structuredQuery.where.fieldFilter.field.fieldPath, 'userId');
    assert.equal(body.structuredQuery.where.fieldFilter.op, 'EQUAL');
    assert.deepEqual(body.structuredQuery.where.fieldFilter.value, { stringValue: 'uid-1' });
    assert.equal(body.transaction, 'tx-base64');
    assert.equal(documents.length, 1);
    assert.equal(documents[0]?.data['userId'], 'uid-1');
  });

  it('creates a document with documentId and encoded fields', async () => {
    const { fetchImpl, captured } = createFetchStub(
      () => documentResponse('medicines/med-1', { name: 'دواء', stock: 4 }),
    );

    const created = await createClient(fetchImpl).createDocument('medicines', { name: 'دواء', stock: 4 }, 'med-1');

    const request = captured[0];
    assert.ok(request);
    assert.equal(request.method, 'POST');
    assert.ok(request.url.endsWith('/documents/medicines?documentId=med-1'), request.url);
    assert.deepEqual(JSON.parse(request.body ?? '{}'), {
      fields: { name: { stringValue: 'دواء' }, stock: { integerValue: '4' } },
    });
    assert.equal(created.relativePath, 'medicines/med-1');
    assert.equal(created.data['stock'], 4);
  });

  it('patches a document with an update mask and a precondition', async () => {
    const { fetchImpl, captured } = createFetchStub(
      () => documentResponse('users/uid-1', { name: 'اسم جديد' }),
    );

    await createClient(fetchImpl).patchDocument(
      'users/uid-1',
      { name: 'اسم جديد' },
      { updateMaskPaths: ['name'], precondition: 'exists' },
    );

    const request = captured[0];
    assert.ok(request);
    assert.equal(request.method, 'PATCH');
    assert.ok(request.url.includes('updateMask.fieldPaths=name'), request.url);
    assert.ok(request.url.includes('currentDocument.exists=true'), request.url);
    assert.deepEqual(JSON.parse(request.body ?? '{}'), { fields: { name: { stringValue: 'اسم جديد' } } });
  });

  it('patches with a create precondition when asked for missing documents', async () => {
    const { fetchImpl, captured } = createFetchStub(
      () => documentResponse('users/uid-9', { status: 'pending' }),
    );

    await createClient(fetchImpl).patchDocument(
      'users/uid-9',
      { status: 'pending' },
      { precondition: 'missing' },
    );

    const request = captured[0];
    assert.ok(request);
    assert.ok(request.url.includes('currentDocument.exists=false'), request.url);
    assert.equal(request.url.includes('updateMask.fieldPaths'), false);
  });
});

describe('firestore rest transaction primitives (injected fetch, no network)', () => {
  it('begins a transaction', async () => {
    const { fetchImpl, captured } = createFetchStub(() => ({ status: 200, body: { transaction: 'tx-1' } }));

    const transaction = await createClient(fetchImpl).beginTransaction();

    const request = captured[0];
    assert.ok(request);
    assert.equal(request.method, 'POST');
    assert.ok(request.url.endsWith('/documents:beginTransaction'), request.url);
    assert.equal(transaction, 'tx-1');
  });

  it('reports an unexpected beginTransaction payload', async () => {
    const { fetchImpl } = createFetchStub(() => ({ status: 200, body: {} }));

    await assert.rejects(
      () => createClient(fetchImpl).beginTransaction(),
      (error: unknown) => error instanceof FirestoreRestError && error.reason === 'UNKNOWN',
    );
  });

  it('reads documents inside a transaction, preserving the requested order', async () => {
    const { fetchImpl, captured } = createFetchStub(() => ({
      status: 200,
      body: [
        { found: documentResponse('medicines/med-2', { stock: 2 }).body },
        {
          missing: `projects/${TEST_CONFIG.projectId}/databases/${TEST_CONFIG.databaseId}/documents/medicines/med-1`,
        },
      ],
    }));

    const results = await createClient(fetchImpl).batchGetDocuments(
      ['medicines/med-1', 'medicines/med-2'],
      'tx-1',
    );

    const request = captured[0];
    assert.ok(request);
    assert.ok(request.url.endsWith('/documents:batchGet'), request.url);

    const body = JSON.parse(request.body ?? '{}') as { documents: string[]; transaction?: string };
    assert.equal(body.documents.length, 2);
    assert.equal(body.transaction, 'tx-1');
    assert.equal(results.length, 2);
    assert.equal(results[0], null, 'the missing document must map to null in the requested position');
    assert.equal(results[1]?.relativePath, 'medicines/med-2');
  });

  it('skips the network call for an empty batchGet', async () => {
    const { fetchImpl, captured } = createFetchStub(() => ({ status: 200, body: [] }));

    const results = await createClient(fetchImpl).batchGetDocuments([]);

    assert.deepEqual(results, []);
    assert.equal(captured.length, 0);
  });

  it('commits writes with the right preconditions for create/update/upsert', async () => {
    const { fetchImpl, captured } = createFetchStub(() => ({
      status: 200,
      body: { commitTime: '2026-01-01T00:00:00.000000Z', writeResults: [] },
    }));

    const result = await createClient(fetchImpl).commitWrites([
      { relativePath: 'medicines/new', data: { stock: 1 }, kind: 'create' },
      { relativePath: 'medicines/existing', data: { stock: 2 }, kind: 'update' },
      { relativePath: 'medicines/any', data: { stock: 3 } },
    ], 'tx-1');

    const request = captured[0];
    assert.ok(request);
    assert.equal(request.method, 'POST');
    assert.ok(request.url.endsWith('/documents:commit'), request.url);

    const body = JSON.parse(request.body ?? '{}') as {
      writes: Array<{
        update: { name: string; fields: Record<string, unknown> };
        currentDocument?: { exists: boolean };
      }>;
      transaction?: string;
    };

    assert.equal(body.writes.length, 3);
    assert.deepEqual(body.writes[0]?.currentDocument, { exists: false });
    assert.deepEqual(body.writes[1]?.currentDocument, { exists: true });
    assert.equal(body.writes[2]?.currentDocument, undefined);
    assert.equal(
      body.writes[0]?.update.name,
      `projects/${TEST_CONFIG.projectId}/databases/${TEST_CONFIG.databaseId}/documents/medicines/new`,
    );
    assert.deepEqual(body.writes[0]?.update.fields, { stock: { integerValue: '1' } });
    assert.equal(body.transaction, 'tx-1');
    assert.equal(result.writeCount, 3);
    assert.equal(result.commitTime, '2026-01-01T00:00:00.000000Z');
  });

  it('rolls a transaction back', async () => {
    const { fetchImpl, captured } = createFetchStub(() => ({ status: 200, body: {} }));

    await createClient(fetchImpl).rollback('tx-1');

    const request = captured[0];
    assert.ok(request);
    assert.ok(request.url.endsWith('/documents:rollback'), request.url);
    assert.deepEqual(JSON.parse(request.body ?? '{}'), { transaction: 'tx-1' });
  });

  it('maps an expired transaction error from a commit', async () => {
    const { fetchImpl } = createFetchStub(() => ({
      status: 400,
      body: { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'the transaction is no longer active' } },
    }));

    await assert.rejects(
      () => createClient(fetchImpl).commitWrites(
        [{ relativePath: 'medicines/x', data: { stock: 1 } }],
        'tx-expired',
      ),
      (error: unknown) => error instanceof FirestoreRestError
        && error.httpStatus === 400
        && error.reason === 'FAILED_PRECONDITION'
        && error.requestSent === true,
    );
  });
});

// ===================================================================
// Stage 5A - PART 1/2/3: update masks, server timestamps, write safety.
//
// These are WIRE-level tests (injected fetch, no network): they prove the
// exact JSON `commitWrites` produces. The matching EMULATOR tests in
// firestore-rules-emulator.test.ts prove the real Firestore Emulator honours
// that JSON.
// ===================================================================

interface CapturedWrite {
  readonly update: { readonly name: string; readonly fields: Record<string, unknown> };
  readonly updateMask?: { readonly fieldPaths: string[] };
  readonly updateTransforms?: ReadonlyArray<{ readonly fieldPath: string; readonly setToServerValue: string }>;
  readonly currentDocument?: { readonly exists: boolean };
}

interface CommitBody {
  readonly writes: readonly CapturedWrite[];
  readonly transaction?: string;
}

function commitBody(captured: readonly CapturedRequest[], index = 0): CommitBody {
  const request = captured[index];
  assert.ok(request, 'no request was captured');
  return JSON.parse(request.body ?? '{}') as CommitBody;
}

function stubCommit(): { readonly fetchImpl: typeof fetch; readonly captured: CapturedRequest[] } {
  return createFetchStub(() => ({
    status: 200,
    body: { commitTime: '2026-01-01T00:00:00.000000Z', writeResults: [] },
  }));
}

describe('Stage 6: HTTP 409 is disambiguated by the gRPC status', () => {
  /**
   * Firestore answers BOTH a duplicate id and a transaction conflict with HTTP
   * 409. The two mean opposite things - "pick another id" versus "retry with
   * fresh reads" - so the reason must come from the body's status name, never
   * from the HTTP code alone. A conflict silently downgraded to
   * `ALREADY_EXISTS` would make the Stage 6 retry loop give up on the first
   * ordinary contention.
   */
  it('reports a transaction conflict as ABORTED, not ALREADY_EXISTS', async () => {
    const { fetchImpl } = createFetchStub(() => ({
      status: 409,
      body: {
        error: {
          code: 409,
          message: 'Transaction lock timeout.',
          status: 'ABORTED',
        },
      },
    }));

    await assert.rejects(
      () => createClient(fetchImpl).commitWrites([]),
      (error: unknown) => {
        assert.ok(error instanceof FirestoreRestError);
        assert.equal(error.reason, 'ABORTED', 'a conflict must stay retryable');
        assert.equal(error.httpStatus, 409);
        return true;
      },
    );
  });

  it('still reports a genuine duplicate as ALREADY_EXISTS', async () => {
    const { fetchImpl } = createFetchStub(() => ({
      status: 409,
      body: {
        error: {
          code: 409,
          message: 'The entity already exists.',
          status: 'ALREADY_EXISTS',
        },
      },
    }));

    await assert.rejects(
      () => createClient(fetchImpl).commitWrites([]),
      (error: unknown) => {
        assert.ok(error instanceof FirestoreRestError);
        assert.equal(error.reason, 'ALREADY_EXISTS', 'a duplicate is NOT retryable');
        return true;
      },
    );
  });

  it('falls back to the historical meaning when the body carries no status', async () => {
    const { fetchImpl } = createFetchStub(() => ({
      status: 409,
      body: { error: { code: 409, message: 'conflict' } },
    }));

    await assert.rejects(
      () => createClient(fetchImpl).commitWrites([]),
      (error: unknown) => {
        assert.ok(error instanceof FirestoreRestError);
        // Ambiguous by nature: the pre-Stage 6 behaviour is preserved so a
        // malformed error body cannot turn a duplicate into a silent retry.
        assert.equal(error.reason, 'ALREADY_EXISTS');
        return true;
      },
    );
  });

  it('keeps the ABORTED vocabulary reachable from the reason union', () => {
    // A compile-time assertion with a runtime one: if 'ABORTED' were removed
    // from FirestoreRestReason this file would not even typecheck.
    const reasons: readonly FirestoreRestReason[] = ['ABORTED', 'ALREADY_EXISTS'];
    assert.ok(reasons.includes('ABORTED'));
  });
});

describe('Stage 5A: field-path grammar (PART 1)', () => {
  it('passes simple names through and backtick-quotes names Firestore would reject', () => {
    assert.equal(encodeFieldPathSegment('stock'), 'stock');
    assert.equal(encodeFieldPathSegment('_private'), '_private');
    assert.equal(encodeFieldPathSegment('m1'), 'm1');

    assert.equal(encodeFieldPathSegment('unit price'), '`unit price`');
    assert.equal(encodeFieldPathSegment('1abc'), '`1abc`');
    assert.equal(encodeFieldPathSegment('has.dot'), '`has.dot`');
    assert.equal(encodeFieldPathSegment('has`backtick'), '`has\\`backtick`');
    assert.equal(encodeFieldPathSegment('has\\slash'), '`has\\\\slash`');
  });

  it('parses and re-encodes nested and quoted paths into canonical syntax', () => {
    assert.deepEqual(parseFieldPath('stock'), ['stock']);
    assert.deepEqual(parseFieldPath('meta.at'), ['meta', 'at']);
    assert.equal(encodeFieldPath('meta.at'), 'meta.at');
    assert.equal(encodeFieldPath('`unit price`'), '`unit price`');
    assert.equal(encodeFieldPath('a.`b.c`'), 'a.`b.c`');
    assert.equal(encodeFieldPath('`a\\`b`'), '`a\\`b`', 'a quoted segment round-trips');
  });

  it('rejects malformed field paths before any request is built', () => {
    for (const invalid of [
      '',
      'a..b',
      '.a',
      'a.',
      '`unterminated',
      '`',
      'a.`b',
      '__name__',
      'meta.__x__',
    ]) {
      assert.throws(() => parseFieldPath(invalid), FirestoreCodecError, `accepted: ${invalid}`);
    }
  });
});

describe('Stage 5A: literal timestamps vs server timestamps (PART 2/4)', () => {
  it('encodes a literal timestamp as timestampValue and never as a string', () => {
    const encoded = encodeValue(FirestoreTimestamp.fromDate(new Date('2026-03-04T05:06:07.000Z')));
    assert.deepEqual(encoded, { timestampValue: '2026-03-04T05:06:07.000Z' });
    assert.equal(
      (encoded as FirestoreRawValue).stringValue,
      undefined,
      'a timestamp must never become a stringValue',
    );
  });

  it('decodes a timestampValue into a FirestoreTimestamp that preserves the exact string', () => {
    const decoded = decodeValue({ timestampValue: '2026-03-04T05:06:07.123456789Z' });
    assert.ok(decoded instanceof Object, 'a decoded timestamp must be a distinguishable object');
    assert.equal((decoded as FirestoreTimestamp).isoValue, '2026-03-04T05:06:07.123456789Z');
    assert.equal(
      (decoded as FirestoreTimestamp).toDate().toISOString(),
      '2026-03-04T05:06:07.123Z',
      'toDate() is the explicit, lossy millisecond conversion',
    );

    // Re-encoding a decoded timestamp reproduces the identical wire string.
    assert.deepEqual(encodeValue(decoded), { timestampValue: '2026-03-04T05:06:07.123456789Z' });
  });

  it('keeps a decoded timestamp distinguishable from a plain string', () => {
    const timestamp = decodeValue({ timestampValue: '2026-03-04T05:06:07.000Z' });
    const text = decodeValue({ stringValue: '2026-03-04T05:06:07.000Z' });
    assert.equal(typeof text, 'string');
    assert.notEqual(typeof timestamp, 'string');
    assert.notDeepEqual(timestamp, text);
  });

  it('rejects a malformed timestamp string instead of guessing', () => {
    assert.throws(
      () => decodeValue({ timestampValue: 'REQUEST_TIME' }),
      FirestoreCodecError,
      'a server-timestamp token must never decode as a literal value',
    );
    for (const invalid of ['', '2026-03-04', 'not-a-date', '2026-03-04T05:06:07', '2026-13-45T99:99:99Z']) {
      assert.throws(() => decodeValue({ timestampValue: invalid }), FirestoreCodecError, `accepted: ${invalid}`);
    }
  });

  it('rejects a well-shaped but non-existent calendar instant', () => {
    // Shape-valid RFC 3339, but month 13 / day 45 / hour 99 do not exist.
    assert.throws(
      () => decodeValue({ timestampValue: '2026-13-45T99:99:99Z' }),
      FirestoreCodecError,
      'a syntactically valid string must not be accepted when the instant does not exist',
    );
  });

  it('refuses to encode SERVER_TIMESTAMP as an ordinary value', () => {
    assert.equal(isServerTimestamp(SERVER_TIMESTAMP), true);
    assert.equal(isServerTimestamp('REQUEST_TIME'), false);
    assert.equal(isServerTimestamp(new Date()), false);
    assert.equal(isServerTimestamp(null), false);

    assert.throws(
      () => encodeValue(SERVER_TIMESTAMP),
      FirestoreCodecError,
      'a server timestamp must never travel as a value',
    );
    assert.throws(
      () => encodeValue({ requestDate: SERVER_TIMESTAMP }),
      FirestoreCodecError,
      'nested inside a map it must still be refused by the value encoder',
    );
  });

  it('separates server-timestamp markers from ordinary data', () => {
    const { fields, transformPaths } = extractServerTimestamps({
      requestDate: SERVER_TIMESTAMP,
      status: 'pending',
      meta: { at: SERVER_TIMESTAMP, author: 'admin' },
    });

    assert.deepEqual(transformPaths, [['requestDate'], ['meta', 'at']]);
    assert.deepEqual(fields, { status: 'pending', meta: { author: 'admin' } });
    assert.equal('requestDate' in fields, false, 'the marker must be removed from the data');
  });

  it('rejects a server-timestamp marker inside an array (a transform cannot target an element)', () => {
    assert.throws(
      () => extractServerTimestamps({ items: [1, SERVER_TIMESTAMP] }),
      FirestoreCodecError,
    );
  });
});

describe('Stage 5A: updateMask wire format (PART 1 - the C5 fix)', () => {
  it('derives a mask from the data for kind:update instead of replacing the document', async () => {
    const { fetchImpl, captured } = stubCommit();

    await createClient(fetchImpl).commitWrites([
      { relativePath: 'medicines/med-1', data: { stock: 7 }, kind: 'update' },
    ]);

    const write = commitBody(captured).writes[0];
    assert.ok(write);
    assert.deepEqual(write.updateMask, { fieldPaths: ['stock'] }, 'a partial update must carry a mask');
    assert.deepEqual(write.update.fields, { stock: { integerValue: '7' } });
    assert.deepEqual(write.currentDocument, { exists: true });
  });

  it('sends only the masked fields in the body, never the untouched ones', async () => {
    const { fetchImpl, captured } = stubCommit();

    await createClient(fetchImpl).commitWrites([
      {
        relativePath: 'medicines/med-1',
        data: { stock: 7, totalOutward: 3 },
        kind: 'update',
        updateMaskPaths: ['stock', 'totalOutward'],
      },
    ]);

    const write = commitBody(captured).writes[0];
    assert.ok(write);
    assert.deepEqual(write.updateMask, { fieldPaths: ['stock', 'totalOutward'] });
    assert.deepEqual(
      Object.keys(write.update.fields).sort(),
      ['stock', 'totalOutward'],
      'a masked update must not resend name/maxQuantity/totalInward',
    );
  });

  it('encodes nested and specially-named mask paths on the wire', async () => {
    const { fetchImpl, captured } = stubCommit();

    await createClient(fetchImpl).commitWrites([
      {
        relativePath: 'medicines/med-1',
        data: { meta: { 'unit price': 4, at: 1 }, stock: 2 },
        kind: 'update',
        updateMaskPaths: ['meta.`unit price`', 'meta.at', 'stock'],
      },
    ]);

    const write = commitBody(captured).writes[0];
    assert.ok(write);
    assert.deepEqual(write.updateMask, { fieldPaths: ['meta.`unit price`', 'meta.at', 'stock'] });
  });

  it('keeps create semantics: no mask, exists=false, full document', async () => {
    const { fetchImpl, captured } = stubCommit();

    await createClient(fetchImpl).commitWrites([
      { relativePath: 'medicines/med-new', data: { name: 'دواء', stock: 4, maxQuantity: 2 }, kind: 'create' },
    ]);

    const write = commitBody(captured).writes[0];
    assert.ok(write);
    assert.equal(write.updateMask, undefined, 'a create must not grow an implicit mask');
    assert.deepEqual(write.currentDocument, { exists: false });
    assert.deepEqual(Object.keys(write.update.fields).sort(), ['maxQuantity', 'name', 'stock']);
  });

  it('keeps upsert-without-mask semantics: a full document replacement', async () => {
    const { fetchImpl, captured } = stubCommit();

    await createClient(fetchImpl).commitWrites([{ relativePath: 'medicines/med-1', data: { stock: 1 } }]);

    const write = commitBody(captured).writes[0];
    assert.ok(write);
    assert.equal(write.updateMask, undefined, 'an upsert without a mask must keep replacing the document');
    assert.equal(write.currentDocument, undefined);
  });
});

describe('Stage 5A: unsafe write shapes are refused (PART 3 / G)', () => {
  it('refuses a mask path in neither data nor transforms (it would DELETE the field)', async () => {
    const { fetchImpl, captured } = stubCommit();

    await assert.rejects(
      () => createClient(fetchImpl).commitWrites([
        {
          relativePath: 'medicines/med-1',
          data: { stock: 1 },
          kind: 'update',
          updateMaskPaths: ['stock', 'name'],
        },
      ]),
      (error: unknown) => error instanceof FirestoreRestError
        && error.reason === 'INVALID_ARGUMENT'
        && error.requestSent === false,
    );

    assert.equal(captured.length, 0, 'an unsafe write must be rejected BEFORE any network call');
  });

  it('refuses a data field outside the mask (Firestore would silently IGNORE it)', async () => {
    const { fetchImpl, captured } = stubCommit();

    await assert.rejects(
      () => createClient(fetchImpl).commitWrites([
        {
          relativePath: 'medicines/med-1',
          data: { stock: 1, totalOutward: 2 },
          kind: 'update',
          updateMaskPaths: ['stock'],
        },
      ]),
      (error: unknown) => error instanceof FirestoreRestError
        && error.reason === 'INVALID_ARGUMENT'
        && error.requestSent === false,
    );

    assert.equal(captured.length, 0);
  });

  it('refuses an empty write and a transform-only upsert', async () => {
    const { fetchImpl, captured } = stubCommit();
    const client = createClient(fetchImpl);

    await assert.rejects(
      () => client.commitWrites([{ relativePath: 'medicines/med-1', data: {} }]),
      (error: unknown) => error instanceof FirestoreRestError && error.requestSent === false,
    );

    await assert.rejects(
      () => client.commitWrites([{ relativePath: 'medicines/med-1', data: { at: SERVER_TIMESTAMP } }]),
      (error: unknown) => error instanceof FirestoreRestError && error.requestSent === false,
    );

    assert.equal(captured.length, 0);
  });

  it('rejects a malformed mask path before any request is built', async () => {
    const { fetchImpl, captured } = stubCommit();

    await assert.rejects(
      () => createClient(fetchImpl).commitWrites([
        { relativePath: 'medicines/med-1', data: { stock: 1 }, kind: 'update', updateMaskPaths: ['a..b'] },
      ]),
      (error: unknown) => error instanceof FirestoreRestError
        && error.reason === 'INVALID_ARGUMENT'
        && error.requestSent === false,
    );

    assert.equal(captured.length, 0);
  });
});

describe('Stage 5A: server-timestamp transforms (PART 2)', () => {
  it('encodes SERVER_TIMESTAMP as an updateTransform REQUEST_TIME entry', async () => {
    const { fetchImpl, captured } = stubCommit();

    await createClient(fetchImpl).commitWrites([
      { relativePath: 'order_requests/req-1', data: { requestDate: SERVER_TIMESTAMP, status: 'pending' }, kind: 'create' },
    ]);

    const write = commitBody(captured).writes[0];
    assert.ok(write);
    assert.deepEqual(write.updateTransforms, [{ fieldPath: 'requestDate', setToServerValue: 'REQUEST_TIME' }]);
    assert.equal('requestDate' in write.update.fields, false, 'a transform target must NOT also be sent as a value');
    assert.deepEqual(write.update.fields, { status: { stringValue: 'pending' } });
  });

  it('never uses the local clock or a literal string for a server timestamp', async () => {
    const { fetchImpl, captured } = stubCommit();
    const before = Date.now();

    await createClient(fetchImpl).commitWrites([
      { relativePath: 'order_requests/req-2', data: { requestDate: SERVER_TIMESTAMP }, kind: 'create' },
    ]);

    const write = commitBody(captured).writes[0];
    assert.ok(write);
    const serialized = JSON.stringify(write);
    assert.ok(serialized.includes('REQUEST_TIME'));
    assert.equal(serialized.includes('timestampValue'), false, 'no local-clock timestamp may be sent');
    assert.equal(
      serialized.includes(new Date(before).toISOString()),
      false,
      'the local wall clock must not leak into the payload',
    );
  });

  it('supports a transform-only masked update', async () => {
    const { fetchImpl, captured } = stubCommit();

    await createClient(fetchImpl).commitWrites([
      {
        relativePath: 'medicines/med-1',
        data: { processedAt: SERVER_TIMESTAMP },
        kind: 'update',
        updateMaskPaths: ['processedAt'],
      },
    ]);

    const write = commitBody(captured).writes[0];
    assert.ok(write);
    assert.deepEqual(write.updateMask, { fieldPaths: ['processedAt'] });
    assert.deepEqual(write.updateTransforms, [{ fieldPath: 'processedAt', setToServerValue: 'REQUEST_TIME' }]);
  });

  it('carries update masks and transforms inside a transaction', async () => {
    const { fetchImpl, captured } = stubCommit();

    await createClient(fetchImpl).commitWrites(
      [{
        relativePath: 'medicines/med-tx',
        data: { stock: 5, processedAt: SERVER_TIMESTAMP },
        kind: 'update',
        updateMaskPaths: ['stock', 'processedAt'],
      }],
      'tx-9',
    );

    const body = commitBody(captured);
    assert.equal(body.transaction, 'tx-9', 'the transaction id must be preserved');
    const write = body.writes[0];
    assert.ok(write);
    assert.deepEqual(write.updateMask, { fieldPaths: ['stock', 'processedAt'] });
    assert.deepEqual(write.updateTransforms, [{ fieldPath: 'processedAt', setToServerValue: 'REQUEST_TIME' }]);
  });
});

describe('Stage 5A: patchDocument shares the mask safety rules', () => {
  it('sends updateMask.fieldPaths query parameters for a partial patch', async () => {
    const { fetchImpl, captured } = createFetchStub(() => documentResponse('medicines/med-1', { stock: 9 }));

    await createClient(fetchImpl).patchDocument(
      'medicines/med-1',
      { stock: 9 },
      { updateMaskPaths: ['stock'], precondition: 'exists' },
    );

    const request = captured[0];
    assert.ok(request);
    assert.equal(request.method, 'PATCH');
    const url = new URL(request.url);
    assert.deepEqual(url.searchParams.getAll('updateMask.fieldPaths'), ['stock']);
    assert.equal(url.searchParams.get('currentDocument.exists'), 'true');
  });

  it('rejects an unsafe, empty or transform patch before any network call', async () => {
    const { fetchImpl, captured } = createFetchStub(() => documentResponse('medicines/med-1', {}));
    const client = createClient(fetchImpl);

    await assert.rejects(
      () => client.patchDocument('medicines/med-1', { stock: 1 }, { updateMaskPaths: ['stock', 'name'] }),
      (error: unknown) => error instanceof FirestoreRestError && error.requestSent === false,
    );
    await assert.rejects(
      () => client.patchDocument('medicines/med-1', {}),
      (error: unknown) => error instanceof FirestoreRestError && error.requestSent === false,
    );
    // The PATCH endpoint cannot express field transforms; the client reports it
    // through the same typed error contract (request never sent).
    await assert.rejects(
      () => client.patchDocument('medicines/med-1', { at: SERVER_TIMESTAMP }),
      (error: unknown) => error instanceof FirestoreRestError
        && error.reason === 'INVALID_ARGUMENT'
        && error.requestSent === false,
    );

    assert.equal(captured.length, 0);
  });
});

describe('Stage 5A: client-side document ids', () => {
  it('generates Firestore-style 20-character Auto-Ids that are safe as document ids', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const id = generateAutoId();
      assert.equal(id.length, 20, `expected 20 characters, got ${id.length}: ${id}`);
      assert.match(id, /^[A-Za-z0-9]{20}$/, `unexpected characters in ${id}`);
      assert.doesNotThrow(() => assertSafeRelativePath(`order_requests/${id}`));
      seen.add(id);
    }
    assert.equal(seen.size, 200, 'generated ids must not collide');
  });
});
