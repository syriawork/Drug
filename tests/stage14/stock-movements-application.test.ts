/**
 * Stage 14 - the application layer for the READ-ONLY Stock Movement Audit page.
 *
 * WHAT THIS FILE PROVES
 * Stage 14 adds no backend code: `FirestoreStockLogsRepository` and `mapStockLog`
 * already existed from Stage 5B, and the Stage 6 transaction already wrote the
 * documents. This suite pins the behaviour the new screen depends on, so a change
 * to the SHARED read path cannot silently alter what the screen shows:
 *
 *  - every movement row reaches the view field for field, with NO aggregation
 *  - the SIGN is not invented: `quantity` stays a positive magnitude and `type`
 *    alone carries the direction
 *  - the transport's ORDER is preserved rather than sorted into a chronology
 *  - a failure is an honest failure, with nothing leaked
 *  - there is genuinely no path from this screen to a stock write
 *
 * The real `toStockLogView` is used, not a copy, so a test that passes here
 * describes what the shipped projection does.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createManagerApplication } from '../../electron/application';
import type { StockLog, StockMovementType } from '../../electron/domain/models';
import { FirestoreRestError } from '../../electron/services/firestore-rest';
import {
  FakeOrdersRepository,
  FakeSession,
  FakeStockLogsRepository,
  timestamp,
  rulesDenied,
} from '../stage7/helpers/fakes';

// Tests run from `dist/tests/stage14`, so the SOURCE tree is three levels up.
const projectRoot = join(__dirname, '..', '..', '..');

/** A stored movement with values chosen so any transformation would be visible. */
function storedMovement(overrides: Partial<StockLog> = {}): StockLog {
  return {
    id: 'log-1',
    medicineId: 'med-42',
    medicineName: 'باراسيتامول',
    // POSITIVE, for BOTH directions - that is the whole point of the field.
    quantity: 7,
    type: 'outward',
    date: timestamp('2026-06-04T08:30:00.000Z'),
    // Free text, NOT a username (D10).
    label: 'صرف طلب Allison',
    actorUid: 'uid-employee',
    requestId: 'req-9',
    orderId: 'ord-3',
    ...overrides,
  };
}

/**
 * Builds the application over ONE repository the caller keeps a handle on.
 *
 * The repository is a parameter so a test can assert how OFTEN it is reached; a
 * helper that built its own would make a call-count of zero vacuous.
 */
