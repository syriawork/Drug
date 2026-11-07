import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, describe, it } from 'node:test';
import {
  assertDomainId,
  createOperationIdentity,
  type OperationIdentity,
} from '../../functions/src/domain/operations';
import {
  calculateOperationJournalChecksum,
  createOperationJournalRecord,
  OperationJournal,
  OperationJournalError,
  type OperationJournalFileSystem,
  type JournalOrderRequest,
  type JournalOrderRequestItem,
  type OperationJournalRecord,
  validateOperationJournalRecord,
} from '../../electron/journal/operation-journal';

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

function makeIdentity(operationId = 'journal:operation-1'): OperationIdentity {
  return createOperationIdentity(operationId, 'receipt', {
    medicineId: 'medicine-1',
    quantity: 3,
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function operationFileName(operationId: string): string {
  const digest = createHash('sha256').update(operationId, 'utf8').digest('hex');
  return `operation-${digest}.json`;
}

async function newDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'drug-manager-journal-'));
  temporaryDirectories.push(directory);
  return directory;
}

function nativeFileSystem(): OperationJournalFileSystem {
  return {
    async mkdir(path) {
      await mkdir(path, { recursive: true });
    },
    async readdir(path) {
      return readdir(path, { encoding: 'utf8' });
    },
    async readFile(path) {
      return readFile(path, 'utf8');
    },
    async open(path, flags, mode) {
      return open(path, flags, mode);
    },
    async rename(oldPath, newPath) {
      await rename(oldPath, newPath);
    },
  };
}

async function initializedJournal(directory: string, fileSystem?: OperationJournalFileSystem): Promise<OperationJournal> {
  const journal = fileSystem
    ? new OperationJournal(directory, { fileSystem })
    : new OperationJournal(directory);
  await journal.initialize();
  return journal;
}

describe('Stage 36A2A operation identity and journal record validation', () => {
  it('uses the existing Stage 36A1 operation-ID validator without duplicating its grammar', () => {
    assert.doesNotThrow(() => assertDomainId('Alpha.2:-_'));
    assert.throws(() => assertDomainId('not/an/operation-id'));
    assert.throws(() => assertDomainId(''));
  });

  it('strictly validates the versioned journal schema and separates its checksum from payloadHash', () => {
    const operation = makeIdentity();
    const record = createOperationJournalRecord(operation, 'prepared');

    assert.deepEqual(validateOperationJournalRecord(record), record);
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.integrity.recordChecksum, calculateOperationJournalChecksum(record));
    assert.notEqual(record.integrity.recordChecksum, operation.payloadHash);
    assert.throws(() => validateOperationJournalRecord({ ...record, unknownField: true }), OperationJournalError);
    assert.throws(
      () => validateOperationJournalRecord({
        ...record,
        integrity: { recordChecksum: '0'.repeat(64) },
      }),
      /checksum verification failed/,
    );
    assert.throws(
      () => validateOperationJournalRecord({
        ...record,
        lifecycle: { status: 'not-a-status' },
      }),
      /strict schema/,
    );
  });

  it('initializes lifecycle fields and validates canonical UTC timestamps', () => {
    const operation = makeIdentity();
    const record = createOperationJournalRecord(operation, 'prepared');

    assert.match(record.lifecycle.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(record.lifecycle.lastAttemptAt, null);
    assert.equal(record.lifecycle.originalResultReference, null);
    for (const timestamp of ['not-a-timestamp', '2026-02-30T00:00:00.000Z', '2026-11-06']) {
      assert.throws(
        () => createOperationJournalRecord(operation, 'prepared', { lastAttemptAt: timestamp }),
        /lifecycle does not match/,
      );
    }
    assert.throws(
      () => createOperationJournalRecord(operation, 'prepared', { createdAt: '2026-02-30T00:00:00.000Z' }),
      /lifecycle does not match/,
    );
  });

  it('rejects confirmed lifecycle records without a valid original result reference', () => {
    const operation = makeIdentity();

    assert.throws(() => createOperationJournalRecord(operation, 'confirmed'), /lifecycle does not match/);
    assert.throws(
      () => createOperationJournalRecord(operation, 'confirmed', { originalResultReference: '   ' }),
      /lifecycle does not match/,
    );
    assert.throws(
      () => createOperationJournalRecord(operation, 'confirmed', { originalResultReference: 'result\u0000ref' }),
      /lifecycle does not match/,
    );
    assert.equal(
      createOperationJournalRecord(operation, 'confirmed', {
        originalResultReference: 'firestore://original-result/123',
      }).lifecycle.originalResultReference,
      'firestore://original-result/123',
    );
  });
});

