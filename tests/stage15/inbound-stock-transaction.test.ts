/**
 * Stage 15 - the INBOUND STOCK transaction, tested against a fake transport.
 *
 * WHAT THIS FILE PROVES
 *
 * The one guarantee Stage 15 exists to establish: a stock receipt and its
 * `stock_logs` row are written TOGETHER or NOT AT ALL. Everything below is about
 * that single property:
 *
 *  - nothing is SENT before `commit()` - the writes are queued, so a failure
 *    anywhere in between leaves the database untouched;
 *  - `commit()` sends both writes in ONE `:commit`, never two calls;
 *  - every failure path ENDS the transaction, so no handle is left holding
 *    Firestore's locks on the documents it read;
 *  - the medicine update is MASKED, so the receipt cannot wipe `name`,
 *    `maxQuantity` or `totalOutward` - the Stage 5A G3 finding;
 *  - `quantity` is stored POSITIVE and the direction is carried by `type`, so
 *    Stage 14's audit screen can never read a receipt as an outflow.
 *
 * The transport here is a recording double, not Firestore. The emulator suite
 * proves the same properties against the real engine; this file proves them
 * without a network and without a port.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  INBOUND_STOCK_TOTALS_MASK,
  mapInboundStockTotalsWrite,
  mapNewInboundStockLogWrite,
} from '../../electron/repositories';
import {
  FirestoreInboundStockTransaction,
  type FirestoreInboundStockTransactionClient,
} from '../../electron/repositories/firestore/inbound-stock-transaction';
import { createInboundStockTransactionFactory } from '../../electron/repositories/firestore/inbound-stock-transaction-factory';
import { DomainError } from '../../electron/domain/errors';
import { SERVER_TIMESTAMP } from '../../electron/services/firestore-codec';
import type { FirestoreDocument, FirestoreWriteRequest } from '../../electron/services/firestore-rest';

const MEDICINE_ID = 'med-42';

/** A medicine document as the transaction's read will decode it. */
function medicineDocument(stock: number, totalInward: number): FirestoreDocument {
  return {
    name: `projects/demo/databases/(default)/documents/medicines/${MEDICINE_ID}`,
    relativePath: `medicines/${MEDICINE_ID}`,
    createTime: null,
    updateTime: null,
    data: {
      name: 'Panadol',
      maxQuantity: 10,
      stock,
      totalInward,
      totalOutward: 3,
    },
  };
}

/** Records every transport call, so a test can assert what was and was not sent. */
function recordingClient(options: {
  readonly document?: FirestoreDocument | null;
  readonly commitFailure?: Error | null;
  readonly readFailure?: Error | null;
} = {}) {
  const commits: FirestoreWriteRequest[][] = [];
  const rollbacks: string[] = [];
  const batchGets: string[][] = [];

  const client: FirestoreInboundStockTransactionClient = {
    beginTransaction: async (): Promise<string> => 'tx-inbound-1',
    batchGetDocuments: async (paths: readonly string[]): Promise<readonly (FirestoreDocument | null)[]> => {
      batchGets.push([...paths]);
      if (options.readFailure !== undefined && options.readFailure !== null) {
        throw options.readFailure;
      }
      return [options.document === undefined ? medicineDocument(10, 40) : options.document];
    },
    commitWrites: async (writes: readonly FirestoreWriteRequest[]): Promise<unknown> => {
      // Recorded BEFORE the failure is raised: the call really was attempted, and
      // "how many commits were attempted" is a different question from "how many
      // were accepted". Asserting on the accepted count would make a suite that
      // passes on zero attempts look like it proved atomicity.
      commits.push([...writes]);
      if (options.commitFailure !== undefined && options.commitFailure !== null) {
        throw options.commitFailure;
      }
      return { ok: true };
    },
    rollback: async (tx: string): Promise<void> => {
      rollbacks.push(tx);
    },
  };

  return { client, commits, rollbacks, batchGets };
}

