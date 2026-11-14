/**
 * Stage 7 - the "process this order request" use case.
 *
 * This service is a THIN ADAPTER and must stay one. The entire R1-R4 / W1-W5
 * algorithm, every business rule, the bounded retry and the distinction between a
 * business refusal and a rules denial belong to the Stage 6
 * `OrderProcessingService`, and none of it is duplicated, re-implemented or
 * re-ordered here. Moving any of it into an IPC handler would put transaction
 * logic outside the layer that owns it and make the two implementations drift.
 *
 * THE ONLY THING THE RENDERER SUPPLIES IS AN ID
 * `requestId` is the whole input. The renderer cannot send a document, a field
 * mask, a collection path, a write payload, a role or an actor. Everything else
 * - which transaction to open, what to read, what to write, who the actor is -
 * is decided in the Main process from the session and the domain rules.
 *
 * THE ACTOR COMES FROM THE SESSION, NEVER FROM THE RENDERER
 * `actor.uid` is the signed-in user's own uid, read from the Main-process
 * session. A renderer that asked to process a request "as" somebody else would be
 * ignored by construction, because there is no parameter through which to say so.
 * Note that A2 writes the EMPLOYEE's name into the stock log and the ADMIN's uid
 * into `processedBy` (D3); the service is the authority on that and this adapter
 * does not second-guess it.
 *
 * THE THREE OUTCOMES ARE SUCCESSES, NOT ERRORS
 * `processed`, `rejected` and `already-processed` all come back as
 * `ApplicationSuccess`. Only a THROWN failure - a rules denial, a conflict, a
 * transport failure - becomes an `ApplicationFailure`. Collapsing a business
 * refusal into an error would lose A2's user-facing reason and would make the UI
 * treat a normal, committed outcome as a malfunction.
 */

import { DomainError, OrderRequestSubmissionError } from '../domain/errors';
import type { OperationIdentity } from '../../functions/src/domain/operations';
import { MAX_RAW_ITEMS } from '../domain/order-rules';
import type { OrderItem } from '../domain/models';
import type { MedicinesRepository } from '../repositories/contracts/medicines-repository';
import type { OrderRequestsRepository } from '../repositories/contracts/order-repository';
import type {
  OrderProcessingActor,
  OrderProcessingOutcome,
  OrderProcessingService,
} from '../services/order-processing.service';
import { attempt, applicationRefusal } from './application-result';
import { toOrderProcessingOutcomeView, toOrderRequestListItemView } from './views';

/** Supplies the current safe auth state; never a token. */
export interface AuthStateSource {
  getState(): SafeAuthState;
}

/**
 * A request id is validated BEFORE it can reach the transport.
 *
 * The same conservative character set the Stage 3 path validator accepts is used
 * here (letters, digits, `_`, `-`), with a length ceiling. A client-generated id
 * that contained `/` or `.` could otherwise address a different document than
 * the one the caller named.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface OrderRequestsApplicationServiceOptions {
  readonly orderProcessing: OrderProcessingService;
  /**
   * Stage 11: the request READ path.
   *
   * Optional so the Stage 7 constructor keeps working unchanged; when it is
   * absent `getOrderRequest` answers `NOT_FOUND` rather than throwing. It is the
   * same contract the Stage 6 orchestrator itself reads through, which is why it
   * cannot become a second route to a different document.
   */
  readonly orderRequests?: OrderRequestsRepository | undefined;
  /** Stage 16: resolves medicine names from the trusted catalogue before submit. */
  readonly medicines?: MedicinesRepository | undefined;
  readonly operationJournal?: OrderRequestJournal | undefined;
  readonly createSubmissionIdentity?: OrderRequestIdentityFactory | undefined;
  readonly auth: AuthStateSource;
  /** Display name for the actor; falls back to the email, then to the uid. */
  readonly actorName?: ((state: SafeAuthState) => string) | undefined;
  readonly onDiagnostic?: ((message: string) => void) | undefined;
}

export interface OrderRequestJournalRecord {
  readonly operation: OperationIdentity;
  readonly lifecycle: {
    readonly status:
      | 'prepared'
      | 'submission_unknown'
      | 'confirmed'
      | 'definitively_rejected'
      | 'identity_conflict'
      | 'corrupt';
    readonly createdAt: string;
    readonly lastAttemptAt: string | null;
    readonly originalResultReference: string | null;
  };
  readonly orderRequest?: {
    readonly requestId: string;
    readonly uid: string;
    readonly requestedItems: readonly { readonly medicineId: string; readonly quantity: number }[];
    readonly payload: {
      readonly uid: string;
      readonly items: readonly OrderItem[];
      readonly status: 'pending';
      readonly requestDate: 'SERVER_TIMESTAMP';
    } | null;
  };
}

