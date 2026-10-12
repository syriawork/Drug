/**
 * Stage 5B - closed value sets of the domain.
 *
 * These mirror the EXISTING persisted Firestore values and the Android sources
 * (A1 rules / A2 AdminOrderProcessor). They are string union types on purpose:
 *
 *  - a TypeScript `enum` would compile to a runtime object and reject the plain
 *    strings that Firestore actually stores, so every read would need a cast;
 *  - the values must stay byte-identical to what is persisted, because
 *    `firestore.rules` compares them with `==` and is CASE-SENSITIVE.
 *
 * WHY THIS FILE EXISTS INSTEAD OF `services/firestore-codec.ts`:
 * Stage 3 ships an architecture guard asserting that the Firestore transport
 * files contain no role/status literals at all, because a role literal in the
 * transport would be one step away from client-side authorization. Keeping the
 * vocabulary in `domain/` satisfies that guard honestly rather than by renaming
 * a string in a comment, and it puts the vocabulary where it belongs: it is
 * domain knowledge, not wire-format knowledge.
 *
 * No normalisation happens on write. A value already stored in a legacy form is
 * mapped in `repositories/firestore/mappers/` and surfaced as a documented
 * unknown, never silently rewritten.
 */

/** `users/{uid}.role` - the authority is the admin check in firestore.rules (A1 line 20). */
export type UserRole = 'admin' | 'assistant' | 'employee';

/** `users/{uid}.status` - the authority is the approval check in firestore.rules (A1). */
export type UserStatus = 'pending' | 'approved' | 'rejected';

/**
 * `orders/{id}.status` (and `users/{uid}.lastOrderStatus`).
 *
 * `lastOrderStatus` has one extra legal value in practice: the EMPTY STRING.
 * Real production data uses it to mean "this user has never ordered"
 * (migration/audit_report.json -> proposedSummary.lastOrderStatus = "").
 * A2 checks `lastOrderStatus == "pending"` and `== "rejected"`, so the empty
 * string is semantically "no record" and must NOT collapse to a status.
 */
export type OrderStatus = 'pending' | 'accepted' | 'rejected';

/** The literal stored by production data when a user has no previous order. */
export type EmptyOrderStatus = '';

/** `order_requests/{id}.status` (A2 markProcessed / markFailed). */
export type OrderRequestStatus = 'pending' | 'processed' | 'failed';

/** `stock_logs/{id}.type` - A4 only ever writes these two values. */
export type StockMovementType = 'inward' | 'outward';

/** Every value a closed set above is allowed to contain. */
export const USER_ROLES: readonly UserRole[] = Object.freeze(['admin', 'assistant', 'employee']);
export const USER_STATUSES: readonly UserStatus[] = Object.freeze(['pending', 'approved', 'rejected']);
export const ORDER_STATUSES: readonly OrderStatus[] = Object.freeze(['pending', 'accepted', 'rejected']);
export const ORDER_REQUEST_STATUSES: readonly OrderRequestStatus[] = Object.freeze(['pending', 'processed', 'failed']);
export const STOCK_MOVEMENT_TYPES: readonly StockMovementType[] = Object.freeze(['inward', 'outward']);

/** True when `value` is one of the known `UserRole` strings. */
export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

/** True when `value` is one of the known `UserStatus` strings. */
export function isUserStatus(value: string): value is UserStatus {
  return (USER_STATUSES as readonly string[]).includes(value);
}

/** True when `value` is one of the known `OrderStatus` strings. */
export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

/** True when `value` is one of the known `OrderRequestStatus` strings. */
export function isOrderRequestStatus(value: string): value is OrderRequestStatus {
  return (ORDER_REQUEST_STATUSES as readonly string[]).includes(value);
}

/** True when `value` is one of the known `StockMovementType` strings. */
export function isStockMovementType(value: string): value is StockMovementType {
  return (STOCK_MOVEMENT_TYPES as readonly string[]).includes(value);
}