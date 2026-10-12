/**
 * Stage 7 - the application error boundary.
 *
 * ONE rule governs this file: a failure that reaches the renderer must be a
 * CODE and a FIXED SENTENCE, and nothing else. The renderer never receives a
 * stack trace, a document path, a raw Firestore wire error, an HTTP status, a
 * server message, or anything token-shaped.
 *
 * WHY THE MAPPING IS A CLOSED SET
 * Every internal failure is forced into one of seven codes. That is what makes
 * the boundary reviewable: an unrecognised failure cannot fall through to a
 * default that prints its own message, it becomes `INTERNAL_ERROR`, which
 * reveals nothing. Fail closed.
 *
 * WHERE THE AUTHORITY ACTUALLY LIVES
 * `AUTHORIZATION_DENIED` is a REPORT, never a decision. It is produced from a
 * `DomainError` of kind `NOT_AUTHORIZED`, which `repositories/` raises from an
 * HTTP 401/403 returned by Firestore. In other words: this layer never decides
 * that somebody may or may not do something; it only reports what
 * firestore.rules already decided on the server.
 *
 * DIAGNOSTICS
 * `ApplicationError.diagnostic` keeps the technical detail (error name, the
 * domain error kind, the document path, a redacted server message) so the Main
 * process can log something actionable. It is redacted through the Stage 3
 * `sanitizeServerMessage` helper before it is stored, and it is NEVER put into
 * the payload that crosses IPC.
 */

import { FirebaseConfigError } from '../config/firebase-config';
import { FirestoreConfigError } from '../config/firestore-config';
import { DomainError, MalformedDataError, type DomainErrorKind } from '../domain/errors';
import { AuthenticationError } from '../services/firebase-auth';
import { FirestoreRestError, type FirestoreRestReason, sanitizeServerMessage } from '../services/firestore-rest';

/**
 * The application's own taxonomy. It mirrors `ApplicationErrorCode` in
 * `src/shared/ipc-contract.d.ts` one-for-one; `tests/stage7/` pins the two
 * lists together so they can never drift apart silently.
 */
export type ApplicationErrorKind =
  | 'AUTHENTICATION_FAILED'
  | 'AUTHORIZATION_DENIED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'INFRASTRUCTURE_FAILURE'
  | 'CONCURRENCY_CONFLICT'
  | 'INTERNAL_ERROR';

/**
 * The user-facing sentence for each code.
 *
 * These are FIXED strings on purpose. A message that interpolated an internal
 * error would be a leak waiting to happen; here the code alone decides what the
 * user reads, so the wording is reviewable in one table.
 */
export const APPLICATION_ERROR_MESSAGES: Readonly<Record<ApplicationErrorKind, string>> = Object.freeze({
  AUTHENTICATION_FAILED: 'انتهت صلاحية الجلسة أو فشلت عملية تسجيل الدخول، يُرجى تسجيل الدخول من جديد',
  AUTHORIZATION_DENIED: 'ليست لديك صلاحية تنفيذ هذه العملية وفق قواعد أمان Firebase',
  VALIDATION_FAILED: 'البيانات المُدخلة أو البيانات المخزَّنة لا تتوافق مع قواعد العمل',
  NOT_FOUND: 'البيانات المطلوبة غير موجودة',
  INFRASTRUCTURE_FAILURE: 'تعذّر الاتصال بالخدمة، يُرجى التحقق من الشبكة والمحاولة لاحقاً',
  CONCURRENCY_CONFLICT: 'تغيّرت البيانات أثناء المعالجة، يُرجى إعادة المحاولة',
  INTERNAL_ERROR: 'حدث خطأ غير متوقع، يُرجى المحاولة لاحقاً',
});

/** Codes for which repeating the identical call could plausibly succeed. */
const RETRYABLE_KINDS: ReadonlySet<ApplicationErrorKind> = new Set<ApplicationErrorKind>([
  'INFRASTRUCTURE_FAILURE',
  'CONCURRENCY_CONFLICT',
]);

export interface ApplicationErrorOptions {
  /** Whether the UI may offer "try again" for this failure. */
  readonly retryable?: boolean | undefined;
  /** Main-process only detail. Redacted, never sent to the renderer. */
  readonly diagnostic?: string | undefined;
  /** The original error, kept for the Main-process log. */
  readonly cause?: unknown;
}

/**
 * The error the application layer raises. It is a normal `Error` (so the
 * Main-process log keeps a stack) but only `code`, `message` and `retryable`
 * are ever projected into the renderer payload.
 */
export class ApplicationError extends Error {
  public readonly kind: ApplicationErrorKind;
  public readonly retryable: boolean;
  public readonly diagnostic: string;
  public override readonly cause: unknown;

  public constructor(kind: ApplicationErrorKind, options: ApplicationErrorOptions = {}) {
    super(APPLICATION_ERROR_MESSAGES[kind]);
    this.name = 'ApplicationError';
    this.kind = kind;
    this.retryable = options.retryable ?? RETRYABLE_KINDS.has(kind);
    this.diagnostic = options.diagnostic ?? '';
    this.cause = options.cause;
  }
}

/**
 * Removes token-shaped fragments from a diagnostic string before storing it.
 *
 * Reuses the Stage 3 `sanitizeServerMessage` rather than repeating the patterns:
 * a second, subtly different copy of "what a token looks like" is exactly how
 * one leak eventually survives. Defence in depth - the transport already
 * sanitises, and a diagnostic must stay safe even if that changes.
 */