export interface OrderRequestJournal {
  prepare(
    operation: OperationIdentity,
    orderRequest: {
      readonly requestId: string;
      readonly uid: string;
      readonly requestedItems: readonly { readonly medicineId: string; readonly quantity: number }[];
    },
  ): Promise<OrderRequestJournalRecord>;
  get(operationId: unknown): Promise<OrderRequestJournalRecord | null>;
  listRecords(): Promise<readonly OrderRequestJournalRecord[]>;
  setOrderRequestPayload(operationId: unknown, items: readonly OrderItem[]): Promise<OrderRequestJournalRecord>;
  setStatus(
    operationId: unknown,
    status: OrderRequestJournalRecord['lifecycle']['status'],
    lifecycleUpdates?: {
      readonly lastAttemptAt?: string | null;
      readonly originalResultReference?: string | null;
    },
  ): Promise<OrderRequestJournalRecord>;
}

export interface OrderRequestIdentityFactoryResult {
  readonly operation: OperationIdentity;
  readonly requestId: string;
}

export type OrderRequestIdentityFactory = (
  uid: string,
  items: readonly { readonly medicineId: string; readonly quantity: number }[],
) => OrderRequestIdentityFactoryResult;

/** Default actor label: the display name, else the email, else the uid. */
function defaultActorName(state: SafeAuthState): string {
  if (state.displayName !== undefined && state.displayName !== null && state.displayName.length > 0) {
    return state.displayName;
  }
  if (state.email !== null && state.email.length > 0) {
    return state.email;
  }
  return state.uid ?? '';
}

export class OrderRequestsApplicationService {
  private readonly orderProcessing: OrderProcessingService;
  private readonly orderRequests: OrderRequestsRepository | undefined;
  private readonly medicines: MedicinesRepository | undefined;
  private readonly operationJournal: OrderRequestJournal | undefined;
  private readonly createSubmissionIdentity: OrderRequestIdentityFactory | undefined;
  private readonly auth: AuthStateSource;
  private readonly actorName: (state: SafeAuthState) => string;
  private readonly onDiagnostic: ((message: string) => void) | undefined;
  private readonly inFlightOperations = new Set<string>();

  public constructor(options: OrderRequestsApplicationServiceOptions) {
    this.orderProcessing = options.orderProcessing;
    this.orderRequests = options.orderRequests;
    this.medicines = options.medicines;
    this.operationJournal = options.operationJournal;
    this.createSubmissionIdentity = options.createSubmissionIdentity;
    this.auth = options.auth;
    this.actorName = options.actorName ?? defaultActorName;
    this.onDiagnostic = options.onDiagnostic;
  }

