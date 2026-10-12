/**
 * Stage 9 - the user-management use cases.
 *
 * This service owns the FIRST WRITE in the Windows client. Everything about it
 * is shaped by one question: which changes has the existing architecture already
 * justified? The answer is enumerated below and nowhere else.
 *
 * THE COMPLETE SET OF PERMITTED TRANSITIONS
 *
 *   rename             -> UsersRepository.renameUser
 *   approve / reject   -> UsersRepository.approveUser / rejectUser
 *   exception grant /
 *   exception revoke   -> UsersRepository.grant / revokeSingleOrderException
 *
 * That is exactly the Stage 5B `UsersRepository` contract, and it is deliberately
 * smaller than what firestore.rules would technically allow an `isAdmin()`
 * caller to do. The rules grant `isAdmin()` an unconditional update on
 * `users/{userId}`, so `role` and `employeeId` COULD be written from here - but
 * the repository exposes no method for either, and the Stage 5B audit documents
 * `employeeId` as FROZEN and `setUserRole` as unsound. Narrowing the write to
 * what the contract already justifies means the UI cannot be used to reach a
 * field nobody reviewed. Rules remain the authority; this layer is narrower still.
 *
 * WHY UNKNOWN FIELDS ARE REJECTED RATHER THAN IGNORED
 * The payload is checked against an allowlist of keys, and an unexpected key is
 * a `VALIDATION_FAILED` refusal. Silently dropping `role: 'admin'` would make a
 * future compromised or buggy renderer believe it had promoted someone. Failing
 * loudly means the mismatch is visible instead of quietly swallowed.
 *
 * WHY NOTHING HERE DECIDES AUTHORIZATION
 * The only local check is session PRESENCE, which is a fact about this process
 * and grants nothing. `role` is never read to decide whether a write is allowed.
 * An employee who reaches this method gets as far as the network, and
 * firestore.rules answers 403 - which is the whole point. The Stage 9 emulator
 * suite proves it against a real engine.
 *
 * WHY A WRITE RETURNS NO DATA
 * `updateUser` answers with a bare success arm. The renderer re-reads the list
 * afterwards instead of patching its own copy, so what it displays is what the
 * server actually stored - including the `lastOrder*` summary that a masked
 * write deliberately leaves untouched.
 */

import type { UsersRepository } from '../repositories/contracts/users-repository';
import { applicationFailureFrom, applicationRefusal, applicationSuccess } from './application-result';

/** Supplies the current safe auth state; never a token. */
export interface AuthStateSource {
  getState(): SafeAuthState;
}

/**
 * The exact keys an update payload may carry.
 *
 * `uid` plus the three optional transitions. Nothing else is accepted - see the
 * class comment for why an unexpected key is refused rather than dropped.
 */
const ALLOWED_UPDATE_KEYS: ReadonlySet<string> = new Set<string>(['uid', 'name', 'approval', 'exception']);

/**
 * A uid must survive being used as a document id.
 *
 * The Stage 3 path validator accepts letters, digits, `_` and `-`; the same
 * conservative set is applied here so a crafted id can never address a document
 * outside `users/`. Firebase Auth uids are `[A-Za-z0-9_-]` in practice, so this
 * rejects nothing legitimate.
 */
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** A display name must be non-blank and bounded. */
const MAX_NAME_LENGTH = 120;

/** The validated form of an update, once the payload has been trusted. */
interface ValidatedUpdate {
  readonly uid: string;
  readonly name?: string | undefined;
  readonly approval?: 'approve' | 'reject' | undefined;
  readonly exception?: 'grant' | 'revoke' | undefined;
}

export interface UsersManagementServiceOptions {
  readonly users: UsersRepository;
  readonly auth: AuthStateSource;
  readonly onDiagnostic?: ((message: string) => void) | undefined;
}
/** Narrows an unknown approval value, or returns `null` when it is unusable. */
function readApproval(value: unknown): 'approve' | 'reject' | null | 'invalid' {
  if (value === null || value === undefined) {
    return null;
  }
  return value === 'approve' || value === 'reject' ? value : 'invalid';
}

/** Narrows an unknown exception value, or returns `null` when it is unusable. */
function readException(value: unknown): 'grant' | 'revoke' | null | 'invalid' {
  if (value === null || value === undefined) {
    return null;
  }
  return value === 'grant' || value === 'revoke' ? value : 'invalid';
}