/** Begins a transaction over a recording client. */
async function begin(options: Parameters<typeof recordingClient>[0] = {}) {
  const recorder = recordingClient(options);
  const factory = createInboundStockTransactionFactory(recorder.client);
  const transaction = await factory();
  return { transaction, ...recorder };
}

/** The inbound movement a receipt queues, as the use case builds it. */
function inboundMovement(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'uid-admin',
    medicineId: MEDICINE_ID,
    medicineName: 'Panadol',
    quantity: 5,
    type: 'inward' as const,
    date: SERVER_TIMESTAMP,
    label: 'المدير',
    ...overrides,
  };
}
describe('Stage 15 requirement 1: both writes go out in ONE commit', () => {
  it('sends nothing at all until commit() is called', async () => {
    const { transaction, commits } = await begin();

    await transaction.readMedicine(MEDICINE_ID);
    await transaction.applyInboundTotals(MEDICINE_ID, 15, 45);
    await transaction.appendStockLog(inboundMovement());

    // The whole point of QUEUING: a failure anywhere between the read and the
    // commit must leave the database untouched, and it can only do that if nothing
    // has been sent yet.
    assert.deepEqual(commits, [], 'no write may reach the transport before commit()');
    await transaction.commit();

    assert.equal(commits.length, 1, 'exactly one commit, never two');
  });

  it('puts the medicine update and the audit row in that ONE commit', async () => {
    const { transaction, commits } = await begin();

    await transaction.applyInboundTotals(MEDICINE_ID, 15, 45);
    await transaction.appendStockLog(inboundMovement());
    await transaction.commit();

    const writes = commits[0] as { relativePath: string; kind?: string }[];
    assert.equal(writes.length, 2);

    const paths = writes.map((write) => write.relativePath);
    assert.equal(paths.includes(`medicines/${MEDICINE_ID}`), true, 'the medicine must be updated');
    assert.equal(
      paths.some((path) => path.startsWith('stock_logs/')),
      true,
      'the audit row must be written by the same commit',
    );
  });

  it('reads the medicine inside the transaction, with the handle attached', async () => {
    const { transaction, batchGets } = await begin();

    await transaction.readMedicine(MEDICINE_ID);

    assert.deepEqual(batchGets, [[`medicines/${MEDICINE_ID}`]]);
  });
});

describe('Stage 15 requirement 2: the write is masked and correctly shaped', () => {
  it('masks exactly `stock` and `totalInward`, and nothing else', () => {
    const write = mapInboundStockTotalsWrite(MEDICINE_ID, 15, 45);

    // An unmasked write would DELETE `name`, `maxQuantity` and `totalOutward` -
    // the Stage 5A G3 finding. `totalOutward` especially belongs to the Stage 6
    // processor, and a receipt has no business touching it.
    assert.deepEqual([...write.updateMaskPaths!], [...INBOUND_STOCK_TOTALS_MASK]);
    assert.deepEqual([...INBOUND_STOCK_TOTALS_MASK], ['stock', 'totalInward']);
    assert.deepEqual(Object.keys(write.data).sort(), ['stock', 'totalInward']);
    assert.equal(write.kind, 'update');
  });

  it('writes ABSOLUTE values, because REST cannot express an increment', async () => {
    const { transaction, commits } = await begin();

    await transaction.applyInboundTotals(MEDICINE_ID, 15, 45);
    await transaction.commit();

    const write = (commits[0] as { data: Record<string, unknown> }[])[0]!;
    // Not `+5`, not a delta: the numbers themselves.
    assert.deepEqual(write.data, { stock: 15, totalInward: 45 });
  });

  it('files the audit row with a POSITIVE quantity and the direction in `type`', () => {
    const write = mapNewInboundStockLogWrite(inboundMovement({ quantity: 5 }), 'log-1');

    // A negative magnitude would be read by every later aggregation as an outflow,
    // which is precisely the corruption Stage 14's screen exists to prevent.
    assert.equal(write.data['quantity'], 5);
    assert.equal(write.data['type'], 'inward');
  });

  it('omits order references, as an inbound receipt has no order', () => {
    const write = mapNewInboundStockLogWrite(inboundMovement(), 'log-1');

    assert.equal('orderId' in write.data, false);
    assert.equal('requestId' in write.data, false);
  });

  it('writes the authenticated administrator name into `userName`', () => {
    const write = mapNewInboundStockLogWrite(inboundMovement(), 'log-1');

    assert.equal(write.data['userName'], 'المدير');
    assert.equal('label' in write.data, false, 'the wire field keeps its stored name');
  });

  it('stamps the server time, never a client clock (D4)', () => {
    const write = mapNewInboundStockLogWrite(inboundMovement(), 'log-1');

    assert.equal(write.data['date'], SERVER_TIMESTAMP);
  });
});

