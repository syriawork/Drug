/**
 * Stage 11 - the order-requests application layer.
 *
 * The claim under test is DELEGATION, not processing. Stage 11 adds a user
 * interface to the Stage 6 engine and must not become a second engine, so every
 * case here asks the same question from a different angle: did this layer hand
 * the work to `OrderProcessingService` and then faithfully report what came back?
 *
 * The four Stage 6 outcomes are asserted SEPARATELY, because collapsing any two
 * of them would be a real defect:
 *
 *   success                      -> a committed order, and its id must survive
 *   business-validation-failure -> a COMMITTED `failed` marker; a success, not an
 *                                  error, and the reason must reach the UI
 *   already-processed            -> ZERO writes; still a success, and NO order id
 *   thrown                       -> an error, and never a success claim
 *
 * No network, no Electron runtime, no production backend.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { APPLICATION_ERROR_MESSAGES } from '../../electron/application/application-error';
import { DomainError } from '../../electron/domain/errors';
import { FirestoreRestError } from '../../electron/services/firestore-rest';
import {
  FakeOrderProcessingService,
  FakeOrderRequestsRepository,
  FakeUsersRepository,
  makeOrderRequest,
  makeUser,
  rulesDenied,
} from '../stage7/helpers/fakes';
import { buildApplication, buildApplicationWithStage6 } from '../stage9/helpers';

// Tests are executed from `dist/tests/stage11`, so the SOURCE tree is three
// levels up. Reading the compiled output instead would scan `.d.ts` files and
// silently pass a guard that no longer guards anything.
const projectRoot = join(__dirname, '..', '..', '..');
const applicationRoot = join(projectRoot, 'electron', 'application');

/** Builds a Stage 6 service that returns the given outcome or throws the error. */
function stage6Returning(outcome: unknown): FakeOrderProcessingService {
  return new FakeOrderProcessingService(outcome as never);
}

describe('Stage 11 requirement 1: the list delegates to the repository', () => {
  it('reads every known status through the established single-EQUAL query', async () => {
    const requests = new FakeOrderRequestsRepository([
      makeOrderRequest({ id: 'req-pending' }),
      makeOrderRequest({ id: 'req-processed', status: 'processed', orderId: 'order-7' }),
      makeOrderRequest({ id: 'req-failed', status: 'failed', error: 'Insufficient stock for Panadol' }),
    ]);

    const result = await buildApplication(undefined, undefined, requests).manager.listOrderRequests();

    // One established query per status, driven by the domain's own closed set.
    assert.deepEqual([...requests.statusesQueried], ['pending', 'processed', 'failed']);
    assert.equal(result.ok, true);
    assert.deepEqual(
      (result.ok ? [...result.value] : []).map((request) => request.id).sort(),
      ['req-failed', 'req-pending', 'req-processed'],
    );
  });

  it('surfaces all THREE statuses, so a manager can tell them apart', async () => {
    const requests = new FakeOrderRequestsRepository([
      makeOrderRequest({ id: 'req-pending' }),
      makeOrderRequest({ id: 'req-processed', status: 'processed', orderId: 'order-7' }),
      makeOrderRequest({ id: 'req-failed', status: 'failed', error: 'Insufficient stock for Panadol' }),
    ]);

    const result = await buildApplication(undefined, undefined, requests).manager.listOrderRequests();

    assert.equal(result.ok, true);
    const byId = new Map((result.ok ? result.value : []).map((request) => [request.id, request]));
    assert.equal(byId.get('req-pending')?.status, 'pending');
    assert.equal(byId.get('req-processed')?.status, 'processed');
    assert.equal(byId.get('req-processed')?.orderId, 'order-7');
    assert.equal(byId.get('req-failed')?.status, 'failed');
    assert.equal(
      byId.get('req-failed')?.error,
      'Insufficient stock for Panadol',
      "the engine's own business reason must reach the manager",
    );
  });

  it('reports a rules refusal rather than an empty queue', async () => {
    const requests = new FakeOrderRequestsRepository([], rulesDenied('order_requests/req-1'));

    const result = await buildApplication(undefined, undefined, requests).manager.listOrderRequests();

    assert.equal(result.ok, false);
    assert.equal(!result.ok ? result.error.code : null, 'AUTHORIZATION_DENIED');
    assert.equal(
      !result.ok ? result.error.message : null,
      APPLICATION_ERROR_MESSAGES.AUTHORIZATION_DENIED,
      'the payload must carry the fixed sentence, never the server message',
    );
  });

  it('resolves the employee name best-effort, and survives the users read failing', async () => {
    const named = new FakeOrderRequestsRepository([makeOrderRequest({ uid: 'uid-emp' })]);
    const users = new FakeUsersRepository([makeUser({ uid: 'uid-emp', name: 'سارة العامري' })]);

    const ok = await buildApplication(users, undefined, named).manager.listOrderRequests();
    assert.equal(ok.ok ? ok.value[0]?.employeeName : null, 'سارة العامري');

    // Reading profiles is admin-only, so for any other caller this throws. The
    // queue must STILL be returned, with the uid left to identify the employee.
    const denied = new FakeUsersRepository([], rulesDenied('users/uid-emp'));
    const fallback = await buildApplication(denied, undefined, named).manager.listOrderRequests();
    assert.equal(fallback.ok, true, 'a decoration failure must not become a page error');
    assert.equal(fallback.ok ? fallback.value[0]?.employeeName : null, null);
    assert.equal(fallback.ok ? fallback.value[0]?.uid : null, 'uid-emp');
  });
});
describe('Stage 11 requirement 2: a single-request read delegates correctly', () => {
  it('returns the stored request, projected onto the safe view', async () => {
    const requests = new FakeOrderRequestsRepository([makeOrderRequest({ id: 'req-42' })]);

    const result = await buildApplication(undefined, undefined, requests).orderRequests.getOrderRequest('req-42');

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.value.id : null, 'req-42');
    assert.equal(result.ok ? result.value.items[0]?.medicineName : null, 'Panadol');
    // Timestamps are flattened in Main; a FirestoreTimestamp must not cross IPC.
    assert.equal(typeof (result.ok ? result.value.requestDateIso : null), 'string');
  });

  it('answers NOT_FOUND for an absent id, distinctly from a denial', async () => {
    const requests = new FakeOrderRequestsRepository([makeOrderRequest({ id: 'req-1' })]);

    const missing = await buildApplication(undefined, undefined, requests).orderRequests.getOrderRequest('req-absent');
    assert.equal(!missing.ok ? missing.error.code : null, 'NOT_FOUND');

    const deniedRepo = new FakeOrderRequestsRepository([], rulesDenied('order_requests/req-1'));
    const denied = await buildApplication(undefined, undefined, deniedRepo).orderRequests.getOrderRequest('req-1');
    assert.equal(!denied.ok ? denied.error.code : null, 'AUTHORIZATION_DENIED');
  });

  it('refuses a malformed id before any I/O', async () => {
    const requests = new FakeOrderRequestsRepository([makeOrderRequest()]);

    for (const bad of [null, 42, '', 'req/../users/x', { requestId: 'nested' }]) {
      const result = await buildApplication(undefined, undefined, requests).orderRequests.getOrderRequest(bad);
      assert.equal(!result.ok ? result.error.code : null, 'VALIDATION_FAILED', `refuse ${String(bad)}`);
    }
  });
});

