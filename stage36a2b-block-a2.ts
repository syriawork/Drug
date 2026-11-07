
  it('accepts a complete order request at record creation', () => {
    const operation = makeOrderOperation();
    const record = createOperationJournalRecord(operation, 'prepared', {}, orderIntent());

    assert.deepEqual(validateOperationJournalRecord(record), record);
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.orderRequest?.requestId, 'stable-request-1');
    assert.equal(record.orderRequest?.uid, 'uid-employee');
    assert.deepEqual(record.orderRequest?.requestedItems, [{ medicineId: 'medicine-1', quantity: 2 }]);
    assert.equal(record.orderRequest?.payload, null);
    assert.equal(record.integrity.recordChecksum, calculateOperationJournalChecksum(record));
  });

  it('rejects an order request with an unknown top-level field', () => {
    expectInvalidOrderRequest(makeOrderOperation(), { ...orderIntent(), bogus: true }, 'unknown field');
  });

  it('rejects an order request missing requestId', () => {
    const { requestId: _requestId, ...rest } = orderIntent();
    expectInvalidOrderRequest(makeOrderOperation(), rest, 'requestId');
  });

  it('rejects an order request missing uid', () => {
    const { uid: _uid, ...rest } = orderIntent();
    expectInvalidOrderRequest(makeOrderOperation(), rest, 'uid');
  });

  it('rejects an order request missing requestedItems', () => {
    const { requestedItems: _items, ...rest } = orderIntent();
    expectInvalidOrderRequest(makeOrderOperation(), rest, 'requestedItems');
  });

  it('rejects a malformed requestId', () => {
    expectInvalidOrderRequest(makeOrderOperation(), { ...orderIntent(), requestId: 'request/id' }, 'request id');
    expectInvalidOrderRequest(makeOrderOperation(), { ...orderIntent(), requestId: '' }, 'request id');
  });

  it('rejects an invalid uid', () => {
    expectInvalidOrderRequest(makeOrderOperation(), { ...orderIntent(), uid: '' }, 'uid');
    expectInvalidOrderRequest(makeOrderOperation(), { ...orderIntent(), uid: 123 }, 'uid');
  });

  it('rejects invalid requestedItems', () => {
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...orderIntent(), requestedItems: [] },
      'empty items',
    );
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...orderIntent(), requestedItems: [{ medicineId: 'medicine-1' }] },
      'quantity',
    );
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...orderIntent(), requestedItems: [{ medicineId: 'medicine-1', quantity: 0 }] },
      'positive',
    );
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...orderIntent(), requestedItems: [{ medicineId: 'medicine-1', quantity: 2.5 }] },
      'safe integer',
    );
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...orderIntent(), requestedItems: [{ medicineId: 'bad id!', quantity: 1 }] },
      'medicine id',
    );
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...orderIntent(), requestedItems: [{ medicineId: 'medicine-1', quantity: 1, extra: true }] },
      'item field',
    );
  });
