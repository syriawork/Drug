/**
 * Stage 5B - Domain models (PURE TYPES ONLY).
 *
 * This module has no Electron import, no Firestore import, no I/O and no runtime
 * side effect, and it knows NOTHING about the wire format (`stringValue`,
 * `integerValue`, `mapValue`, `arrayValue`, `timestampValue`, `updateMask`,
 * document paths).
 *
 * The wire format lives in `repositories/firestore/mappers/` and the transport
 * in `services/firestore-rest.ts`; both depend on this module, never the other
 * way round (docs/domain-data-architecture.md Â§9.2).
 *
 * Every field below is justified by an authoritative source: the Android
 * sources (A2-A6) or real production data (A8/A9). No speculative field was
 * added and no field was renamed away from what Firestore persists.
 */

import type { FirestoreTimestamp } from '../services/firestore-codec';
import type {
  OrderRequestStatus,
  OrderStatus,
  StockMovementType,
  UserRole,
  UserStatus,
} from './values';

/**
 * The closed value sets are re-exported so every module can import the domain
 * language from ONE place (`domain/`), while the definitions themselves stay
 * next to the codec guards that produced them.
 */
export type {
  OrderRequestStatus,
  OrderStatus,
  StockMovementType,
  UserRole,
  UserStatus,
};

/**
 * A domain timestamp.
 *
 * Stage 5A made `FirestoreTimestamp` a first-class decoded type precisely so a
 * timestamp never degrades into a string or a lossy `Date`. The domain re-exports
 * it under a neutral name so no module outside the transport layer has to know
 * the type comes from the codec.
 *
 * `toDate()` is an explicit millisecond conversion. Prefer keeping the
 * `FirestoreTimestamp`: a Firestore `timestampValue` may carry nanosecond
 * precision that `Date` silently truncates.
 */
export type DomainTimestamp = FirestoreTimestamp;

/** A line of an order or of an order request. */
export interface OrderItem {
  readonly medicineId: string;
  /** Snapshot of the name at write time; firestore.rules never validates it. */
  readonly medicineName: string;
  readonly quantity: number;
}

/** `users/{uid}` - profile fields. Authority: firestore.rules + A6. */
export interface UserProfile {
  /** Document id == Firebase Auth UID. */
  readonly uid: string;
  readonly name: string;
  /** Frozen: firestore.rules forbids an owner from changing employeeId. */
  readonly employeeId: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  /**
   * Single-order exception. firestore.rules requires it at creation time, but
   * real production documents may omit it (A9), so it is read with a documented
   * `false` default rather than assumed.
   */
  readonly hasException: boolean;
}

/**
 * The denormalised "last order" summary on `users/{uid}`.
 *
 * Not accidental duplication: the Android processing engine (A2) cannot run a
 * query inside `runTransaction()` on the Firebase Spark plan, so this summary IS
 * the eligibility source of truth. Reads must use it instead of querying the
 * `orders` collection.
 */
export interface UserOrderSummary {
  readonly lastOrderId: string | null;
  readonly lastOrderDate: DomainTimestamp | null;
  /**
   * `MM-yyyy`. May be persisted with Arabic-Indic digits (D1). The RAW value is
   * preserved here; normalisation is an explicit, separate step (see
   * `month-year.ts`). This field is never rewritten on write.
   */
  readonly lastOrderMonthYear: string;
  /**
   * `''` is a legal, production-observed value meaning "this user has never
   * ordered" (A8 proposedSummary). It is preserved as-is.
   */
  readonly lastOrderStatus: OrderStatus | '' | null;
  readonly lastOrderIsException: boolean;
}

export type User = UserProfile & UserOrderSummary;

/** `medicines/{id}` */
export interface Medicine {
  readonly id: string;
  readonly name: string;
  /** Upper bound of a SINGLE order (A2 line 310). Not the stock. */
  readonly maxQuantity: number;
  /** Current balance. A2 decrements it at REQUEST time, not at accept time. */
  readonly stock: number;
  /** Totals for the inventory report (A4 only; A2 never reads it). */
  readonly totalInward: number;
  readonly totalOutward: number;
}

