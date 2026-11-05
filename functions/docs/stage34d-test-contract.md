# Stage 34D submitOrder test contract

This document records the temporary contract used by the Stage 34D emulator
integration suite. It is a test aid only and does not replace any original
Stage 33L/33N artifact that is not present in this repository.

## Confirmed implementation behavior

- The callable is exported as `submitOrder` from [functions/src/index.ts](../src/index.ts).
- The callable requires an authenticated caller and then authorizes only
  `status === 'approved'` from the `users/{uid}` profile.
- The payload is validated to accept only `idempotencyKey` and `items` at the
  top level.
- Raw line count is capped at five before aggregation.
- Duplicate medicines are merged by `medicineId`, and the aggregated items are
  sorted deterministically by medicine ID.
- Inventory validation requires `name`, `maxQuantity`, `stock`,
  `reservedStock`, `totalInward`, and `totalOutward` to be present and valid.
- Reservation arithmetic checks the invariant `stockAfter + reservedStockAfter === onHandBefore`.
- The order document writes `status: 'pending'`, `isExceptionOrder: false`, and
  a generated `orderId` tied to the authenticated user and idempotency key.
- The user summary is updated with: `lastOrderId`, `lastOrderDate`,
  `lastOrderMonthYear`, `lastOrderStatus`, `pendingOrder`, and
  `pendingOrderId`.
- The stock movement row keeps `stock_logs.line = medicineId` for this stage.
- Idempotency ownership is bound to `users/{uid}` and the idempotency key hash.

## Temporary assumptions approved for testing

These values are treated as the working contract for the emulator suite while the
original Stage 33L/33N repository source remains unavailable:

- `stock_logs.line = medicineId`
- `lastOrderId`, `lastOrderDate`, `lastOrderMonthYear`, `lastOrderStatus`,
  `pendingOrder`, and `pendingOrderId` are the expected user summary fields
- `settings/app` fallback values are `allowFridayOrders: false`,
  `startTime: '06:00'`, `endTime: '10:00'`, `minDaysBetweenOrders: 15`
- The server clock is the local Functions emulator clock; schedule tests are
  therefore written to skip when the real local time does not satisfy the rule
  being asserted.

## Original Stage 33L/33N requirements unavailable in this repository

The repository does not contain the original Stage 33L or Stage 33N design
artifact. The suite therefore relies on the current Electron domain-layer logic
as the operational reference, while explicitly avoiding any invented contract
requirements that are not supported by implementation or repo evidence.
