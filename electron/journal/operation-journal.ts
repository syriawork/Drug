import { createHash, randomUUID } from 'node:crypto';
import {
  assertDomainId,
  assertOperationIdentityCompatible,
  validateStoredOperationRecord,
  type OperationIdentity,
} from '../../functions/src/domain/operations';
import { basename, join } from 'node:path';

// schemaVersion 1 is the only supported journal schema version. `orderRequest` is
// an additive, optional field under schemaVersion 1: journal records written before
// this extension (without `orderRequest`) remain valid and are never rewritten or
// silently reinterpreted, and a record's `orderRequest` presence is fixed when the
// record is prepared. Any record that does not strictly match the schema is rejected
// (fail-closed; corrupt evidence is quarantined, never discarded). A new schema
// version is not required because the extension is backward compatible under
// schemaVersion 1.
const JOURNAL_SCHEMA_VERSION = 1;
const RECORD_FILE_PATTERN = /^operation-([a-f0-9]{64})\.json$/;
const TEMP_FILE_PATTERN = /^operation-([a-f0-9]{64})\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const QUARANTINE_FILE_PATTERN = /^quarantine-[0-9a-f-]{36}-.+\.corrupt$/;
const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  'EACCES',
  'EINVAL',
  'EISDIR',
  'ENOTSUP',
  'EPERM',
]);

export type OperationLifecycleStatus =
  | 'prepared'
  | 'submission_unknown'
  | 'confirmed'
  | 'definitively_rejected'
  | 'identity_conflict'
  | 'corrupt';

export interface OperationJournalLifecycle {
  readonly status: OperationLifecycleStatus;
  readonly createdAt: string;
  readonly lastAttemptAt: string | null;
  readonly originalResultReference: string | null;
}

export interface JournalOrderRequestItem {
  readonly medicineId: string;
  readonly medicineName: string;
  readonly quantity: number;
}

export interface JournalOrderRequest {
  readonly requestId: string;
  readonly uid: string;
  readonly requestedItems: readonly { readonly medicineId: string; readonly quantity: number }[];
  readonly payload: {
    readonly uid: string;
    readonly items: readonly JournalOrderRequestItem[];
    readonly status: 'pending';
    readonly requestDate: 'SERVER_TIMESTAMP';
  } | null;
}

export interface OperationJournalRecord {
  readonly schemaVersion: 1;
  readonly operation: OperationIdentity;
  readonly lifecycle: OperationJournalLifecycle;
  readonly orderRequest?: JournalOrderRequest;
  readonly integrity: {
    readonly recordChecksum: string;
  };
}

interface JournalFileHandle {
  writeFile(data: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface OperationJournalFileSystem {
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  open(path: string, flags: 'wx' | 'r', mode?: number): Promise<JournalFileHandle>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

export class OperationJournalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OperationJournalError';
  }
}

const nodeFileSystem: OperationJournalFileSystem = {
  async mkdir(path) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path, { recursive: true });
  },
  async readdir(path) {
    const { readdir } = await import('node:fs/promises');
    return readdir(path, { encoding: 'utf8' });
  },
  async readFile(path) {
    const { readFile } = await import('node:fs/promises');
    return readFile(path, 'utf8');
  },
  async open(path, flags, mode) {
    const { open } = await import('node:fs/promises');
    return open(path, flags, mode);
  },
  async rename(oldPath, newPath) {
    const { rename } = await import('node:fs/promises');
    await rename(oldPath, newPath);
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every((key) => typeof key === 'string' && expected.includes(key));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isRecord(value)) {
    const fields = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
    return `{${fields.join(',')}}`;
  }
  // `undefined` has no JSON representation (an absent optional field, such as a
  // journal record without `orderRequest`). Represent it deterministically so
  // recovery can compare records with and without `orderRequest` without failing
  // closed on the absence itself. Functions and symbols remain unrepresentable.
  if (value === undefined) {
    return 'null';
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new OperationJournalError('Journal data contains a value that cannot be serialized.');
  }
  return serialized;
}

