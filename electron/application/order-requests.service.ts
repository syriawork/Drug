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

import { DomainError } from '../domain/errors';
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
  readonly auth: AuthStateSource;
  /** Display name for the actor; falls back to the email, then to the uid. */
  readonly actorName?: ((state: SafeAuthState) => string) | undefined;
  readonly onDiagnostic?: ((message: string) => void) | undefined;
}

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
  private readonly auth: AuthStateSource;
  private readonly actorName: (state: SafeAuthState) => string;
  private readonly onDiagnostic: ((message: string) => void) | undefined;
  private submissionInFlight = false;

  public constructor(options: OrderRequestsApplicationServiceOptions) {
    this.orderProcessing = options.orderProcessing;
    this.orderRequests = options.orderRequests;
    this.medicines = options.medicines;
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

    if (this.submissionInFlight) {
      return applicationRefusal('VALIDATION_FAILED', {
        retryable: true,
        diagnostic: 'ignored a concurrent order-request submission',
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
    const medicines = this.medicines;
    if (orderRequests === undefined || medicines === undefined) {
      return applicationRefusal('INFRASTRUCTURE_FAILURE', {
        retryable: false,
        diagnostic: 'submitPendingRequest without configured repositories',
      });
    }

    const uid = state.uid;
    this.submissionInFlight = true;
    try {
      return await attempt(async (): Promise<OrderRequestSubmissionView> => {
        const names = new Map<string, string>();
        const items: OrderItem[] = [];
        for (const item of parsed.items) {
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

        const requestId = await orderRequests.submitPendingRequest({
          uid,
          items: Object.freeze(items),
        });
        if (requestId.length === 0) {
          throw new Error('order-request repository returned an invalid request id');
        }
        return Object.freeze({ requestId });
      }, this.onDiagnostic);
    } finally {
      this.submissionInFlight = false;
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
