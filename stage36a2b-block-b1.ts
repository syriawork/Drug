
  it('reuses the same order request identity on repeated preparation', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeOrderOperation();
    const intent = orderIntent();

    const first = await journal.prepare(operation, intent);
    const second = await journal.prepare(operation, intent);

    assert.deepEqual(second, first);
    assert.equal(second.lifecycle.createdAt, first.lifecycle.createdAt);
    assert.equal(second.orderRequest?.requestId, 'stable-request-1');
    assert.equal(second.orderRequest?.payload, null);
  });

  it('rejects a different submission intent for an existing operation ID', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeOrderOperation();

    await journal.prepare(operation, orderIntent());
    await expectJournalError(
      () => journal.prepare(operation, { ...orderIntent(), requestId: 'stable-request-2' }),
      'different submission data',
    );
  });

  it('records the immutable order-request payload exactly once', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeOrderOperation();
    const items: readonly JournalOrderRequestItem[] = Object.freeze([
      Object.freeze({ medicineId: 'medicine-1', medicineName: 'Paracetamol', quantity: 2 }),
    ]);

    const prepared = await journal.prepare(operation, orderIntent());
    const attached = await journal.setOrderRequestPayload(operation.operationId, items);

    assert.equal(attached.lifecycle.createdAt, prepared.lifecycle.createdAt);
    assert.deepEqual(attached.orderRequest!.payload, {
      uid: 'uid-employee',
      items,
      status: 'pending',
      requestDate: 'SERVER_TIMESTAMP',
    });
    await expectJournalError(
      () => journal.setOrderRequestPayload(operation.operationId, items),
      'already recorded',
    );
  });

  it('rejects a payload attachment after an attempt has begun', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeOrderOperation();
    const items: readonly JournalOrderRequestItem[] = Object.freeze([
      Object.freeze({ medicineId: 'medicine-1', medicineName: 'Paracetamol', quantity: 2 }),
    ]);

    const prepared = await journal.prepare(operation, orderIntent());
    const attached = await journal.setOrderRequestPayload(prepared.operationId, items);
    await journal.setStatus(operation.operationId, 'submission_unknown', {
      lastAttemptAt: '2026-11-06T13:00:00.000Z',
    });
    await expectJournalError(
      () => journal.setOrderRequestPayload(operation.operationId, items),
      'after an attempt begins',
    );
    const current = await journal.get(operation.operationId);
    assert.deepEqual(current!.orderRequest, attached.orderRequest);
  });

  it('preserves orderRequest exactly across lifecycle updates and recomputes the checksum', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeOrderOperation();
    const items: readonly JournalOrderRequestItem[] = Object.freeze([
      Object.freeze({ medicineId: 'medicine-1', medicineName: 'Paracetamol', quantity: 2 }),
    ]);

    const attached = await journal.setOrderRequestPayload(
      (await journal.prepare(operation, orderIntent())).operationId,
      items,
    );
    const updated = await journal.setStatus(operation.operationId, 'submission_unknown', {
      lastAttemptAt: '2026-11-06T13:00:00.000Z',
    });

    assert.deepEqual(updated.orderRequest, attached.orderRequest);
    assert.equal(updated.lifecycle.createdAt, attached.lifecycle.createdAt);
    assert.equal(updated.orderRequest?.payload?.requestDate, 'SERVER_TIMESTAMP');
    assert.equal(updated.orderRequest!.payload!.items[0].medicineName, 'Paracetamol');
    assert.equal(updated.integrity.recordChecksum, calculateOperationJournalChecksum(updated));
    assert.deepEqual(validateOperationJournalRecord(updated), updated);
  });
