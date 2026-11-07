const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const path = require('node:path');

const libDirectory = process.env.STAGE36A1_TEST_LIB_DIR || path.join(__dirname, '..', 'lib');
const {
  assertOperationIdentityCompatible,
  canonicalizeOperationPayload,
  createOperationIdentity,
  hashOperationPayload,
  validateStoredOperationRecord,
} = require(path.join(libDirectory, 'domain', 'operations.js'));
const {
  calculateInventoryMovement,
  onHand,
  reverseInventoryMovement,
  validateInventoryMovement,
  validateInventoryState,
} = require(path.join(libDirectory, 'domain', 'inventory.js'));
const { validateOrderTransition } = require(path.join(libDirectory, 'domain', 'order-lifecycle.js'));
const {
  evaluateAuthorizationProfile,
  evaluateCombinedAuthorization,
} = require(path.join(libDirectory, 'domain', 'authorization-state.js'));

function orderPayload(items = [{ medicineId: 'med-b', quantity: 2 }, { medicineId: 'med-a', quantity: 1 }]) {
  return { orderId: 'order-1', userId: 'user-1', items };
}

function profile(overrides = {}) {
  return { uid: 'user-1', role: 'employee', status: 'approved', ...overrides };
}

function returnEvidence(overrides = {}) {
  return {
    returnEventId: 'return-1',
    orderId: 'order-1',
    items: [{ medicineId: 'med-a', quantity: 1 }],
    acceptedByUid: 'admin-1',
    acceptedAt: '2026-11-05T12:00:00.000Z',
    ...overrides,
  };
}

function orderContext(overrides = {}) {
  return {
    orderId: 'order-1',
    items: [{ medicineId: 'med-a', quantity: 2 }],
    ...overrides,
  };
}

function errorCode(code) {
  return (error) => {
    assert.equal(error.code, code);
    return true;
  };
}

