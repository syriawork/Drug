/**
 * Stage 5B - shared plumbing for the Firestore-backed repositories.
 *
 * Two responsibilities, both deliberately small:
 *
 *  1. TRANSLATION of transport failures into `DomainError`. Nothing above this
 *     layer should ever see a `FirestoreRestError`. The mapping is deliberately
 *     literal: a 403 becomes `NOT_AUTHORIZED` because the RULES denied it - the
 *     client never decided anything.
 *
 *  2. The `RepositoryContext` that carries the authenticated REST client plus a
 *     per-document id extractor, since `getDocument` returns a relative path
 *     rather than the document id.
 */

import { DomainError } from '../../domain/errors';
import {
  type FirestoreDocument,
  type FirestoreRestClient,
  FirestoreRestError,
} from '../../services/firestore-rest';

/** Translates any transport/codec failure into a `DomainError`. */
export function toDomainError(error: unknown, documentPath: string | null = null): DomainError {
  if (error instanceof DomainError) {
    return error;
  }

  if (error instanceof FirestoreRestError) {
    switch (error.reason) {
      case 'PERMISSION_DENIED':
      case 'UNAUTHENTICATED':
        return new DomainError(
          'NOT_AUTHORIZED',
          'Ø±ÙÙØ¶ Ø§Ù„Ø·Ù„Ø¨ Ù…Ù† Ù‚ÙˆØ§Ø¹Ø¯ Ø£Ù…Ø§Ù† Firestore Security Rules',
          { documentPath, cause: error },
        );
      case 'NOT_FOUND':
        return new DomainError('NOT_FOUND', 'Ø§Ù„Ù…Ø³ØªÙ†Ø¯ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯', { documentPath, cause: error });
      case 'ALREADY_EXISTS':
        return new DomainError('ALREADY_EXISTS', 'Ø§Ù„Ù…Ø³ØªÙ†Ø¯ Ù…ÙˆØ¬ÙˆØ¯ Ù…Ø³Ø¨Ù‚Ø§Ù‹', { documentPath, cause: error });
      // Stage 6: a transaction conflict. Kept DISTINCT from a business failure
      // so the processing service re-reads and retries instead of marking the
      // request as failed.
      case 'ABORTED':
        return new DomainError('ABORTED', 'transaction conflict: data changed during the read', { documentPath, cause: error });
      case 'FAILED_PRECONDITION':
        return new DomainError('PRECONDITION_FAILED', 'Ù„Ù… ØªØªØ­Ù‚Ù‚ Ø§Ù„Ø´Ø±ÙˆØ· Ø§Ù„Ù…Ø³Ø¨Ù‚Ø© Ù„Ù„ÙƒØªØ§Ø¨Ø©', { documentPath, cause: error });
      case 'INVALID_ARGUMENT':
      case 'CONFIGURATION_ERROR':
        return new DomainError('INVALID_INPUT', 'Ø·Ù„Ø¨ Firestore ØºÙŠØ± ØµØ§Ù„Ø­', { documentPath, cause: error });
      default:
        return new DomainError('TRANSPORT', 'ÙØ´Ù„ Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ø®Ø¯Ù…Ø© Firestore', { documentPath, cause: error });
    }
  }

  return new DomainError('UNKNOWN', 'Ø®Ø·Ø£ ØºÙŠØ± Ù…ØªÙˆÙ‚Ø¹ Ø£Ø«Ù†Ø§Ø¡ Ø§Ù„ÙˆØµÙˆÙ„ Ø¥Ù„Ù‰ Firestore', { documentPath, cause: error });
}

export interface RepositoryContext {
  /** The single authenticated Main-process REST client (Stage 5A). */
  readonly client: FirestoreRestClient;
  /** Raised once per non-fatal mapping surprise, for the caller's log. */
  readonly onWarning?: ((message: string) => void) | undefined;
}

/**
 * Returns the LAST path segment of a relative Firestore path.
 *
 * `getDocument` returns `relativePath` (e.g. `users/abc123`), while the domain
 * needs the id. Doing the split once here keeps every repository from repeating
 * a string operation that could silently be wrong.
 */
export function documentIdOf(document: FirestoreDocument): string {
  const segments = document.relativePath.split('/');
  return segments[segments.length - 1] ?? '';
}

/** Builds the relative path of a document in a single-collection collection. */
export function documentPath(collection: string, id: string): string {
  return `${collection}/${id}`;
}

/** Rejects an empty id before it can reach the transport layer. */
export function requireId(id: string, fieldName: string): string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new DomainError('INVALID_INPUT', `${fieldName} must be a non-empty string`);
  }
  return id;
}

/** Rejects an empty collection listing rather than downloading everything. */
export function requirePositiveLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new DomainError('INVALID_INPUT', 'limit must be a positive whole number');
  }
  return limit;
}