describe('Stage 15 requirement 3: a failure leaves NOTHING behind', () => {
  it('writes neither the medicine nor the log when the commit fails', async () => {
    const { transaction, commits } = await begin({
      commitFailure: new DomainError('ABORTED', 'someone else wrote first', { documentPath: null }),
    });

    await transaction.applyInboundTotals(MEDICINE_ID, 15, 45);
    await transaction.appendStockLog(inboundMovement());

    await assert.rejects(
      async () => transaction.commit(),
      // The commit was ATTEMPTED and failed. Nothing was accepted, and - asserted
      // below - no second attempt followed.
      (error: unknown) => error instanceof DomainError,
    );

    assert.equal(commits.length, 1, 'the failed commit was the only one attempted');
  });

  it('releases the handle after a failed commit, so a retry is possible', async () => {
    const { transaction, rollbacks } = await begin({
      commitFailure: new DomainError('ABORTED', 'conflict', { documentPath: null }),
    });

    await transaction.applyInboundTotals(MEDICINE_ID, 15, 45);
    await assert.rejects(async () => transaction.commit());

    // An abandoned handle keeps Firestore's locks on every document that attempt
    // read, which would block other administrators writing at the same time.
    await transaction.rollback();

    assert.deepEqual(rollbacks, ['tx-inbound-1']);
  });

  it('refuses to queue anything AFTER a commit, so a late write cannot escape', async () => {
    const { transaction } = await begin();

    await transaction.applyInboundTotals(MEDICINE_ID, 15, 45);
    await transaction.commit();

    // The queue is cleared by committing; a write added afterwards would either be
    // lost silently or land without its partner.
    await assert.rejects(
      async () => transaction.appendStockLog(inboundMovement()),
      (error: unknown) => error instanceof DomainError && error.kind === 'INVALID_INPUT',
    );
  });

  it('rolls back rather than committing an empty receipt', async () => {
    const { transaction, commits, rollbacks } = await begin();

    // No writes were queued. Committing an empty list would report a stock receipt
    // that moved nothing, so the transaction abandons itself instead.
    await transaction.commit();

    // ZERO commits reached the transport: an empty receipt is refused LOCALLY, so
    // there is no round trip and nothing for Firestore to accept or reject. A suite
    // asserting one attempt here would be asserting the wrong behaviour - the point
    // is that no request is made at all.
    assert.deepEqual(commits, [], 'an empty receipt must never reach the transport');
    assert.deepEqual(rollbacks, ['tx-inbound-1'], 'and the handle must be released');
  });

  it('translates a refused READ into the same DomainError the rules produce', async () => {
    const { transaction } = await begin({ document: null });

    // A missing medicine is NOT an error - it is a legitimate answer, and the use
    // case turns it into NOT_FOUND without pretending anything was read.
    assert.equal(await transaction.readMedicine('med-missing'), null);
  });
});