describe('Stage 36A1B canonical operation and stored identity contract', () => {
  it('canonical payload and hash are stable regardless of item ordering', () => {
    const first = hashOperationPayload('reserve', orderPayload());
    const second = hashOperationPayload('reserve', orderPayload([
      { medicineId: 'med-a', quantity: 1 },
      { medicineId: 'med-b', quantity: 2 },
    ]));
    assert.equal(first, second);
  });

  it('aggregates duplicate medicine lines and sorts canonical lines', () => {
    const { payload } = canonicalizeOperationPayload('reserve', orderPayload([
      { medicineId: 'med-b', quantity: 2 },
      { medicineId: 'med-a', quantity: 3 },
      { medicineId: 'med-b', quantity: 4 },
    ]));
    assert.deepEqual(payload.items, [
      { medicineId: 'med-a', quantity: 3 },
      { medicineId: 'med-b', quantity: 6 },
    ]);
  });

  it('rejects invalid operation, order, user, and medicine IDs with exact codes', () => {
    assert.throws(() => createOperationIdentity('', 'reserve', orderPayload()), errorCode('INVALID_ID'));
    assert.throws(() => canonicalizeOperationPayload('reserve', { ...orderPayload(), orderId: 'bad/id' }), errorCode('INVALID_ID'));
    assert.throws(() => canonicalizeOperationPayload('reserve', { ...orderPayload(), userId: '' }), errorCode('INVALID_ID'));
    assert.throws(() => canonicalizeOperationPayload('reserve', orderPayload([{ medicineId: '', quantity: 1 }])), errorCode('INVALID_ID'));
  });

  it('rejects unknown order and medicine-line fields', () => {
    assert.throws(() => canonicalizeOperationPayload('reserve', { ...orderPayload(), extra: true }), errorCode('UNKNOWN_FIELD'));
    assert.throws(() => canonicalizeOperationPayload('reserve', orderPayload([{ medicineId: 'med-a', quantity: 1, extra: true }])), errorCode('UNKNOWN_FIELD'));
  });

  it('rejects invalid quantities, unsafe aggregation, and empty orders', () => {
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
      assert.throws(
        () => canonicalizeOperationPayload('reserve', orderPayload([{ medicineId: 'med-a', quantity }])),
        errorCode('INVALID_QUANTITY'),
      );
    }
    assert.throws(
      () => canonicalizeOperationPayload('reserve', orderPayload([
        { medicineId: 'med-a', quantity: Number.MAX_SAFE_INTEGER },
        { medicineId: 'med-a', quantity: 1 },
      ])),
      errorCode('ARITHMETIC_OVERFLOW'),
    );
    assert.throws(() => canonicalizeOperationPayload('reserve', orderPayload([])), errorCode('EMPTY_ORDER'));
  });

  it('includes operation type in payload hashes', () => {
    assert.notEqual(hashOperationPayload('reserve', orderPayload()), hashOperationPayload('release', orderPayload()));
  });

  it('accepts a fully validated exact retry', () => {
    const stored = createOperationIdentity('op-1', 'reserve', orderPayload());
    const proposed = createOperationIdentity('op-1', 'reserve', orderPayload([
      { medicineId: 'med-a', quantity: 1 },
      { medicineId: 'med-b', quantity: 2 },
    ]));
    assert.deepEqual(assertOperationIdentityCompatible(stored, proposed), undefined);
  });

  it('rejects reuse of an operation ID with changed canonical payload or operation type', () => {
    const stored = createOperationIdentity('op-1', 'reserve', orderPayload());
    const changedPayload = createOperationIdentity('op-1', 'reserve', orderPayload([
      { medicineId: 'med-a', quantity: 5 },
    ]));
    const changedType = createOperationIdentity('op-1', 'release', orderPayload());
    assert.throws(() => assertOperationIdentityCompatible(stored, changedPayload), errorCode('OPERATION_ID_CONFLICT'));
    assert.throws(() => assertOperationIdentityCompatible(stored, changedType), errorCode('OPERATION_ID_CONFLICT'));
  });

  it('validates the complete stored record schema and rejects incomplete or unknown fields', () => {
    const stored = createOperationIdentity('op-1', 'reserve', orderPayload());
    assert.deepEqual(validateStoredOperationRecord(stored), stored);
    const { payloadHash, ...incomplete } = stored;
    assert.throws(() => validateStoredOperationRecord(incomplete), errorCode('INVALID_STORED_OPERATION'));
    assert.throws(() => validateStoredOperationRecord({ ...stored, unknown: true }), errorCode('UNKNOWN_FIELD'));
  });

  it('rejects invalid stored operation IDs, types, and SHA-256 formats', () => {
    const stored = createOperationIdentity('op-1', 'reserve', orderPayload());
    assert.throws(() => validateStoredOperationRecord({ ...stored, operationId: 'bad/id' }), errorCode('INVALID_ID'));
    assert.throws(() => validateStoredOperationRecord({ ...stored, operationType: 'grant-admin' }), errorCode('INVALID_OPERATION_TYPE'));
    for (const payloadHash of ['not-a-hash', stored.payloadHash.toUpperCase(), `0${stored.payloadHash.slice(1, -1)}`, '']) {
      assert.throws(() => validateStoredOperationRecord({ ...stored, payloadHash }), errorCode('INVALID_STORED_OPERATION'));
    }
  });

  it('recomputes stored hash and rejects mismatched or noncanonical payload representations', () => {
    const stored = createOperationIdentity('op-1', 'reserve', orderPayload());
    assert.throws(
      () => validateStoredOperationRecord({
        ...stored,
        canonicalPayload: orderPayload([{ medicineId: 'med-a', quantity: 9 }]),
      }),
      errorCode('STORED_OPERATION_HASH_MISMATCH'),
    );
    assert.throws(
      () => validateStoredOperationRecord({
        ...stored,
        canonicalPayload: orderPayload([
          { medicineId: 'med-b', quantity: 2 },
          { medicineId: 'med-a', quantity: 1 },
        ]),
      }),
      errorCode('INVALID_STORED_OPERATION'),
    );
  });

  it('rejects conflicting canonical content even when the supplied hash is reused', () => {
    const stored = createOperationIdentity('op-1', 'reserve', orderPayload());
    const collisionLikeRecord = {
      ...stored,
      canonicalPayload: orderPayload([{ medicineId: 'med-a', quantity: 9 }]),
    };
    assert.throws(
      () => assertOperationIdentityCompatible(stored, collisionLikeRecord),
      errorCode('STORED_OPERATION_HASH_MISMATCH'),
    );
  });
});