describe('Stage 36A2A operation journal persistence and recovery', () => {
  it('persists an initial record and updates an existing valid record', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeIdentity();

    const prepared = await journal.prepare(operation);
    assert.equal(prepared.lifecycle.status, 'prepared');
    assert.deepEqual(await journal.get(operation.operationId), prepared);

    const confirmed = await journal.setStatus(operation.operationId, 'confirmed', {
      originalResultReference: 'result://original/1',
    });
    assert.equal(confirmed.lifecycle.status, 'confirmed');
    assert.equal(confirmed.lifecycle.createdAt, prepared.lifecycle.createdAt);
    assert.equal(confirmed.lifecycle.originalResultReference, 'result://original/1');
    assert.deepEqual(
      await new OperationJournal(directory).initialize(),
      [confirmed],
    );
  });

  it('preserves createdAt, records attempt timestamps, and checksums lifecycle changes', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeIdentity();
    const prepared = await journal.prepare(operation);
    const attemptAt = '2026-11-06T12:55:00.000Z';

    const attempted = await journal.recordAttempt(operation.operationId, attemptAt);
    assert.equal(attempted.lifecycle.createdAt, prepared.lifecycle.createdAt);
    assert.equal(attempted.lifecycle.lastAttemptAt, attemptAt);
    assert.equal(attempted.integrity.recordChecksum, calculateOperationJournalChecksum(attempted));
    assert.throws(
      () => validateOperationJournalRecord({
        ...attempted,
        lifecycle: { ...attempted.lifecycle, lastAttemptAt: '2026-11-06' },
      }),
      /lifecycle does not match/,
    );

    const statusUpdate = await journal.setStatus(operation.operationId, 'submission_unknown');
    assert.equal(statusUpdate.lifecycle.createdAt, prepared.lifecycle.createdAt);
    assert.equal(statusUpdate.lifecycle.lastAttemptAt, attemptAt);
    assert.equal(statusUpdate.integrity.recordChecksum, calculateOperationJournalChecksum(statusUpdate));
    assert.notEqual(statusUpdate.integrity.recordChecksum, attempted.integrity.recordChecksum);
    await assert.rejects(
      journal.setStatus(operation.operationId, 'prepared', { createdAt: '2026-11-06T12:55:00.000Z' }),
      /creation timestamp cannot be changed/,
    );
    await assert.rejects(
      journal.setStatus(operation.operationId, 'prepared', { lastAttemptAt: null }),
      /last attempt timestamp cannot be cleared/,
    );
    await assert.rejects(
      journal.recordAttempt(operation.operationId, '2026-11-06T12:55:60.000Z'),
      /canonical UTC ISO timestamp/,
    );
  });

  it('requires and preserves the original result reference after confirmation', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeIdentity();
    await journal.prepare(operation);

    await assert.rejects(journal.setStatus(operation.operationId, 'confirmed'), /lifecycle does not match/);
    const confirmed = await journal.setStatus(operation.operationId, 'confirmed', {
      originalResultReference: 'firestore://original-result/42',
    });
    const laterUpdate = await journal.setStatus(operation.operationId, 'confirmed');
    assert.equal(laterUpdate.lifecycle.originalResultReference, confirmed.lifecycle.originalResultReference);
    await assert.rejects(
      journal.setStatus(operation.operationId, 'confirmed', { originalResultReference: 'result://replacement' }),
      /cannot be replaced/,
    );
    await assert.rejects(
      journal.setStatus(operation.operationId, 'confirmed', { originalResultReference: null }),
      /cannot be cleared/,
    );
    assert.equal(
      (await journal.get(operation.operationId))?.lifecycle.originalResultReference,
      'firestore://original-result/42',
    );
  });

  it('marks identity conflicts without replacing the originally stored operation identity', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const original = makeIdentity();
    await journal.prepare(original);
    const conflicting = createOperationIdentity(original.operationId, 'receipt', {
      medicineId: 'medicine-1',
      quantity: 4,
    });

    await assert.rejects(journal.prepare(conflicting), /different operation identity/);

    const stored = await journal.get(original.operationId);
    assert.equal(stored?.lifecycle.status, 'identity_conflict');
    assert.deepEqual(stored?.operation, original);
    assert.notEqual(stored?.operation.payloadHash, conflicting.payloadHash);
  });

  it('uses unique temporary filenames for serialized writes of one operation', async () => {
    const directory = await newDirectory();
    const opened: string[] = [];
    const native = nativeFileSystem();
    const fileSystem: OperationJournalFileSystem = {
      ...native,
      async open(path, flags, mode) {
        if (flags === 'wx') {
          opened.push(path);
        }
        return native.open(path, flags, mode);
      },
    };
    const journal = await initializedJournal(directory, fileSystem);
    const operation = makeIdentity();

    await Promise.all([
      journal.prepare(operation),
      journal.setStatus(operation.operationId, 'submission_unknown'),
      journal.setStatus(operation.operationId, 'confirmed', {
        originalResultReference: 'result://unique-temp',
      }),
    ]);

    assert.equal(opened.length, 3);
    assert.equal(new Set(opened).size, opened.length);
  });

  it('recovers a valid final record without changing it', async () => {
    const directory = await newDirectory();
    const operation = makeIdentity();
    const record = createOperationJournalRecord(operation, 'prepared');
    const finalPath = join(directory, operationFileName(operation.operationId));
    const contents = `${stableJson(record)}\n`;
    await mkdir(directory, { recursive: true });
    await writeFile(finalPath, contents, 'utf8');

    const recovered = await new OperationJournal(directory).initialize();

    assert.deepEqual(recovered, [record]);
    assert.equal(await readFile(finalPath, 'utf8'), contents);
  });

  it('recovers confirmed records using the complete lifecycle schema', async () => {
    const directory = await newDirectory();
    const operation = makeIdentity();
    const record = createOperationJournalRecord(operation, 'confirmed', {
      createdAt: '2026-11-06T12:00:00.000Z',
      lastAttemptAt: '2026-11-06T12:10:00.000Z',
      originalResultReference: 'firestore://original-result/recovery',
    });
    const finalPath = join(directory, operationFileName(operation.operationId));
    const contents = `${stableJson(record)}\n`;
    await mkdir(directory, { recursive: true });
    await writeFile(finalPath, contents, 'utf8');

    const [recovered] = await new OperationJournal(directory).initialize();

    assert.deepEqual(recovered, record);
    assert.equal(await readFile(finalPath, 'utf8'), contents);
  });

  it('promotes one valid temporary record when no final record exists', async () => {
    const directory = await newDirectory();
    const operation = makeIdentity();
    const record = createOperationJournalRecord(operation, 'prepared');
    const finalName = operationFileName(operation.operationId);
    const temporaryName = `${finalName.slice(0, -5)}.00000000-0000-4000-8000-000000000001.tmp`;
    const temporaryPath = join(directory, temporaryName);
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${stableJson(record)}\n`, 'utf8');

    const recovered = await new OperationJournal(directory).initialize();

    assert.deepEqual(recovered, [record]);
    assert.equal(await readFile(join(directory, finalName), 'utf8'), `${stableJson(record)}\n`);
  });

  it('quarantines a corrupt final record and fails closed without discarding its bytes', async () => {
    const directory = await newDirectory();
    const operation = makeIdentity();
    const finalName = operationFileName(operation.operationId);
    const finalPath = join(directory, finalName);
    const corruptContents = '{"schemaVersion":1,"integrity":{"recordChecksum":"broken"}}\n';
    await mkdir(directory, { recursive: true });
    await writeFile(finalPath, corruptContents, 'utf8');

    await assert.rejects(new OperationJournal(directory).initialize(), OperationJournalError);

    const quarantined = (await readdir(directory)).filter((name) => name.endsWith('.corrupt'));
    assert.equal(quarantined.length, 1);
    assert.equal(await readFile(join(directory, quarantined[0]!), 'utf8'), corruptContents);
    assert.equal((await readdir(directory)).includes(finalName), false);
  });

  it('quarantines a corrupt temporary record and fails closed', async () => {
    const directory = await newDirectory();
    const operation = makeIdentity();
    const finalName = operationFileName(operation.operationId);
    const temporaryName = `${finalName.slice(0, -5)}.00000000-0000-4000-8000-000000000002.tmp`;
    const corruptContents = '{"lifecycle":{"status":"prepared"}}\n';
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, temporaryName), corruptContents, 'utf8');

    await assert.rejects(new OperationJournal(directory).initialize(), OperationJournalError);

    const quarantined = (await readdir(directory)).filter((name) => name.endsWith('.corrupt'));
    assert.equal(quarantined.length, 1);
    assert.equal(await readFile(join(directory, quarantined[0]!), 'utf8'), corruptContents);
  });

  it('accepts a final record with an identical valid temporary and retains both files', async () => {
    const directory = await newDirectory();
    const operation = makeIdentity();
    const record = createOperationJournalRecord(operation, 'prepared');
    const finalName = operationFileName(operation.operationId);
    const temporaryName = `${finalName.slice(0, -5)}.00000000-0000-4000-8000-000000000003.tmp`;
    const contents = `${stableJson(record)}\n`;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, finalName), contents, 'utf8');
    await writeFile(join(directory, temporaryName), contents, 'utf8');

    assert.deepEqual(await new OperationJournal(directory).initialize(), [record]);
    assert.deepEqual((await readdir(directory)).sort(), [finalName, temporaryName].sort());
  });

  it('accepts a valid temporary lifecycle update beside a matching final record', async () => {
    const directory = await newDirectory();
    const operation = makeIdentity();
    const finalRecord = createOperationJournalRecord(operation, 'prepared');
    const temporaryRecord = createOperationJournalRecord(operation, 'confirmed', {
      originalResultReference: 'result://temporary-version',
    });
    const finalName = operationFileName(operation.operationId);
    const temporaryName = `${finalName.slice(0, -5)}.00000000-0000-4000-8000-000000000004.tmp`;
    const finalContents = `${stableJson(finalRecord)}\n`;
    const temporaryContents = `${stableJson(temporaryRecord)}\n`;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, finalName), finalContents, 'utf8');
    await writeFile(join(directory, temporaryName), temporaryContents, 'utf8');

    assert.deepEqual(await new OperationJournal(directory).initialize(), [finalRecord]);
    assert.equal(await readFile(join(directory, finalName), 'utf8'), finalContents);
    assert.equal(await readFile(join(directory, temporaryName), 'utf8'), temporaryContents);
  });

  it('surfaces failed writes and failed renames while preserving existing records and evidence', async () => {
    const writeDirectory = await newDirectory();
    const nativeWriteFs = nativeFileSystem();
    const failingWriteFs: OperationJournalFileSystem = {
      ...nativeWriteFs,
      async open(path, flags, mode) {
        const handle = await nativeWriteFs.open(path, flags, mode);
        if (flags !== 'wx') {
          return handle;
        }
        return {
          async writeFile(data) {
            await handle.writeFile(data);
            throw new Error('injected write failure');
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      },
    };
    const writeJournal = await initializedJournal(writeDirectory, failingWriteFs);
    await assert.rejects(writeJournal.prepare(makeIdentity()), /Unable to write and flush/);
    assert.equal((await readdir(writeDirectory)).some((name) => name.endsWith('.tmp')), true);
    assert.equal((await readdir(writeDirectory)).some((name) => name.endsWith('.json')), false);

    const renameDirectory = await newDirectory();
    const nativeRenameFs = nativeFileSystem();
    let failRename = false;
    const failingRenameFs: OperationJournalFileSystem = {
      ...nativeRenameFs,
      async rename(oldPath, newPath) {
        if (failRename) {
          failRename = false;
          throw new Error('injected rename failure');
        }
        await nativeRenameFs.rename(oldPath, newPath);
      },
    };
    const renameJournal = await initializedJournal(renameDirectory, failingRenameFs);
    const operation = makeIdentity();
    await renameJournal.prepare(operation);
    const finalPath = join(renameDirectory, operationFileName(operation.operationId));
    const originalFinal = await readFile(finalPath, 'utf8');
    failRename = true;
    await assert.rejects(
      renameJournal.setStatus(operation.operationId, 'confirmed', {
        originalResultReference: 'result://rename-test',
      }),
      /Windows refused|atomically install/,
    );
    assert.equal(await readFile(finalPath, 'utf8'), originalFinal);
    assert.equal((await readdir(renameDirectory)).some((name) => name.endsWith('.tmp')), true);
    await assert.rejects(
      renameJournal.setStatus(operation.operationId, 'definitively_rejected'),
      /unresolved after a persistence failure/,
    );
  });

  it('serializes concurrent writes and retains records across every lifecycle status', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeIdentity();
    await journal.prepare(operation);
    const statuses = [
      'submission_unknown',
      'confirmed',
      'definitively_rejected',
      'identity_conflict',
      'corrupt',
      'prepared',
    ] as const;

    for (const status of statuses) {
      const updated = await journal.setStatus(
        operation.operationId,
        status,
        status === 'confirmed' ? { originalResultReference: 'result://status-array' } : {},
      );
      assert.equal(updated.lifecycle.status, status);
      assert.equal(updated.lifecycle.createdAt, (await journal.get(operation.operationId))?.lifecycle.createdAt);
      assert.equal((await readdir(directory)).some((name) => name.endsWith('.json')), true);
    }

    await Promise.all([
      journal.setStatus(operation.operationId, 'confirmed'),
      journal.setStatus(operation.operationId, 'submission_unknown'),
      journal.setStatus(operation.operationId, 'definitively_rejected'),
    ]);
    assert.equal((await journal.get(operation.operationId))?.lifecycle.status, 'definitively_rejected');
    assert.equal((await readdir(directory)).filter((name) => name.endsWith('.json')).length, 1);
  });
});

describe('Stage 36A2A single-instance startup boundary', () => {
  it('acquires the lock before readiness, IPC registration, and Main Process service construction', async () => {
    const { readFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const projectRoot = join(dirname(__dirname), '..', '..');
    const source = await readFile(join(projectRoot, 'electron', 'main.ts'), 'utf8');
    const lockIndex = source.indexOf('app.requestSingleInstanceLock()');

    assert.notEqual(lockIndex, -1);
    assert.ok(lockIndex < source.indexOf('app.whenReady()'));
    assert.ok(lockIndex < source.indexOf('registerIpcHandlers();'));
    assert.ok(lockIndex < source.indexOf('createFirebaseClients('));
    assert.ok(lockIndex < source.indexOf('new FirestoreOrderProcessingService('));
    assert.match(source, /if \(!gotSingleInstanceLock\)\s*\{\s*app\.quit\(\);\s*process\.exit\(0\);/);
    assert.match(source, /app\.on\('second-instance'/);
    assert.match(source, /window\.isMinimized\(\)[\s\S]*?window\.restore\(\)/);
    assert.match(source, /window\.focus\(\)/);
    assert.match(source, /join\(app\.getPath\('userData'\), 'operation-journal'\)/);
  });

  describe('Stage 36A2B journaled order-request metadata', () => {
    it('checksums and recovers the complete immutable order-request identity and payload', async () => {
      const directory = await newDirectory();
      const operationId = 'stage36a2:journaled-order-request';
      const requestId = 'stable-request-36a2';
      const operation = createOperationIdentity(operationId, 'reserve', {
        orderId: requestId,
        userId: 'uid-employee',
        items: [
          { medicineId: 'medicine-1', quantity: 2 },
          { medicineId: 'medicine-1', quantity: 3 },
        ],
      });
      const journal = await initializedJournal(directory);
      const prepared = await journal.prepare(operation, {
        requestId,
        uid: 'uid-employee',
        requestedItems: [
          { medicineId: 'medicine-1', quantity: 2 },
          { medicineId: 'medicine-1', quantity: 3 },
        ],
      });
      const withPayload = await journal.setOrderRequestPayload(operationId, [
        { medicineId: 'medicine-1', medicineName: 'snapshot', quantity: 2 },
        { medicineId: 'medicine-1', medicineName: 'snapshot', quantity: 3 },
      ]);
      const unknown = await journal.setStatus(operationId, 'submission_unknown', {
        lastAttemptAt: '2026-11-06T13:00:00.000Z',
      });

      assert.equal(prepared.lifecycle.status, 'prepared');
      assert.equal(withPayload.lifecycle.createdAt, prepared.lifecycle.createdAt);
      assert.equal(
        unknown.integrity.recordChecksum,
        calculateOperationJournalChecksum(unknown),
        'the order-request envelope and every lifecycle field are part of the checksum',
      );
      assert.deepEqual(validateOperationJournalRecord(unknown), unknown);

      const recovered = await initializedJournal(directory);
      assert.deepEqual(await recovered.get(operationId), unknown);
      assert.equal((await recovered.get(operationId))?.orderRequest?.requestId, requestId);
    });

    it('keeps a valid unresolved final record authoritative when confirmation rename fails', async () => {
      const directory = await newDirectory();
      const operationId = 'stage36a2:failed-confirmation';
      const requestId = 'stable-request-confirmation';
      const baseFileSystem = nativeFileSystem();
      let failNextRename = false;
      const fileSystem: OperationJournalFileSystem = {
        ...baseFileSystem,
        async rename(oldPath, newPath) {
          if (failNextRename) {
            failNextRename = false;
            const error = new Error('injected rename failure') as NodeJS.ErrnoException;
            error.code = 'EPERM';
            throw error;
          }
          await baseFileSystem.rename(oldPath, newPath);
        },
      };
      const journal = await initializedJournal(directory, fileSystem);
      const operation = createOperationIdentity(operationId, 'reserve', {
        orderId: requestId,
        userId: 'uid-employee',
        items: [{ medicineId: 'medicine-1', quantity: 1 }],
      });
      await journal.prepare(operation, {
        requestId,
        uid: 'uid-employee',
        requestedItems: [{ medicineId: 'medicine-1', quantity: 1 }],
      });
      await journal.setOrderRequestPayload(operationId, [
        { medicineId: 'medicine-1', medicineName: 'snapshot', quantity: 1 },
      ]);
      await journal.setStatus(operationId, 'submission_unknown', {
        lastAttemptAt: '2026-11-06T13:00:00.000Z',
      });
      failNextRename = true;
      await assert.rejects(
        () => journal.setStatus(operationId, 'confirmed', {
          originalResultReference: `order_requests/${requestId}`,
        }),
        OperationJournalError,
      );

      const recovered = await initializedJournal(directory);
      const record = await recovered.get(operationId);
      const files = await readdir(directory);
      assert.equal(record?.lifecycle.status, 'submission_unknown');
      assert.equal(record?.orderRequest?.requestId, requestId);
      assert.ok(files.some((name) => name.endsWith('.tmp')), 'the confirmed temporary evidence remains retained');
    });
  });
});

describe('Stage 36A2B orderRequest schema extension', () => {
  function makeOrderOperation(operationId = 'journal:operation-order-1'): OperationIdentity {
    return createOperationIdentity(operationId, 'reserve', {
      orderId: 'stable-request-1',
      userId: 'uid-employee',
      items: [{ medicineId: 'medicine-1', quantity: 2 }],
    });
  }

  function orderIntent(overrides?: {
    readonly requestId?: string;
    readonly uid?: string;
    readonly requestedItems?: readonly { readonly medicineId: string; readonly quantity: number }[];
  }): JournalOrderRequest {
    return Object.freeze({
      requestId: 'stable-request-1',
      uid: 'uid-employee',
      requestedItems: Object.freeze([Object.freeze({ medicineId: 'medicine-1', quantity: 2 })]),
      payload: null,
      ...overrides,
    });
  }

  function orderIntentForPrepare(
    overrides?: Parameters<typeof orderIntent>[0],
  ): Omit<JournalOrderRequest, 'payload'> {
    const { payload: _payload, ...intent } = orderIntent(overrides);
    return intent;
  }

  function expectJournalError(fn: () => unknown, substring: string): void {
    let caught: unknown;
    try {
      fn();
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof OperationJournalError, `expected OperationJournalError: ${substring}`);
    assert.match((caught as Error).message, new RegExp(substring));
  }

  function expectInvalidOrderRequest(operation: OperationIdentity, orderRequest: unknown, _substring: string): void {
    expectJournalError(
      () => createOperationJournalRecord(operation, 'prepared', {}, orderRequest as JournalOrderRequest),
      'strict schema|stored submission',
    );
  }

  async function expectJournalErrorAsync(fn: () => Promise<unknown>, substring: string): Promise<void> {
    await assert.rejects(fn, (error: unknown) => (
      error instanceof OperationJournalError && new RegExp(substring).test(error.message)
    ));
  }


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
    const { medicineName: _name, ...itemWithoutName } = fullOrderRequest()!.payload!.items[0]!;
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
    expectJournalError(() => validateOperationJournalRecord(tampered), 'stored submission');
  });

  it('invalidates the checksum when the document payload changes', () => {
    const operation = makeOrderOperation();
    const record = createOperationJournalRecord(operation, 'prepared', {}, fullOrderRequest());
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
    const record = createOperationJournalRecord(operation, 'prepared', {}, fullOrderRequest());
    const tampered = {
      ...record,
      orderRequest: {
        ...record.orderRequest!,
        payload: { ...record.orderRequest!.payload!, requestDate: 'OTHER_TIMESTAMP' },
      },
    } as unknown as OperationJournalRecord;

    assert.notEqual(calculateOperationJournalChecksum(tampered), record.integrity.recordChecksum);
    expectJournalError(() => validateOperationJournalRecord(tampered), 'strict schema');
  });


  it('reuses the same order request identity on repeated preparation', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeOrderOperation();
    const intent = orderIntentForPrepare();

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

    await journal.prepare(operation, orderIntentForPrepare());
    await expectJournalErrorAsync(
      () => journal.prepare(operation, orderIntentForPrepare({ requestId: 'stable-request-2' })),
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

    const prepared = await journal.prepare(operation, orderIntentForPrepare());
    const attached = await journal.setOrderRequestPayload(operation.operationId, items);

    assert.equal(attached.lifecycle.createdAt, prepared.lifecycle.createdAt);
    assert.deepEqual(attached.orderRequest!.payload, {
      uid: 'uid-employee',
      items,
      status: 'pending',
      requestDate: 'SERVER_TIMESTAMP',
    });
    await expectJournalErrorAsync(
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

    const prepared = await journal.prepare(operation, orderIntentForPrepare());
    const attached = await journal.setOrderRequestPayload(prepared.operation.operationId, items);
    await journal.setStatus(operation.operationId, 'submission_unknown', {
      lastAttemptAt: '2026-11-06T13:00:00.000Z',
    });
    await expectJournalErrorAsync(
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
      (await journal.prepare(operation, orderIntentForPrepare())).operation.operationId,
      items,
    );
    const updated = await journal.setStatus(operation.operationId, 'submission_unknown', {
      lastAttemptAt: '2026-11-06T13:00:00.000Z',
    });

    assert.deepEqual(updated.orderRequest, attached.orderRequest);
    assert.equal(updated.lifecycle.createdAt, attached.lifecycle.createdAt);
    assert.equal(updated.orderRequest?.payload?.requestDate, 'SERVER_TIMESTAMP');
    assert.equal(updated.orderRequest!.payload!.items[0]?.medicineName, 'Paracetamol');
    assert.equal(updated.integrity.recordChecksum, calculateOperationJournalChecksum(updated));
    assert.deepEqual(validateOperationJournalRecord(updated), updated);
  });


  it('persists the order request across a journal restart and reuses it exactly', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeOrderOperation();
    const intent = orderIntentForPrepare();
    const items: readonly JournalOrderRequestItem[] = Object.freeze([
      Object.freeze({ medicineId: 'medicine-1', medicineName: 'Paracetamol', quantity: 2 }),
    ]);

    await journal.prepare(operation, intent);
    await journal.setOrderRequestPayload(operation.operationId, items);
    const updated = await journal.setStatus(operation.operationId, 'submission_unknown', {
      lastAttemptAt: '2026-11-06T13:00:00.000Z',
    });

    const recovered = await initializedJournal(directory);
    const record = await recovered.get(operation.operationId);

    assert.deepEqual(record, updated);
    assert.equal(record?.orderRequest?.requestId, 'stable-request-1');
    assert.equal(record?.orderRequest?.payload?.items[0]?.medicineName, 'Paracetamol');
    assert.equal(record?.orderRequest?.payload?.requestDate, 'SERVER_TIMESTAMP');
    assert.equal(record!.integrity.recordChecksum, calculateOperationJournalChecksum(record!));
    assert.deepEqual(validateOperationJournalRecord(record!), record!);
  });

  it('fails closed when a recovered record carries tampered order-request data', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeOrderOperation();

    await journal.prepare(operation, orderIntentForPrepare());
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

    await journal.prepare(orderOperation, orderIntentForPrepare());
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

  it('journal SERVER_TIMESTAMP marker is immutable across retries', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeOrderOperation();
    const intent = orderIntentForPrepare();
    const items: readonly JournalOrderRequestItem[] = Object.freeze([
      Object.freeze({ medicineId: 'medicine-1', medicineName: 'Paracetamol', quantity: 2 }),
    ]);

    await journal.prepare(operation, intent);
    const prepared = await journal.setOrderRequestPayload(operation.operationId, items);
    const markerBefore = prepared.orderRequest?.payload?.requestDate;
    assert.equal(markerBefore, 'SERVER_TIMESTAMP');

    // Retry preparation - marker should remain identical
    const repeated = await journal.prepare(operation, intent);
    const markerAfter = repeated.orderRequest?.payload?.requestDate;
    assert.equal(markerAfter, 'SERVER_TIMESTAMP');
    assert.equal(markerBefore, markerAfter);
  });

  it('journal SERVER_TIMESTAMP marker persists through status updates', async () => {
    const directory = await newDirectory();
    const journal = await initializedJournal(directory);
    const operation = makeOrderOperation();
    const intent = orderIntentForPrepare();
    const items: readonly JournalOrderRequestItem[] = Object.freeze([
      Object.freeze({ medicineId: 'medicine-1', medicineName: 'Paracetamol', quantity: 2 }),
    ]);

    await journal.prepare(operation, intent);
    const prepared = await journal.setOrderRequestPayload(operation.operationId, items);
    assert.equal(prepared.orderRequest?.payload?.requestDate, 'SERVER_TIMESTAMP');

    // Update status multiple times
    await journal.setStatus(operation.operationId, 'submission_unknown', {
      lastAttemptAt: '2026-11-06T13:00:00.000Z',
    });
    await journal.setStatus(operation.operationId, 'confirmed', {
      originalResultReference: 'order_requests/stable-request-1',
    });

    const record = await journal.get(operation.operationId);
    assert.ok(record);
    assert.equal(record.orderRequest?.payload?.requestDate, 'SERVER_TIMESTAMP');
    assert.equal(record.lifecycle.status, 'confirmed');
  });

  it('restart recovery preserves SERVER_TIMESTAMP marker exactly', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'drug-manager-journal-'));
    try {
      const journal1 = new OperationJournal(directory);
      await journal1.initialize();
      const operation = makeOrderOperation();
      const intent = orderIntentForPrepare();
      await journal1.prepare(operation, intent);
      await journal1.setOrderRequestPayload(operation.operationId, [
        { medicineId: 'medicine-1', medicineName: 'Paracetamol', quantity: 2 },
      ]);

      // Read the marker from the first journal
      const record1 = await journal1.get(operation.operationId);
      assert.ok(record1);
      const markerFrom1 = record1.orderRequest?.payload?.requestDate;
      assert.equal(markerFrom1, 'SERVER_TIMESTAMP');

      const journal2 = new OperationJournal(directory);
      await journal2.initialize();
      const recovered = await journal2.get(operation.operationId);
      assert.equal(recovered?.orderRequest?.payload?.requestDate, markerFrom1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stableJson preserves SERVER_TIMESTAMP marker distinguishability', () => {
    // An absent optional orderRequest field remains distinguishable from a present field with null
    const recordWithNull = {
      schemaVersion: 1,
      operation: { operationId: 'test', identity: 'receipt', items: [], userId: 'uid-1' },
      lifecycle: { status: 'prepared', createdAt: '2026-01-01T00:00:00.000Z', lastAttemptAt: null, originalResultReference: null },
      orderRequest: null,
      integrity: { recordChecksum: 'abc' },
    };

    const recordAbsent = {
      schemaVersion: 1,
      operation: { operationId: 'test', identity: 'receipt', items: [], userId: 'uid-1' },
      lifecycle: { status: 'prepared', createdAt: '2026-01-01T00:00:00.000Z', lastAttemptAt: null, originalResultReference: null },
      // orderRequest field is absent
      integrity: { recordChecksum: 'abc' },
    };

    const jsonWithNull = stableJson(recordWithNull);
    const jsonAbsent = stableJson(recordAbsent);

    // They should be different: one has "orderRequest":null, the other has no orderRequest key
    assert.notStrictEqual(jsonWithNull, jsonAbsent);
    assert.ok(jsonWithNull.includes('orderRequest'), 'recordWithNull should have orderRequest key');
    assert.ok(!jsonAbsent.includes('orderRequest'), 'recordAbsent should not have orderRequest key');
  });
});