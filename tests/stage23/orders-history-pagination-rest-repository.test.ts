import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_FIRESTORE_DATABASE_ID, type FirestoreRestConfig } from '../../electron/config/firestore-config';
import { FirestoreTimestamp, encodeFields } from '../../electron/services/firestore-codec';
import { FirestoreRestClient, FirestoreRestError } from '../../electron/services/firestore-rest';
import { FirestoreOrdersRepository } from '../../electron/repositories/firestore/order-repository';

const CONFIG: FirestoreRestConfig = Object.freeze({
  projectId: 'demo-stage23',
  databaseId: DEFAULT_FIRESTORE_DATABASE_ID,
  emulatorHost: '127.0.0.1:8080',
  requestTimeoutMs: 5000,
});

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
}

function clientFor(
  respond: (index: number) => unknown,
): { readonly client: FirestoreRestClient; readonly requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    requests.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
    });
    return new Response(JSON.stringify(respond(requests.length - 1)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    client: new FirestoreRestClient({
      config: CONFIG,
      getAccessToken: async () => 'test-token',
      fetchImpl,
      allowRemoteTarget: false,
    }),
    requests,
  };
}

function orderDocument(id: string): Record<string, unknown> {
  return {
    name: `projects/${CONFIG.projectId}/databases/${CONFIG.databaseId}/documents/orders/${id}`,
    fields: encodeFields({
      userId: 'employee-1',
      userName: 'نور',
      items: [{ medicineId: 'med-1', medicineName: 'دواء', quantity: 1 }],
      date: FirestoreTimestamp.parse('2026-10-11T09:00:00.000Z'),
      monthYear: '10-2026',
      status: 'pending',
    }),
  };
}

describe('Stage 23 Firestore order-history pagination', () => {
  it('passes the opaque continuation token through the repository and preserves identity', async () => {
    const { client, requests } = clientFor((index) => index === 0
      ? { documents: [orderDocument('order-1')], nextPageToken: 'opaque/token + value' }
      : { documents: [orderDocument('order-2')] });
    const repository = new FirestoreOrdersRepository({ client });

    const first = await repository.listOrdersPage(2, null);
    const second = await repository.listOrdersPage(2, first.nextPageToken);

    assert.equal(first.orders[0]?.id, 'order-1');
    assert.equal(first.nextPageToken, 'opaque/token + value');
    assert.equal(second.orders[0]?.id, 'order-2');
    assert.equal(second.nextPageToken, null);
    assert.equal(new URL(requests[0]!.url).searchParams.get('pageSize'), '2');
    assert.equal(new URL(requests[0]!.url).searchParams.has('pageToken'), false);
    assert.equal(new URL(requests[1]!.url).searchParams.get('pageToken'), 'opaque/token + value');
    assert.equal(requests.length, 2);
  });

  it('treats an omitted token as end-of-list and rejects a malformed token response', async () => {
    const end = clientFor(() => ({ documents: [] }));
    const endResult = await end.client.listDocuments('orders', { pageSize: 500 });
    assert.equal(endResult.nextPageToken, null);

    const malformed = clientFor(() => ({ documents: [], nextPageToken: 42 }));
    await assert.rejects(
      () => malformed.client.listDocuments('orders', { pageSize: 500 }),
      (error: unknown) => error instanceof FirestoreRestError && error.reason === 'UNKNOWN',
    );
  });

  it('rejects an empty continuation token before issuing a request', async () => {
    const { client, requests } = clientFor(() => ({ documents: [] }));
    const repository = new FirestoreOrdersRepository({ client });

    await assert.rejects(() => repository.listOrdersPage(500, ''));
    assert.equal(requests.length, 0);
  });

  it('propagates Firestore authorization failures instead of treating them as end-of-list', async () => {
    const fetchImpl = (async (): Promise<Response> => new Response(JSON.stringify({
      error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' },
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
    const client = new FirestoreRestClient({
      config: CONFIG,
      getAccessToken: async () => 'test-token',
      fetchImpl,
      allowRemoteTarget: false,
    });
    const repository = new FirestoreOrdersRepository({ client });

    await assert.rejects(() => repository.listOrdersPage(500, null));
  });
});