describe('Stage 36A1B inventory movement contract', () => {
  it('derives onHand from availableStock and reservedStock only', () => {
    assert.equal(onHand({ availableStock: 7, reservedStock: 3 }), 10);
    assert.throws(
      () => validateInventoryState({ availableStock: 7, reservedStock: 3, onHand: 10 }),
      errorCode('INVALID_INVENTORY_STATE'),
    );
  });

  it('rejects missing, malformed, negative, fractional, unsafe, and inconsistent inventory state', () => {
    for (const state of [
      {},
      { availableStock: 1 },
      { availableStock: -1, reservedStock: 0 },
      { availableStock: 1.5, reservedStock: 0 },
      { availableStock: Number.MAX_SAFE_INTEGER + 1, reservedStock: 0 },
      { availableStock: '2', reservedStock: 0 },
      null,
    ]) {
      assert.throws(() => validateInventoryState(state), errorCode('INVALID_INVENTORY_STATE'));
    }
    assert.throws(
      () => onHand({ availableStock: Number.MAX_SAFE_INTEGER, reservedStock: 1 }),
      errorCode('ARITHMETIC_OVERFLOW'),
    );
  });

  it('reserves stock with exact medicine, before/after balances, and deltas', () => {
    const movement = calculateInventoryMovement(
      { availableStock: 10, reservedStock: 2 },
      'op-reserve',
      'move-reserve',
      { operationType: 'reserve', medicineId: 'med-a', quantity: 3 },
    );
    assert.equal(movement.medicineId, 'med-a');
    assert.deepEqual(movement.before, { availableStock: 10, reservedStock: 2 });
    assert.deepEqual(movement.after, { availableStock: 7, reservedStock: 5 });
    assert.deepEqual(movement.deltas, { availableStock: -3, reservedStock: 3, onHand: 0 });
    assert.equal(movement.quantity, 3);
  });

  it('fulfills reserved stock with exact medicine and delta; approval alone does not calculate fulfillment', () => {
    const movement = calculateInventoryMovement(
      { availableStock: 7, reservedStock: 5 },
      'op-fulfill',
      'move-fulfill',
      { operationType: 'fulfill', medicineId: 'med-a', quantity: 2 },
    );
    assert.equal(movement.medicineId, 'med-a');
    assert.deepEqual(movement.after, { availableStock: 7, reservedStock: 3 });
    assert.deepEqual(movement.deltas, { availableStock: 0, reservedStock: -2, onHand: -2 });
  });

  it('releases reserved stock with exact pool transfer and deltas', () => {
    const movement = calculateInventoryMovement(
      { availableStock: 7, reservedStock: 5 },
      'op-release',
      'move-release',
      { operationType: 'release', medicineId: 'med-a', quantity: 2 },
    );
    assert.deepEqual(movement.after, { availableStock: 9, reservedStock: 3 });
    assert.deepEqual(movement.deltas, { availableStock: 2, reservedStock: -2, onHand: 0 });
  });

  it('receives new stock into available stock with exact deltas', () => {
    const movement = calculateInventoryMovement(
      { availableStock: 7, reservedStock: 3 },
      'op-receipt',
      'move-receipt',
      { operationType: 'receipt', medicineId: 'med-a', quantity: 4 },
    );
    assert.deepEqual(movement.after, { availableStock: 11, reservedStock: 3 });
    assert.deepEqual(movement.deltas, { availableStock: 4, reservedStock: 0, onHand: 4 });
  });

  it('applies positive and negative corrections only to the explicitly selected pool', () => {
    const availableIncrease = calculateInventoryMovement(
      { availableStock: 7, reservedStock: 3 },
      'op-correct-1',
      'move-correct-1',
      { operationType: 'correction', medicineId: 'med-a', stockPool: 'availableStock', delta: 2 },
    );
    const reservedDecrease = calculateInventoryMovement(
      { availableStock: 7, reservedStock: 3 },
      'op-correct-2',
      'move-correct-2',
      { operationType: 'correction', medicineId: 'med-a', stockPool: 'reservedStock', delta: -1 },
    );
    assert.deepEqual(availableIncrease.after, { availableStock: 9, reservedStock: 3 });
    assert.deepEqual(availableIncrease.deltas, { availableStock: 2, reservedStock: 0, onHand: 2 });
    assert.deepEqual(reservedDecrease.after, { availableStock: 7, reservedStock: 2 });
    assert.deepEqual(reservedDecrease.deltas, { availableStock: 0, reservedStock: -1, onHand: -1 });
    assert.equal(availableIncrease.stockPool, 'availableStock');
    assert.equal(reservedDecrease.stockPool, 'reservedStock');
  });

  it('rejects missing and malformed medicine IDs and invalid stock pools with exact codes', () => {
    assert.throws(
      () => calculateInventoryMovement({ availableStock: 1, reservedStock: 0 }, 'op', 'move', {
        operationType: 'receipt', quantity: 1,
      }),
      errorCode('INVALID_ID'),
    );
    assert.throws(
      () => calculateInventoryMovement({ availableStock: 1, reservedStock: 0 }, 'op', 'move', {
        operationType: 'receipt', medicineId: 'bad/id', quantity: 1,
      }),
      errorCode('INVALID_ID'),
    );
    assert.throws(
      () => calculateInventoryMovement({ availableStock: 1, reservedStock: 0 }, 'op', 'move', {
        operationType: 'correction', medicineId: 'med-a', stockPool: 'onHand', delta: 1,
      }),
      errorCode('INVALID_STOCK_POOL'),
    );
  });

  it('rejects incorrect correction stock-pool semantics and receipt delta semantics', () => {
    const correction = calculateInventoryMovement(
      { availableStock: 7, reservedStock: 3 },
      'op-correct',
      'move-correct',
      { operationType: 'correction', medicineId: 'med-a', stockPool: 'availableStock', delta: 2 },
    );
    assert.throws(
      () => validateInventoryMovement({ ...correction, stockPool: 'reservedStock' }),
      errorCode('INVALID_MOVEMENT_SEMANTICS'),
    );

    const receipt = calculateInventoryMovement(
      { availableStock: 7, reservedStock: 3 },
      'op-receipt',
      'move-receipt',
      { operationType: 'receipt', medicineId: 'med-a', quantity: 2 },
    );
    assert.throws(
      () => validateInventoryMovement({
        ...receipt,
        before: { availableStock: 7, reservedStock: 3 },
        after: { availableStock: 5, reservedStock: 3 },
        deltas: { availableStock: -2, reservedStock: 0, onHand: -2 },
      }),
      errorCode('INVALID_MOVEMENT_SEMANTICS'),
    );
  });

  it('rejects insufficient available or reserved stock and negative resulting balances', () => {
    assert.throws(
      () => calculateInventoryMovement({ availableStock: 1, reservedStock: 0 }, 'op', 'move', {
        operationType: 'reserve', medicineId: 'med-a', quantity: 2,
      }),
      errorCode('INSUFFICIENT_AVAILABLE_STOCK'),
    );
    for (const operationType of ['fulfill', 'release']) {
      assert.throws(
        () => calculateInventoryMovement({ availableStock: 4, reservedStock: 1 }, 'op', 'move', {
          operationType, medicineId: 'med-a', quantity: 2,
        }),
        errorCode('INSUFFICIENT_RESERVED_STOCK'),
      );
    }
    assert.throws(
      () => calculateInventoryMovement({ availableStock: 1, reservedStock: 0 }, 'op', 'move', {
        operationType: 'correction', medicineId: 'med-a', stockPool: 'availableStock', delta: -2,
      }),
      errorCode('NEGATIVE_BALANCE'),
    );
  });

  it('rejects invalid quantities, zero corrections, unsafe values, and arithmetic overflow', () => {
    assert.throws(
      () => calculateInventoryMovement({ availableStock: 1, reservedStock: 0 }, 'op', 'move', {
        operationType: 'receipt', medicineId: 'med-a', quantity: 0,
      }),
      errorCode('INVALID_QUANTITY'),
    );
    assert.throws(
      () => calculateInventoryMovement({ availableStock: 1, reservedStock: 0 }, 'op', 'move', {
        operationType: 'correction', medicineId: 'med-a', stockPool: 'availableStock', delta: 0,
      }),
      errorCode('INVALID_DELTA'),
    );
    assert.throws(
      () => calculateInventoryMovement({ availableStock: Number.MAX_SAFE_INTEGER, reservedStock: 0 }, 'op', 'move', {
        operationType: 'receipt', medicineId: 'med-a', quantity: 1,
      }),
      errorCode('ARITHMETIC_OVERFLOW'),
    );
    assert.doesNotThrow(() => validateInventoryState({
      availableStock: 0, reservedStock: Number.MAX_SAFE_INTEGER,
    }));
    assert.throws(
      () => validateInventoryState({ availableStock: Number.MAX_SAFE_INTEGER, reservedStock: 1 }),
      errorCode('ARITHMETIC_OVERFLOW'),
    );
  });

  it('rejects movement records with unknown fields or inconsistent before/after deltas', () => {
    const movement = calculateInventoryMovement(
      { availableStock: 3, reservedStock: 1 },
      'op-reserve',
      'move-reserve',
      { operationType: 'reserve', medicineId: 'med-a', quantity: 1 },
    );
    assert.deepEqual(validateInventoryMovement(movement), movement);
    assert.throws(
      () => validateInventoryMovement({ ...movement, unexpected: true }),
      errorCode('INVALID_INVENTORY_STATE'),
    );
    assert.throws(
      () => validateInventoryMovement({ ...movement, deltas: { ...movement.deltas, onHand: 1 } }),
      errorCode('INVALID_MOVEMENT'),
    );
  });

  it('rejects malformed or semantically invalid reversal source movements', () => {
    const source = calculateInventoryMovement(
      { availableStock: 5, reservedStock: 0 },
      'op-receipt',
      'move-receipt',
      { operationType: 'receipt', medicineId: 'med-a', quantity: 3 },
    );
    const invalidSource = {
      ...source,
      before: { availableStock: 5, reservedStock: 0 },
      after: { availableStock: 2, reservedStock: 0 },
      deltas: { availableStock: -3, reservedStock: 0, onHand: -3 },
    };
    assert.throws(
      () => reverseInventoryMovement(
        { availableStock: 2, reservedStock: 0 }, 'op-reverse', 'move-reverse', invalidSource,
        { sourceMovementId: 'move-receipt', reversalExists: false },
      ),
      errorCode('INVALID_MOVEMENT_SEMANTICS'),
    );
  });

  it('requires an authoritative source-keyed reversal guard and rejects an existing guard', () => {
    const source = calculateInventoryMovement(
      { availableStock: 5, reservedStock: 0 },
      'op-receipt',
      'move-receipt',
      { operationType: 'receipt', medicineId: 'med-a', quantity: 3 },
    );
    assert.throws(
      () => reverseInventoryMovement(source.after, 'op-reverse', 'move-reverse', source, undefined),
      errorCode('INVALID_REVERSAL_GUARD'),
    );
    assert.throws(
      () => reverseInventoryMovement(source.after, 'op-reverse', 'move-reverse', source, {
        sourceMovementId: 'move-receipt',
        reversalExists: true,
      }),
      errorCode('DUPLICATE_REVERSAL'),
    );
    assert.throws(
      () => reverseInventoryMovement(source.after, 'op-reverse', 'move-reverse', source, {
        sourceMovementId: 'another-source',
        reversalExists: false,
      }),
      errorCode('INVALID_REVERSAL_GUARD'),
    );
  });

  it('creates an exact inverse reversal when the authoritative source guard is absent', () => {
    const source = calculateInventoryMovement(
      { availableStock: 5, reservedStock: 0 },
      'op-receipt',
      'move-receipt',
      { operationType: 'receipt', medicineId: 'med-a', quantity: 3 },
    );
    const reversal = reverseInventoryMovement(source.after, 'op-reverse', 'move-reverse', source, {
      sourceMovementId: source.movementId,
      reversalExists: false,
    });
    assert.equal(reversal.operationType, 'reversal');
    assert.equal(reversal.medicineId, source.medicineId);
    assert.equal(reversal.sourceMovementId, source.movementId);
    assert.equal(reversal.sourceOperationId, source.operationId);
    assert.deepEqual(reversal.before, source.after);
    assert.deepEqual(reversal.after, source.before);
    assert.deepEqual(reversal.deltas, { availableStock: -3, reservedStock: 0, onHand: -3 });
    assert.deepEqual(validateInventoryMovement(reversal, source), reversal);
  });

  it('rejects reversal underflow and reversal-of-reversal', () => {
    const source = calculateInventoryMovement(
      { availableStock: 5, reservedStock: 0 },
      'op-receipt',
      'move-receipt',
      { operationType: 'receipt', medicineId: 'med-a', quantity: 3 },
    );
    assert.throws(
      () => reverseInventoryMovement({ availableStock: 1, reservedStock: 0 }, 'op-reverse', 'move-reverse', source, {
        sourceMovementId: source.movementId, reversalExists: false,
      }),
      errorCode('NEGATIVE_BALANCE'),
    );
    const reversal = reverseInventoryMovement(source.after, 'op-reverse', 'move-reverse', source, {
      sourceMovementId: source.movementId, reversalExists: false,
    });
    assert.throws(
      () => reverseInventoryMovement(source.before, 'op-again', 'move-again', reversal, {
        sourceMovementId: reversal.movementId, reversalExists: false,
      }),
      errorCode('REVERSAL_OF_REVERSAL'),
    );
  });
});