export function redactDiagnostic(rawDiagnostic: string): string {
  return sanitizeServerMessage(rawDiagnostic);
}

/**
 * `DomainError` is Stage 5B's whole reason for existing: it lets every layer
 * above `repositories/` tell "the rules denied this" from "the network is
 * down" without knowing that Firestore exists. The table below is the direct
 * translation into the application taxonomy.
 *
 * NOTE ON `ABORTED` -> `CONCURRENCY_CONFLICT`: a transaction conflict is an
 * INFRASTRUCTURE outcome, never a business verdict. Reporting it as a
 * validation failure would be a lie the UI would act on by refusing a request
 * that is perfectly processable.
 */
const DOMAIN_ERROR_KINDS: Readonly<Record<DomainErrorKind, ApplicationErrorKind>> = Object.freeze({
  NOT_AUTHORIZED: 'AUTHORIZATION_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'VALIDATION_FAILED',
  INVALID_INPUT: 'VALIDATION_FAILED',
  MALFORMED_DATA: 'VALIDATION_FAILED',
  ABORTED: 'CONCURRENCY_CONFLICT',
  PRECONDITION_FAILED: 'VALIDATION_FAILED',
  TRANSPORT: 'INFRASTRUCTURE_FAILURE',
  UNKNOWN: 'INTERNAL_ERROR',
});

/**
 * Defence in depth. A `FirestoreRestError` must never leave `repositories/`
 * (that is what `toDomainError` guarantees), so reaching this branch means the
 * transport leaked. Mapping it anyway is what stops a leak from becoming a
 * renderer-facing HTTP status and a server message.
 */
const TRANSPORT_REASONS: Readonly<Record<FirestoreRestReason, ApplicationErrorKind>> = Object.freeze({
  PERMISSION_DENIED: 'AUTHORIZATION_DENIED',
  UNAUTHENTICATED: 'AUTHENTICATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'VALIDATION_FAILED',
  ABORTED: 'CONCURRENCY_CONFLICT',
  FAILED_PRECONDITION: 'VALIDATION_FAILED',
  INVALID_ARGUMENT: 'VALIDATION_FAILED',
  NETWORK: 'INFRASTRUCTURE_FAILURE',
  CONFIGURATION_ERROR: 'INFRASTRUCTURE_FAILURE',
  UNKNOWN: 'INTERNAL_ERROR',
});

/** Best-effort technical description for the Main-process log. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name.trim().length > 0 ? error.name : 'Error';
    return redactDiagnostic(`${name}: ${error.message}`);
  }
  return redactDiagnostic(`non-error thrown: ${String(error)}`);
}

/** Adds the domain document path to a diagnostic (never to the payload). */
function withDocumentPath(diagnostic: string, documentPath: string | null): string {
  return documentPath === null ? diagnostic : `${diagnostic} (at ${documentPath})`;
}

/**
 * The single funnel every internal failure passes through.
 *
 * Call order matters and is deliberate:
 *   1. an `ApplicationError` is already safe and is returned unchanged;
 *   2. `AuthenticationError` carries a Stage 2 code that the existing sign-in
 *      contract already exposes verbatim, so it is preserved rather than
 *      flattened - the renderer keeps the precise "wrong password" wording;
 *   3. `DomainError` is the normal path and is a pure table lookup;
 *   4. transport, configuration and unknown errors fail closed.
 */
export function toApplicationError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) {
    return error;
  }

  if (error instanceof AuthenticationError) {
    return new ApplicationError('AUTHENTICATION_FAILED', {
      retryable: false,
      diagnostic: `${describe(error)} [${error.code}]`,
      cause: error,
    });
  }

  if (error instanceof DomainError) {
    // A `MalformedDataError` is the one domain error whose `message` alone is not
    // actionable: the message says WHAT is wrong, but the `fieldPath` says WHERE.
    // Both belong in the Main-process log - and in neither does the path reach
    // the renderer, which only ever sees the fixed sentence for the code.
    const diagnostic = error instanceof MalformedDataError
      ? `${describe(error)} [domain:${error.kind} field:${error.fieldPath}]`
      : `${describe(error)} [domain:${error.kind}]`;
    return new ApplicationError(DOMAIN_ERROR_KINDS[error.kind], {
      diagnostic: withDocumentPath(diagnostic, error.documentPath),
      cause: error,
    });
  }

  if (error instanceof FirestoreRestError) {
    return new ApplicationError(TRANSPORT_REASONS[error.reason], {
      diagnostic: withDocumentPath(
        `${describe(error)} [transport:${error.reason} http:${error.httpStatus} sent:${String(error.requestSent)}]`,
        error.serverMessage,
      ),
      cause: error,
    });
  }

  if (error instanceof FirebaseConfigError || error instanceof FirestoreConfigError) {
    return new ApplicationError('INFRASTRUCTURE_FAILURE', {
      retryable: false,
      diagnostic: describe(error),
      cause: error,
    });
  }

  return new ApplicationError('INTERNAL_ERROR', {
    retryable: false,
    diagnostic: describe(error),
    cause: error,
  });
}

/**
 * The ONLY projection of an error that may cross the IPC bridge.
 *
 * It is built field by field on purpose. Spreading the error, or reusing its
 * `message`, would be one refactor away from shipping a server message to the
 * renderer; here the payload physically cannot carry more than these keys.
 */
export function toApplicationErrorPayload(error: ApplicationError): ApplicationErrorPayload {
  return Object.freeze({
    code: error.kind,
    message: APPLICATION_ERROR_MESSAGES[error.kind],
    retryable: error.retryable,
  });
}

