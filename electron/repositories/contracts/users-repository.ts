/**
 * Stage 5B - `users` repository contract.
 *
 * firestore.rules (lines 37-63) makes three different powers out of one
 * collection, which is why the interface is split:
 *
 *   READ   - an owner may read their own profile; `isAdmin()` may read all
 *   WRITE  - `isAdmin()` may write anything; an owner may change ONLY `name`
 *            and `status` (and only the rejected -> pending transition)
 *   DELETE - `isAdmin()` only
 *
 * DELETION IS INTENTIONALLY ABSENT. Nothing in the Stage 4 design requires it,
 * the Android delete button is part of the not-yet-enabled admin screen (C1),
 * and omitting it keeps a destructive operation from being expressible by
 * accident. It can be added later as a named, deliberate method.
 *
 * UNRESTRICTED UPDATES ARE ABSENT ON PURPOSE. There is no `updateUser(user)`.
 * The three writes below are the only ones the authoritative model justifies,
 * and each one is individually masked so it cannot erase `lastOrder*`.
 */

import type { User } from '../../domain/models';

export interface UsersRepository {
  // ------------------------------------------------------------- READ

  /**
   * Reads one profile by uid. Returns `null` when the document does not exist.
   *
   * The same call is the own-profile read and the admin read; which one it is
   * depends on the caller's token, and only firestore.rules knows that. A
   * foreign profile is therefore `403`, never a "not found" - and the caller
   * must not retry, because a retry cannot change the outcome.
   */
  getUser(uid: string): Promise<User | null>;

  /**
   * Lists every profile. firestore.rules allows this to `isAdmin()` only, so
   * an employee receives 403. There is deliberately no filtering parameter: a
   * filtered list would still be denied, because rules are not filters.
   */
  listAllUsers(): Promise<readonly User[]>;

  // ------------------------------------------------- ADMINISTRATIVE WRITE

  /** Sets `status = 'approved'`. Admin only. */
  approveUser(uid: string): Promise<void>;

  /** Sets `status = 'rejected'`. Admin only. */
  rejectUser(uid: string): Promise<void>;

  /**
   * Grants the single-order exception (`hasException = true`).
   * Admin only. Consumed and cleared by the Stage 6 processing step.
   */
  grantSingleOrderException(uid: string): Promise<void>;

  /** Revokes the exception (`hasException = false`). Admin only. */
  revokeSingleOrderException(uid: string): Promise<void>;

  /** Renames a profile. Admin only. Masked to the `name` field. */
  renameUser(uid: string, name: string): Promise<void>;

  // -------------------------------------------------------- NOT PROVIDED
  //
  // deleteUser(uid)                    - not required by the design
  // updateUser(user)                   - would be an unrestricted write
  // setUserRole(uid, role)             - forbidden by the rules for everyone
  //                                    except another admin editing a peer
  // setUserEmployeeId(uid, employeeId) - FROZEN: the rules forbid it
}