function applicationOver(
  repository: FakeStockLogsRepository,
  signedIn = true,
): ReturnType<typeof createManagerApplication> {
  return createManagerApplication({
    session: signedIn ? FakeSession.signedIn() : FakeSession.signedOut(),
    usersRepository: undefined as never,
    medicinesRepository: undefined as never,
    settingsRepository: undefined as never,
    orderRequestsRepository: undefined as never,
    ordersRepository: new FakeOrdersRepository([]),
    orderProcessing: undefined as never,
    stockLogsRepository: repository,
    // Stage 15: the movement read touches no transaction, so it is a placeholder.
    inboundStockTransactionFactory: undefined as never,
  });
}
describe('Stage 14 requirement 1: every stored movement reaches the view unchanged', () => {
  it('passes all eight fields through with no transformation', async () => {
    const repository = new FakeStockLogsRepository([storedMovement()]);

    const result = await applicationOver(repository).manager.listStockMovements();

    assert.equal(result.ok, true);
    const view = result.ok ? result.value[0] : undefined;
    assert.equal(view?.id, 'log-1');
    assert.equal(view?.medicineId, 'med-42');
    assert.equal(view?.label, 'صرف طلب Allison');
    assert.equal(view?.quantity, 7);
    assert.equal(view?.type, 'outward');
    assert.equal(view?.dateIso, '2026-06-04T08:30:00.000Z');
    assert.equal(view?.actorUid, 'uid-employee');
    assert.equal(view?.requestId, 'req-9');
    assert.equal(view?.orderId, 'ord-3');
  });

  it('keeps quantity POSITIVE for both directions, and never signs it', async () => {
    // The property the whole screen rests on. If this ever inverted for outward
    // movements, every downstream sum would be silently wrong.
    const repository = new FakeStockLogsRepository([
      storedMovement({ id: 'in', type: 'inward', quantity: 10 }),
      storedMovement({ id: 'out', type: 'outward', quantity: 10 }),
    ]);

    const result = await applicationOver(repository).manager.listStockMovements();

    const rows = result.ok ? result.value : [];
    assert.deepEqual(rows.map((row) => [row.type, row.quantity]), [
      ['inward', 10],
      ['outward', 10],
    ]);
    // And nothing anywhere is negative.
    assert.equal(rows.every((row) => row.quantity >= 0), true, 'no row may carry a negative quantity');
  });

  it('keeps an absent label empty rather than substituting a username', async () => {
    // D10: this field is free text in some writers. Turning an empty one into a
    // uid would imply the document said something it did not.
    const repository = new FakeStockLogsRepository([storedMovement({ label: '' })]);

    const result = await applicationOver(repository).manager.listStockMovements();

    assert.equal(result.ok ? result.value[0]?.label : null, '');
  });

  it('preserves absent references as null, not an empty string', async () => {
    const repository = new FakeStockLogsRepository([
      storedMovement({ orderId: null, requestId: null, actorUid: null }),
    ]);

    const result = await applicationOver(repository).manager.listStockMovements();

    const view = result.ok ? result.value[0] : undefined;
    assert.equal(view?.orderId, null);
    assert.equal(view?.requestId, null);
    assert.equal(view?.actorUid, null);
  });

  it('degrades an UNKNOWN stored type to the documented default', async () => {
    // The mapper already narrowed this before the view saw it, so the view must
    // survive the case defensively - and the value it degrades to is `inward`,
    // the domain's documented fallback, not an invented third state.
    const repository = new FakeStockLogsRepository([
      storedMovement({ type: 'sideways' as unknown as StockMovementType }),
    ]);

    const result = await applicationOver(repository).manager.listStockMovements();

    assert.equal(result.ok ? result.value[0]?.type : null, 'inward');
  });
});
describe('Stage 14 requirement 2: NO aggregation happens anywhere on this path', () => {
  it('returns one row per stored document, never a grouped or netted row', async () => {
    const repository = new FakeStockLogsRepository([
      storedMovement({ id: 'a', medicineId: 'med-1', type: 'inward', quantity: 5 }),
      storedMovement({ id: 'b', medicineId: 'med-1', type: 'outward', quantity: 3 }),
      storedMovement({ id: 'c', medicineId: 'med-1', type: 'outward', quantity: 2 }),
      storedMovement({ id: 'd', medicineId: 'med-2', type: 'inward', quantity: 9 }),
    ]);

    const result = await applicationOver(repository).manager.listStockMovements();

    const rows = result.ok ? result.value : [];
    assert.equal(rows.length, 4, 'four documents in, four rows out - no grouping');
    // The two med-1 outward rows are still SEPARATE. A per-medicine subtotal would
    // have collapsed them into one, and `totalInward - totalOutward` would have
    // collapsed everything into a balance the database never stored.
    assert.deepEqual(rows.map((row) => row.id), ['a', 'b', 'c', 'd']);
  });

  it('publishes no aggregate field alongside the rows', async () => {
    const repository = new FakeStockLogsRepository([
      storedMovement({ type: 'inward', quantity: 100 }),
      storedMovement({ type: 'outward', quantity: 60 }),
    ]);

    const result = await applicationOver(repository).manager.listStockMovements();

    // The payload is a bare array. If a `total`, `balance` or `summary` were added
    // alongside it, this would fail - which is the point: a screen that shows rows
    // only must not be handed a number it was told not to compute.
    const payload = result.ok ? result.value : [];
    assert.deepEqual(Object.keys(payload), ['0', '1']);
  });

  it('preserves the transport order rather than sorting it into a chronology', async () => {
    // The REST layer has no `orderBy`. A layer that sorted by date would be
    // publishing an ordering the backend never promised - and on an audit trail
    // that looks like a guarantee.
    const repository = new FakeStockLogsRepository([
      storedMovement({ id: 'third', date: timestamp('2026-06-03T00:00:00.000Z') }),
      storedMovement({ id: 'first', date: timestamp('2026-06-05T00:00:00.000Z') }),
      storedMovement({ id: 'second', date: timestamp('2026-06-04T00:00:00.000Z') }),
    ]);

    const result = await applicationOver(repository).manager.listStockMovements();

    assert.deepEqual(
      (result.ok ? [...result.value] : []).map((row) => row.id),
      ['third', 'first', 'second'],
      'the rows must arrive in the order the transport produced them',
    );
  });

  it('reads with the FIXED application limit, not one the caller chose', async () => {
    const repository = new FakeStockLogsRepository([storedMovement()]);

    await applicationOver(repository).manager.listStockMovements();

    // The limit belongs to the application, so the renderer cannot widen or narrow
    // the read by passing a number it invented.
    assert.deepEqual([...repository.seenLimits], [500]);
  });
});
describe('Stage 14 requirement 3: failures are honest and leak nothing', () => {
  it('refuses a signed-out caller WITHOUT reaching the repository', async () => {
    // The instance is the one the application actually holds. A count of zero on
    // an instance nobody injected would pass even if the guard were removed.
    const repository = new FakeStockLogsRepository([storedMovement()]);

    const result = await applicationOver(repository, false).manager.listStockMovements();

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'AUTHENTICATION_FAILED');
    assert.deepEqual([...repository.seenLimits], [], 'the repository must not have been read at all');
  });

  it('reports the RULES refusal an employee receives, as an authorization denial', async () => {
    // `stock_logs` is admin-only (firestore.rules line 86). This is the verdict the
    // server sends, passed through honestly rather than swallowed into an empty
    // page - an empty page would tell the employee there is nothing to audit.
    const repository = new FakeStockLogsRepository([], rulesDenied('stock_logs'));

    const result = await applicationOver(repository).manager.listStockMovements();

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'AUTHORIZATION_DENIED');
  });

  it('survives an infrastructure failure without inventing rows', async () => {
    // A REAL transport error, not a bare `Error`. A generic error is by design
    // classified `INTERNAL_ERROR`, so asserting `INFRASTRUCTURE_FAILURE` with one
    // would be asserting a mapping the application deliberately does not make.
    const repository = new FakeStockLogsRepository([], new FirestoreRestError({
      reason: 'NETWORK', httpStatus: 503, requestSent: true, message: 'upstream is down',
    }));

    const result = await applicationOver(repository).manager.listStockMovements();

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, 'INFRASTRUCTURE_FAILURE');
    // And nothing leaked: the transport message is not the payload.
    assert.equal(result.ok ? null : result.error.message.includes('upstream is down'), false);
  });

  it('reports an empty trail as an empty list, not as an error', async () => {
    const repository = new FakeStockLogsRepository([]);

    const result = await applicationOver(repository).manager.listStockMovements();

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.value : null, []);
  });
});