function operationDigest(operationId: string): string {
  return createHash('sha256').update(operationId, 'utf8').digest('hex');
}

function recordFileName(operationId: string): string {
  return `operation-${operationDigest(operationId)}.json`;
}

function recordPath(directory: string, operationId: string): string {
  return join(directory, recordFileName(operationId));
}

function calculateChecksumBody(
  schemaVersion: 1,
  operation: OperationIdentity,
  lifecycle: OperationJournalRecord['lifecycle'],
  orderRequest?: JournalOrderRequest,
): string {
  const body = orderRequest === undefined
    ? { schemaVersion, operation, lifecycle }
    : { schemaVersion, operation, lifecycle, orderRequest };
  return createHash('sha256')
    .update(stableJson(body), 'utf8')
    .digest('hex');
}

function isLifecycleStatus(value: unknown): value is OperationLifecycleStatus {
  return value === 'prepared'
    || value === 'submission_unknown'
    || value === 'confirmed'
    || value === 'definitively_rejected'
    || value === 'identity_conflict'
    || value === 'corrupt';
}

function isValidTimestamp(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isValidOriginalResultReference(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 2048
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
}

type OperationLifecycleValues = Partial<Omit<OperationJournalLifecycle, 'status'>>;

function isValidJournalOrderRequest(value: unknown): value is JournalOrderRequest {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['requestId', 'uid', 'requestedItems', 'payload'])
    || typeof value['requestId'] !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(value['requestId'])
    || typeof value['uid'] !== 'string'
    || value['uid'].length === 0
    || !Array.isArray(value['requestedItems'])
    || value['requestedItems'].length === 0
    || value['requestedItems'].length > 5
    || !value['requestedItems'].every((item) => (
      isRecord(item)
      && hasExactKeys(item, ['medicineId', 'quantity'])
      && typeof item['medicineId'] === 'string'
      && /^[A-Za-z0-9_-]{1,128}$/.test(item['medicineId'])
      && typeof item['quantity'] === 'number'
      && Number.isSafeInteger(item['quantity'])
      && item['quantity'] > 0
    ))
  ) {
    return false;
  }
  if (value['payload'] === null) {
    return true;
  }
  const payload = value['payload'];
  return isRecord(payload)
    && hasExactKeys(payload, ['uid', 'items', 'status', 'requestDate'])
    && payload['uid'] === value['uid']
    && payload['status'] === 'pending'
    && payload['requestDate'] === 'SERVER_TIMESTAMP'
    && Array.isArray(payload['items'])
    && payload['items'].length === value['requestedItems'].length
    && payload['items'].every((item) => (
      isRecord(item)
      && hasExactKeys(item, ['medicineId', 'medicineName', 'quantity'])
      && typeof item['medicineId'] === 'string'
      && /^[A-Za-z0-9_-]{1,128}$/.test(item['medicineId'])
      && typeof item['medicineName'] === 'string'
      && item['medicineName'].length > 0
      && item['medicineName'].trim() === item['medicineName']
      && typeof item['quantity'] === 'number'
      && Number.isSafeInteger(item['quantity'])
      && item['quantity'] > 0
    ))
    && sameItemMultiset(value['requestedItems'], payload['items']);
}

