
  it('persists the order request across a journal restart and reuses it exactly', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeOrderOperation();
    const intent = orderIntent();
    const items: readonly JournalOrderRequestItem[] = Object.freeze([
      Object.freeze({ medicineId: 'medicine-1', medicineName: 'Paracetamol', quantity: 2 }),
    ]);

    await journal.prepare(operation, intent);
    const attached = await journal.setOrderRequestPayload(operation.operationId, items);
    await journal.setStatus(operation.operationId, 'submission_unknown', {
      lastAttemptAt: '2026-11-06T13:00:00.000Z',
    });

    const recovered = await initializedJournal(directory);
    const record = await recovered.get(operation.operationId);

    assert.deepEqual(record, attached);
    assert.equal(record?.orderRequest?.requestId, 'stable-request-1');
    assert.equal(record?.orderRequest?.payload?.items[0].medicineName, 'Paracetamol');
    assert.equal(record?.orderRequest?.payload?.requestDate, 'SERVER_TIMESTAMP');
    assert.equal(record!.integrity.recordChecksum, calculateOperationJournalChecksum(record!));
    assert.deepEqual(validateOperationJournalRecord(record!), record!);
  });

  it('fails closed when a recovered record carries tampered order-request data', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeOrderOperation();

    await journal.prepare(operation, orderIntent());
    const path = join(directory, operationFileName(operation.operationId));
    const contents = await readFile(path, 'utf8');
    const stored = JSON.parse(contents);
    const tampered = {
      ...stored,
      orderRequest: { ...stored.orderRequest, requestId: 'tampered-request' },
    };
    await writeFile(path, `${stableJson(tampered)}\n`, 'utf8');

    await assert.rejects(() => new OperationJournal(directory).initialize(), OperationJournalError);
    const files = await readdir(directory);
    assert.ok(files.some((name) => name.endsWith('.corrupt')), 'tampered evidence is quarantined');
  });

  it('keeps pre-extension schemaVersion 1 records without orderRequest valid', () => {
    const operation = makeIdentity();
    const record = createOperationJournalRecord(operation, 'prepared');

    assert.equal(record.schemaVersion, 1);
    assert.equal(record.orderRequest, undefined);
    assert.deepEqual(validateOperationJournalRecord(record), record);
    assert.equal(record.integrity.recordChecksum, calculateOperationJournalChecksum(record));
  });

  it('rejects an unsupported schema version', () => {
    const operation = makeOrderOperation();
    const record = createOperationJournalRecord(operation, 'prepared', {}, orderIntent());

    expectJournalError(() => validateOperationJournalRecord({ ...record, schemaVersion: 2 }), 'strict schema');
  });

  it('preserves schemaVersion and orderRequest presence through lifecycle updates', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const orderOperation = makeOrderOperation();
    const plainOperation = makeIdentity();

    await journal.prepare(orderOperation, orderIntent());
    await journal.prepare(plainOperation);

    const updatedWith = await journal.setStatus(orderOperation.operationId, 'submission_unknown', {
      lastAttemptAt: '2026-11-06T13:00:00.000Z',
    });
    const updatedWithout = await journal.setStatus(plainOperation.operationId, 'submission_unknown');

    assert.equal(updatedWith.schemaVersion, 1);
    assert.equal(updatedWith.orderRequest?.requestId, 'stable-request-1');
    assert.equal(updatedWithout.schemaVersion, 1);
    assert.equal(updatedWithout.orderRequest, undefined);
    assert.equal(updatedWith.integrity.recordChecksum, calculateOperationJournalChecksum(updatedWith));
    assert.equal(updatedWithout.integrity.recordChecksum, calculateOperationJournalChecksum(updatedWithout));
  });
});