  /**
   * Stage 16: submits only employee intent. Identity and medicine-name snapshots
   * are resolved in Main; status, timestamp and document ID remain repository-owned.
   */
  public async submitPendingRequest(payload: unknown): Promise<ApplicationResult<OrderRequestSubmissionView>> {
    const parsed = parseOrderRequestSubmission(payload);
    if (parsed === null) {
      return applicationRefusal('VALIDATION_FAILED', {
        retryable: false,
        diagnostic: 'rejected a malformed order-request submission before any I/O',
      });
    }

    const state = this.auth.getState();
    if (!state.authenticated || state.uid === null || state.uid.length === 0) {
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'submitPendingRequest without a Main-process session',
      });
    }

    const orderRequests = this.orderRequests;
    const journal = this.operationJournal;
    const identityFactory = this.createSubmissionIdentity;
    const medicines = this.medicines;
    if (orderRequests === undefined || journal === undefined || identityFactory === undefined) {
      return applicationRefusal('INFRASTRUCTURE_FAILURE', {
        retryable: false,
        diagnostic: 'submitPendingRequest without configured repositories or journal',
      });
    }

    const uid = state.uid;
    return attempt(async (): Promise<OrderRequestSubmissionView> => {
      // Step 1: Generate fresh operation identity and request ID
      const { operation, requestId } = identityFactory(uid, parsed.items);

      // Step 2: Prepare the journal record durably before any network activity
      // The journal record is created with status 'prepared'
      const requestedItems = parsed.items.map((item: any) => ({
        medicineId: item.medicineId,
        quantity: item.quantity,
      }));
      await journal.prepare(operation, {
        requestId,
        uid,
        requestedItems,
      });

      // Step 3: Resolve medicine names (this triggers firestore:catalogue-read)
      // Must happen after journal prepare but before Firestore create
      const items: { readonly medicineId: string; readonly quantity: number }[] = [];
      const medicineNameMap = new Map<string, string>();
      for (const rawItem of parsed.items) {
        let medicineName = medicineNameMap.get(rawItem.medicineId);
        if (medicineName === undefined) {
          const medicine = await medicines!.getMedicine(rawItem.medicineId);
          if (medicine === null) {
            // Journal is already in 'prepared' state; we can still fail closed
            throw new DomainError('NOT_FOUND', `medicine ${rawItem.medicineId} does not exist`);
          }
          medicineName = medicine.name;
          medicineNameMap.set(rawItem.medicineId, medicineName);
        }
        items.push(Object.freeze({ medicineId: rawItem.medicineId, quantity: rawItem.quantity }));
      }

      // Step 4: Store the exact immutable payload in the journal
      // This includes medicineName snapshots and sets the stage for Firestore create
      const journalItems: OrderItem[] = items.map((item) => ({
        medicineId: item.medicineId,
        medicineName: medicineNameMap.get(item.medicineId) || '',
        quantity: item.quantity,
      }));
      await journal.setOrderRequestPayload(operation.operationId, journalItems);

      // Step 5: Set journal status to submission_unknown before attempting network submission
      await journal.setStatus(operation.operationId, 'submission_unknown', {
        lastAttemptAt: new Date().toISOString(),
      });

      const submissionItems = items.map((item) => ({
        medicineId: item.medicineId,
        medicineName: medicineNameMap.get(item.medicineId) || '',
        quantity: item.quantity,
      }));

      // Step 7: Attempt creation; the repository owns strict ALREADY_EXISTS reconciliation.
      let result: 'created' | 'reconciled' | 'identity-conflict';
      try {
        result = await orderRequests.submitPendingRequest({
          requestId,
          uid,
          items: submissionItems,
        });
      } catch (error: unknown) {
        if (error instanceof OrderRequestSubmissionError && error.resolution === 'definitive_rejection') {
          await journal.setStatus(operation.operationId, 'definitively_rejected');
        }
        throw error;
      }

      // Step 8: Handle create outcomes
      if (result === 'identity-conflict') {
        await journal.setStatus(operation.operationId, 'identity_conflict');
        throw new DomainError('ALREADY_EXISTS', 'The stored request ID belongs to a different submission.');
      }

      // Step 9: Confirm only after a successful create (no ALREADY_EXISTS).
      await journal.setStatus(operation.operationId, 'confirmed', {
        originalResultReference: `order_requests/${requestId}`,
      });

      return Object.freeze({ operationId: operation.operationId, requestId });
    }, this.onDiagnostic);
  }

  public async listUnresolvedOrderRequests(): Promise<ApplicationResult<readonly OrderRequestRecoveryView[]>> {
    const state = this.auth.getState();
    if (!state.authenticated || state.uid === null || state.uid.length === 0) {
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'listUnresolvedOrderRequests without a Main-process session',
      });
    }
    const journal = this.operationJournal;
    if (journal === undefined) {
      return applicationRefusal('INFRASTRUCTURE_FAILURE', {
        retryable: false,
        diagnostic: 'listUnresolvedOrderRequests without a configured journal',
      });
    }
    return attempt(async () => {
      const unresolved: OrderRequestRecoveryView[] = [];
      for (const record of await journal.listRecords()) {
        const orderRequest = record.orderRequest;
        if (
          orderRequest === undefined
          || orderRequest.uid !== state.uid
          || (
            record.lifecycle.status !== 'prepared'
            && record.lifecycle.status !== 'submission_unknown'
            && record.lifecycle.status !== 'identity_conflict'
          )
        ) {
          continue;
        }
        unresolved.push(Object.freeze({
          operationId: record.operation.operationId,
          requestId: orderRequest.requestId,
          status: record.lifecycle.status,
          createdAtIso: record.lifecycle.createdAt,
        }));
      }
      return Object.freeze(unresolved);
    }, this.onDiagnostic);
  }

  public async resumeOrderRequest(operationIdValue: unknown): Promise<ApplicationResult<OrderRequestSubmissionView>> {
    const state = this.auth.getState();
    if (!state.authenticated || state.uid === null || state.uid.length === 0) {
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'resumeOrderRequest without a Main-process session',
      });
    }
    const journal = this.operationJournal;
    if (journal === undefined) {
      return applicationRefusal('INFRASTRUCTURE_FAILURE', {
        retryable: false,
        diagnostic: 'resumeOrderRequest without a configured journal',
      });
    }
    return attempt(async () => {
      const record = await journal.get(operationIdValue);
      if (record === null || record.orderRequest === undefined) {
        throw new DomainError('NOT_FOUND', 'No resumable order request exists for this operation.');
      }
      if (record.orderRequest.uid !== state.uid) {
        throw new DomainError('NOT_FOUND', 'No resumable order request exists for this operation.');
      }
      if (record.lifecycle.status === 'confirmed') {
        return Object.freeze({
          operationId: record.operation.operationId,
          requestId: record.orderRequest.requestId,
        });
      }
      if (
        record.lifecycle.status !== 'prepared'
        && record.lifecycle.status !== 'submission_unknown'
      ) {
        throw new DomainError('INVALID_INPUT', 'This operation is not in a resumable state.');
      }
      return this.submitJournaledOrderRequest(record, state.uid);
    }, this.onDiagnostic);
  }

  private async submitJournaledOrderRequest(
    initialRecord: OrderRequestJournalRecord,
    uid: string,
  ): Promise<OrderRequestSubmissionView> {
    const orderRequests = this.orderRequests;
    const journal = this.operationJournal;
    const medicines = this.medicines;
    const submission = initialRecord.orderRequest;
    if (!orderRequests || !journal || !submission) {
      throw new DomainError('UNKNOWN', 'The journaled order request is incomplete.');
    }
    if (submission.uid !== uid) {
      throw new DomainError('NOT_FOUND', 'No resumable order request exists for this operation.');
    }
    const operationId = initialRecord.operation.operationId;
    if (this.inFlightOperations.has(operationId)) {
      throw new DomainError('ABORTED', 'The same order request is already being attempted.');
    }
    this.inFlightOperations.add(operationId);
    try {
      let record = initialRecord;
      if (record.orderRequest?.payload === null) {
        if (record.lifecycle.status !== 'prepared' || medicines === undefined) {
          throw new DomainError('UNKNOWN', 'The immutable order-request payload is unavailable for safe recovery.');
        }
        const names = new Map<string, string>();
        const items: OrderItem[] = [];
        for (const item of submission.requestedItems) {
          let medicineName = names.get(item.medicineId);
          if (medicineName === undefined) {
            const medicine = await medicines.getMedicine(item.medicineId);
            if (medicine === null) {
              throw new DomainError('NOT_FOUND', `medicine ${item.medicineId} does not exist`);
            }
            medicineName = medicine.name;
            names.set(item.medicineId, medicineName);
          }
          items.push(Object.freeze({
            medicineId: item.medicineId,
            medicineName,
            quantity: item.quantity,
          }));
        }
        record = await journal.setOrderRequestPayload(operationId, items);
      }
      const payload = record.orderRequest?.payload;
      if (payload === null || payload === undefined || payload.uid !== uid) {
        throw new DomainError('UNKNOWN', 'The immutable order-request payload is invalid.');
      }

      const attemptedAt = new Date().toISOString();
      await journal.setStatus(operationId, 'submission_unknown', { lastAttemptAt: attemptedAt });
      let result: 'created' | 'reconciled' | 'identity-conflict';
      try {
        result = await orderRequests.submitPendingRequest({
          requestId: submission.requestId,
          uid: payload.uid,
          items: payload.items,
        });
      } catch (error: unknown) {
        if (error instanceof OrderRequestSubmissionError && error.resolution === 'definitive_rejection') {
          await journal.setStatus(operationId, 'definitively_rejected');
        }
        throw error;
      }
      if (result === 'identity-conflict') {
        await journal.setStatus(operationId, 'identity_conflict');
        throw new DomainError('ALREADY_EXISTS', 'The stored request ID belongs to a different submission.');
      }
      await journal.setStatus(operationId, 'confirmed', {
        originalResultReference: `order_requests/${submission.requestId}`,
      });
      return Object.freeze({ operationId, requestId: submission.requestId });
    } finally {
      this.inFlightOperations.delete(operationId);
    }
  }

  /**
   * Stage 11: re-reads ONE request so the dialog can show its real current state.
   *
   * WHY THIS EXISTS SEPARATELY FROM `listOrderRequests()`
   * After a processing attempt the ONLY thing that matters is what the server
   * stored - Stage 6 may have committed a `failed` marker, or written nothing at
   * all for an already-processed request. Re-reading the list would answer that,
   * except that the list is windowed per status, so a request that just left
   * `pending` could simply be absent from the response and the UI would be left
   * showing stale data. One `get` by id is authoritative regardless of paging.
   *
   * It reads through the SAME `OrderRequestsRepository` contract the Stage 6
   * transaction uses, and it opens no transaction of its own: this is a read, and
   * no processing logic lives in this layer.
   */
  public getOrderRequest(requestId: unknown): Promise<ApplicationResult<OrderRequestListItemView>> {
    if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
      return Promise.resolve(applicationRefusal('VALIDATION_FAILED', {
        retryable: false,
        diagnostic: 'rejected a malformed request id before any I/O',
      }));
    }
    if (this.orderRequests === undefined) {
      return Promise.resolve(applicationRefusal('NOT_FOUND', {
        retryable: false,
        diagnostic: 'getOrderRequest without a configured order-request repository',
      }));
    }
    if (!this.auth.getState().authenticated) {
      return Promise.resolve(applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'getOrderRequest without a Main-process session',
      }));
    }

    return attempt(async () => {
      const request = await this.orderRequests?.getOrderRequest(requestId);
      if (request === null || request === undefined) {
        // The caller distinguishes "absent" from "denied"; a genuine rules refusal
        // throws a DomainError and becomes AUTHORIZATION_DENIED, never NOT_FOUND.
        throw new DomainError('NOT_FOUND', `order request ${requestId} does not exist`);
      }
      return toOrderRequestListItemView(request);
    }, this.onDiagnostic);
  }

  /**
   * Processes one pending request through the Stage 6 service.
   *
   * Never throws: the returned `ApplicationResult` is always resolved, so the IPC
   * handler can pass it straight back without a `try`/`catch` that might leak.
   */
  public processOrderRequest(requestId: unknown): Promise<ApplicationResult<OrderProcessingOutcomeView>> {
    if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
      return Promise.resolve(applicationRefusal('VALIDATION_FAILED', {
        retryable: false,
        diagnostic: 'rejected a malformed request id before any I/O',
      }));
    }

    const state = this.auth.getState();
    if (!state.authenticated || state.uid === null || state.uid.length === 0) {
      return Promise.resolve(applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'processOrderRequest without a Main-process session',
      }));
    }

    const actor: OrderProcessingActor = Object.freeze({
      uid: state.uid,
      name: this.actorName(state),
    });

    return attempt(
      async (): Promise<OrderProcessingOutcome> => this.orderProcessing.process(requestId, actor),
      this.onDiagnostic,
    ).then((result) => (result.ok
      ? applicationOutcomeSuccess(result.value)
      : result));
  }
}