describe('Stage 36A1B owner-approved order lifecycle', () => {
  it('permits pending approval, rejection, and cancellation', () => {
    for (const to of ['accepted', 'rejected', 'cancelled']) {
      assert.equal(validateOrderTransition('pending', to), undefined);
    }
  });

  it('permits separate accepted-to-fulfilled physical handoff and accepted cancellation', () => {
    assert.equal(validateOrderTransition('accepted', 'fulfilled'), undefined);
    assert.equal(validateOrderTransition('accepted', 'cancelled'), undefined);
  });

  it('requires structured return evidence and matching order/item association for fulfilled cancellation', () => {
    assert.equal(validateOrderTransition(
      'fulfilled',
      'cancelled',
      { physicalReturn: returnEvidence() },
      orderContext(),
    ), undefined);
    assert.throws(
      () => validateOrderTransition('fulfilled', 'cancelled', {}, orderContext()),
      errorCode('INVALID_RETURN_EVIDENCE'),
    );
    assert.throws(
      () => validateOrderTransition(
        'fulfilled',
        'cancelled',
        { physicalReturn: true },
        orderContext(),
      ),
      errorCode('INVALID_RETURN_EVIDENCE'),
    );
  });

  it('rejects malformed return actor, event, timestamp, order, medicine, and quantity', () => {
    for (const evidence of [
      returnEvidence({ acceptedByUid: '' }),
      returnEvidence({ returnEventId: 'bad/id' }),
      returnEvidence({ acceptedAt: 'yesterday' }),
      returnEvidence({ orderId: 'other-order' }),
      returnEvidence({ items: [{ medicineId: 'med-unknown', quantity: 1 }] }),
      returnEvidence({ items: [{ medicineId: 'med-a', quantity: 3 }] }),
      returnEvidence({ items: [{ medicineId: 'med-a', quantity: 1.5 }] }),
    ]) {
      assert.throws(
        () => validateOrderTransition('fulfilled', 'cancelled', { physicalReturn: evidence }, orderContext()),
        errorCode('INVALID_RETURN_EVIDENCE'),
      );
    }
  });

  it('prohibits backward, repeated, and terminal transitions', () => {
    for (const [from, to] of [
      ['pending', 'pending'],
      ['accepted', 'pending'],
      ['accepted', 'rejected'],
      ['rejected', 'pending'],
      ['rejected', 'accepted'],
      ['rejected', 'cancelled'],
      ['fulfilled', 'accepted'],
      ['fulfilled', 'pending'],
      ['cancelled', 'pending'],
      ['cancelled', 'accepted'],
      ['cancelled', 'fulfilled'],
      ['cancelled', 'cancelled'],
    ]) {
      assert.throws(
        () => validateOrderTransition(from, to),
        errorCode('INVALID_ORDER_TRANSITION'),
        `${from} -> ${to}`,
      );
    }
    assert.throws(
      () => validateOrderTransition('unknown', 'accepted'),
      errorCode('INVALID_ORDER_STATUS'),
    );
  });

  it('does not apply inventory restoration during cancellation validation', () => {
    const balancesBefore = { availableStock: 2, reservedStock: 0 };
    const evidence = { physicalReturn: returnEvidence() };
    validateOrderTransition('fulfilled', 'cancelled', evidence, orderContext());
    assert.deepEqual(balancesBefore, { availableStock: 2, reservedStock: 0 });
  });
});

