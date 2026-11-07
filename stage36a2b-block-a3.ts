
  it('rejects an order request for a non-reserve operation type', () => {
    const operation = createOperationIdentity('journal:operation-receipt', 'receipt', {
      medicineId: 'medicine-1',
      quantity: 1,
    });
    expectInvalidOrderRequest(operation, orderIntent(), 'stored submission');
  });

  it('rejects an order request whose requestId differs from the canonical orderId', () => {
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...orderIntent(), requestId: 'other-request' },
      'stored submission',
    );
  });

  it('rejects an order request whose uid differs from the canonical userId', () => {
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...orderIntent(), uid: 'other-uid' },
      'stored submission',
    );
  });

  it('rejects an order request whose items differ from the canonical items', () => {
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...orderIntent(), requestedItems: [{ medicineId: 'medicine-2', quantity: 2 }] },
      'stored submission',
    );
  });

  function fullOrderRequest(overrides?: Partial<JournalOrderRequest>): JournalOrderRequest {
    return Object.freeze({
      requestId: 'stable-request-1',
      uid: 'uid-employee',
      requestedItems: Object.freeze([Object.freeze({ medicineId: 'medicine-1', quantity: 2 })]),
      payload: Object.freeze({
        uid: 'uid-employee',
        items: Object.freeze([
          Object.freeze({ medicineId: 'medicine-1', medicineName: 'Paracetamol', quantity: 2 }),
        ]),
        status: 'pending',
        requestDate: 'SERVER_TIMESTAMP',
      }),
      ...overrides,
    } as JournalOrderRequest);
  }

  it('rejects a document payload with an unknown key', () => {
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...fullOrderRequest(), payload: { ...fullOrderRequest()!.payload, bogus: 1 } },
      'payload field',
    );
  });

  it('rejects a document payload with a non-pending status', () => {
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...fullOrderRequest(), payload: { ...fullOrderRequest()!.payload, status: 'processed' } },
      'status',
    );
  });

  it('rejects a document payload with a non-marker requestDate', () => {
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...fullOrderRequest(), payload: { ...fullOrderRequest()!.payload, requestDate: '2026-01-01T00:00:00.000Z' } },
      'requestDate',
    );
  });

  it('rejects a document payload whose uid differs from the order request uid', () => {
    expectInvalidOrderRequest(
      makeOrderOperation(),
      { ...fullOrderRequest(), payload: { ...fullOrderRequest()!.payload, uid: 'other-uid' } },
      'uid',
    );
  });

  it('rejects a document payload whose items differ from the requested items', () => {
    expectInvalidOrderRequest(
      makeOrderOperation(),
      {
        ...fullOrderRequest(),
        payload: {
          ...fullOrderRequest()!.payload,
          items: Object.freeze([Object.freeze({ medicineId: 'medicine-2', medicineName: 'Other', quantity: 2 })]),
        },
      },
      'items',
    );
  });

  it('rejects a document payload item with a missing or empty medicineName snapshot', () => {
    const { medicineName: _name, ...itemWithoutName } = fullOrderRequest()!.payload!.items[0];
    expectInvalidOrderRequest(
      makeOrderOperation(),
      {
        ...fullOrderRequest(),
        payload: {
          ...fullOrderRequest()!.payload,
          items: Object.freeze([Object.freeze(itemWithoutName as JournalOrderRequestItem)]),
        },
      },
      'medicineName',
    );
    expectInvalidOrderRequest(
      makeOrderOperation(),
      {
        ...fullOrderRequest(),
        payload: {
          ...fullOrderRequest()!.payload,
          items: Object.freeze([Object.freeze({ ...fullOrderRequest()!.payload!.items[0], medicineName: '' })]),
        },
      },
      'medicineName',
    );
  });