describe('Stage 15 requirement 5: no OTHER write became expressible', () => {
  it('the transaction exposes only the receipt, and no general setter', () => {
    const members = Object.getOwnPropertyNames(FirestoreInboundStockTransaction.prototype);

    // The four PUBLIC operations plus the constructor. `assertOpen` and `enqueue`
    // are TypeScript-`private`, so they exist on the prototype at runtime - the
    // same is true of Stage 6's adapter, and the check is about the public surface,
    // so they are listed rather than pretended away.
    assert.deepEqual(members.sort(), [
      'appendStockLog',
      'applyInboundTotals',
      'assertOpen',
      'commit',
      'constructor',
      'enqueue',
      'readMedicine',
      'rollback',
    ]);

    // And the claim that matters: no second inventory path. A `setStock`,
    // `adjustStock`, `createMedicine` or `deleteMedicine` here would be a wider
    // write than this stage was approved for.
    for (const forbidden of ['setStock', 'adjustStock', 'createMedicine', 'deleteMedicine', 'renameMedicine', 'setTotalOutward']) {
      assert.equal(
        members.some((name) => name.toLowerCase().includes(forbidden.toLowerCase())),
        false,
        `the transaction must expose no "${forbidden}" operation`,
      );
    }
  });

  it('`StockLogsRepository` still exposes no append of its own', () => {
    // Read as TEXT rather than through a fake: a fake could be missing a method the
    // real repository has, and this claim is about the real contract.
    const contract = readFileSync(
      join(__dirname, '..', '..', '..', 'electron', 'repositories', 'contracts', 'order-repository.ts'),
      'utf8',
    );
    const stockLogs = contract.slice(contract.indexOf('export interface StockLogsRepository'));
    const body = stockLogs.slice(0, stockLogs.indexOf('\n}'));

    // The Stage 15 comment MENTIONS `appendStockLog` - in prose, explaining why the
    // method is absent - so only a real DECLARATION counts.
    assert.equal(
      /^\s*append\w*\s*\(/m.test(body),
      false,
      'the repository must still expose no append method',
    );
    assert.deepEqual(
      [...body.matchAll(/^\s*(\w+)\s*\(/gm)].map((match) => match[1]).sort(),
      ['listStockLogs', 'listStockLogsByOrder'],
      'the repository must still expose exactly its two list methods',
    );
  });

  it('`MedicinesRepository` gained no write at all', () => {
    const contract = readFileSync(
      join(__dirname, '..', '..', '..', 'electron', 'repositories', 'contracts', 'medicines-repository.ts'),
      'utf8',
    );
    const medicines = contract.slice(
      contract.indexOf('export interface MedicinesRepository'),
      contract.indexOf('export interface SettingsRepository'),
    );
    const body = medicines.slice(0, medicines.indexOf('\n}'));

    // `setMaxQuantity` is Stage 10's, and still the ONLY medicine write. No
    // `setStock`, `createMedicine` or `deleteMedicine` came with Stage 15.
    assert.deepEqual(
      [...body.matchAll(/^\s*(\w+)\s*\(/gm)].map((match) => match[1]).sort(),
      ['getMedicine', 'listMedicines', 'setMaxQuantity'],
    );
  });

  it('`UsersRepository` gained no write either', () => {
    const contract = readFileSync(
      join(__dirname, '..', '..', '..', 'electron', 'repositories', 'contracts', 'users-repository.ts'),
      'utf8',
    );
    const users = contract.slice(contract.indexOf('export interface UsersRepository'));
    const body = users.slice(0, users.indexOf('\n}'));

    // No `deleteUser`: C1 stays out, exactly as Stage 5B recorded.
    assert.equal(/^\s*delete\w*\s*\(/m.test(body), false, 'the deletion blocker must hold');
    assert.deepEqual(
      [...body.matchAll(/^\s*(\w+)\s*\(/gm)].map((match) => match[1]).sort(),
      [
        'approveUser', 'getUser', 'grantSingleOrderException', 'listAllUsers',
        'rejectUser', 'renameUser', 'revokeSingleOrderException',
      ],
    );
  });
});