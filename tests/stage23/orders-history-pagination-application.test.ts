import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '../../electron/domain/errors';
import {
  FakeOrdersRepository,
  FakeSession,
  FakeUsersRepository,
  makeOrder,
  rulesDenied,
} from '../stage7/helpers/fakes';
import { buildApplication } from '../stage9/helpers';

describe('Stage 23 administrator order-history application pagination', () => {
  it('uses a fixed bounded page and never publishes the Main-owned continuation token', async () => {
    const orders = new FakeOrdersRepository([], null, [{
      orders: [makeOrder({ id: 'order-1' })],
      nextPageToken: 'private-next-page-token',
    }]);

    const result = await buildApplication(undefined, undefined, undefined, orders).manager.listOrderHistoryPage();

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.value.orders.map((order) => order.id) : [], ['order-1']);
    assert.equal(result.ok && result.value.hasMore, true);
    assert.equal(JSON.stringify(result).includes('private-next-page-token'), false);
    assert.deepEqual(orders.seenLimits, [500]);
    assert.deepEqual(orders.seenPageTokens, [null]);
  });

  it('retains the cursor after a transient subsequent-page failure and retries the same page', async () => {
    const users = new FakeUsersRepository([]);
    const orders = new FakeOrdersRepository([], null, [
      { orders: [makeOrder({ id: 'order-1' })], nextPageToken: 'cursor-1' },
      { failure: new DomainError('TRANSPORT', 'temporary failure') },
      { orders: [makeOrder({ id: 'order-2' })], nextPageToken: null },
    ]);
    const manager = buildApplication(users, undefined, undefined, orders).manager;

    const first = await manager.listOrderHistoryPage();
    const failed = await manager.loadMoreOrderHistory();
    const retried = await manager.loadMoreOrderHistory();

    assert.equal(first.ok && first.value.hasMore, true);
    assert.equal(failed.ok, false);
    assert.equal(failed.ok ? null : failed.error.code, 'INFRASTRUCTURE_FAILURE');
    assert.equal(failed.ok ? null : failed.error.retryable, true);
    assert.deepEqual(retried.ok ? retried.value.orders.map((order) => order.id) : [], ['order-2']);
    assert.equal(retried.ok && retried.value.hasMore, false);
    assert.deepEqual(orders.seenLimits, [500, 500, 500]);
    assert.deepEqual(orders.seenPageTokens, [null, 'cursor-1', 'cursor-1']);
    assert.equal(users.listCalls, 1, 'Load More must not trigger another profile read');
  });

  it('resets to a fresh first page on refresh and performs no read after end-of-list', async () => {
    const orders = new FakeOrdersRepository([], null, [
      { orders: [makeOrder({ id: 'old-order' })], nextPageToken: 'cursor-old' },
      { orders: [makeOrder({ id: 'new-order' })], nextPageToken: 'cursor-new' },
      { orders: [makeOrder({ id: 'next-order' })], nextPageToken: null },
    ]);
    const manager = buildApplication(undefined, undefined, undefined, orders).manager;

    const first = await manager.listOrderHistoryPage();
    const refreshed = await manager.listOrderHistoryPage();
    const next = await manager.loadMoreOrderHistory();
    const ended = await manager.loadMoreOrderHistory();

    assert.deepEqual(first.ok ? first.value.orders.map((order) => order.id) : [], ['old-order']);
    assert.deepEqual(refreshed.ok ? refreshed.value.orders.map((order) => order.id) : [], ['new-order']);
    assert.deepEqual(next.ok ? next.value.orders.map((order) => order.id) : [], ['next-order']);
    assert.equal(ended.ok && ended.value.hasMore, false);
    assert.deepEqual(orders.seenPageTokens, [null, null, 'cursor-new']);
    assert.deepEqual(orders.seenLimits, [500, 500, 500]);
  });

  it('does not advance when the rules refuse the page and reports the refusal', async () => {
    const orders = new FakeOrdersRepository([], rulesDenied('orders'));
    const manager = buildApplication(undefined, undefined, undefined, orders).manager;

    const result = await manager.listOrderHistoryPage();

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'AUTHORIZATION_DENIED');
    assert.deepEqual(orders.seenPageTokens, [null]);
  });

  it('refuses signed-out paging before touching the repository', async () => {
    const orders = new FakeOrdersRepository([makeOrder()]);
    const manager = buildApplication(undefined, undefined, undefined, orders, FakeSession.signedOut()).manager;

    const first = await manager.listOrderHistoryPage();
    const more = await manager.loadMoreOrderHistory();

    assert.equal(first.ok, false);
    assert.equal(first.ok ? null : first.error.code, 'AUTHENTICATION_FAILED');
    assert.equal(more.ok, false);
    assert.equal(more.ok ? null : more.error.code, 'AUTHENTICATION_FAILED');
    assert.deepEqual(orders.seenPageTokens, []);
  });

  it('stops on a repeated continuation token instead of creating an endless page loop', async () => {
    const orders = new FakeOrdersRepository([], null, [
      { orders: [makeOrder()], nextPageToken: 'same-cursor' },
      { orders: [makeOrder({ id: 'duplicate-page' })], nextPageToken: 'same-cursor' },
    ]);
    const manager = buildApplication(undefined, undefined, undefined, orders).manager;

    await manager.listOrderHistoryPage();
    const repeated = await manager.loadMoreOrderHistory();
    const ended = await manager.loadMoreOrderHistory();

    assert.equal(repeated.ok, false);
    assert.equal(repeated.ok ? null : repeated.error.retryable, false);
    assert.equal(ended.ok, true);
    assert.equal(ended.ok ? ended.value.hasMore : null, false);
    assert.deepEqual(orders.seenPageTokens, [null, 'same-cursor']);
  });

  it('rejects a multi-token cycle and clears the cursor without another read', async () => {
    const orders = new FakeOrdersRepository([], null, [
      { orders: [makeOrder({ id: 'page-a' })], nextPageToken: 'cursor-a' },
      { orders: [makeOrder({ id: 'page-b' })], nextPageToken: 'cursor-b' },
      { orders: [makeOrder({ id: 'cycle-page' })], nextPageToken: 'cursor-a' },
    ]);
    const manager = buildApplication(undefined, undefined, undefined, orders).manager;

    const first = await manager.listOrderHistoryPage();
    const second = await manager.loadMoreOrderHistory();
    const cycle = await manager.loadMoreOrderHistory();
    const stopped = await manager.loadMoreOrderHistory();

    assert.equal(first.ok && first.value.hasMore, true);
    assert.equal(second.ok && second.value.hasMore, true);
    assert.equal(cycle.ok, false);
    assert.equal(cycle.ok ? null : cycle.error.code, 'INTERNAL_ERROR');
    assert.equal(cycle.ok ? null : cycle.error.retryable, false);
    assert.equal(stopped.ok, true);
    assert.equal(stopped.ok ? stopped.value.hasMore : null, false);
    assert.deepEqual(orders.seenPageTokens, [null, 'cursor-a', 'cursor-b']);
  });
});