describe('Stage 14 requirement 4: the read path offers no write to call', () => {
  it('exposes the read-only movement operations on the application surface', () => {
    const application = applicationOver(new FakeStockLogsRepository());
    const members = Object.getOwnPropertyNames(Object.getPrototypeOf(application.manager))
      .filter((name) => name.toLowerCase().includes('movement') || name.toLowerCase().includes('stock'));

    // These are all reads; Stage 19 adds the selected-order detail read while the
    // namespace remains write-free.
    assert.deepEqual(members.sort(), ['listStockMovements', 'listStockMovementsByOrder']);
  });

  it('reaches the repository once per read, and never a write', async () => {
    const repository = new FakeStockLogsRepository([storedMovement()]);

    await applicationOver(repository).manager.listStockMovements();

    assert.deepEqual([...repository.seenLimits], [500], 'one read, one repository call');
  });

  it('has no write method to reach, on the repository OR the contract', () => {
    // The STRUCTURAL claim. `StockLogsRepository` declares two list methods and
    // nothing else, so "the screen cannot write" is enforced by the type system
    // rather than by a code review. This is asserted on the real contract file
    // rather than on a fake, because a fake could be missing a method the real
    // repository has.
    const contract = readFileSync(
      join(projectRoot, 'electron', 'repositories', 'contracts', 'order-repository.ts'),
      'utf8',
    );
    const stockLogsInterface = contract.slice(
      contract.indexOf('export interface StockLogsRepository'),
    );

    for (const writeVerb of ['append', 'create', 'update', 'delete', 'save', 'set', 'patch']) {
      assert.equal(
        new RegExp(`\\b${writeVerb}\\w*\\s*\\(`, 'i').test(stockLogsInterface),
        false,
        `the StockLogsRepository contract must expose no "${writeVerb}" method`,
      );
    }
  });
});