export class UsersManagementService {
  private readonly users: UsersRepository;
  private readonly auth: AuthStateSource;
  private readonly onDiagnostic: ((message: string) => void) | undefined;

  public constructor(options: UsersManagementServiceOptions) {
    this.users = options.users;
    this.auth = options.auth;
    this.onDiagnostic = options.onDiagnostic;
  }

  /**
   * Validates the payload without performing any I/O.
   *
   * Returns a failure envelope rather than throwing, so the caller has exactly
   * one way to handle a bad payload and cannot forget the refusal branch.
   */
  public validateUpdate(payload: unknown): ApplicationResult<ValidatedUpdate> {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return applicationRefusal('VALIDATION_FAILED', { diagnostic: 'the update payload must be an object' });
    }

    const candidate = payload as Record<string, unknown>;

    // Refusing an unexpected key is the single most important check here: it is
    // what makes `role`, `employeeId` and the `lastOrder*` summary unreachable
    // rather than merely ignored.
    for (const key of Object.keys(candidate)) {
      if (!ALLOWED_UPDATE_KEYS.has(key)) {
        return applicationRefusal('VALIDATION_FAILED', {
          diagnostic: `refused an update carrying the unsupported key "${key}"`,
        });
      }
    }

    const uid = candidate['uid'];
    if (typeof uid !== 'string' || !UID_PATTERN.test(uid)) {
      return applicationRefusal('VALIDATION_FAILED', { diagnostic: 'refused a malformed uid' });
    }

    const rawName = candidate['name'];
    let name: string | undefined;
    if (rawName !== null && rawName !== undefined) {
      if (typeof rawName !== 'string') {
        return applicationRefusal('VALIDATION_FAILED', { diagnostic: 'refused a non-string name' });
      }
      const trimmed = rawName.trim();
      if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
        return applicationRefusal('VALIDATION_FAILED', {
          diagnostic: `refused a name outside 1..${MAX_NAME_LENGTH} characters`,
        });
      }
      name = trimmed;
    }

    const approval = readApproval(candidate['approval']);
    if (approval === 'invalid') {
      return applicationRefusal('VALIDATION_FAILED', { diagnostic: 'refused an unknown approval transition' });
    }

    const exception = readException(candidate['exception']);
    if (exception === 'invalid') {
      return applicationRefusal('VALIDATION_FAILED', { diagnostic: 'refused an unknown exception transition' });
    }

    if (name === undefined && approval === null && exception === null) {
      return applicationRefusal('VALIDATION_FAILED', { diagnostic: 'the update carries no change at all' });
    }

    return applicationSuccess({
      uid,
      ...(name === undefined ? {} : { name }),
      ...(approval === null ? {} : { approval }),
      ...(exception === null ? {} : { exception }),
    });
  }

  /**
   * Applies one partial administrative update.
   *
   * Never throws: every outcome, including an unexpected internal failure, comes
   * back as an `ApplicationResult`.
   */
  public async updateUser(payload: unknown): Promise<ApplicationResult<null>> {
    const validated = this.validateUpdate(payload);
    if (!validated.ok) {
      return validated;
    }

    // Session presence only. This grants nothing and refuses nothing on the basis
    // of a role; it just avoids a pointless round trip when nobody is signed in.
    const state = this.auth.getState();
    if (!state.authenticated || state.uid === null) {
      return applicationRefusal('AUTHENTICATION_FAILED', {
        retryable: false,
        diagnostic: 'updateUser without a Main-process session',
      });
    }

    const change = validated.value;

    try {
      // A fixed order keeps behaviour predictable when several changes are sent
      // together, and keeps any failure attributable to one known transition.
      if (change.name !== undefined) {
        await this.users.renameUser(change.uid, change.name);
      }
      if (change.approval === 'approve') {
        await this.users.approveUser(change.uid);
      } else if (change.approval === 'reject') {
        await this.users.rejectUser(change.uid);
      }
      if (change.exception === 'grant') {
        await this.users.grantSingleOrderException(change.uid);
      } else if (change.exception === 'revoke') {
        await this.users.revokeSingleOrderException(change.uid);
      }
      return applicationSuccess(null);
    } catch (error: unknown) {
      return applicationFailureFrom<null>(error, this.onDiagnostic);
    }
  }
}