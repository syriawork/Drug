/**
 * Stage 5B - `users/{uid}` <-> domain `User`.
 *
 * Field-by-field authority: docs/domain-data-architecture.md Â§4.1, A1 rules, and
 * the real production backup (A9) whose documents contain ONLY
 * `{uid, role, name, employeeId, status}`.
 *
 * That last point drives the mapping: every `lastOrder*` summary field is
 * OPTIONAL and must survive both an ABSENT field and an explicit `null`.
 */

import type { OrderStatus, User, UserRole, UserStatus } from '../../../domain/models';
import {
  type RawFields,
  booleanOrFalse,
  optionalString,
  optionalTimestamp,
  readUserRole,
  readUserStatus,
  requireString,
  stringOrDefault,
} from './readers';

/** Diagnostics raised while mapping one document, for the caller's log. */
export interface MappingWarning {
  readonly documentPath: string;
  readonly field: string;
  readonly detail: string;
}

export interface MapOptions {
  /** Collects non-fatal surprises (unknown enum values) instead of swallowing them. */
  readonly onWarning?: ((warning: MappingWarning) => void) | undefined;
}

/**
 * Maps one decoded `users/{uid}` document onto the domain model.
 *
 * `documentId` is authoritative for `uid`: firestore.rules requires
 * `request.resource.data.uid == request.auth.uid` at creation, so the stored
 * field and the document id always agree, and trusting the id avoids a
 * self-referential field.
 */
export function mapUser(
  documentId: string,
  fields: RawFields,
  documentPath: string,
  options: MapOptions = {},
): User {
  const warn = options.onWarning ?? ((): void => undefined);
  const onUnknown = (field: string) => (actual: string): void => {
    warn({ documentPath, field, detail: `unknown value "${actual}"; read with the documented default` });
  };

  const role: UserRole = readUserRole(fields, onUnknown('role'));
  const status: UserStatus = readUserStatus(fields, onUnknown('status'));

  // `lastOrderStatus` legitimately holds the EMPTY STRING in production data
  // (A8 proposedSummary.lastOrderStatus === ""), which means "never ordered".
  // An explicit null is equally possible. Both are preserved as-is.
  const lastOrderStatus = optionalString(fields, 'lastOrderStatus') as OrderStatus | '' | null;

  return Object.freeze({
    uid: documentId,
    // The stored `uid` is read when present but the document id wins; a
    // mismatch would mean corrupted data, not a valid alternative identity.
    name: stringOrDefault(fields, 'name', ''),
    employeeId: stringOrDefault(fields, 'employeeId', documentId),
    role,
    status,
    hasException: booleanOrFalse(fields, 'hasException'),
    lastOrderId: optionalString(fields, 'lastOrderId'),
    lastOrderDate: optionalTimestamp(fields, 'lastOrderDate'),
    lastOrderMonthYear: stringOrDefault(fields, 'lastOrderMonthYear', ''),
    lastOrderStatus,
    lastOrderIsException: booleanOrFalse(fields, 'lastOrderIsException'),
  });
}

/**
 * Builds the `users/{uid}` payload for a NEW profile.
 *
 * This is the only user write implemented in Stage 5B, and it exists because
 * firestore.rules constrains creation tightly: `role` and `status` are FORCED to
 * `employee` / `pending` and `hasException` to `false`, and the caller cannot
 * choose any of them. The function therefore takes no role/status argument -
 * the operation "register a new employee" simply cannot be expressed with a
 * different role.
 */
export function mapNewUserProfile(user: {
  readonly uid: string;
  readonly name: string;
  readonly employeeId: string;
}): Record<string, unknown> {
  return {
    uid: user.uid,
    name: user.name,
    employeeId: user.employeeId,
    // Fixed by firestore.rules (lines 43-46). Not configurable by design.
    role: 'employee',
    status: 'pending',
    hasException: false,
  };
}

/**
 * Builds a masked administrative profile update.
 *
 * Only the fields an administrator is allowed to change are included, and the
 * caller must pass `updateMaskPaths` matching them, because an unmasked REST
 * update would REPLACE the whole document and erase `lastOrder*` (Stage 5A C5).
 */
export function mapUserAdministrativeUpdate(changes: {
  readonly name?: string | undefined;
  readonly status?: UserStatus | undefined;
  readonly hasException?: boolean | undefined;
}): { readonly data: Record<string, unknown>; readonly maskPaths: readonly string[] } {
  const data: Record<string, unknown> = {};
  const maskPaths: string[] = [];

  if (changes.name !== undefined) {
    data['name'] = changes.name;
    maskPaths.push('name');
  }
  if (changes.status !== undefined) {
    data['status'] = changes.status;
    maskPaths.push('status');
  }
  if (changes.hasException !== undefined) {
    data['hasException'] = changes.hasException;
    maskPaths.push('hasException');
  }

  if (maskPaths.length === 0) {
    throw new Error('mapUserAdministrativeUpdate requires at least one field to change');
  }
  return { data, maskPaths: Object.freeze(maskPaths) };
}

/** Reads the document id out of a `users/<uid>` relative path. */
export function userIdFromPath(relativePath: string): string {
  const parts = relativePath.split('/');
  if (parts.length !== 2 || parts[0] !== 'users') {
    throw new Error(`not a users path: ${relativePath}`);
  }
  return parts[1] ?? '';
}

export { requireString };