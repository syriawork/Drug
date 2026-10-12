/**
 * Stage 5B - the domain barrel.
 *
 * Everything a caller needs to speak the domain language, with no Firestore and
 * no Electron in sight. `repositories/` and above may import from here; this
 * module imports nothing from them.
 */

export type {
  AppSettings,
  DomainTimestamp,
  Medicine,
  Order,
  OrderItem,
  OrderRequest,
  StockLog,
  User,
  UserOrderSummary,
  UserProfile,
} from './models';

export type {
  EmptyOrderStatus,
  OrderRequestStatus,
  OrderStatus,
  StockMovementType,
  UserRole,
  UserStatus,
} from './values';

export {
  ORDER_REQUEST_STATUSES,
  ORDER_STATUSES,
  STOCK_MOVEMENT_TYPES,
  USER_ROLES,
  USER_STATUSES,
  isOrderRequestStatus,
  isOrderStatus,
  isStockMovementType,
  isUserRole,
  isUserStatus,
} from './values';

export { formatMonthYear, isMonthYearLike, isSameMonthYear, normalizeMonthYear } from './month-year';

// Stage 6 - the pure processing rules and the result model.
export { aggregateItems, MAX_RAW_ITEMS, parseTimeToMinutes } from './order-rules';
export type { AggregateResult, NormalizedItem } from './order-rules';
export {
  BUSINESS_TIME_ZONE,
  DAY_OF_WEEK_FRIDAY,
  DEFAULT_SCHEDULE_SETTINGS,
  getDamascusCalendarParts,
  getDamascusMonthYear,
  validateScheduleAndTime,
} from './schedule';
export type { DamascusCalendarParts, ScheduleSettings } from './schedule';
export { validateUserEligibility } from './eligibility';
export {
  isAlreadyProcessed,
  isBusinessValidationFailure,
  isRawStatusPending,
  isSuccess,
  RAW_STATUS_ABSENT,
  RAW_STATUS_PENDING,
} from './results';
export type {
  ProcessingAlreadyProcessed,
  ProcessingBusinessValidationFailure,
  ProcessingResult,
  ProcessingSuccess,
} from './results';

export { DomainError, InvalidInputError, MalformedDataError } from './errors';
export type { DomainErrorKind } from './errors';