function sameItemMultiset(
  left: readonly { readonly medicineId: string; readonly quantity: number }[],
  right: readonly { readonly medicineId: string; readonly quantity: number }[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const count = new Map<string, number>();
  for (const item of left) {
    const key = `${item.medicineId}\u0000${item.quantity}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  for (const item of right) {
    const key = `${item.medicineId}\u0000${item.quantity}`;
    const remaining = count.get(key) ?? 0;
    if (remaining === 0) {
      return false;
    }
    count.set(key, remaining - 1);
  }
  return [...count.values()].every((remaining) => remaining === 0);
}

function aggregateItems(
  items: readonly { readonly medicineId: string; readonly quantity: number }[],
): readonly { readonly medicineId: string; readonly quantity: number }[] {
  const quantities = new Map<string, number>();
  for (const item of items) {
    quantities.set(item.medicineId, (quantities.get(item.medicineId) ?? 0) + item.quantity);
  }
  return [...quantities.entries()].map(([medicineId, quantity]) => ({ medicineId, quantity }));
}

function matchesOrderRequestIdentity(operation: OperationIdentity, orderRequest: JournalOrderRequest): boolean {
  const canonicalPayload = operation.canonicalPayload;
  return operation.operationType === 'reserve'
    && 'orderId' in canonicalPayload
    && canonicalPayload.orderId === orderRequest.requestId
    && canonicalPayload.userId === orderRequest.uid
    && sameItemMultiset(canonicalPayload.items, aggregateItems(orderRequest.requestedItems));
}

function sameOrderRequestIntent(left: JournalOrderRequest, right: JournalOrderRequest): boolean {
  return stableJson({
    requestId: left.requestId,
    uid: left.uid,
    requestedItems: left.requestedItems,
  }) === stableJson({
    requestId: right.requestId,
    uid: right.uid,
    requestedItems: right.requestedItems,
  });
}

export function calculateOperationJournalChecksum(
  value: Pick<OperationJournalRecord, 'schemaVersion' | 'operation' | 'lifecycle'>
    & Partial<Pick<OperationJournalRecord, 'orderRequest'>>,
): string {
  return calculateChecksumBody(value.schemaVersion, value.operation, value.lifecycle, value.orderRequest);
}

export function createOperationJournalRecord(
  operationValue: unknown,
  status: OperationLifecycleStatus,
  lifecycleValues: OperationLifecycleValues = {},
  orderRequest?: JournalOrderRequest,
): OperationJournalRecord {
  const operation = validateStoredOperationRecord(operationValue);
  if (!isLifecycleStatus(status)) {
    throw new OperationJournalError('Journal lifecycle status is invalid.');
  }
  const lifecycle = Object.freeze({
    status,
    createdAt: lifecycleValues.createdAt === undefined ? new Date().toISOString() : lifecycleValues.createdAt,
    lastAttemptAt: lifecycleValues.lastAttemptAt === undefined ? null : lifecycleValues.lastAttemptAt,
    originalResultReference:
      lifecycleValues.originalResultReference === undefined ? null : lifecycleValues.originalResultReference,
  });
  validateLifecycle(lifecycle);
  if (orderRequest !== undefined && !isValidJournalOrderRequest(orderRequest)) {
    throw new OperationJournalError('Journal order-request payload does not match the strict schema.');
  }
  if (orderRequest !== undefined && !matchesOrderRequestIdentity(operation, orderRequest)) {
    throw new OperationJournalError('Journal order-request identity does not match its stored submission.');
  }
  const checksum = calculateChecksumBody(JOURNAL_SCHEMA_VERSION, operation, lifecycle, orderRequest);
  return Object.freeze({
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    operation,
    lifecycle,
    ...(orderRequest === undefined ? {} : { orderRequest }),
    integrity: Object.freeze({ recordChecksum: checksum }),
  });
}

function validateLifecycle(value: unknown): asserts value is OperationJournalLifecycle {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['status', 'createdAt', 'lastAttemptAt', 'originalResultReference'])
    || !isLifecycleStatus(value['status'])
    || !isValidTimestamp(value['createdAt'])
    || (
      value['lastAttemptAt'] !== null
      && !isValidTimestamp(value['lastAttemptAt'])
    )
    || (
      value['originalResultReference'] !== null
      && !isValidOriginalResultReference(value['originalResultReference'])
    )
    || (
      value['status'] === 'confirmed'
      && !isValidOriginalResultReference(value['originalResultReference'])
    )
  ) {
    throw new OperationJournalError('Journal lifecycle does not match the strict schema.');
  }
}

export function validateOperationJournalRecord(value: unknown): OperationJournalRecord {
  if (
    !isRecord(value)
    || !(
      hasExactKeys(value, ['schemaVersion', 'operation', 'lifecycle', 'integrity'])
      || hasExactKeys(value, ['schemaVersion', 'operation', 'lifecycle', 'orderRequest', 'integrity'])
    )
    || value['schemaVersion'] !== JOURNAL_SCHEMA_VERSION
    || !isRecord(value['integrity'])
    || !hasExactKeys(value['integrity'], ['recordChecksum'])
    || typeof value['integrity']['recordChecksum'] !== 'string'
    || !/^[a-f0-9]{64}$/.test(value['integrity']['recordChecksum'])
  ) {
    throw new OperationJournalError('Journal record does not match the strict schema.');
  }

  const operation = validateStoredOperationRecord(value['operation']);
  validateLifecycle(value['lifecycle']);
  const lifecycle = Object.freeze({
    status: value['lifecycle']['status'],
    createdAt: value['lifecycle']['createdAt'],
    lastAttemptAt: value['lifecycle']['lastAttemptAt'],
    originalResultReference: value['lifecycle']['originalResultReference'],
  });
  const orderRequest = Object.hasOwn(value, 'orderRequest') ? value['orderRequest'] : undefined;
  if (orderRequest !== undefined && !isValidJournalOrderRequest(orderRequest)) {
    throw new OperationJournalError('Journal order-request payload does not match the strict schema.');
  }
  if (orderRequest !== undefined && !matchesOrderRequestIdentity(operation, orderRequest)) {
    throw new OperationJournalError('Journal order-request identity does not match its stored submission.');
  }
  const expectedChecksum = calculateChecksumBody(JOURNAL_SCHEMA_VERSION, operation, lifecycle, orderRequest);
  if (value['integrity']['recordChecksum'] !== expectedChecksum) {
    throw new OperationJournalError('Journal record checksum verification failed.');
  }

  return Object.freeze({
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    operation,
    lifecycle,
    ...(orderRequest === undefined ? {} : { orderRequest }),
    integrity: Object.freeze({ recordChecksum: expectedChecksum }),
  });
}

function serializeRecord(record: OperationJournalRecord): string {
  return `${stableJson(record)}\n`;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

export interface OperationJournalOptions {
  readonly fileSystem?: OperationJournalFileSystem;
  readonly platform?: NodeJS.Platform;
}

export class OperationJournal {
  private readonly fileSystem: OperationJournalFileSystem;
  private readonly platform: NodeJS.Platform;
  private initialization: Promise<readonly OperationJournalRecord[]> | undefined;
  private readonly operationQueues = new Map<string, Promise<void>>();
  private readonly blockedOperations = new Set<string>();

  constructor(
    private readonly directory: string,
    options: OperationJournalOptions = {},
  ) {
    this.fileSystem = options.fileSystem ?? nodeFileSystem;
    this.platform = options.platform ?? process.platform;
  }

  public initialize(): Promise<readonly OperationJournalRecord[]> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  public async listRecords(): Promise<readonly OperationJournalRecord[]> {
    await this.requireInitialized();
    const names = await this.fileSystem.readdir(this.directory);
    const records: OperationJournalRecord[] = [];
    for (const name of names) {
      if (!RECORD_FILE_PATTERN.test(name)) {
        continue;
      }
      const path = join(this.directory, name);
      try {
        const record = this.parseRecordText(await this.fileSystem.readFile(path), path);
        if (recordFileName(record.operation.operationId) !== name) {
          throw new OperationJournalError('Journal filename does not match its stored operation ID.');
        }
        records.push(record);
      } catch (error) {
        await this.quarantine(path, name);
        throw new OperationJournalError('Unable to list journal records because a record was invalid.', {
          cause: error,
        });
      }
    }
    return Object.freeze(
      records.sort((left, right) => left.operation.operationId.localeCompare(right.operation.operationId)),
    );
  }

  public async get(operationIdValue: unknown): Promise<OperationJournalRecord | null> {
    const operationId = this.validatedOperationId(operationIdValue);
    await this.requireInitialized();
    if (this.blockedOperations.has(operationId)) {
      throw new OperationJournalError(
        'Journal state for this operation is unresolved after a persistence failure; restart and recover before use.',
      );
    }
    const path = recordPath(this.directory, operationId);
    let text: string;
    try {
      text = await this.fileSystem.readFile(path);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return null;
      }
      throw new OperationJournalError('Unable to read the operation journal record.', { cause: error });
    }

    try {
      return this.parseRecordText(text, path, operationId);
    } catch (error) {
      await this.quarantine(path, recordFileName(operationId));
      throw error;
    }
  }

  public async prepare(
    operationValue: unknown,
    orderRequest?: Omit<JournalOrderRequest, 'payload'> & { readonly payload?: null },
  ): Promise<OperationJournalRecord> {
    const operation = validateStoredOperationRecord(operationValue);
    const initialOrderRequest = orderRequest === undefined ? undefined : { ...orderRequest, payload: null };
    if (initialOrderRequest !== undefined && !isValidJournalOrderRequest(initialOrderRequest)) {
      throw new OperationJournalError('Initial journal order-request data does not match the strict schema.');
    }
    await this.requireInitialized();
    return this.serializeForOperation(operation.operationId, async () => {
      const current = await this.get(operation.operationId);
      if (current) {
        try {
          assertOperationIdentityCompatible(current.operation, operation);
        } catch (error) {
          const conflicted = createOperationJournalRecord(
            current.operation,
            'identity_conflict',
            current.lifecycle,
            current.orderRequest,
          );
          await this.persist(conflicted, current);
          throw new OperationJournalError(
            'The operation ID is already bound to a different operation identity.',
            { cause: error },
          );
        }
        if (
          initialOrderRequest !== undefined
          && (
            current.orderRequest === undefined
            || !sameOrderRequestIntent(current.orderRequest, initialOrderRequest)
          )
        ) {
          throw new OperationJournalError('The operation ID is already bound to different submission data.');
        }
        return current;
      }

      if (await this.hasQuarantineFor(operation.operationId)) {
        throw new OperationJournalError(
          'Quarantined journal evidence exists for this operation ID; refusing to recreate it.',
        );
      }
      const prepared = createOperationJournalRecord(operation, 'prepared', {}, initialOrderRequest);
      await this.persist(prepared, null);
      return prepared;
    });
  }

  public async setOrderRequestPayload(
    operationIdValue: unknown,
    items: readonly JournalOrderRequestItem[],
  ): Promise<OperationJournalRecord> {
    const operationId = this.validatedOperationId(operationIdValue);
    await this.requireInitialized();
    return this.serializeForOperation(operationId, async () => {
      const current = await this.get(operationId);
      if (!current || !current.orderRequest) {
        throw new OperationJournalError('Cannot attach a payload without a journaled order request.');
      }
      if (current.lifecycle.status !== 'prepared' || current.lifecycle.lastAttemptAt !== null) {
        throw new OperationJournalError('The immutable order-request payload cannot change after an attempt begins.');
      }
      if (current.orderRequest.payload !== null) {
        throw new OperationJournalError('The immutable order-request payload is already recorded.');
      }
      const orderRequest: JournalOrderRequest = {
        ...current.orderRequest,
        payload: {
          uid: current.orderRequest.uid,
          items: items.map((item) => Object.freeze({ ...item })),
          status: 'pending',
          requestDate: 'SERVER_TIMESTAMP',
        },
      };
      const updated = createOperationJournalRecord(
        current.operation,
        current.lifecycle.status,
        current.lifecycle,
        orderRequest,
      );
      await this.persist(updated, current);
      return updated;
    });
  }

  public async setStatus(
    operationIdValue: unknown,
    status: OperationLifecycleStatus,
    lifecycleUpdates: OperationLifecycleValues = {},
  ): Promise<OperationJournalRecord> {
    const operationId = this.validatedOperationId(operationIdValue);
    if (!isLifecycleStatus(status)) {
      throw new OperationJournalError('Journal lifecycle status is invalid.');
    }
    await this.requireInitialized();
    return this.serializeForOperation(operationId, async () => {
      const current = await this.get(operationId);
      if (!current) {
        throw new OperationJournalError('Cannot update a journal record that does not exist.');
      }
      if (
        lifecycleUpdates.createdAt !== undefined
        && lifecycleUpdates.createdAt !== current.lifecycle.createdAt
      ) {
        throw new OperationJournalError('The operation creation timestamp cannot be changed.');
      }
      if (
        current.lifecycle.lastAttemptAt !== null
        && lifecycleUpdates.lastAttemptAt === null
      ) {
        throw new OperationJournalError('The last attempt timestamp cannot be cleared.');
      }
      if (
        current.lifecycle.originalResultReference !== null
        && lifecycleUpdates.originalResultReference !== undefined
        && lifecycleUpdates.originalResultReference !== current.lifecycle.originalResultReference
      ) {
        throw new OperationJournalError(
          lifecycleUpdates.originalResultReference === null
            ? 'The original result reference cannot be cleared.'
            : 'The original result reference cannot be replaced.',
        );
      }
      const updated = createOperationJournalRecord(current.operation, status, {
        ...current.lifecycle,
        ...lifecycleUpdates,
        originalResultReference:
          lifecycleUpdates.originalResultReference ?? current.lifecycle.originalResultReference,
      }, current.orderRequest);
      await this.persist(updated, current);
      return updated;
    });
  }

  public async recordAttempt(
    operationIdValue: unknown,
    attemptedAt = new Date().toISOString(),
  ): Promise<OperationJournalRecord> {
    if (!isValidTimestamp(attemptedAt)) {
      throw new OperationJournalError('Attempt timestamp must be a canonical UTC ISO timestamp.');
    }
    const operationId = this.validatedOperationId(operationIdValue);
    await this.requireInitialized();
    return this.serializeForOperation(operationId, async () => {
      const current = await this.get(operationId);
      if (!current) {
        throw new OperationJournalError('Cannot record an attempt without an existing journal record.');
      }
      const updated = createOperationJournalRecord(current.operation, current.lifecycle.status, {
        ...current.lifecycle,
        lastAttemptAt: attemptedAt,
      }, current.orderRequest);
      await this.persist(updated, current);
      return updated;
    });
  }

  private async initializeOnce(): Promise<readonly OperationJournalRecord[]> {
    await this.fileSystem.mkdir(this.directory);
    const names = await this.fileSystem.readdir(this.directory);
    const finals = new Map<string, { readonly path: string; readonly record: OperationJournalRecord }>();
    const temporaries = new Map<string, Array<{
      readonly name: string;
      readonly path: string;
      readonly record: OperationJournalRecord;
    }>>();
    const corruptFiles: string[] = [];

    for (const name of names) {
      if (QUARANTINE_FILE_PATTERN.test(name)) {
        continue;
      }
      const finalMatch = RECORD_FILE_PATTERN.exec(name);
      const temporaryMatch = TEMP_FILE_PATTERN.exec(name);
      if (!finalMatch && !temporaryMatch) {
        corruptFiles.push(name);
        continue;
      }
      const path = join(this.directory, name);
      const expectedDigest = (finalMatch ?? temporaryMatch)?.[1];
      let text: string;
      try {
        text = await this.fileSystem.readFile(path);
      } catch (error) {
        throw new OperationJournalError(`Unable to read journal file ${name}.`, { cause: error });
      }
      try {
        const record = this.parseRecordText(text, path);
        if (operationDigest(record.operation.operationId) !== expectedDigest) {
          throw new OperationJournalError('Journal filename does not match its stored operation ID.');
        }
        if (finalMatch) {
          finals.set(record.operation.operationId, { path, record });
        } else {
          const entries = temporaries.get(record.operation.operationId) ?? [];
          entries.push({ name, path, record });
          temporaries.set(record.operation.operationId, entries);
        }
      } catch {
        corruptFiles.push(name);
      }
    }

    if (corruptFiles.length > 0) {
      for (const name of corruptFiles) {
        await this.quarantine(join(this.directory, name), name);
      }
      throw new OperationJournalError(
        `Journal recovery quarantined ${corruptFiles.length} invalid file(s); manual review is required.`,
      );
    }

    const promote: Array<{
      readonly operationId: string;
      readonly entry: { readonly name: string; readonly path: string; readonly record: OperationJournalRecord };
    }> = [];
    for (const [operationId, entries] of temporaries) {
      const final = finals.get(operationId);
      if (final) {
        if (entries.some((entry) => (
          stableJson(entry.record.operation) !== stableJson(final.record.operation)
          || stableJson(entry.record.orderRequest) !== stableJson(final.record.orderRequest)
          || entry.record.lifecycle.createdAt !== final.record.lifecycle.createdAt
        ))) {
          throw new OperationJournalError(
            `Journal recovery found valid files with conflicting immutable identity for operation ${operationId}; evidence was preserved.`,
          );
        }
      } else {
        const firstRecord = entries[0]!.record;
        if (entries.some((entry) => (
          stableJson(entry.record.operation) !== stableJson(firstRecord.operation)
          || stableJson(entry.record.orderRequest) !== stableJson(firstRecord.orderRequest)
          || entry.record.lifecycle.createdAt !== firstRecord.lifecycle.createdAt
          || serializeRecord(entry.record) !== serializeRecord(firstRecord)
        ))) {
          throw new OperationJournalError(
            `Journal recovery found conflicting temporary records for operation ${operationId}; evidence was preserved.`,
          );
        }
        promote.push({ operationId, entry: entries[0]! });
      }
    }

    for (const { operationId, entry } of promote) {
      const finalPath = recordPath(this.directory, operationId);
      if (await this.pathExists(finalPath)) {
        throw new OperationJournalError(
          `Journal recovery found an unexpected final record for operation ${operationId}; evidence was preserved.`,
        );
      }
      await this.fileSystem.rename(entry.path, finalPath);
      finals.set(operationId, { path: finalPath, record: entry.record });
    }
    if (promote.length > 0) {
      await this.syncDirectory();
    }

    return Object.freeze(
      [...finals.values()]
        .map(({ record }) => record)
        .sort((left, right) => left.operation.operationId.localeCompare(right.operation.operationId)),
    );
  }

  private parseRecordText(text: string, filePath: string, expectedOperationId?: string): OperationJournalRecord {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      throw new OperationJournalError(`Journal file is not valid JSON: ${filePath}`, { cause: error });
    }
    const record = validateOperationJournalRecord(parsed);
    if (serializeRecord(record) !== text) {
      throw new OperationJournalError(`Journal file is not in canonical serialized form: ${filePath}`);
    }
    if (expectedOperationId !== undefined && record.operation.operationId !== expectedOperationId) {
      throw new OperationJournalError(`Journal file contains a different operation ID: ${filePath}`);
    }
    return record;
  }

  private async persist(
    record: OperationJournalRecord,
    expectedExisting: OperationJournalRecord | null,
  ): Promise<void> {
    const operationId = record.operation.operationId;
    if (this.blockedOperations.has(operationId)) {
      throw new OperationJournalError('Journal state for this operation is blocked pending recovery.');
    }
    this.blockedOperations.add(operationId);
    const finalPath = recordPath(this.directory, operationId);
    const finalName = recordFileName(operationId);
    const temporaryPath = join(this.directory, `${finalName.slice(0, -5)}.${randomUUID()}.tmp`);
    let handle: JournalFileHandle | undefined;
    try {
      handle = await this.fileSystem.open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(serializeRecord(record));
      await handle.sync();
    } catch (error) {
      throw new OperationJournalError('Unable to write and flush the temporary journal record.', { cause: error });
    } finally {
      if (handle) {
        await handle.close();
      }
    }

    const verifiedTemporary = this.parseRecordText(
      await this.fileSystem.readFile(temporaryPath),
      temporaryPath,
      record.operation.operationId,
    );
    if (serializeRecord(verifiedTemporary) !== serializeRecord(record)) {
      throw new OperationJournalError('Temporary journal record verification did not match the intended record.');
    }

    const existing = await this.readFinalIfPresent(record.operation.operationId);
    if (expectedExisting === null && existing !== null) {
      throw new OperationJournalError('A journal record appeared before initial persistence; refusing replacement.');
    }
    if (expectedExisting !== null && (
      existing === null
      || serializeRecord(existing) !== serializeRecord(expectedExisting)
    )) {
      throw new OperationJournalError('The journal record changed before update; refusing replacement.');
    }

    try {
      // On Windows Node replaces an existing file when supported. Never unlink
      // first; a refusal leaves the verified existing final record in place.
      await this.fileSystem.rename(temporaryPath, finalPath);
    } catch (error) {
      if (this.platform === 'win32' && expectedExisting !== null) {
        throw new OperationJournalError(
          'Windows refused to replace the journal record; the existing final was not unlinked.',
          { cause: error },
        );
      }
      throw new OperationJournalError(
        'Unable to atomically install the verified journal record; existing evidence was left untouched.',
        { cause: error },
      );
    }
    await this.syncDirectory();
    this.blockedOperations.delete(operationId);
  }

  private async readFinalIfPresent(operationId: string): Promise<OperationJournalRecord | null> {
    const path = recordPath(this.directory, operationId);
    let text: string;
    try {
      text = await this.fileSystem.readFile(path);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return null;
      }
      throw new OperationJournalError('Unable to inspect the existing journal record.', { cause: error });
    }
    const record = this.parseRecordText(text, path, operationId);
    if (recordFileName(record.operation.operationId) !== basename(path)) {
      throw new OperationJournalError('Existing journal filename does not match its operation ID.');
    }
    return record;
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await this.fileSystem.readFile(path);
      return true;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return false;
      }
      throw new OperationJournalError('Unable to inspect the journal destination.', { cause: error });
    }
  }

  private async hasQuarantineFor(operationId: string): Promise<boolean> {
    const marker = `operation-${operationDigest(operationId)}.`;
    const names = await this.fileSystem.readdir(this.directory);
    return names.some((name) => QUARANTINE_FILE_PATTERN.test(name) && name.includes(marker));
  }

  private async quarantine(path: string, originalName: string): Promise<void> {
    const quarantinePath = join(this.directory, `quarantine-${randomUUID()}-${originalName}.corrupt`);
    try {
      await this.fileSystem.rename(path, quarantinePath);
    } catch (error) {
      throw new OperationJournalError(
        `Unable to quarantine corrupt journal evidence ${originalName}; recovery stopped.`,
        { cause: error },
      );
    }
  }

  private async syncDirectory(): Promise<void> {
    if (this.platform === 'win32') {
      return;
    }
    let handle: JournalFileHandle | undefined;
    try {
      handle = await this.fileSystem.open(this.directory, 'r');
      await handle.sync();
    } catch (error) {
      if (!UNSUPPORTED_DIRECTORY_SYNC_CODES.has(errorCode(error) ?? '')) {
        throw new OperationJournalError('Unable to synchronize the journal directory.', { cause: error });
      }
    } finally {
      if (handle) {
        await handle.close();
      }
    }
  }

  private validatedOperationId(value: unknown): string {
    assertDomainId(value, 'operationId');
    return value;
  }

  private async requireInitialized(): Promise<void> {
    if (!this.initialization) {
      throw new OperationJournalError('Operation journal must be initialized before use.');
    }
    await this.initialization;
  }

  private serializeForOperation<T>(operationId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueues.get(operationId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.operationQueues.set(operationId, tail);
    void tail.then(() => {
      if (this.operationQueues.get(operationId) === tail) {
        this.operationQueues.delete(operationId);
      }
    });
    return result;
  }
}