describe('Stage 36A1B profile and trusted Firebase Auth state classification', () => {
  it('classifies missing, malformed, mismatched, unknown-role, and unknown-status profiles', () => {
    assert.deepEqual(evaluateAuthorizationProfile('user-1', null), { state: 'missing' });
    for (const value of [
      'not-an-object',
      {},
      profile({ uid: 'other-user' }),
      profile({ role: 'root' }),
      profile({ status: 'unknown' }),
    ]) {
      assert.equal(evaluateAuthorizationProfile('user-1', value).state, 'malformed');
    }
  });

  it('classifies pending and rejected profiles without treating extra fields as privileges', () => {
    assert.equal(evaluateAuthorizationProfile('user-1', profile({ status: 'pending' })).state, 'pending');
    assert.equal(evaluateAuthorizationProfile('user-1', profile({ status: 'rejected' })).state, 'rejected');
    const withUnknownPrivilege = evaluateAuthorizationProfile('user-1', profile({ isAdmin: true }));
    assert.equal(withUnknownPrivilege.state, 'approved');
    assert.equal(withUnknownPrivilege.profile.role, 'employee');
  });

  it('requires explicit Auth account state and fails closed when it is missing or unavailable', () => {
    assert.equal(evaluateCombinedAuthorization('user-1', profile(), undefined).state, 'auth-unavailable');
    assert.equal(evaluateCombinedAuthorization('user-1', profile(), null).state, 'auth-unavailable');
    assert.equal(evaluateCombinedAuthorization('user-1', profile(), { state: 'unavailable' }).state, 'auth-unavailable');
    assert.equal(evaluateCombinedAuthorization('user-1', profile(), { state: 'missing' }).state, 'auth-missing');
    assert.equal(evaluateCombinedAuthorization('user-1', profile(), { state: 'enabled', extra: true }).state, 'auth-unavailable');
  });

  it('denies an approved profile when the trusted Firebase Auth account is disabled', () => {
    const result = evaluateCombinedAuthorization('user-1', profile(), { state: 'disabled' });
    assert.equal(result.state, 'auth-disabled');
    assert.deepEqual(result.profile, profile());
  });

  it('classifies an approved profile as authorized only with an explicitly enabled Auth account', () => {
    const result = evaluateCombinedAuthorization('user-1', profile(), { state: 'enabled' });
    assert.equal(result.state, 'approved');
    assert.deepEqual(result.profile, profile());
  });

  it('keeps the existing admin, assistant, and employee role vocabulary', () => {
    for (const role of ['admin', 'assistant', 'employee']) {
      assert.equal(evaluateAuthorizationProfile('user-1', profile({ role })).state, 'approved');
    }
  });
});
