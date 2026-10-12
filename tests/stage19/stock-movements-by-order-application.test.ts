import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FirestoreRestError } from '../../electron/services/firestore-rest';
import { FakeSession, rulesDenied } from '../stage7/helpers/fakes';
import { createTestApplication, RecordingStockLogsRepository, stockLog } from './helpers';

describe('Stage 19: order-scoped stock movements in the application layer', () => {
  it('validates the complete payload before any repository access', async () => {
    const repository = new RecordingStockLogsRepository([stockLog()]);
    const manager = createTestApplication(repository).manager;

    for (const payload of [
      null,
      [],
      {},
      { orderId: '' },
      { orderId: '../outside' },
      { orderId: 'ord-3', uid: 'renderer-uid' },
      { orderId: 'ord-3', userName: 'renderer-name' },
      { orderId: 'ord-3', role: 'admin' },
    ]) {
      const result = await manager.listStockMovementsByOrder(payload);
      assert.equal(result.ok, false);
      assert.equal(result.ok ? null : result.error.code, 'VALIDATION_FAILED');
    }
    assert.deepEqual(repository.orderQueries, []);
  });

  it('requires an authenticated Main session and does not query without it', async () => {
    const repository = new RecordingStockLogsRepository([stockLog()]);
    const result = await createTestApplication(repository, FakeSession.signedOut())
      .manager.listStockMovementsByOrder({ orderId: 'ord-3' });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'AUTHENTICATION_FAILED');
    assert.deepEqual(repository.orderQueries, []);
  });

  it('delegates the selected id with the fixed bound and projects only StockLogView fields', async () => {
    const repository = new RecordingStockLogsRepository([
      stockLog(),
      stockLog({ id: 'log-2', orderId: 'ord-other' }),
    ]);
    const result = await createTestApplication(repository).manager
      .listStockMovementsByOrder({ orderId: 'ord-3' });

    assert.deepEqual(repository.orderQueries, [{ orderId: 'ord-3', limit: 500 }]);
    assert.deepEqual(repository.allLimits, [500]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.value : [], [{
      id: 'log-1',
      medicineId: 'med-42',
      label: 'صرف طلب Allison',
      quantity: 7,
      type: 'outward',
      dateIso: '2026-06-04T08:30:00.000Z',
      actorUid: 'uid-employee',
      requestId: 'req-9',
      orderId: 'ord-3',
    }]);
  });

  it('maps Rules and transport failures to safe application errors', async () => {
    const denied = await createTestApplication(
      new RecordingStockLogsRepository([], rulesDenied('stock_logs')),
    ).manager.listStockMovementsByOrder({ orderId: 'ord-3' });
    assert.equal(denied.ok, false);
    assert.equal(denied.ok ? null : denied.error.code, 'AUTHORIZATION_DENIED');

    const failed = await createTestApplication(new RecordingStockLogsRepository([], new FirestoreRestError({
      reason: 'NETWORK',
      httpStatus: 503,
      requestSent: true,
      message: 'private upstream detail',
    }))).manager.listStockMovementsByOrder({ orderId: 'ord-3' });
    assert.equal(failed.ok, false);
    assert.equal(failed.ok ? null : failed.error.code, 'INFRASTRUCTURE_FAILURE');
    assert.equal(failed.ok ? false : failed.error.message.includes('private upstream detail'), false);
  });
});