/**
 * `orders/{id}`
 *
 * NOTE a deliberate inconsistency that must be preserved, not "fixed":
 * `stock` is decremented when an order is REQUESTED while `totalOutward` is only
 * incremented when it is ACCEPTED, so `stock !== totalInward - totalOutward`.
 * The Android inventory report therefore derives inward/outward totals from
 * `stock_logs`, NOT from these counters (C8).
 */
export interface Order {
  readonly id: string;
  /** Ownership field. firestore.rules line 77 scopes reads by it. */
  readonly userId: string;
  readonly userName: string;
  readonly items: readonly OrderItem[];
  readonly date: DomainTimestamp;
  /**
   * `MM-yyyy`, ASCII per A2 (SimpleDateFormat Locale.US). Legacy documents may
   * hold Arabic-Indic digits (D1); the raw value is preserved as-is.
   */
  readonly monthYear: string;
  readonly status: OrderStatus;
  /** Absent in 8 of 26 real production orders (A8) => read as `false`. */
  readonly isExceptionOrder: boolean;
  /** Back-reference to `order_requests/{id}`. */
  readonly requestId: string | null;
}

/** `order_requests/{id}` */
export interface OrderRequest {
  /** Client-generated id (A5 uses a UUID; see repositories/firestore/document-id.ts). */
  readonly id: string;
  /** Ownership field (firestore.rules line 92). */
  readonly uid: string;
  readonly items: readonly OrderItem[];
  readonly status: OrderRequestStatus;
  /**
   * Authoritative request time. Stage 5A: a FUTURE Windows-created request
   * writes this as a Firestore SERVER timestamp (REQUEST_TIME). Historical
   * client-generated timestamps are read as-is and are NOT reinterpreted (D4).
   */
  readonly requestDate: DomainTimestamp;
  // Written by the processing step (A2); never written at creation time.
  readonly orderId: string | null;
  readonly error: string | null;
  /** The admin UID, or the legacy literal "backend-v1". */
  readonly processedBy: string | null;
  readonly processedAt: DomainTimestamp | null;
}

/** `stock_logs/{id}` */
export interface StockLog {
  readonly id: string;
  readonly medicineId: string;
  readonly medicineName: string;
  /** Always a positive magnitude (A4 line 595 uses Math.abs). */
  readonly quantity: number;
  readonly type: StockMovementType;
  readonly date: DomainTimestamp;
  /**
   * LOADS-BEARING RENAME. The Firestore field is `userName`, but historical
   * writers use it for different values: A2 stores the recipient's name, Android
   * may store descriptive text, and inbound receipts store the authenticated
   * administrator's profile name. It is exposed as `label` because it is not a
   * globally reliable username.
   */
  readonly label: string;
  /**
   * CONFLICTING SEMANTICS (D3): A2 writes the employee receiving an order,
   * while inbound receipts write the administrator recording them. Exposed as
   * "who performed the movement".
   */
  readonly actorUid: string | null;
  /** Present only when A2 wrote the entry. */
  readonly requestId: string | null;
  /** Present only when A2 wrote the entry. */
  readonly orderId: string | null;
}

/**
 * `settings/app` (D9: the single fixed document id; NOT `settings/schedule`).
 *
 * All six fields are written by the Android settings screen (A4). Two of them are
 * DEAD in the current Android model and are documented as such rather than
 * hidden: `maxDailyOrders` and `assistantId` are never read by A2 or A5.
 */
export interface AppSettings {
  readonly minDaysBetweenOrders: number;
  /** Dead: the Android client explicitly commented the check out (A5). */
  readonly maxDailyOrders: number;
  readonly allowFridayOrders: boolean;
  /** `HH:mm` */
  readonly startTime: string;
  /** `HH:mm` */
  readonly endTime: string;
  /** Dead in the Android model: display/administrative only. */
  readonly assistantId: string;
}