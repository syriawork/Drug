/**
 * Stage 5B - domain error taxonomy.
 *
 * The repositories translate transport failures (`FirestoreRestError`) into
 * these, so that no layer above `repositories/` has to know that Firestore
 * exists, while still being able to tell "the rules denied this" apart from
 * "the network is down".
 *
 * SECURITY: a `NotAuthorized` error does NOT mean the client decided the caller
 * is not an administrator. The client never makes that decision - it merely
 * reports that `firestore.rules` returned HTTP 403. See §10 of
 * docs/domain-data-architecture.md.
 */

export type DomainErrorKind =
  /** Firestore Security Rules (or a missing session) answered 401/403. */
  | 'NOT_AUTHORIZED'
  /** The document does not exist. */
  | 'NOT_FOUND'
  /** The requested document already exists (create precondition). */
  | 'ALREADY_EXISTS'
  /** The write shape is invalid and was rejected BEFORE any request. */
  | 'INVALID_INPUT'
  /** A stored document could not be mapped onto the domain model. */
  | 'MALFORMED_DATA'
  /**
   * Stage 6: a Firestore transaction was aborted because a document it read
   * changed before the commit.
   *
   * This is an INFRASTRUCTURE outcome, never a business one. It must never be
   * converted into `status = 'failed'`: the request is still perfectly
   * processable, it just needs to be re-read and re-attempted.
   */
  | 'ABORTED'
  /** The transaction/response precondition failed. */
  | 'PRECONDITION_FAILED'
  /** Transport or configuration failure. */
  | 'TRANSPORT'
  /** Anything the client could not classify. */
  | 'UNKNOWN';

export class DomainError extends Error {
  public readonly kind: DomainErrorKind;
  /** The raw document path, when the error is about a specific document. */
  public readonly documentPath: string | null;
  /** The original cause, already sanitised by the transport layer. */
  public override readonly cause: unknown;

  public constructor(kind: DomainErrorKind, message: string, options: {
    readonly documentPath?: string | null | undefined;
    readonly cause?: unknown;
  } = {}) {
    super(message);
    this.name = 'DomainError';
    this.kind = kind;
    this.documentPath = options.documentPath ?? null;
    this.cause = options.cause;
  }
}

/**
 * A stored document does not match the shape the domain requires.
 *
 * Raised by the mappers when a REQUIRED field is missing or has the wrong type.
 * It is deliberately distinct from a transport error: it means the DATA is
 * wrong, not that the request was refused.
 */
export class MalformedDataError extends DomainError {
  public readonly fieldPath: string;

  public constructor(fieldPath: string, message: string, documentPath: string | null = null) {
    super('MALFORMED_DATA', message, { documentPath });
    this.name = 'MalformedDataError';
    this.fieldPath = fieldPath;
  }
}

/** A caller supplied an argument the repository refuses to send. */
export class InvalidInputError extends DomainError {
  public constructor(message: string) {
    super('INVALID_INPUT', message);
    this.name = 'InvalidInputError';
  }
}