interface ParsedOrderRequestSubmission {
  readonly items: readonly { readonly medicineId: string; readonly quantity: number }[];
}

const MEDICINE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function parseOrderRequestSubmission(payload: unknown): ParsedOrderRequestSubmission | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const input = payload as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Object.prototype.hasOwnProperty.call(input, 'items')) {
    return null;
  }
  const rawItems = input['items'];
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_RAW_ITEMS) {
    return null;
  }

  const items: { readonly medicineId: string; readonly quantity: number }[] = [];
  for (const rawItem of rawItems) {
    if (rawItem === null || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      return null;
    }
    const item = rawItem as Record<string, unknown>;
    if (
      Object.keys(item).length !== 2
      || !Object.prototype.hasOwnProperty.call(item, 'medicineId')
      || !Object.prototype.hasOwnProperty.call(item, 'quantity')
    ) {
      return null;
    }
    const medicineId = item['medicineId'];
    const quantity = item['quantity'];
    if (
      typeof medicineId !== 'string'
      || !MEDICINE_ID_PATTERN.test(medicineId)
      || typeof quantity !== 'number'
      || !Number.isSafeInteger(quantity)
      || quantity <= 0
    ) {
      return null;
    }
    items.push(Object.freeze({ medicineId, quantity }));
  }
  return Object.freeze({ items: Object.freeze(items) });
}

/** Projects a Stage 6 outcome into a success envelope. */
function applicationOutcomeSuccess(outcome: OrderProcessingOutcome): ApplicationResult<OrderProcessingOutcomeView> {
  return Object.freeze({ ok: true as const, value: toOrderProcessingOutcomeView(outcome) });
}
