
  it('includes orderRequest in the record checksum', () => {
    const operation = makeOrderOperation();
    const withRequest = createOperationJournalRecord(operation, 'prepared', {}, orderIntent());
    const withoutRequest = createOperationJournalRecord(operation, 'prepared', {});

    assert.notEqual(withRequest.integrity.recordChecksum, withoutRequest.integrity.recordChecksum);
    assert.equal(withRequest.integrity.recordChecksum, calculateOperationJournalChecksum(withRequest));
    assert.deepEqual(validateOperationJournalRecord(withRequest), withRequest);
  });

  it('invalidates the checksum when the requestId changes', () => {
    const operation = makeOrderOperation();
    const record = createOperationJournalRecord(operation, 'prepared', {}, orderIntent());
    const tampered = {
      ...record,
      orderRequest: { ...record.orderRequest!, requestId: 'different-request' },
    } as unknown as OperationJournalRecord;

    assert.notEqual(calculateOperationJournalChecksum(tampered), record.integrity.recordChecksum);
    expectJournalError(() => validateOperationJournalRecord(tampered), 'checksum verification failed');
  });

  it('invalidates the checksum when the document payload changes', () => {
    const operation = makeOrderOperation();
    const record = createOperationJournalRecord(operation, 'prepared', {}, orderIntent());
    const tampered = {
      ...record,
      orderRequest: {
        ...record.orderRequest!,
        payload: {
          ...record.orderRequest!.payload!,
          items: Object.freeze([
            Object.freeze({ ...record.orderRequest!.payload!.items[0], medicineName: 'OtherName' }),
          ]),
        },
      },
    } as unknown as OperationJournalRecord;

    assert.notEqual(calculateOperationJournalChecksum(tampered), record.integrity.recordChecksum);
    expectJournalError(() => validateOperationJournalRecord(tampered), 'checksum verification failed');
  });

  it('invalidates the checksum when the payload requestDate marker changes', () => {
    const operation = makeOrderOperation();
    const record = createOperationJournalRecord(operation, 'prepared', {}, orderIntent());
    const tampered = {
      ...record,
      orderRequest: {
        ...record.orderRequest!,
        payload: { ...record.orderRequest!.payload!, requestDate: 'OTHER_TIMESTAMP' },
      },
    } as unknown as OperationJournalRecord;

    assert.notEqual(calculateOperationJournalChecksum(tampered), record.integrity.recordChecksum);
    expectJournalError(() => validateOperationJournalRecord(tampered), 'checksum verification failed');
  });