describe('Stage 11 requirement 3: processing delegates to the Stage 6 service', () => {
  it('forwards the id and the SESSION actor, and nothing else', async () => {
    const stage6 = stage6Returning({ result: { kind: 'success', orderId: 'order-9' }, attempts: 1 });

    await buildApplicationWithStage6(stage6).orderRequests.processOrderRequest('req-42');

    assert.equal(stage6.calls.length, 1);
    assert.equal(stage6.calls[0]?.requestId, 'req-42');
    // The actor is the signed-in user, read from the Main session. There is no
    // payload key through which a renderer could name somebody else.
    assert.equal(stage6.calls[0]?.actor.uid, 'uid-admin');
  });

  it('refuses a malformed id BEFORE any processing is attempted', async () => {
    const stage6 = stage6Returning({ result: { kind: 'success', orderId: 'order-9' }, attempts: 1 });

    for (const bad of [null, 42, '', 'req/../users/x', 'a'.repeat(200)]) {
      const result = await buildApplicationWithStage6(stage6).orderRequests.processOrderRequest(bad);
      assert.equal(!result.ok ? result.error.code : null, 'VALIDATION_FAILED', `refuse ${String(bad)}`);
    }
    assert.equal(stage6.calls.length, 0, 'Stage 6 must not be reached for an invalid id');
  });
});
describe('Stage 11 requirements 4 & 5: the four Stage 6 outcomes stay distinct', () => {
  it('reports a committed order as processed, keeping the order id', async () => {
    const stage6 = stage6Returning({ result: { kind: 'success', orderId: 'order-9' }, attempts: 1 });

    const result = await buildApplicationWithStage6(stage6).orderRequests.processOrderRequest('req-42');

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.value : null, {
      outcome: 'processed', orderId: 'order-9', reason: null, status: null,
    });
  });

  it("reports a BUSINESS refusal as a success carrying the engine's own reason", async () => {
    // Stage 6 already committed a `failed` marker, so this is a completed unit of
    // work. Reporting it as an error would tell the manager to retry a request the
    // engine has already closed, and would discard the reason the UI must show.
    const stage6 = stage6Returning({
      result: { kind: 'business-validation-failure', reason: 'Insufficient stock for Panadol' },
      attempts: 1,
    });

    const result = await buildApplicationWithStage6(stage6).orderRequests.processOrderRequest('req-42');

    assert.equal(result.ok, true, 'a business refusal is NOT an application failure');
    assert.equal(result.ok ? result.value.outcome : null, 'rejected');
    assert.equal(result.ok ? result.value.reason : null, 'Insufficient stock for Panadol');
    assert.equal(result.ok ? result.value.orderId : null, null, 'a refused request creates no order');
  });

  it('reports an ALREADY-PROCESSED request as a success with no order id', async () => {
    // The engine wrote nothing at all, so claiming an order id here would send
    // the manager looking for an order that does not exist.
    const stage6 = stage6Returning({ result: { kind: 'already-processed', status: 'processed' }, attempts: 1 });

    const result = await buildApplicationWithStage6(stage6).orderRequests.processOrderRequest('req-42');

    assert.equal(result.ok, true, 're-attempting is not a malfunction');
    assert.equal(result.ok ? result.value.outcome : null, 'already-processed');
    assert.equal(result.ok ? result.value.orderId : null, null);
    assert.equal(result.ok ? result.value.status : null, 'processed');
  });

  it('turns a THROWN failure into an error, never into a success', async () => {
    // Business refusal and infrastructure failure must not look alike. Only the
    // second one is retryable, and only the second one may show a retry button.
    const cases: readonly (readonly [string, unknown])[] = [
      ['AUTHORIZATION_DENIED', rulesDenied('order_requests/req-42')],
      ['CONCURRENCY_CONFLICT', new DomainError('ABORTED', 'the request moved while we looked')],
      ['INFRASTRUCTURE_FAILURE', new FirestoreRestError({
        reason: 'NETWORK', httpStatus: 503, requestSent: true, message: 'upstream is down',
      })],
    ];

    for (const [code, thrown] of cases) {
      const result = await buildApplicationWithStage6(stage6Returning(thrown))
        .orderRequests.processOrderRequest('req-42');
      assert.equal(result.ok, false, `${code} must not read as success`);
      assert.equal(!result.ok ? result.error.code : null, code);
    }
  });

  it('never echoes the transport or rules message back to the renderer', async () => {
    const result = await buildApplicationWithStage6(stage6Returning(new FirestoreRestError({
      reason: 'PERMISSION_DENIED',
      httpStatus: 403,
      requestSent: true,
      message: 'Missing or insufficient permissions at /databases/(default)',
    }))).orderRequests.processOrderRequest('req-42');

    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes('insufficient permissions'), false);
    assert.equal(!result.ok ? result.error.message : null, APPLICATION_ERROR_MESSAGES.AUTHORIZATION_DENIED);
  });
});
describe('Stage 11 requirement 6: there is exactly ONE processing implementation', () => {
  it('keeps the Stage 11 application path free of Stage 6 engine vocabulary', () => {
    // The inbound receipt is a separate named use case with its own transaction
    // contract. This Stage 11 assertion stays scoped to order processing so that
    // it proves the Stage 6 algorithm was not duplicated here.
    const engineOnlyTokens = [
      'aggregatelines', 'createorder', 'createstocklog',
      'updatemedicinestock', 'markrequestprocessed', 'markrequestfailed',
      'updateusersummary', 'begintransaction', 'commitwrites',
      'damascusmonthyear', 'validateusereligibility',
    ];

    const code = readFileSync(join(applicationRoot, 'order-requests.service.ts'), 'utf8').toLowerCase();
    for (const token of [...engineOnlyTokens, 'mindaysbetweenorders', 'maxdailyorders', 'allowfridayorders']) {
      assert.equal(
        code.includes(token),
        false,
        `Stage 11 order processing must not contain "${token}"`,
      );
    }
  });

  it('delegates processing through the single injected orchestrator', async () => {
    // A structural proof that survives a rename: every `.process(` call site
    // inside the application layer must be the one injected Stage 6 service.
    const serviceFile = readFileSync(join(applicationRoot, 'order-requests.service.ts'), 'utf8');
    const targets = [...serviceFile.matchAll(/this\.(\w+)\.process\(/g)].map((match) => match[1]);

    assert.deepEqual(targets, ['orderProcessing']);
  });

  it('keeps the Stage 11 read path free of any transaction', async () => {
    const serviceFile = readFileSync(join(applicationRoot, 'order-requests.service.ts'), 'utf8');
    assert.equal(serviceFile.includes('runTransaction'), false);
    assert.equal(serviceFile.includes('beginTransaction'), false);
  });
});