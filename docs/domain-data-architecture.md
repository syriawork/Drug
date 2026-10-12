# Ù…Ø¹Ù…Ø§Ø±ÙŠØ© Ø§Ù„Ù…Ø¬Ø§Ù„ ÙˆØ§Ù„Ø¨ÙŠØ§Ù†Ø§Øª â€” Ø§Ù„Ù…Ø±Ø­Ù„Ø© Ø§Ù„Ø±Ø§Ø¨Ø¹Ø© (ØªØµÙ…ÙŠÙ…) ÙˆØ§Ù„Ù…Ø±Ø­Ù„Ø© Ø§Ù„Ø®Ø§Ù…Ø³Ø© B (ØªÙ†ÙÙŠØ°)

> **Â§0â€“Â§14 ØªØµÙ…ÙŠÙ… Stage 4 ÙÙ‚Ø· (ØªØ¯Ù‚ÙŠÙ‚).** **Â§15 Ù‡Ùˆ ØªÙ†ÙÙŠØ° Stage 5B Ø§Ù„ÙØ¹Ù„ÙŠ**: Ù†Ù…Ø§Ø°Ø¬ Ø§Ù„Ù…Ø¬Ø§Ù„ØŒ Ø·Ø¨Ù‚Ø© Ø§Ù„ØªØ­ÙˆÙŠÙ„ØŒ Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§ØªØŒ ÙˆØ­Ø¯ÙˆØ¯ Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø§Øª.
> Ø§Ù„Ù‡Ø¯Ù: Ø·Ø¨Ù‚Ø© Ù…Ø¬Ø§Ù„/Ø¨ÙŠØ§Ù†Ø§Øª Ù„ØªØ·Ø¨ÙŠÙ‚ ÙˆÙŠÙ†Ø¯ÙˆØ² **Ù…ØªÙˆØ§ÙÙ‚Ø© Ù…Ø¹ Ù†Ù…ÙˆØ°Ø¬ Ø¨ÙŠØ§Ù†Ø§Øª Ù…Ø´Ø±ÙˆØ¹ Ø§Ù„Ø£Ù†Ø¯Ø±ÙˆÙŠØ¯ ÙˆÙ…Ù†Ø·Ù‚Ù‡ Ø§Ù„Ù‚Ø§Ø¦Ù…**ØŒ Ù…Ø¹ Ø¨Ù‚Ø§Ø¡ **Ù‚ÙˆØ§Ø¹Ø¯ Ø£Ù…Ø§Ù† Firestore Ù‡ÙŠ Ù…ØµØ¯Ø± Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„ÙˆØ­ÙŠØ¯**.

---

## 0. Ø§Ù„Ù†Ø·Ø§Ù‚ ÙˆØ§Ù„Ù…ØµØ§Ø¯Ø± Ø§Ù„Ù…ÙÙ„Ø²ÙÙ…Ø©

### 0.1 Ø§Ù„Ù…ØµØ§Ø¯Ø± Ø§Ù„Ù…ÙÙ„Ø²ÙÙ…Ø© Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…Ø© ÙÙŠ Ù‡Ø°Ø§ Ø§Ù„ØªØ¯Ù‚ÙŠÙ‚

| Ø§Ù„Ø±Ù…Ø² | Artifact | Ø§Ù„Ø¯ÙˆØ± |
|---|---|---|
| **A1** | `mobile/drug/firestore.rules` | **Ø³Ù„Ø·Ø© Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„Ù‚ØµÙˆÙ‰.** Ù„Ø§ ØªÙØ¹Ø¯ÙŽÙ‘Ù„. Ø¨ØµÙ…Ø© SHA-256 `1FA3C607â€¦DC63B` |
| **A2** | `AdminOrderProcessor.kt` (348 Ø³Ø·Ø±Ù‹Ø§) | **Ø³Ù„Ø·Ø© Ø¯Ù„Ø§Ù„Ø§Øª Ù…Ø¹Ø§Ù„Ø¬Ø© Ø§Ù„Ø·Ù„Ø¨.** Ù…ÙØ®ØªØ¨ÙŽØ± Ø¨Ù€ 17 Ø­Ø§Ù„Ø© Robolectric |
| **A3** | `Models.kt` | Ù†Ù…ÙˆØ°Ø¬ Kotlin Ø§Ù„Ø³Ø·Ø­ÙŠ (Ù†Ø§Ù‚Øµ â€” Ø§Ù†Ø¸Ø± C11) |
| **A4** | `AdminActivity.kt` (935 Ø³Ø·Ø±Ù‹Ø§) | Ø¥Ø¬Ø±Ø§Ø¡Ø§Øª Ø§Ù„Ø¥Ø¯Ø§Ø±Ø©. **ØºÙŠØ± Ù…ÙÙØ¹ÙŽÙ‘Ù„ ÙØ¹Ù„ÙŠÙ‹Ø§** â€” Ø§Ù†Ø¸Ø± C1 |
| **A5** | `MedicineOrderActivity.kt` | Ù…Ø³Ø§Ø± Ø§Ù„Ù…ÙˆØ¸Ù + Ø£Ù‡Ù„ÙŠØ© Ø§Ù„Ø¹Ù…ÙŠÙ„ |
| **A6** | `MainActivity.kt` | Ø¹Ø±Ø¶ Ø§Ù„Ø­Ø§Ù„Ø© + ÙØ­Øµ Ø£Ø¯ÙˆØ§Ø± |
| **A7** | `functions/src/index.ts` | Cloud Function **Ù‚Ø¯ÙŠÙ…/ØºÙŠØ± Ù…Ù†Ø´ÙˆØ±** â€” Ø§Ù†Ø¸Ø± C2 |
| **A8** | `migration/audit_report.json` | **Ø¨ÙŠØ§Ù†Ø§Øª Ø¥Ù†ØªØ§Ø¬ÙŠØ© Ø­Ù‚ÙŠÙ‚ÙŠØ©**: 26 Ø·Ù„Ø¨Ù‹Ø§ØŒ 5 Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ†ØŒ 8 Ø´ÙˆØ§Ù‡Ø¯ |
| **A9** | `migration/users_backup_*.json` | Ù„Ù‚Ø·Ø© Ø®Ø§Ù… Ù„Ù…Ø³ØªÙ†Ø¯Ø§Øª `users` Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠØ© |
| **A10** | `electron/services/firestore-rest.ts` | Ø·Ø¨Ù‚Ø© Ø§Ù„Ù†Ù‚Ù„ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© (Stage 3) |
| **A11** | `src/shared/ipc-contract.d.ts` | Ø¹Ù‚Ø¯ Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© Ø§Ù„Ø­Ø§Ù„ÙŠ |

### 0.2 Ù…Ø¹Ø§ÙŠØ±Ø© Sources of Truth: Ø£ÙŠÙÙ‘ Ù…ØµØ¯Ø±Ù ÙÙŠ Ø£ÙŠÙ‘ Ø¬Ø§Ù†Ø¨ØŸ

| Ø§Ù„Ø¬Ø§Ù†Ø¨ | Ø§Ù„Ø³Ù„Ø·Ø© | Ø§Ù„Ø³Ø¨Ø¨ |
|---|---|---|
| Ù…Ù† ÙŠÙ…Ù„Ùƒ Ø­Ù‚ Ø§Ù„ÙˆØµÙˆÙ„ Ù„Ø£ÙŠ Ù…Ø³ØªÙ†Ø¯ | **A1** | Ù‡Ùˆ Ù…Ø§ ÙŠÙÙ†ÙÙŽÙ‘Ø° Ø¹Ù„Ù‰ Ø§Ù„Ø®Ø§Ø¯Ù…Ø› Ù„Ø§ ÙŠÙ…ÙƒÙ† Ù„Ø¹Ù…ÙŠÙ„ Ø£Ù† ÙŠÙˆØ³Ù‘Ø¹Ù‡ |
| Ù…Ø¹Ù†Ù‰ `role = "admin"` | **A1** | A1 Ù‡Ùˆ Ù…Ù† ÙŠÙ‚Ø±Ø£ Ø§Ù„Ø­Ù‚Ù„ ÙˆÙŠÙ‚Ø±Ù‘Ø± |
| ØªØ±ØªÙŠØ¨ Ø®Ø·ÙˆØ§Øª Ù…Ø¹Ø§Ù„Ø¬Ø© Ø§Ù„Ø·Ù„Ø¨ | **A2** | Ù…Ø¹Ø§Ù„Ø¬ Ù…ÙØ®ØªØ¨ÙŽØ±ØŒ ÙˆÙ…Ø°ÙƒÙˆØ± ÙÙŠ `migration/README.md` ÙƒÙ…Ø­Ø±Ùƒ ØªÙØ§ÙˆØ¶ |
| ØµÙŠØºØ© `monthYear` Ø§Ù„Ù…Ø¹ØªÙ…Ø¯Ø© | **A2** (`Locale.US` â‡’ ASCII) | Ø§Ù„Ø®ÙŠØ§Ø± Ø§Ù„Ù…ØªÙ‘Ø³Ù‚ Ù…Ø¹ A7 â€” Ù„ÙƒÙ† Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© ØªØ®Ø§Ù„ÙÙ‡ (D1) |
| Ø§Ù„Ù…Ù†Ø·Ù‚Ø© Ø§Ù„Ø²Ù…Ù†ÙŠØ© Ù„Ù„Ø£Ø¹Ù…Ø§Ù„ | **A2 + A7** (Ø§ØªÙØ§Ù‚ Ø¹Ù„Ù‰ `Asia/Damascus`) | ÙˆØ§Ø¬Ù‡Ø© Ø§Ù„Ù…ÙˆØ¸Ù ØªØ³ØªØ®Ø¯Ù… Ù…Ù†Ø·Ù‚Ø© Ø§Ù„Ø¬Ù‡Ø§Ø² â‡’ Ø§Ø³ØªØ´Ø§Ø±ÙŠØ© ÙÙ‚Ø· (D2) |
| Ø´ÙƒÙ„ Ù…Ø³ØªÙ†Ø¯ `settings` | **A4** | ÙŠå†™å‡º Ø§Ù„Ø­Ù‚ÙˆÙ„ Ø§Ù„Ø³ØªØ©Ø› A2 ÙŠÙ‚Ø±Ø£ Ø£Ø±Ø¨Ø¹Ø© |
| Ø§Ù„Ø´ÙƒÙ„ Ø§Ù„ÙØ¹Ù„ÙŠ Ù„Ù„Ø¨ÙŠØ§Ù†Ø§Øª | **A8 + A9** | A3 Ù†Ø§Ù‚Øµ ÙˆÙ„Ø§ ÙŠØºØ·ÙŠ `lastOrder*` |

---

## 1. Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹Ø§Øª Ø§Ù„Ù…ÙØ­Ù„ÙŽÙ‘Ù„Ø©

| Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹Ø© | Ù…ÙØ¹Ø±Ù‘Ù Ø§Ù„Ù…Ø³ØªÙ†Ø¯ | Ù‚Ø±Ø§Ø¡Ø© A1 | ÙƒØªØ§Ø¨Ø© A1 |
|---|---|---|---|
| `users` | `{uid}` = Firebase Auth UID | Ø§Ù„Ù…Ø§Ù„Ùƒ Ø£Ùˆ `isAdmin()` | `isAdmin()` ÙƒØ§Ù…Ù„ Â· Ø§Ù„Ù…Ø§Ù„Ùƒ: `name`,`status` ÙÙ‚Ø· |
| `medicines` | `{autoId}` | Ø£ÙŠ Ù…Ø³ØªØ®Ø¯Ù… Ù…ÙØµØ§Ø¯ÙŽÙ‚ | `isAdmin()` ÙÙ‚Ø· |
| `orders` | `{autoId}` | `isAdmin()` Ø£Ùˆ `resource.data.userId == auth.uid` | `isAdmin()` ÙÙ‚Ø· |
| `order_requests` | **UUID Ù…Ù† Ø§Ù„Ø¹Ù…ÙŠÙ„** | `isAdmin()` Ø£Ùˆ `resource.data.uid == auth.uid` | Ø¥Ù†Ø´Ø§Ø¡: `isApproved()` + `hasOnly` Â· ØªØ¹Ø¯ÙŠÙ„/Ø­Ø°Ù: `isAdmin()` |
| `stock_logs` | `{autoId}` | `isAdmin()` ÙÙ‚Ø· | `isAdmin()` ÙÙ‚Ø· |
| `settings` | **`app` (Ù…ÙØ±Ø¯ Ø«Ø§Ø¨Øª)** | Ø£ÙŠ Ù…Ø³ØªØ®Ø¯Ù… Ù…ÙØµØ§Ø¯ÙŽÙ‚ | `isAdmin()` ÙÙ‚Ø· |

> âš ï¸ Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª Stage 3 Ø§Ø³ØªØ®Ø¯Ù…Øª `settings/schedule` ÙƒÙ€ fixture. **Ø§Ù„Ù…Ø¹Ø±Ù‘Ù Ø§Ù„Ø¥Ù†ØªØ§Ø¬ÙŠ Ø§Ù„Ù…Ø¹ØªÙ…Ø¯ Ù‡Ùˆ `settings/app`** (A5:84ØŒ A2:246). A1 ØªØ³Ù…Ø­ Ø¨Ø£ÙŠ `docId`ØŒ Ù„ÙƒÙ† Ø·Ø¨Ù‚Ø© ÙˆÙŠÙ†Ø¯ÙˆØ² ØªØªØ¹Ø§Ù…Ù„ Ù…Ø¹ `settings/app` Ø­ØµØ±ÙŠÙ‹Ø§ (D9).


---

## 2. Ù†Ù…Ø§Ø°Ø¬ Ø§Ù„Ù…Ø¬Ø§Ù„ (Domain Models)

> **Ø£Ù†ÙˆØ§Ø¹ ÙÙ‚Ø·** â€” Ù„Ø§ Ù…Ù†Ø·Ù‚ØŒ Ù„Ø§ I/OØŒ Ù„Ø§ Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¹Ù„Ù‰ Electron Ø£Ùˆ Firestore. ØªÙÙƒØªØ¨ ÙÙŠ `electron/domain/` ÙˆØªÙØ®ØªØ¨ÙŽØ± Ø¨Ù€ `node --test` Ù…Ø¨Ø§Ø´Ø±Ø©. ØªÙØµØ¯ÙŽÙ‘Ø± Ù†Ø³Ø®Ø© Ø¢Ù…Ù†Ø© Ù„Ù„ÙˆØ§Ø¬Ù‡Ø© Ø¹Ø¨Ø± `src/shared/`.

### 2.1 Ø§Ù„Ù‚ÙŠÙ… Ø§Ù„Ù…ÙØºÙ„Ù‚Ø© â€” Ù…Ø·Ø§Ø¨Ù‚Ø© Ø­Ø±ÙÙŠÙ‹Ø§ Ù„Ù€ A1/A2

```ts
export type UserRole            = 'admin' | 'assistant' | 'employee';
export type UserStatus          = 'pending' | 'approved' | 'rejected';
export type OrderStatus         = 'pending' | 'accepted' | 'rejected';
export type OrderRequestStatus  = 'pending' | 'processed' | 'failed';
export type StockMovementType   = 'inward' | 'outward';
```

> âš ï¸ **Ø­Ø³Ø§Ø³ÙŠØ© Ø­Ø§Ù„Ø© Ø§Ù„Ø£Ø­Ø±Ù.** A1 ÙŠÙ‚Ø§Ø±Ù† `== 'admin'` Ùˆ `== 'approved'` Ø¨Ø£Ø­Ø±Ù ØµØºÙŠØ±Ø© Ø­ØµØ±Ù‹Ø§Ø› `Admin` Ø£Ùˆ `Approved` ØªÙØ¹Ø§Ù…ÙŽÙ„ ÙƒÙ…Ø³ØªØ®Ø¯Ù… Ø¹Ø§Ø¯ÙŠ. Ù„Ø§ ØªÙØ·Ø¨Ù‘Ø¹ Ø§Ù„Ø­Ø§Ù„Ø© Ø¹Ù†Ø¯ Ø§Ù„ÙƒØªØ§Ø¨Ø© Ø¥Ø·Ù„Ø§Ù‚Ù‹Ø§Ø› Ø·Ø¨Ù‘Ø¹Ù‡Ø§ Ø¹Ù†Ø¯ Ø§Ù„Ù‚Ø±Ø§Ø¡Ø© Ù„Ù„ØªØ­Ø°ÙŠØ± ÙÙ‚Ø·.

### 2.2 `User`

```ts
export interface UserProfile {
  readonly uid: string;            // Firestore doc id = Firebase Auth UID
  readonly name: string;
  readonly employeeId: string;     // Ù…Ø¬Ù…Ù‘Ø¯: A1:54 ÙŠÙ…Ù†Ø¹ ØªØºÙŠÙŠØ±Ù‡
  readonly role: UserRole;         // Ù…ØµØ¯Ø± Ø§Ù„Ø­Ù‚ÙŠÙ‚Ø©: A1 Ø³Ø·Ø± 20
  readonly status: UserStatus;     // Ù…ØµØ¯Ø± Ø§Ù„Ø­Ù‚ÙŠÙ‚Ø©: A1 isApproved()
  readonly hasException: boolean;  // A1:46 ØªØ´ØªØ±Ø·Ù‡ Ø¹Ù†Ø¯ Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡Ø› Ù‚Ø¯ ØºØ§Ø¦Ø¨Ù‹Ø§ (D7)
}

/** Ø­Ù‚ÙˆÙ„ Ù…Ù„Ø®Ù‘Øµ Ø§Ù„Ù…ÙƒØ±Ù‘Ø±Ø©. Ù…ØµØ¯Ø± Ø§Ù„Ø­Ù‚ÙŠÙ‚Ø© Ù„Ù„Ø£Ù‡Ù„ÙŠØ© ÙÙŠ A2. */
export interface UserOrderSummary {
  readonly lastOrderId: string | null;
  readonly lastOrderDate: string | null;   // ISO-8601 Ù†ØµÙŠ ÙÙŠ ÙˆÙŠÙ†Ø¯ÙˆØ² (D4)
  readonly lastOrderMonthYear: string;     // Â«MM-yyyyÂ» â€” Ù‚Ø¯ ÙŠÙƒÙˆÙ† Ù‡Ù†Ø¯ÙŠÙ‹Ø§ Ø¹Ø±Ø¨ÙŠÙ‹Ø§ (D1)
  readonly lastOrderStatus: OrderStatus | '' | null;
  readonly lastOrderIsException: boolean;
}

export type User = UserProfile & UserOrderSummary;
```

> **Ù„Ù…Ø§Ø°Ø§ Ø§Ù„Ù…Ù„Ø®Ù‘Øµ Ø§Ù„Ù…ÙƒØ±Ù‘Ø±ØŸ** `migration/README.md` ÙŠØ´Ø±Ø­ Ø£Ù†Ù‡ Ù…ÙˆØ¬ÙˆØ¯ Ù„Ø£Ù† Ù…Ø­Ø±Ùƒ A2 **Ù„Ø§ ÙŠØ³ØªØ·ÙŠØ¹ ØªÙ†ÙÙŠØ° Ø§Ø³ØªØ¹Ù„Ø§Ù…Ø§Øª Ø¯Ø§Ø®Ù„ `runTransaction()`** Ø¹Ù„Ù‰ Ø®Ø·Ø© Spark. Ù…ØªØ·Ù„Ø¨ Ù…Ø¹Ù…Ø§Ø±ÙŠ Ù„Ø§ ØªÙƒØ±Ø§Ø± Ø¹Ø´ÙˆØ§Ø¦ÙŠ.
> **Ø§Ù„Ù†ØªÙŠØ¬Ø©:** Ù…ØµØ¯Ø± Ø§Ù„Ø­Ù‚ÙŠÙ‚Ø© Ù„Ù„Ø£Ù‡Ù„ÙŠØ© Ù‡Ùˆ `users/{uid}.lastOrder*`ØŒ **ÙˆÙ„ÙŠØ³** Ù…Ø¬Ù…ÙˆØ¹Ø© `orders`.

### 2.3 `Medicine`

```ts
export interface Medicine {
  readonly id: string;
  readonly name: string;
  readonly maxQuantity: number;    // Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ø¹Ù„Ù‰ ÙÙŠ Ø§Ù„Ø·Ù„Ø¨ Ø§Ù„ÙˆØ§Ø­Ø¯ (A2:310) â€” Ù„Ø§ Ø§Ù„Ø±ØµÙŠØ¯
  readonly stock: number;          // ÙŠÙØ®ØµÙ… Ø¹Ù†Ø¯ Ø§Ù„Ø·Ù„Ø¨ (A2) Ù„Ø§ Ø¹Ù†Ø¯ Ø§Ù„Ù‚Ø¨ÙˆÙ„
  readonly totalInward: number;    // Ù„Ø§ ÙŠÙ‚Ø±Ø£Ù‡ A2 Ø¥Ø·Ù„Ø§Ù‚Ù‹Ø§ â€” A4 ÙÙ‚Ø·
  readonly totalOutward: number;   // Ù„Ø§ ÙŠÙ‚Ø±Ø£Ù‡ A2 â€” A4 ÙÙ‚Ø· Ø¹Ù†Ø¯ status=accepted
}
```

> âš ï¸ **ØªØ¹Ø§Ø±Ø¶ Ø¯Ù„Ø§Ù„ÙŠ:** `stock` ÙŠÙØ®ØµÙ… Ø¹Ù†Ø¯ Ø§Ù„Ø·Ù„Ø¨ØŒ `totalOutward` ÙŠÙØ²Ø§Ø¯ Ø¹Ù†Ø¯ Ø§Ù„Ù‚Ø¨ÙˆÙ„. Ø¥Ø°Ù† **`stock â‰  totalInward âˆ’ totalOutward`** Ø¹Ù…Ø¯Ù‹Ø§. ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø¬Ø±Ø¯ ÙÙŠ A4 (`generateInventoryPdf`) ÙŠØ­Ø³Ø¨ Ø§Ù„ÙˆØ§Ø±Ø¯/Ø§Ù„ØµØ§Ø¯Ø± Ù…Ù† **`stock_logs`** Ù„Ø§ Ù…Ù† Ø¹Ø¯Ù‘Ø§Ø¯Ø§Øª Ø§Ù„Ø¯ÙˆØ§Ø¡ â€” ÙˆÙ‡Ø°Ø§ Ø§Ù„Ø³Ù„ÙˆÙƒ Ø§Ù„ØµØ­ÙŠØ­ Ø§Ù„ÙˆØ§Ø¬Ø¨ ØªÙƒØ±Ø§Ø±Ù‡ (C8).

### 2.4 `OrderItem` / `OrderRequestItem`

```ts
export interface OrderItem {
  readonly medicineId: string;
  readonly medicineName: string;  // Ù†Ø³Ø®Ø© Ø¹Ù†Ø¯ Ø§Ù„ÙƒØªØ§Ø¨Ø©Ø› A1 Ù„Ø§ ØªØªØ­Ù‚Ù‚ Ù…Ù†Ù‡Ø§
  readonly quantity: number;
}
```

> A1 ÙŠÙØ±Ø¶ Ø¹Ù„Ù‰ `order_requests.items` Ø§Ù„Ø´Ø±Ø· `items is list` ÙÙ‚Ø· â€” **Ù„Ø§ ÙŠØªØ­Ù‚Ù‚ Ù…Ù† Ù…Ø­ØªÙˆÙ‰ ÙƒÙ„ Ø¹Ù†ØµØ±**. ÙØ­Øµ `medicineId`/`quantity` ÙŠØªÙ… ÙÙŠ A2 Ø¨Ø¹Ø¯ Ø§Ù„Ù‚Ø±Ø§Ø¡Ø©. Ø·Ø¨Ù‚Ø© ÙˆÙŠÙ†Ø¯ÙˆØ² ØªØªØ­Ù‚Ù‚ Ù‚Ø¨Ù„ Ø§Ù„ÙƒØªØ§Ø¨Ø© (UX) Ù…Ø¹ Ø¨Ù‚Ø§Ø¡ A2 ÙƒØ³Ù„Ø·Ø© Ù†Ù‡Ø§Ø¦ÙŠØ©.

### 2.5 `Order`

```ts
export interface Order {
  readonly id: string;
  readonly userId: string;              // Ø­Ù‚Ù„ Ø§Ù„Ù…Ù„ÙƒÙŠØ©. A1:77
  readonly userName: string;
  readonly items: readonly OrderItem[];
  readonly date: string;                // ISO-8601
  readonly monthYear: string;           // Â«MM-yyyyÂ» â€” D1
  readonly status: OrderStatus;
  readonly isExceptionOrder: boolean;   // ØºØ§Ø¦Ø¨ ÙÙŠ 8 Ù…Ù† 26 Ø·Ù„Ø¨Ù‹Ø§ (A8) â‡’ false
  readonly requestId: string | null;    // Ø±Ø§Ø¨Ø· order_requests/{id}
}
```

### 2.6 `OrderRequest`

```ts
export interface OrderRequest {
  readonly id: string;              // UUID Ù…Ù† Ø§Ù„Ø¹Ù…ÙŠÙ„
  readonly uid: string;             // Ø­Ù‚Ù„ Ø§Ù„Ù…Ù„ÙƒÙŠØ©. A1:92 â€” D6
  readonly items: readonly OrderItem[];
  readonly status: OrderRequestStatus;
  readonly requestDate: string;     // ISO-8601. A2:212 ÙŠÙ‚Ø±Ø¤Ù‡ Ø¨Ù€ getTimestamp â€” D4
  // Ø­Ù‚ÙˆÙ„ ÙŠÙƒØªØ¨Ù‡Ø§ Ø§Ù„Ù…Ø¹Ø§Ù„Ø¬ A2 ÙˆÙ„Ø§ ÙŠÙˆÙ‚Ù‘Ø¹Ù‡Ø§ A1 Ø¹Ù„Ù‰ Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡:
  readonly orderId: string | null;
  readonly error: string | null;
  readonly processedBy: string | null;   // adminUid Ø£Ùˆ "backend-v1"
  readonly processedAt: string | null;
}
```

> ðŸ”’ **Ù‚ÙŠØ¯ A1 Ø§Ù„Ø­Ø§Ø³Ù… (Ø³Ø·Ø± 99):** `request.resource.data.keys().hasOnly(['uid','items','status','requestDate'])`
> Ø£ÙŠ ÙƒØªØ§Ø¨Ø© Ù…Ù† ÙˆÙŠÙ†Ø¯ÙˆØ² **ÙŠØ¬Ø¨ Ø£Ù„Ø§ ØªØ­ØªÙˆÙŠ Ø£ÙŠ Ù…ÙØªØ§Ø­ Ø¥Ø¶Ø§ÙÙŠ** â€” Ù„Ø§ `idempotencyKey`ØŒ Ù„Ø§ `clientTimestamp`ØŒ Ù„Ø§ `source`. Ù…Ø®Ø§Ù„ÙØ© ÙˆØ§Ø­Ø¯Ø© â‡’ `403`.

### 2.7 `StockLog`

```ts
export interface StockLog {
  readonly id: string;
  readonly medicineId: string;
  readonly medicineName: string;
  readonly quantity: number;        // Ù…Ø·Ù„Ù‚ Ù…ÙˆØ¬Ø¨ Ø¯Ø§Ø¦Ù…Ù‹Ø§ (A4:595 Math.abs)
  readonly type: StockMovementType;
  readonly date: string;            // ISO-8601
  /** âš ï¸ Ø­Ù‚Ù„ Ù…Ø­Ù…Ù‘Ù„ â€” Ù„ÙŠØ³ Ø§Ø³Ù… Ù…Ø³ØªØ®Ø¯Ù…. A2: Ø§Ø³Ù… Ø§Ù„Ù…ÙˆØ¸Ù Â· A4: Ù†Øµ ÙˆØµÙÙŠ Ø­Ø± */
  readonly label: string;
  readonly actorUid: string | null; // Ø¯Ù„Ø§Ù„ØªØ§Ù† Ù…ØªØ¹Ø§Ø±Ø¶ØªØ§Ù† â€” D3
  readonly requestId: string | null;   // A2 ÙÙ‚Ø·
  readonly orderId: string | null;     // A2 ÙÙ‚Ø·
}
```

### 2.8 `AppSettings`

```ts
export interface AppSettings {
  readonly minDaysBetweenOrders: number;   // A2:262 fallback = 15
  /** âš ï¸ Ù…ÙŠØª ÙˆØ¸ÙŠÙÙŠÙ‹Ø§: A5:232-233 Ø¹Ù„Ù‘Ù‚ Ø§Ù„ÙØ­Øµ ØµØ±Ø§Ø­Ø©Ù‹. Ù„Ø§ ØªÙ†ÙÙ‘Ø°Ù‡. */
  readonly maxDailyOrders: number;
  readonly allowFridayOrders: boolean;     // A2:259 fallback = false
  readonly startTime: string;              // Â«HH:mmÂ» â€” A2:260 fallback = "06:00"
  readonly endTime: string;                // Â«HH:mmÂ» â€” A2:261 fallback = "10:00"
  /** Ù„Ø§ ÙŠÙ‚Ø±Ø£Ù‡ A2 ÙˆÙ„Ø§ A5 Ø¥Ø·Ù„Ø§Ù‚Ù‹Ø§. Ø­Ù‚Ù„ Ø¹Ø±Ø¶/Ø¥Ø¯Ø§Ø±Ø© ÙÙ‚Ø·. */
  readonly assistantId: string;
}
```


---

## 3. Ø­Ø¯ÙˆØ¯ Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª (Repository Boundaries)

### 3.1 Ø§Ù„Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø­Ø§ÙƒÙ…Ø©

```
electron/domain/          â† Ù†Ù‚ÙŠ: Ø£Ù†ÙˆØ§Ø¹ + Ù‚ÙˆØ§Ø¹Ø¯ ØµØ±ÙØ©. Ù„Ø§ ElectronØŒ Ù„Ø§ FirestoreØŒ Ù„Ø§ I/O.
        â–²
electron/repositories/    â† ÙˆØ§Ø¬Ù‡Ø§Øª + ØªÙ†ÙÙŠØ°Ø§Øª Firestore. ØªØ¹ØªÙ…Ø¯ Ø¹Ù„Ù‰ FirestoreRestClient ÙÙ‚Ø·.
        â–²
electron/services/        â† Ø­Ø§Ù„Ø§Øª Ø§Ø³ØªØ®Ø¯Ø§Ù… (application). ØªÙ†Ø³Ù‘Ù‚ Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª Ù…ØªØ¹Ø¯Ù‘Ø¯Ø©.
        â–²
electron/ipc/             â† Ù…Ø¹Ø§Ù„Ø¬Ø§Øª + ØªØ­ÙˆÙŠÙ„ Ø¥Ù„Ù‰ DTO. Ù„Ø§ Ù‚ÙˆØ§Ø¹Ø¯ ØµÙ„Ø§Ø­ÙŠØ§Øª.
        â–²
src/renderer/             â† Ø¹Ø±Ø¶ ÙÙ‚Ø·. Ù„Ø§ ÙˆØµÙˆÙ„ Ù„Ù€ FirestoreØŒ Ù„Ø§ ÙØ­Øµ Ø£Ø¯ÙˆØ§Ø±.
```

**Ù‚ÙˆØ§Ø¹Ø¯ ØµØ§Ø±Ù…Ø©:**

1. `domain/` **Ù„Ø§ ÙŠØ³ØªÙˆØ±Ø¯** Ù…Ù† `repositories/` ÙˆÙ„Ø§ `services/` ÙˆÙ„Ø§ `config/` â€” ÙŠÙØ®ØªØ¨ÙŽØ± ÙˆØ­Ø¯Ù‡.
2. `repositories/` **Ù„Ø§ ÙŠØ³ØªÙˆØ±Ø¯** Ù…Ù† `services/` â€” ÙŠØ¹Ø±Ù `FirestoreRestClient` ÙÙ‚Ø·.
3. `ipc/` **Ù„Ø§ ÙŠØ­ØªÙˆÙŠ** Ù…Ù†Ø·Ù‚ Ø£Ø¹Ù…Ø§Ù„ â€” ÙƒÙ„ Ù‚Ø±Ø§Ø± ÙŠØ¹ÙˆØ¯ Ø¥Ù„Ù‰ `services/`.
4. `repositories/` **Ù„Ø§ ÙŠØ·Ø¨Ù‘Ù‚** Ø£ÙŠ ÙØ­Øµ ØµÙ„Ø§Ø­ÙŠØ§Øª â€” Ø§Ù„Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¹Ù„Ù‰ A1 Ø­ØµØ±ÙŠÙ‹Ø§Ø›æ‰¿æ‹… `403` ÙÙ‚Ø·.
5. `renderer/` **Ù„Ø§ ÙŠØ³ØªÙ‚Ø¨Ù„** Ù…Ø³ØªÙ†Ø¯Ø§Øª Firestore ÙˆÙ„Ø§ Ø±Ù…ÙˆØ²Ù‹Ø§ â€” ÙŠØ³ØªÙ‚Ø¨Ù„ DTO Ù…ÙØ³Ù‚ÙŽØ·Ø©.

### 3.2 ÙˆØ§Ø¬Ù‡Ø§Øª Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª Ø§Ù„Ù…Ù‚ØªØ±Ø­Ø©

ÙƒÙ„ ÙˆØ§Ø¬Ù‡Ø© Ù…Ù‚Ø³Ù‘Ù…Ø© Ø¥Ù„Ù‰ Ø«Ù„Ø§Ø«Ø© Ø£Ù‚Ø³Ø§Ù… ØµØ±ÙŠØ­Ø©ØŒ Ù„Ø£Ù† A1 ÙŠØ¬Ø¹Ù„Ù‡Ø§ Ø³Ù„Ø·Ø§Øª Ù…Ø®ØªÙ„ÙØ© ØªÙ…Ø§Ù…Ù‹Ø§.

```ts
// â”€â”€ UsersRepository â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface UsersRepository {
  // (1) Ø§Ù„Ù‚Ø±Ø§Ø¡Ø©
  getOwnProfile(uid: string): Promise<User | null>;   // A1: isOwner
  getProfile(uid: string): Promise<User>;            // A1: isOwner || isAdmin
  listAll(): Promise<readonly User[]>;               // A1: isAdmin ÙÙ‚Ø·
  // (2) ÙƒØªØ§Ø¨Ø§Øª Ø¥Ø¯Ø§Ø±ÙŠØ©
  approve(uid: string): Promise<void>;               // status = 'approved'
  reject(uid: string): Promise<void>;                // status = 'rejected'
  grantSingleOrderException(uid: string): Promise<void>;   // hasException = true
  revokeException(uid: string): Promise<void>;             // hasException = false
  rename(uid: string, name: string): Promise<void>;         // A1 ÙŠØ³Ù…Ø­ Ù„Ù„Ù…Ø§Ù„Ùƒ
  resubmitAfterRejection(uid: string, name: string): Promise<void>; // rejected â†’ pending
  deleteUser(uid: string): Promise<void>;                    // A1: isAdmin ÙÙ‚Ø·
  // (3) Ù…Ø¹Ø§Ù…Ù„Ø§Øª
  /** A2:382-389 â€” hasException=false + ÙƒÙ„ Ø­Ù‚ÙˆÙ„ lastOrder*. */
  commitProcessedOrderSummary(tx, userRef, summary): Promise<void>;
}

// â”€â”€ MedicinesRepository â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface MedicinesRepository {
  // (1) Ø§Ù„Ù‚Ø±Ø§Ø¡Ø© â€” A1: Ø£ÙŠ Ù…Ø³ØªØ®Ø¯Ù… Ù…ÙØµØ§Ø¯ÙŽÙ‚
  listCatalog(opts?: { stockGreaterThanZero?: boolean }): Promise<readonly Medicine[]>;
  getMedicine(id: string): Promise<Medicine>;
  // (2) ÙƒØªØ§Ø¨Ø§Øª Ø¥Ø¯Ø§Ø±ÙŠØ© â€” A1: isAdmin
  create(input: { name: string; maxQuantity: number; initialStock: number }): Promise<Medicine>;
  updateMaxQuantity(id: string, maxQuantity: number): Promise<void>;
  deleteMedicine(id: string): Promise<void>;
  // (3) Ù…Ø¹Ø§Ù…Ù„Ø§Øª
  /** A4:877-897 â€” ÙŠØ²ÙŠØ¯ stock Ùˆ totalInward Ù…Ø¹Ù‹Ø§ ÙˆÙŠÙƒØªØ¨ stock_log inward. */
  addStockTransactionally(medicineId: string, quantity: number, actor: ActorInfo): Promise<void>;
  /** A2:363 â€” Ø®ØµÙ… Ù…Ø·Ù„Ù‚ Ù…Ø­Ø³ÙˆØ¨ Ø¯Ø§Ø®Ù„ Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø© (REST Ù„Ø§ ÙŠØ¯Ø¹Ù… increment). */
  decrementStockTransactionally(tx, medicineId: string, newAbsoluteStock: number): Promise<void>;
  /** A4:381 â€” ÙŠØ²ÙŠØ¯ totalOutward ÙÙ‚Ø· Ø¹Ù†Ø¯ Ù‚Ø¨ÙˆÙ„ Ø§Ù„Ø·Ù„Ø¨. */
  incrementTotalOutwardTransactionally(tx, medicineId: string, newAbsoluteValue: number): Promise<void>;
}
```


```ts
// â”€â”€ OrdersRepository â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface OrdersRepository {
  getOrder(id: string): Promise<Order>;                    // Ù‚Ø±Ø§Ø¡Ø©: isOwner || isAdmin
  listRecent(limit: number): Promise<readonly Order[]>;     // Ù‚Ø±Ø§Ø¡Ø©: isAdmin
  listOwnOrders(userId: string, limit: number): Promise<readonly Order[]>;
  // ÙƒØªØ§Ø¨Ø§Øª Ø¥Ø¯Ø§Ø±ÙŠØ© â€” A1: isAdmin
  createOrderTransactionally(tx, draft: NewOrder): Promise<string /*orderId*/>;  // A2:358
  setStatusTransactionally(tx, orderId, expected, next): Promise<boolean>;      // A4:370/399
  replaceItemsTransactionally(tx, orderId, items): Promise<void>;               // A4:454
}

// â”€â”€ OrderRequestsRepository â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface OrderRequestsRepository {
  getOwnRequest(id: string): Promise<OrderRequest | null>;
  listPendingForProcessing(): Promise<readonly OrderRequest[]>;   // A1: isAdmin
  /** ðŸ”’ A1:99 hasOnly(['uid','items','status','requestDate']). Ù„Ø§ Ù…ÙØªØ§Ø­ Ø¥Ø¶Ø§ÙÙŠ. */
  submitPending(request: NewOrderRequest): Promise<void>;         // Ø§Ù„ÙƒØªØ§Ø¨Ø© Ø§Ù„ÙˆØ­ÙŠØ¯Ø© Ù„Ù„Ù…ÙˆØ¸Ù
  // Ù…Ø¹Ø§Ù…Ù„Ø§Øª â€” ÙƒÙ„Ù‡Ø§ Ø¥Ø¯Ø§Ø±ÙŠØ©
  markProcessedTransactionally(tx, requestId, orderId, adminUid): Promise<void>;
  markFailedTransactionally(tx, requestId, reason, actor): Promise<void>;
}

// â”€â”€ StockLogsRepository â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface StockLogsRepository {
  listAll(): Promise<readonly StockLog[]>;                                    // isAdmin ÙÙ‚Ø·
  listBetween(fromIso: string, toIso: string): Promise<readonly StockLog[]>;  // A4:743-745
  listByOrder(orderId: string): Promise<readonly StockLog[]>;
  appendTransactionally(tx, entry: NewStockLog): Promise<void>;   // Ù„Ø§ ÙƒØªØ§Ø¨Ø© Ù…Ø¨Ø§Ø´Ø±Ø©
}

// â”€â”€ SettingsRepository â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface SettingsRepository {
  getAppSettings(): Promise<AppSettings>;                   // Ù‚Ø±Ø§Ø¡Ø©: Ø£ÙŠ Ù…Ø³ØªØ®Ø¯Ù… Ù…ÙØµØ§Ø¯ÙŽÙ‚
  saveAppSettings(settings: AppSettings): Promise<void>;    // ÙƒØªØ§Ø¨Ø©: A1 isAdmin ÙÙ‚Ø·
}
```

**Ù„Ù…Ø§Ø°Ø§ Ù‡Ø°Ø§ Ø§Ù„ØªÙ‚Ø³ÙŠÙ…ØŸ** A1 ÙŠØ¬Ø¹Ù„ Ø§Ù„Ø¹Ù…Ù„ÙŠØ© Ù†ÙØ³Ù‡Ø§ Â«Ù…Ø³Ù…ÙˆØ­Ø©Â» Ø£Ùˆ Â«Ù…Ù…Ù†ÙˆØ¹Ø©Â» Ø­Ø³Ø¨ Ù‡ÙˆÙŠØ© Ø§Ù„Ù…ØªØµÙ„. Ø§Ù„ØªÙ‚Ø³ÙŠÙ… ÙŠØ¹Ù„Ù† Ø°Ù„Ùƒ **ÙÙŠ Ø§Ù„ØªÙˆÙ‚ÙŠØ¹** Ø¨Ø¯Ù„ Ø£Ù† ÙŠÙƒÙˆÙ† Ø§ÙƒØªØ´Ø§ÙÙ‹Ø§ ÙˆÙ‚Øª Ø§Ù„ØªØ´ØºÙŠÙ„:

| Ø§Ù„Ù‚Ø³Ù… | Ø§Ù„Ù…ØªØµÙ„ Ø§Ù„Ù…Ø³Ù…ÙˆØ­ | Ø¹Ù†Ø¯ Ù…Ø®Ø§Ù„ÙØ© A1 |
|---|---|---|
| Ù‚Ø±Ø§Ø¡Ø© | Ø­Ø³Ø¨ Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹Ø© | `403 PERMISSION_DENIED` |
| ÙƒØªØ§Ø¨Ø© Ø¥Ø¯Ø§Ø±ÙŠØ© | `isAdmin()` ÙÙ‚Ø· | `403` |
| Ù…Ø¹Ø§Ù…Ù„Ø§Øª | `isAdmin()` (Ø¹Ø¯Ø§ `submitPending`) | `403` Ø¹Ù†Ø¯ `:commit` |

---

## 4. Ø®Ø±ÙŠØ·Ø© Ø§Ù„Ø­Ù‚ÙˆÙ„ (Firestore Field Mapping)

### 4.1 `users/{uid}`

| Firestore | Ø§Ù„Ù†ÙˆØ¹ | Ù…Ø·Ù„ÙˆØ¨ØŸ | Ø§Ù„Ù…Ø¹Ù†Ù‰ | Ù…ØµØ¯Ø± Ø§Ù„Ø­Ù‚ÙŠÙ‚Ø© |
|---|---|---|---|---|
| `uid` | string | Ù†Ø¹Ù… Ø¹Ù†Ø¯ Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡ (A1:43) | UID Ù…Ù† Auth | A1 ÙŠÙØ±Ø¶ `== request.auth.uid` |
| `name` | string | Ù†Ø¹Ù… Ø¹Ù…Ù„ÙŠÙ‹Ø§ | Ø§Ù„Ø§Ø³Ù… Ø§Ù„ÙƒØ§Ù…Ù„ | Ù‚Ø§Ø¨Ù„ Ù„Ù„ØªØ¹Ø¯ÙŠÙ„ (Ù…Ø§Ù„Ùƒ + `isAdmin()`) |
| `employeeId` | string | Ù†Ø¹Ù… Ø¹Ù…Ù„ÙŠÙ‹Ø§ | Ø§Ù„Ø±Ù‚Ù… Ø§Ù„ÙˆØ¸ÙŠÙÙŠ | **Ù…Ø¬Ù…Ù‘Ø¯** (A1:54) |
| `role` | string | Ù†Ø¹Ù… | `admin`/`assistant`/`employee` | **A1** Ø³Ø·Ø± 20 |
| `status` | string | Ù†Ø¹Ù… | `pending`/`approved`/`rejected` | **A1** `isApproved()` |
| `hasException` | boolean | Ù†Ø¹Ù… Ø¹Ù†Ø¯ Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡ (A1:46) | Ø§Ø³ØªØ«Ù†Ø§Ø¡ Ù„Ø·Ù„Ø¨ ÙˆØ§Ø­Ø¯ | A2 ÙŠØ³ØªÙ‡Ù„ÙƒÙ‡ |
| `lastOrderId` | string \| null | Ù„Ø§ | id Ø¢Ø®Ø± Ø·Ù„Ø¨ | A2 ÙŠÙƒØªØ¨Ù‡ |
| `lastOrderDate` | timestamp \| null | Ù„Ø§ | ØªØ§Ø±ÙŠØ® Ø¢Ø®Ø± Ø·Ù„Ø¨ | A2 ÙŠÙƒØªØ¨Ù‡ |
| `lastOrderMonthYear` | string | Ù„Ø§ | Â«MM-yyyyÂ» | âš ï¸ **Ù…Ø­Ù„ ØªØ¹Ø§Ø±Ø¶** (D1) |
| `lastOrderStatus` | OrderStatus \| '' \| null | Ù„Ø§ | Ø­Ø§Ù„Ø© Ø¢Ø®Ø± Ø·Ù„Ø¨ | A2 + A4 |
| `lastOrderIsException` | boolean | Ù„Ø§ | Ù‡Ù„ ÙƒØ§Ù† Ø§Ø³ØªØ«Ù†Ø§Ø¡Ù‹ | A2 + Ø§Ù„ØªØ±Ø­ÙŠÙ„ |

**Ø¯Ù„ÙŠÙ„ A9:** Ù…Ø³ØªÙ†Ø¯ Ø§Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ø¥Ù†ØªØ§Ø¬ÙŠ = `{uid, role, name, employeeId, status}` ÙÙ‚Ø· â€” Ø¨Ù„Ø§ `hasException` ÙˆØ¨Ù„Ø§ Ø£ÙŠ `lastOrder*`.

### 4.2 `medicines/{id}`

| Firestore | Ø§Ù„Ù†ÙˆØ¹ | Ù…Ø·Ù„ÙˆØ¨ØŸ | Ø§Ù„Ù…Ø¹Ù†Ù‰ | Ù…ØµØ¯Ø± Ø§Ù„Ø­Ù‚ÙŠÙ‚Ø© |
|---|---|---|---|---|
| `name` | string | Ù†Ø¹Ù… | Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ­Ø¶Ø± | `isAdmin()` |
| `maxQuantity` | integer | Ù†Ø¹Ù… | **Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ø¹Ù„Ù‰ ÙÙŠ Ø§Ù„Ø·Ù„Ø¨ Ø§Ù„ÙˆØ§Ø­Ø¯** | `isAdmin()` |
| `stock` | integer | Ù†Ø¹Ù… | Ø§Ù„Ø±ØµÙŠØ¯ Ø§Ù„Ø­Ø§Ù„ÙŠ | A2 ÙŠØ®ØµÙ…ØŒ A4 ÙŠØ²ÙŠØ¯ |
| `totalInward` | integer | Ù„Ø§ | Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„ÙˆØ§Ø±Ø¯ | A4 ÙÙ‚Ø· |
| `totalOutward` | integer | Ù„Ø§ | Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„ØµØ§Ø¯Ø± **Ø§Ù„Ù…Ù‚Ø¨ÙˆÙ„** | A4 ÙÙ‚Ø· |

### 4.3 `orders/{id}`

| Firestore | Ø§Ù„Ù†ÙˆØ¹ | Ù…Ø·Ù„ÙˆØ¨ØŸ | Ø§Ù„Ù…Ø¹Ù†Ù‰ | Ù…ØµØ¯Ø± Ø§Ù„Ø­Ù‚ÙŠÙ‚Ø© |
|---|---|---|---|---|
| `userId` | string | Ù†Ø¹Ù… | **Ø§Ù„Ù…Ø§Ù„Ùƒ** (A1:77) | A2 |
| `userName` | string | Ù„Ø§ | Ù†Ø³Ø®Ø© Ø§Ø³Ù… | A2 |
| `items` | array\<map\> | Ù†Ø¹Ù… | `{medicineId, medicineName, quantity}` | A2 |
| `date` | timestamp | Ù†Ø¹Ù… | ØªØ§Ø±ÙŠØ® Ø§Ù„Ø·Ù„Ø¨ | A2 |
| `monthYear` | string | Ù†Ø¹Ù… | Â«MM-yyyyÂ» | âš ï¸ D1 |
| `status` | OrderStatus | Ù†Ø¹Ù… | `pending`/`accepted`/`rejected` | A2 + A4 |
| `isExceptionOrder` | boolean | **Ù„Ø§** (8/26 ØºØ§Ø¦Ø¨Ø©) | Ù‡Ù„ ÙƒØ§Ù† Ø§Ø³ØªØ«Ù†Ø§Ø¡Ù‹ | A2 |
| `requestId` | string | Ù„Ø§ | Ø±Ø§Ø¨Ø· `order_requests/{id}` | A2 |

### 4.4 `order_requests/{id}`

| Firestore | Ø§Ù„Ù†ÙˆØ¹ | Ù…Ø·Ù„ÙˆØ¨ØŸ | Ø§Ù„Ù…Ø¹Ù†Ù‰ | ÙÙŠ `hasOnly`ØŸ |
|---|---|---|---|---|
| `uid` | string | Ù†Ø¹Ù… | **Ø§Ù„Ù…Ø§Ù„Ùƒ** (A1:92) | âœ… |
| `items` | array | Ù†Ø¹Ù… | Ù†ÙØ³ Ø´ÙƒÙ„ `orders.items` | âœ… |
| `status` | string | Ù†Ø¹Ù… | `pending` Ø¹Ù†Ø¯ Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡ (A1:97) | âœ… |
| `requestDate` | timestamp | Ù†Ø¹Ù… | ÙˆÙ‚Øª Ø§Ù„Ø·Ù„Ø¨ | âœ… |
| `orderId` | string | Ù„Ø§ | Ù†Ø§ØªØ¬ Ø§Ù„Ù…Ø¹Ø§Ù„Ø¬Ø© | âŒ |
| `error` | string | Ù„Ø§ | Ø³Ø¨Ø¨ Ø§Ù„ÙØ´Ù„ | âŒ |
| `processedBy` | string | Ù„Ø§ | Ù…Ù† Ø¹Ø§Ù„Ø¬ Ø§Ù„Ø·Ù„Ø¨ | âŒ |
| `processedAt` | timestamp | Ù„Ø§ | ÙˆÙ‚Øª Ø§Ù„Ù…Ø¹Ø§Ù„Ø¬Ø© | âŒ |

> ðŸ”’ ÙƒØªØ§Ø¨Ø© Ø£ÙŠ Ù…ÙØªØ§Ø­ Ù…Ù† Ø§Ù„Ø£Ø±Ø¨Ø¹Ø© Ø§Ù„Ø£Ø®ÙŠØ±Ø© Ø¹Ù†Ø¯ Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡ â‡’ `403`.

### 4.5 `stock_logs/{id}`

| Firestore | Ø§Ù„Ù†ÙˆØ¹ | Ù…Ø·Ù„ÙˆØ¨ØŸ | Ø§Ù„Ù…Ø¹Ù†Ù‰ | Ù…Ù„Ø§Ø­Ø¸Ø© |
|---|---|---|---|---|
| `uid` | string | Ù†Ø¹Ù… | â›” **Ø¯Ù„Ø§Ù„ØªØ§Ù† Ù…ØªØ¹Ø§Ø±Ø¶ØªØ§Ù†** | A2: Ø§Ù„Ù…ÙˆØ¸Ù Â· A4: Ø§Ù„Ù…Ø¯ÙŠØ± (D3) |
| `medicineId` | string | Ù†Ø¹Ù… | Ù…Ø¹Ø±Ù‘Ù Ø§Ù„Ø¯ÙˆØ§Ø¡ | |
| `medicineName` | string | Ù†Ø¹Ù… | Ù†Ø³Ø®Ø© Ø§Ø³Ù… | |
| `quantity` | integer | Ù†Ø¹Ù… | **Ù…Ø·Ù„Ù‚ Ù…ÙˆØ¬Ø¨ Ø¯Ø§Ø¦Ù…Ù‹Ø§** | A4:595 `Math.abs(diff)` |
| `type` | string | Ù†Ø¹Ù… | `inward` \| `outward` | Ù„Ø§ Ù‚ÙŠÙ…Ø© Ø«Ø§Ù„Ø«Ø© |
| `date` | timestamp | Ù†Ø¹Ù… | ÙˆÙ‚Øª Ø§Ù„Ø­Ø±ÙƒØ© | |
| `userName` | string | Ù†Ø¹Ù… | â›” **Ù†Øµ ÙˆØµÙÙŠ Ø­Ø±** | Ù„ÙŠØ³ Ø§Ø³Ù… Ù…Ø³ØªØ®Ø¯Ù… (D10) |
| `requestId` | string | Ù„Ø§ | Ù…Ù† A2 ÙÙ‚Ø· | |
| `orderId` | string | Ù„Ø§ | Ù…Ù† A2 ÙÙ‚Ø· | |

### 4.6 `settings/app`

| Firestore | Ø§Ù„Ù†ÙˆØ¹ | Ù…Ø·Ù„ÙˆØ¨ØŸ | Ø§Ù„Ù…Ø¹Ù†Ù‰ | ÙŠÙ‚Ø±Ø£Ù‡ A2ØŸ |
|---|---|---|---|---|
| `minDaysBetweenOrders` | integer | Ù†Ø¹Ù… | Ø§Ù„ÙØ§ØµÙ„ Ø§Ù„Ø£Ø¯Ù†Ù‰ Ø¨Ø§Ù„Ø£ÙŠØ§Ù… | âœ… |
| `allowFridayOrders` | boolean | Ù†Ø¹Ù… | Ø§Ù„Ø³Ù…Ø§Ø­ Ø¨Ø§Ù„Ø¬Ù…Ø¹Ø© | âœ… |
| `startTime` | string Â«HH:mmÂ» | Ù†Ø¹Ù… | Ø¨Ø¯Ø§ÙŠØ© Ø§Ù„Ù†Ø§ÙØ°Ø© | âœ… |
| `endTime` | string Â«HH:mmÂ» | Ù†Ø¹Ù… | Ù†Ù‡Ø§ÙŠØ© Ø§Ù„Ù†Ø§ÙØ°Ø© | âœ… |
| `maxDailyOrders` | integer | Ù†Ø¹Ù… | **ØºÙŠØ± Ù…Ø³ØªØ®Ø¯Ù…** (Â§2.8) | âŒ |
| `assistantId` | string | Ù†Ø¹Ù… | **ØºÙŠØ± Ù…Ø³ØªØ®Ø¯Ù…** | âŒ |


---

## 5. Ù…Ù„ÙƒÙŠØ© Ù‚ÙˆØ§Ø¹Ø¯ Ø§Ù„Ø£Ø¹Ù…Ø§Ù„ (Business-Rule Ownership)

| Ø§Ù„Ù‚Ø§Ø¹Ø¯Ø© | A1 `firestore.rules` | Ø·Ø¨Ù‚Ø© Ø§Ù„Ù…Ø¬Ø§Ù„ (ÙˆÙŠÙ†Ø¯ÙˆØ²) | Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© |
|---|---|---|---|
| **Ù…Ù† ÙŠÙ…Ù„Ùƒ Ø­Ù‚ Ø§Ù„ÙƒØªØ§Ø¨Ø© Ø£ØµÙ„Ù‹Ø§** (ØµÙ„Ø§Ø­ÙŠØ©) | âœ… **Ø§Ù„Ø³Ù„Ø·Ø© Ø§Ù„ÙˆØ­ÙŠØ¯Ø©** | âŒ Ù„Ø§ ØªÙØ­Øµ | âŒ Ù„Ø§ ØªÙØ­Øµ |
| `users` â€” Ø§Ù„Ù…Ø§Ù„Ùƒ ÙŠØ¹Ø¯Ù‘Ù„ `name` ÙÙ‚Ø· | âœ… `hasOnly(['name','status'])` | â€” | â€” |
| `users` â€” ØªØµØ¹ÙŠØ¯ `role` | âœ… Ù…Ù…Ù†ÙˆØ¹ | â€” | Ø¥Ø®ÙØ§Ø¡ Ø§Ù„Ø²Ø± (UX ÙÙ‚Ø·) |
| `users` â€” Ø§Ø¹ØªÙ…Ø§Ø¯ Ø°Ø§ØªÙŠ | âœ… Ù…Ù…Ù†ÙˆØ¹ | â€” | Ø¥Ø®ÙØ§Ø¡ Ø§Ù„Ø²Ø± |
| `order_requests` â€” Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡ ÙŠØªØ·Ù„Ù‘Ø¨ `isApproved()` | âœ… | ØªØ­Ø°ÙŠØ± Ù…Ø³Ø¨Ù‚ (UX) | ØªÙˆØ¶ÙŠØ­ |
| `order_requests` â€” Ø´ÙƒÙ„ Ø§Ù„Ù…ÙØ§ØªÙŠØ­ | âœ… `hasOnly` | **Ø¨Ù†Ø§Ø¡ Ø§Ù„Ø§Ù„ØªØ²Ø§Ù…** | â€” |
| Ø­Ø¯ 5 Ø£ØµÙ†Ø§Ù | âŒ | âœ… **ØªÙ†ÙÙŠØ°** (A2) | âœ… Ù…Ù†Ø¹ |
| `quantity > maxQuantity` | âŒ | âœ… **ØªÙ†ÙÙŠØ°** (A2) | âœ… Ù…Ù†Ø¹ |
| `quantity > stock` | âŒ | âœ… **ØªÙ†ÙÙŠØ°** (A2) | âœ… Ù…Ù†Ø¹ |
| ØªØ¬Ù…ÙŠØ¹ ØªÙƒØ±Ø§Ø± Ù†ÙØ³ Ø§Ù„Ø¯ÙˆØ§Ø¡ | âŒ | âœ… **ØªÙ†ÙÙŠØ°** (A2) | â€” |
| Ø·Ù„Ø¨ Ù…ÙØ¹Ù„Ù‘Ù‚ ÙˆØ§Ø­Ø¯ | âŒ | âœ… **ØªÙ†ÙÙŠØ°** (A2) | Ø¹Ø±Ø¶ |
| Ø·Ù„Ø¨ ÙˆØ§Ø­Ø¯/Ø´Ù‡Ø± | âŒ | âœ… **ØªÙ†ÙÙŠØ°** (A2) | Ø¹Ø±Ø¶ |
| ÙØ§ØµÙ„ 15 ÙŠÙˆÙ… | âŒ | âœ… **ØªÙ†ÙÙŠØ°** (A2) | Ø¹Ø±Ø¶ |
| Ù†Ø§ÙØ°Ø© Ø§Ù„ÙˆÙ‚Øª / Ø§Ù„Ø¬Ù…Ø¹Ø© | âŒ | âœ… **ØªÙ†ÙÙŠØ°** (A2) | Ø¹Ø±Ø¶ |
| `hasException` ÙŠØªØ¬Ø§ÙˆØ² ÙƒÙ„ Ø´ÙŠØ¡ | âŒ | âœ… **ØªÙ†ÙÙŠØ°** (A2) | Ø¹Ø±Ø¶ |
| Ø°Ø±Ù‘ÙŠØ© Ø§Ù„Ù…Ø®Ø²ÙˆÙ† | âŒ | âœ… **ØªÙ†ÙÙŠØ°** (Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø©) | â€” |

### 5.1 Ø§Ù„Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø°Ù‡Ø¨ÙŠØ©

> **A1 Ù‡Ùˆ Ø§Ù„Ø­Ø¯Ù‘ Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠØŒ ÙˆÙ„Ø§ ÙŠÙÙƒØ±ÙŽÙ‘Ø± ÙÙŠ Ø£ÙŠ Ù…ÙƒØ§Ù† Ø¢Ø®Ø± ÙƒØ¨Ø¯ÙŠÙ„ Ø¹Ù†Ù‡.**

Ø¹Ù…ÙŠÙ„ REST ÙÙŠ ÙˆÙŠÙ†Ø¯ÙˆØ² **Ù„Ø§ ÙŠØ³ØªØ·ÙŠØ¹** ØªØ¬Ø§ÙˆØ² A1. Ù„Ø°Ù„Ùƒ:

1. `repositories/` **Ù„Ø§ ÙŠØ­ØªÙˆÙŠ** Ø£ÙŠ ÙØ­Øµ `role`/`status` â€” Ù…Ø³Ø¤ÙˆÙ„Ø© Ø¹Ù† Ø§Ù„Ù†Ù‚Ù„ ÙÙ‚Ø·.
2. `domain/` ÙŠØ­ØªÙˆÙŠ **Ø§Ù„Ù‚ÙˆØ§Ø¹Ø¯ Ø§Ù„ØªØ¬Ø§Ø±ÙŠØ©** (maxQuantityØŒ 5 Ø£ØµÙ†Ø§ÙØŒ Ø§Ù„Ù†Ø§ÙØ°Ø© Ø§Ù„Ø²Ù…Ù†ÙŠØ©â€¦) Ù„Ø£Ù†Ù‡Ø§ **Ù„ÙŠØ³Øª** ØµÙ„Ø§Ø­ÙŠØ§Øª â€” A1 Ù„Ø§ ÙŠÙ…Ù†Ø¹ Ø·Ù„Ø¨Ù‹Ø§ Ø¨Ù…Ø®Ø²ÙˆÙ† Ø³Ø§Ù„Ø¨.
3. `renderer/` ÙŠØ¹Ø±Ø¶ Ù…Ø§ ØªÙØ¹ÙŠØ¯Ù‡ Ø§Ù„Ø¹Ù…Ù„ÙŠØ© Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ©. **Ù„Ø§ ÙŠØ®Ø²Ù‘Ù† `role` ÙˆÙ„Ø§ ÙŠØªÙ‘Ø®Ø° Ø¹Ù„Ù‰ Ø£Ø³Ø§Ø³Ù‡ Ù‚Ø±Ø§Ø±Ù‹Ø§ ÙŠÙ…Ù†Ø¹ Ø£Ùˆ ÙŠØ³Ù…Ø­.**
4. Ø¹Ù†Ø¯ `403` Ù…Ù† A1: ØªÙØªØ±Ø¬Ù… Ø¥Ù„Ù‰ Ø±Ø³Ø§Ù„Ø© UX. **Ù„Ø§ ÙŠÙØ¹Ø§Ø¯ Ø§Ù„Ø·Ù„Ø¨ ÙˆÙ„Ø§ ÙŠÙØ®ÙÙ‰ Ø§Ù„Ø®Ø·Ø£.**

> âš ï¸ **Ø³Ù„ÙˆÙƒ A6 Ø§Ù„Ù…ÙˆØ¬ÙˆØ¯ ÙˆÙŠØ¬Ø¨ Ø¹Ø¯Ù… ØªÙƒØ±Ø§Ø±Ù‡:** `MainActivity:54` Ùˆ `SettingsFragment:986` ÙŠÙØ­ØµØ§Ù† `email == "assistant@drugapp.internal"` Ù„ÙØ±Ø¶ Ø³Ù„ÙˆÙƒ Ø¥Ø¯Ø§Ø±ÙŠ. Ù‡Ø°Ø§ **ÙØ­Øµ ØµÙ„Ø§Ø­ÙŠØ§Øª ÙÙŠ Ø§Ù„Ø¹Ù…ÙŠÙ„**ØŒ Ø¨ÙŠÙ†Ù…Ø§ A1 ÙŠØ¹ØªÙ…Ø¯ `role` Ù„Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ø¨Ø±ÙŠØ¯. Ø·Ø¨Ù‚Ø© ÙˆÙŠÙ†Ø¯ÙˆØ² **Ù„Ø§ ØªÙ†Ø³Ø® Ù‡Ø°Ø§ Ø§Ù„Ù†Ù…Ø·** (C4).

---

## 6. ØªØ­Ù„ÙŠÙ„ Ø¯Ù„Ø§Ù„Ø§Øª `AdminOrderProcessor` (A2)

> Ø§Ù„Ù…ØªØ·Ù„Ø¨: Ø§Ù„ØªÙ†ÙÙŠØ° ÙÙŠ ÙˆÙŠÙ†Ø¯ÙˆØ² ÙŠØ­ÙØ¸ Ù‡Ø°Ù‡ Ø§Ù„Ø¯Ù„Ø§Ù„Ø§Øª **Ø¨Ø§Ù„ØªØ±ØªÙŠØ¨ Ù†ÙØ³Ù‡**.

### 6.1 Ø§Ù„Ø¯ÙˆØ§Ù„ Ø§Ù„ØµØ§ÙÙŠØ© (ØªÙÙ†Ù‚Ù„ Ø­Ø±ÙÙŠÙ‹Ø§ Ø¥Ù„Ù‰ `domain/`)

| Ø§Ù„Ø¯Ø§Ù„Ø© | Ø§Ù„Ø³Ø·Ø± | Ø§Ù„Ø³Ù„ÙˆÙƒ Ø§Ù„Ø¯Ù‚ÙŠÙ‚ | Ù…Ù„Ø§Ø­Ø¸Ø© |
|---|---|---|---|
| `aggregateItems` | 44 | ÙŠØ±ÙØ¶ ÙØ§Ø±ØºÙ‹Ø§ØŒ ÙŠØ±ÙØ¶ >5 **Ù‚Ø¨Ù„** Ø§Ù„ØªØ¬Ù…ÙŠØ¹ØŒ ÙŠØ¬Ù…Ø¹ Ø§Ù„Ù…ÙƒØ±Ù‘Ø±ØŒ ÙŠØ±ÙØ¶ `qty <= 0`ØŒ ÙŠØ±ÙØ¶ Ø§Ù„Ù†ÙˆØ¹ ØºÙŠØ± `Number`ØŒ `Math.addExact` Ù„ÙƒØ´Ù overflow | **Ø§Ù„Ø­Ø¯ 5 ÙŠÙÙØ­Øµ Ø¹Ù„Ù‰ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø®Ø§Ù… Ù„Ø§ Ø§Ù„Ù…Ø¬Ù…Ù‘Ø¹Ø©** |
| `parseTimeToMinutes` | 74 | `split(":")`Ø› Ø¥Ù† Ù„Ù… ÙŠÙƒÙ† Ø¬Ø²Ø£ÙŠÙ† â‡’ `0` | `parseTimeToMinutes("garbage")` = 0 â‡’ Ù…Ù†ØªØµÙ Ù„ÙŠÙ„ |
| `getDamascusCalendar` | 80 | `Asia/Damascus` Ø¯Ø§Ø¦Ù…Ù‹Ø§ | Ù…Ù†Ø·Ù‚Ø© Ø«Ø§Ø¨ØªØ© |
| `getDamascusMonthYear` | 87 | `SimpleDateFormat("MM-yyyy", Locale.US)` | â­ **ASCII** (D1) |
| `validateScheduleAndTime` | 94 | (1) Ø§Ù„Ø¬Ù…Ø¹Ø©ØŒ (2) Ø§Ù„Ù†Ø§ÙØ°Ø© | `currentMins < start \|\| currentMins > end` â€” **Ø´Ø§Ù…Ù„ Ø§Ù„Ø·Ø±ÙÙŠÙ†** |
| `validateUserEligibility` | 118 | 6 Ø®Ø·ÙˆØ§Øª Ù…Ø±ØªÙ‘Ø¨Ø© (6.2) | â­ Ø§Ù„ØªØ±ØªÙŠØ¨ Ø­Ø±Ø¬ |

### 6.2 ØªØ±ØªÙŠØ¨ ÙØ­ÙˆØµ Ø§Ù„Ø£Ù‡Ù„ÙŠØ© (A2:118-153) â€” ÙŠÙÙƒØ±ÙŽÙ‘Ø± Ø­Ø±ÙÙŠÙ‹Ø§

```
1. status != "approved"     â‡’ "User is not approved to make orders"
2. hasException == true     â‡’ return null   â—„â”€â”€ ØªØ¬Ø§ÙˆØ² ÙƒØ§Ù…Ù„ Ù„Ø®Ø·ÙˆØ§Øª 3-6
3. canRetryRecord = (lastOrderStatus == "rejected" && !lastOrderIsException)
4. if (!canRetryRecord):
     4a. lastOrderStatus == "pending"        â‡’ "You already have a pending order"
     4b. lastOrderMonthYear == MM-yyyy Ø§Ù„Ø¢Ù† â‡’ "You have already ordered this month"
     4c. diffDays < minDaysBetweenOrders    â‡’ "Minimum interval â€¦ is N days"
5. return null
```

> âš ï¸ Ø«Ù„Ø§Ø« Ø¯Ù‚Ø§Ø¦Ù‚ ØªØºÙŠÙ‘Ø± Ø§Ù„Ø³Ù„ÙˆÙƒ:
> - Ø§Ù„Ø®Ø·ÙˆØ© 2 **Ù‚Ø¨Ù„** ÙƒÙ„ Ø´ÙŠØ¡: Ø§Ù„Ù…Ø³ØªØ«Ù†Ù‰ ÙŠØªØ¬Ø§ÙˆØ² Ø­ØªÙ‰ Ù‚ÙŠØ¯ Â«Ø·Ù„Ø¨ Ù…ÙØ¹Ù„Ù‘Ù‚ ÙˆØ§Ø­Ø¯Â».
> - Ø§Ù„Ø®Ø·ÙˆØ© 4b ØªØ¨Ø¯Ø£ Ø¨Ù€ `isNotBlank()` â€” Ù…Ø³ØªØ®Ø¯Ù… Ø¬Ø¯ÙŠØ¯ (`""`) ÙŠØªØ¬Ø§ÙˆØ²Ù‡Ø§ØŒ ÙˆÙ‡Ø°Ø§ Ù…Ø§ ÙŠØ¬Ø¹Ù„ Ø§Ù„ÙØ­Øµ Ø¢Ù…Ù†Ù‹Ø§.
> - `diffDays = millis / 86400000` ** flooring**: 14.9 ÙŠÙˆÙ… â‡’ 14 â‡’ Ù…Ø±ÙÙˆØ¶ Ø¹Ù†Ø¯ `minDays=15`.

### 6.3 ØªØ³Ù„Ø³Ù„ Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø© (A2:157-401)

| # | Ø§Ù„Ø¹Ù…Ù„ÙŠØ© | Ø§Ù„Ø³Ø·Ø± | Ù…Ù„Ø§Ø­Ø¸Ø© |
|---|---|---|---|
| â€” | `requestId` ÙØ§Ø±Øº â‡’ ÙØ´Ù„ | 163 | Ù‚Ø¨Ù„ Ø£ÙŠ I/O |
| **R1** | Ù‚Ø±Ø§Ø¡Ø© `order_requests/{id}` | 168 | `status == "pending"` ÙˆØ¥Ù„Ø§ `AlreadyProcessed` |
| | `uid` ÙØ§Ø±Øº / `items` Ù„ÙŠØ³Øª `List` / ØªØ¬Ù…ÙŠØ¹ / `requestDate` Ù„ÙŠØ³ `Timestamp` | 179-221 | ÙƒÙ„ ÙˆØ§Ø­Ø¯ â‡’ `failed` |
| **R2** | Ù‚Ø±Ø§Ø¡Ø© `users/{uid}` | 225 | Ù…Ù† Ø§Ù„Ø­Ù‚ÙˆÙ„ Ø§Ù„Ù…ÙƒØ±Ù‘Ø±Ø© ÙÙ‚Ø· |
| **R3** | Ù‚Ø±Ø§Ø¡Ø© `settings/app` | 247 | |
| | ÙØ­ÙˆØµ Ø§Ù„ÙˆÙ‚Øª Ø«Ù… Ø§Ù„Ø£Ù‡Ù„ÙŠØ© | 266 / 278 | |
| **R4** | Ù‚Ø±Ø§Ø¡Ø© `medicines/{id}` Ù„ÙƒÙ„ ØµÙ†Ù | 293 | `maxQuantity` Ø«Ù… `stock` |
| **W1** | Ø¥Ù†Ø´Ø§Ø¡ `orders/{autoId}` | 358 | |
| **W2** | `medicines.stock = stock - qty` | 363 | **Ù‚ÙŠÙ…Ø© Ù…Ø·Ù„Ù‚Ø©** |
| **W3** | Ø¥Ù†Ø´Ø§Ø¡ `stock_logs` (`outward`) | 365 | `uid` = **Ø§Ù„Ù…ÙˆØ¸Ù** |
| **W4** | ØªØ­Ø¯ÙŠØ« `users/{uid}` | 389 | `hasException=false` + ÙƒÙ„ `lastOrder*` |
| **W5** | `order_requests` â‡’ `processed` | 392 | |

> â­ **Ù‚Ø§Ø¹Ø¯Ø© `transaction.get`:** A2 ÙŠÙ‚Ø±Ø£ **Ù‚Ø¨Ù„** Ø£ÙŠ ÙƒØªØ§Ø¨Ø©.

### 6.4 Ø­Ø³Ø§Ø¨ Ø§Ù„Ù…Ø®Ø²ÙˆÙ†

```kotlin
// A2:321-323
if (item.quantity > stock) { markFailed("Insufficient stock for $medName") }
medicinesToUpdate.add(Triple(medRef, medName, stock - item.quantity));
// A2:363 â€” ÙŠÙÙƒØªØ¨ Ø§Ù„Ù…Ø·Ù„Ù‚
transaction.update(medData.first, "stock", medData.third);
```

> â­ **A2 Ù„Ø§ ÙŠØ³ØªØ®Ø¯Ù… `FieldValue.increment` Ø¥Ø·Ù„Ø§Ù‚Ù‹Ø§** â€” ÙŠØ­Ø³Ø¨ Ø§Ù„Ù…Ø·Ù„Ù‚ Ø¯Ø§Ø®Ù„ Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø©ØŒ ÙˆÙ‡Ùˆ Ø¨Ø§Ù„Ø¶Ø¨Ø· Ù…Ø§ ØªØªØ·Ù„Ø¨Ù‡ REST (Â§7.4).
> â­ **A2 Ù„Ø§ ÙŠÙ„Ù…Ø³ `totalOutward`** â€” ÙŠØ­Ø¯Ù‘Ø«Ù‡ A4 ÙÙ‚Ø· Ø¹Ù†Ø¯ `accepted`. Ù„Ø§ ØªÙ†Ø³Ø® Ù‡Ø°Ø§ ÙÙŠ ÙˆÙŠÙ†Ø¯ÙˆØ².

### 6.5 Ø§Ù„Ø­Ø§Ù„Ø§Øª Ø§Ù„ÙØ§Ø´Ù„Ø© ÙˆØ§Ù„Ø°Ø±Ù‘ÙŠØ©

| Ø§Ù„Ø­Ø§Ù„Ø© | `status` | `error` |
|---|---|---|
| ÙƒÙ„ ÙØ´Ù„ ØªØ­Ù‚Ù‘Ù‚ | `failed` | Ù†Øµ Ø§Ù„Ø±Ø³Ø§Ù„Ø© + `processedBy` |
| `status != "pending"` | **Ù„Ø§ Ø´ÙŠØ¡ ÙŠÙÙƒØªØ¨** | `AlreadyProcessed(id)` ÙŠÙØ¹Ø§Ø¯ |
| Ù†Ø¬Ø§Ø­ | `processed` | `orderId` + `processedBy` + `processedAt` |

> â­ **`AlreadyProcessed` Ù„Ø§ ÙŠÙƒØªØ¨ Ø´ÙŠØ¦Ù‹Ø§** â€” Ù…ÙØªØ§Ø­ **Ø§Ù„Ø°Ø±Ù‘ÙŠØ©**: Ø¥Ø¹Ø§Ø¯Ø© ØªØ´ØºÙŠÙ„ Ø§Ù„Ù…Ø¹Ø§Ù„Ø¬ Ù„Ø§ ØªÙÙ†ØªØ¬ Ø·Ù„Ø¨Ù‹Ø§ Ø«Ø§Ù†ÙŠÙ‹Ø§.

### 6.6 Ø§Ù„ØªØ²Ø§Ù…Ù†

---

## 7. Ù…Ø¹Ù…Ø§Ø±ÙŠØ© Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø§Øª (Transaction Architecture)

> **ØªØµÙ…ÙŠÙ… ÙÙ‚Ø·** Ù„Ù…Ø§ Ø³ØªØ­ØªØ§Ø¬Ù‡ Ø®Ø¯Ù…Ø© Ù…Ø¹Ø§Ù„Ø¬Ø© Ø§Ù„Ø·Ù„Ø¨Ø§Øª ÙÙŠ Stage 5.

### 7.1 Ù†Ù‚Ø§Ø· Ø§Ù„Ù†Ù‡Ø§ÙŠØ© Ø§Ù„Ù…Ø·Ù„ÙˆØ¨Ø© (Ù…ÙˆØ¬ÙˆØ¯Ø© Ø£ØµÙ„Ù‹Ø§ ÙÙŠ A10)

| Ø§Ù„Ø®Ø·ÙˆØ© | Ù†Ù‚Ø·Ø© Ø§Ù„Ù†Ù‡Ø§ÙŠØ© | Ø¯Ø§Ù„Ø© A10 | Ù…Ù„Ø§Ø­Ø¸Ø© |
|---|---|---|---|
| 1. Ø¨Ø¯Ø¡ | `POST :beginTransaction` | `beginTransaction()` | ÙŠÙØ±Ø¬Ø¹ Ù…Ø¹Ø±Ù‘Ù `transaction` |
| 2. Ù‚Ø±Ø§Ø¡Ø© | `POST :batchGet` | `batchGetDocuments(paths, tx)` | Ø§Ù„Ù…ÙÙ‚ÙˆØ¯ ÙŠÙØ¹Ø§Ø¯ `null` **Ø¨ØªØ±ØªÙŠØ¨ Ø§Ù„Ø·Ù„Ø¨** |
| 3. ÙƒØªØ§Ø¨Ø© | `POST :commit` | `commitWrites(writes, tx)` | **ÙŠÙÙ‚ÙŠÙŽÙ‘Ù… A1 Ù‡Ù†Ø§** |
| 4. Ø¥Ù„ØºØ§Ø¡ | `POST :rollback` | `rollback(tx)` | Ù„Ø§ ÙŠØ±ØªÙƒØ¨ Ø´ÙŠØ¦Ù‹Ø§ |

> â­ **A1 ÙŠÙÙ‚ÙŠÙŽÙ‘Ù… Ù…Ø±ØªÙŠÙ†:** Ø¹Ù†Ø¯ `:batchGet` (Ø§Ù„Ù‚Ø±Ø§Ø¡Ø©) ÙˆØ¹Ù†Ø¯ `:commit` (Ø§Ù„ÙƒØªØ§Ø¨Ø©). Ø£Ø«Ø¨ØªØª Stage 3 Ø§Ù„Ø§Ø«Ù†ÙŠÙ†.

### 7.2 ØªØ³Ù„Ø³Ù„ Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø© Ø§Ù„Ù…Ø³ØªÙ‡Ø¯Ù (Ù…Ø·Ø§Ø¨Ù‚ Ù„Ù€ A2 Â§6.3)

```ts
const tx = await client.beginTransaction();
try {
  // â”€â”€ ÙƒÙ„ Ø§Ù„Ù‚Ø±Ø§Ø¡Ø© Ø£ÙˆÙ„Ù‹Ø§ (A1 ÙŠÙÙ‚ÙŠÙŽÙ‘Ù… Ù‡Ù†Ø§) â”€â”€
  const [req]  = await client.batchGetDocuments([`order_requests/${requestId}`], tx);
  if (req?.data.status !== 'pending') return AlreadyProcessed;   // Ù„Ø§ ØªÙƒØªØ¨ Ø´ÙŠØ¦Ù‹Ø§
  const [user] = await client.batchGetDocuments([`users/${uid}`], tx);
  const [set]  = await client.batchGetDocuments(['settings/app'], tx);
  const meds   = await client.batchGetDocuments(medIds.map(m => `medicines/${m}`), tx);
  // â”€â”€ ÙØ­ÙˆØµ ØµØ§ÙÙŠØ© â”€â”€
  validateScheduleAndTime(...); validateUserEligibility(...); checkItems(...);
  // â”€â”€ Ø«Ù… Ø§Ù„ÙƒØªØ§Ø¨Ø© (A1 ÙŠÙÙ‚ÙŠÙŽÙ‘Ù… Ù‡Ù†Ø§) â”€â”€
  await client.commitWrites([
    { kind: 'create', relativePath: `orders/${orderId}`,             data: {...} },
    ...medIds.map(id => ({ kind: 'update', relativePath: `medicines/${id}`, data: { stock: newAbs } })),
    ...medIds.map(id => ({ kind: 'create', relativePath: `stock_logs/${logId}`, data: {...} })),
    { kind: 'update', relativePath: `users/${uid}`,                 data: {...} },
    { kind: 'update', relativePath: `order_requests/${requestId}`,  data: { status: 'processed', ... } },
  ], tx);
} catch (e) {
  await client.rollback(tx);
  if (deniedByRules(e)) await markFailed(e);   // Ø®Ø§Ø±Ø¬ Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø©Ø› A1 ÙŠØ³Ù…Ø­ (isAdmin)
  throw e;
}
```

### 7.3 â›” ÙØ¬ÙˆØ© 1 â€” `commitWrites` Ø¨Ù„Ø§ `updateMask` â‡’ Ø®Ø·Ø± Ø¥ØªÙ„Ø§Ù Ø¨ÙŠØ§Ù†Ø§Øª

`FirestoreWriteRequest` (A10:111) Ù„Ø§ ÙŠØ¹Ø±Ù‘Ø¶ `updateMaskPaths`ØŒ Ùˆ`commitWrites` (A10:432) ÙŠØ±Ø³Ù„ `update` **Ø¨Ù„Ø§ Ù‚Ù†Ø§Ø¹**:

```ts
const update = { name: ..., fields: encodeFields(write.data) };   // âŒ Ø¨Ù„Ø§ updateMask
```

ÙÙŠ Firestore RESTØŒ `update` **Ø¨Ù„Ø§ `updateMask` ÙŠØ³ØªØ¨Ø¯Ù„ Ø§Ù„Ù…Ø³ØªÙ†Ø¯ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„** ÙˆÙŠØ­Ø°Ù ÙƒÙ„ Ø­Ù‚Ù„ ØºÙŠØ± Ù…Ø°ÙƒÙˆØ±. Ø¨ÙŠÙ†Ù…Ø§ ÙÙŠ Ø£Ù†Ø¯Ø±ÙˆÙŠØ¯:

```kotlin
transaction.update(medRef, "stock", medData.third)   // ØªØ­Ø¯ÙŠØ« Ø­Ù‚Ù„ ÙˆØ§Ø­Ø¯ ÙÙ‚Ø·
```

> ðŸš¨ **Ù„Ùˆ Ù†ÙÙÙÙ‘Ø°Øª Ù…Ø¹Ø§Ù„Ø¬Ø© Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ø¨Ù€ `commitWrites` ÙƒÙ…Ø§ Ù‡ÙŠ Ø§Ù„ÙŠÙˆÙ…ØŒ Ø³ØªÙÙ…Ø­Ù‰ `name` Ùˆ `maxQuantity` Ùˆ `totalInward` Ùˆ `totalOutward` Ù…Ù† ÙƒÙ„ Ø¯ÙˆØ§Ø¡.**
> **Ø§Ù„Ø¥ØµÙ„Ø§Ø­ Ø§Ù„Ù…Ù„Ø²Ù… Ù‚Ø¨Ù„ Stage 5:** Ø¥Ø¶Ø§ÙØ© `updateMaskPaths` Ø¥Ù„Ù‰ `FirestoreWriteRequest` ÙˆØªØ­ÙˆÙŠÙ„Ù‡ Ø¥Ù„Ù‰ `updateMask: { fieldPaths: [...] }` (C5).

### 7.4 â›” ÙØ¬ÙˆØ© 2 â€” `increment` ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯ ÙÙŠ REST

Ø£Ù†Ø¯Ø±ÙˆÙŠØ¯ ÙŠØ³ØªØ®Ø¯Ù… `FieldValue.increment` ÙÙŠ 6 Ù…ÙˆØ§Ø¶Ø¹ (A4:380ØŒ 412ØŒ 458ØŒ 586ØŒ 880ØŒ 881). REST Ù„Ø§ ÙŠÙˆÙÙ‘Ø±Ù‡.

> **Ø§Ù„ÙØ±Ù‚ Ø§Ù„Ø¯Ù„Ø§Ù„ÙŠ:** ÙÙŠ Ù…Ø¹Ø§Ù…Ù„Ø© Ø£Ù†Ø¯Ø±ÙˆÙŠØ¯ `increment` **ÙŠÙØ¹Ø§Ø¯ Ø­Ø³Ø§Ø¨Ù‡** Ø¹Ù†Ø¯ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©. ÙÙŠ REST ØªÙØ­Ø³Ø¨ Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù…Ø·Ù„Ù‚Ø© ÙÙŠ Ø¬Ø³Ù… Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø© ÙˆØªÙØ¹Ø§Ø¯ ÙƒØªØ§Ø¨ØªÙ‡Ø§. Ø§Ù„Ù†ØªÙŠØ¬Ø© Ù…ØªØ·Ø§Ø¨Ù‚Ø© **Ø¨Ø´Ø±Ø· Ø¥Ø¹Ø§Ø¯Ø© Ø­Ø³Ø§Ø¨ Ø§Ù„Ù…Ø·Ù„Ù‚ ÙÙŠ ÙƒÙ„ Ù…Ø­Ø§ÙˆÙ„Ø©** â€” ÙˆÙ‡Ùˆ Ù…Ø§ ÙŠÙØ¹Ù„Ù‡ A2:363.
> **Ø§Ù„Ù‚Ø§Ø¹Ø¯Ø©:** Ø·Ø¨Ù‚Ø© ÙˆÙŠÙ†Ø¯ÙˆØ² **Ù„Ø§ ØªØ­Ø³Ø¨ `newStock` Ø¥Ù„Ø§ Ø¨Ø¹Ø¯ `batchGet` Ø¯Ø§Ø®Ù„ Ù†ÙØ³ Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø©**ØŒ ÙˆÙ„Ø§ ØªØ¹ØªÙ…Ø¯ Ø¹Ù„Ù‰ Ù‚ÙŠÙ…Ø© Ù…Ù‚Ø±ÙˆØ¡Ø© Ø®Ø§Ø±Ø¬Ù‡Ø§ (D5).

### 7.5 â›” ÙØ¬ÙˆØ© 3 â€” ØªÙˆÙ„ÙŠØ¯ Ù…ÙØ¹Ø±Ù‘Ù Ø§Ù„Ù…Ø³ØªÙ†Ø¯

`AdminOrderProcessor` Ùˆ`AdminActivity` ÙŠØ³ØªØ®Ø¯Ù…Ø§Ù† `db.collection("x").document()` Ø£ÙŠ **Ù…Ø¹Ø±Ù‘ÙÙ‹Ø§ ØªÙ„Ù‚Ø§Ø¦ÙŠÙ‹Ø§ Ù…Ù† Ø§Ù„Ø®Ø§Ø¯Ù…**. REST Ù„Ø§ ÙŠÙˆÙÙ‘Ø± Ø°Ù„Ùƒ.
**Ø§Ù„Ù…Ø·Ù„ÙˆØ¨:** ØªÙˆÙ„ÙŠØ¯ Ø§Ù„Ù…Ø¹Ø±Ù‘Ù ÙÙŠ Ø§Ù„Ø¹Ù…ÙŠÙ„. âš ï¸ `assertSafeRelativePath` ÙŠØ³Ù…Ø­ Ø¨Ù€ `[A-Za-z0-9_-]` ÙÙ‚Ø· â‡’ **Ø§Ù„Ù…Ø¹Ø±Ù‘Ù Ø§Ù„Ù…ÙˆÙ„ÙŽÙ‘Ø¯ ÙŠØ¬Ø¨ Ø£Ù† ÙŠÙ„ØªØ²Ù… Ø¨Ø°Ù„Ùƒ** (Ù„Ø§ `+` ÙˆÙ„Ø§ `/`ØŒ ÙˆÙ„Ø§ ÙŠØ¨Ø¯Ø£ Ø¨Ù€ `__` â€” Ø§Ù†Ø¸Ø± Stage 3 Â§9.1).

### 7.6 Ø­Ø¯ÙˆØ¯ `runQuery` Ø§Ù„Ø­Ø§Ù„ÙŠØ©

`FirestoreStructuredQuery` (A10:129) ÙŠØ¯Ø¹Ù… ÙÙ‚Ø· `collectionId` + `where` Ø¨Ù…ÙØ¹Ø§Ù…Ù„ `EQUAL` + `limit`. **Ù„Ø§ `orderBy` ÙˆÙ„Ø§ range.**

| Ø­Ø§Ø¬Ø© | Ø§Ù„Ù…ØµØ¯Ø± | Ø§Ù„Ø­Ø§Ù„Ø© | Ø§Ù„Ù…Ø·Ù„ÙˆØ¨ Ù„Ø§Ø­Ù‚Ù‹Ø§ |
|---|---|---|---|
| `orders` Ø§Ù„Ø£Ø­Ø¯Ø« (100) | A4:331-333 | âŒ | Ø¥Ø¶Ø§ÙØ© `orderBy` |
| ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø¬Ø±Ø¯ Ø¨ÙŠÙ† ØªØ§Ø±ÙŠØ®ÙŠÙ† | A4:743-745 | âŒ | Ø¥Ø¶Ø§ÙØ© `>=` / `<=` |
| Ø·Ù„Ø¨Ø§Øª `status == pending` | A4:304-305 | âœ… Ù…ØªØ§Ø­ | â€” |
| Ø¢Ø®Ø± Ø·Ù„Ø¨ Ù„Ù„Ù…ÙˆØ¸Ù | A2 Ù„Ø§ ÙŠØ­ØªØ§Ø¬Ù‡ (ÙŠÙ‚Ø±Ø£ Ø§Ù„Ø­Ù‚ÙˆÙ„ Ø§Ù„Ù…ÙƒØ±Ù‘Ø±Ø©) | â€” | â€” |

> âš ï¸ **Ù…ØªØ·Ù„Ù‘Ø¨ ÙÙ‡Ø§Ø±Ø³ ÙÙŠ Ø§Ù„Ø¥Ù†ØªØ§Ø¬:** `whereEqualTo("userId").orderBy("date", DESC).limit(1)` (A5:164) ÙŠØªØ·Ù„Ù‘Ø¨ **ÙÙ‡Ø±Ø³Ù‹Ø§ Ù…Ø±ÙƒÙ‘Ø¨Ù‹Ø§**Ø› A5:199-204 ÙŠØ¹Ø§Ù„Ø¬ Ø®Ø·Ø£ Ø§Ù„ÙÙ‡Ø±Ø³ ØµØ±Ø§Ø­Ø©Ù‹. Ø·Ø¨Ù‚Ø© ÙˆÙŠÙ†Ø¯ÙˆØ² Ø³ØªÙˆØ§Ø¬Ù‡ Ù†ÙØ³ Ø§Ù„Ù…ØªØ·Ù„Ù‘Ø¨.


---

## 8. Ù†Ù…ÙˆØ°Ø¬ Ø§Ù„Ø£Ù…Ø§Ù† (Security Model)

### 8.1 Ø§Ù„Ø³Ù„ÙˆÙƒ Ù„ÙƒÙ„ Ø¯ÙˆØ± (Ù…ÙØ³ØªØ®Ø±ÙŽØ¬ Ù…Ù† A1ØŒ ÙˆÙ…ÙØ«Ø¨ÙŽØª Ø¨Ø£Ø¯Ù„Ø© Stage 3)

| Ø§Ù„Ø¹Ù…Ù„ÙŠØ© | `unauth` | `pending emp` | `approved emp` | `assistant` | `admin` |
|---|---|---|---|---|---|
| `GET users/{uid}` â€” **Ù†ÙØ³Ù‡** | `401/403` âœ… | `200` | `200` | `200` | `200` |
| `GET users/{uid}` â€” **ØºÙŠØ±Ù‡** | `403` âœ… | `403` âœ… | `403` âœ… | `200` | `200` |
| `GET users` (list) | `403` âœ… | `403` âœ… | `403` âœ… | `200` | `200` |
| `PATCH` Ù…Ù„ÙÙ‡ `{name}` | `403` | `200` | `200` | `200` | `200` |
| `PATCH` Ù…Ù„ÙÙ‡ `{status:pending}` | `403` | ÙÙ‚Ø· `rejectedâ†’pending` | ÙÙ‚Ø· `rejectedâ†’pending` | `200` | `200` |
| `PATCH` Ù…Ù„ÙÙ‡ `{role}` / `{employeeId}` | `403` | `403` âœ… | `403` âœ… | `200` | `200` |
| `GET medicines` | `403` | `200` | `200` | `200` | `200` |
| `POST/PATCH/DELETE medicines` | `403` | `403` âœ… | `403` âœ… | `200` | `200` |
| `GET settings/app` | `403` | `200` | `200` | `200` | `200` |
| `PATCH settings/app` | `403` | `403` | `403` | `200` | `200` |
| `GET/PATCH stock_logs` | `403` | `403` âœ… | `403` âœ… | `200` | `200` |
| `POST order_requests` (Ø³Ù„ÙŠÙ…Ø©) | `403` | `403` âœ… | `200` | `200` | `200` |
| `POST order_requests` (+ Ù…ÙØªØ§Ø­ Ø²Ø§Ø¦Ø¯) | `403` | `403` | `403` âœ… | `403` | `403` |
| `PATCH/DELETE order_requests` | `403` | `403` âœ… | `403` âœ… | `200` | `200` |
| `GET orders/{id}` â€” Ù…Ù„ÙƒÙ‡ | `403` | `200` | `200` | `200` | `200` |
| `GET orders/{id}` â€” ØºÙŠØ±Ù‡ | `403` | `403` âœ… | `403` âœ… | `200` | `200` |
| `POST/PATCH/DELETE orders` | `403` | `403` âœ… | `403` âœ… | `200` | `200` |
| `:runQuery orders where userId==auth.uid` | `403` | `200` | `200` | `200` | `200` |
| `:runQuery orders` (Ø¨Ù„Ø§ ÙÙ„ØªØ±) | `403` | `403` âœ… | `403` âœ… | `200` | `200` |

âœ… = **Ù…ÙØ«Ø¨ÙŽØª ÙØ¹Ù„ÙŠÙ‹Ø§ Ø¨Ø·Ù„Ø¨ HTTP Ø­Ù‚ÙŠÙ‚ÙŠ** ÙÙŠ Ù…Ø¬Ù…ÙˆØ¹Ø© Stage 3 (54 Ø§Ø®ØªØ¨Ø§Ø±Ù‹Ø§ØŒ `exit code 0`).
**Ø§Ù„Ù†Ù‚Ø·Ø© Ø§Ù„Ø¬ÙˆÙ‡Ø±ÙŠØ©:** ÙƒÙ„ `403` ÙÙŠ ØµÙÙ‘ `pending employee` Ù‡Ùˆ **Ù‚Ø±Ø§Ø± Ø§Ù„Ø®Ø§Ø¯Ù…** Ø¹Ù„Ù‰ Ø§Ù„Ù‚ÙˆØ§Ø¹Ø¯ Ù†ÙØ³Ù‡Ø§ Ø§Ù„ØªÙŠ ÙŠÙ‚Ø±Ø£Ù‡Ø§ Ø§Ù„Ø£Ù†Ø¯Ø±ÙˆÙŠØ¯.

### 8.2 Ù…Ø¨Ø§Ø¯Ø¦ Ù…Ù„Ø²Ù…Ø© Ù„Ù„Ø·Ø¨Ù‚Ø© Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø©

1. **`assistant` = `admin` ÙÙŠ A1** (Ø³Ø·Ø± 20). Ù„Ø§ ÙØ±Ù‚ Ø³Ù„ÙˆÙƒÙŠØ› Ø§Ù„ÙØ±Ù‚ ÙˆØ¸ÙŠÙÙŠ ÙÙ‚Ø· â€” ÙØ­Øµ Ø¨Ø±ÙŠØ¯ ÙÙŠ A4:986 (C4).
2. **`unauthenticated` Ù„Ø§ ÙŠÙ‚Ø±Ø£ Ø´ÙŠØ¦Ù‹Ø§.** `FirestoreRestClient` ÙŠØ±ÙØ¶ Ø¥Ø±Ø³Ø§Ù„ Ø·Ù„Ø¨ Ø¨Ù„Ø§ Ø±Ù…Ø² Ø£ØµÙ„Ù‹Ø§.
3. **`403` Ù„ÙŠØ³ Ù‚Ø§Ø¨Ù„Ù‹Ø§ Ù„Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©** â€” Ù‡Ùˆ Ù‚Ø±Ø§Ø± A1. ØªØ¹Ø±Ø¶Ù‡ UX ÙˆÙ„Ø§ ÙŠÙØ¹Ø§Ø¯ Ø§Ù„Ø·Ù„Ø¨.
4. **`200` Ø¹Ù„Ù‰ Ù…Ø³ØªÙ†Ø¯ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯ = `NOT_FOUND` Ù„Ø§ `403`.** A5:598-612 ÙŠØªÙˆÙ‚Ù‘Ø¹ Ù‡Ø°Ø§ ØµØ±Ø§Ø­Ø©Ù‹.
5. **Ù„Ø§ Ø¹Ù…ÙŠÙ„ REST ÙŠÙ…ÙƒÙ†Ù‡ Ø§Ù„ØªØ­Ø§ÙŠÙ„.** Stage 3 Ø£Ø«Ø¨Øª Ø£Ù† Ø§Ù„Ø·Ù„Ø¨ Ø°Ø§ØªÙ‡ Ø¨Ø±Ù…Ø² Ù…Ø®ØªÙ„Ù ÙŠØ¹Ø·ÙŠ `403` Ù…Ù‚Ø§Ø¨Ù„ `200`.
6. **Ø§Ù„Ø±Ù…ÙˆØ² ØªØ¨Ù‚Ù‰ ÙÙŠ Ø§Ù„Ø¹Ù…Ù„ÙŠØ© Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ©** â€” `SafeAuthState` Ø¨Ù„Ø§ Ø±Ù…ÙˆØ²ØŒ ÙˆØ§Ù„ÙˆØ§Ø¬Ù‡Ø© ØªØ³ØªÙ‚Ø¨Ù„ DTO Ø¨Ù„Ø§ `role` Ù„Ø§ØªØ®Ø§Ø° Ù‚Ø±Ø§Ø±.


---

## 9. Ø§Ù„Ø¨Ù†ÙŠØ© Ø§Ù„Ù…Ù‚ØªØ±Ø­Ø© Ù„Ù„Ù…Ø´Ø±ÙˆØ¹

> Ù…Ø¨Ù†ÙŠØ© Ø¹Ù„Ù‰ Ø§Ù„Ù‡ÙŠÙƒÙ„ **Ø§Ù„ÙØ¹Ù„Ù„ÙŠ** Ø§Ù„Ù…ÙˆØ¬ÙˆØ¯ (`config/`, `services/`, `ipc/`, `window/`, `util/`) Ù„Ø§ Ø¹Ù„Ù‰ Ù…Ø«Ø§Ù„ Ø¹Ø§Ù….

```
electron/
  main.ts / preload.ts        âœŽ ØªØ¹Ø¯ÙŠÙ„: Ù‚Ù†ÙˆØ§Øª ÙˆÙ…Ø¹Ø§Ù„Ø¬Ø§Øª IPC Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø© ÙÙ‚Ø·
  config/  window/  util/     â† Ù‚Ø§Ø¦Ù… Ø¨Ù„Ø§ ØªØºÙŠÙŠØ±

  services/                   â† Ø§Ù„Ù†Ù‚Ù„ ÙˆØ§Ù„Ù…ØµØ§Ø¯Ù‚Ø© (Ù‚Ø§Ø¦Ù…)
    firebase-auth.ts          Ø§Ù„Ù…Ø±Ø­Ù„Ø© 2
    firestore-rest.ts         Ø§Ù„Ù…Ø±Ø­Ù„Ø© 3  â—„â”€â”€ ÙŠØ­ØªØ§Ø¬ updateMask (Â§7.3)
    firestore-codec.ts        Ø§Ù„Ù…Ø±Ø­Ù„Ø© 3  â—„â”€â”€ ÙŠØ­ØªØ§Ø¬ serverTimestamp (D4)
    app-status.ts
    order-processing.service.ts  ðŸ†• Stage 5 â€” ØªØµÙ…ÙŠÙ…Ù‡ ÙÙŠ Â§7
    eligibility.service.ts        ðŸ†• ÙŠÙ‚Ø±Ø£ domain/ ÙˆÙŠØ³ØªØ¯Ø¹ÙŠ Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª

  domain/                     ðŸ†• Ù†Ù‚ÙŠ 100% â€” Ù„Ø§ ElectronØŒ Ù„Ø§ FirestoreØŒ Ù„Ø§ I/O
    enums.ts       models.ts        results.ts      errors.ts
    month-year.ts  â­ ØªØ·Ø¨ÙŠØ¹ Ø§Ù„Ø£Ø±Ù‚Ø§Ù… Ø§Ù„Ù‡Ù†Ø¯ÙŠØ© â†’ ASCII (D1)
    schedule.ts    â­ Ù†Ø§ÙØ°Ø© Asia/Damascus + Ø§Ù„Ø¬Ù…Ø¹Ø©
    order-rules.ts â­ aggregateItems, maxQuantity, Ø­Ø¯ 5 Ø£ØµÙ†Ø§Ù
    eligibility.ts â­ Ù…Ù†ÙØ° A2 Â§6.2 Ø­Ø±ÙÙŠÙ‹Ø§

  repositories/
    contracts/                ðŸ†• Ø§Ù„ÙˆØ§Ø¬Ù‡Ø§Øª (Â§3.2) â€” 6 Ù…Ù„ÙØ§Øª
    firestore/                ðŸ†• Ø§Ù„ØªÙ†ÙÙŠØ°Ø§Øª â€” 6 Ù…Ù„ÙØ§Øª
      mappers/                â†• Ø­Ø¯ÙˆØ¯ Ø§Ù„ÙˆØ­ÙŠØ¯Ø© Ø¨ÙŠÙ† Firestore ÙˆÙ†Ø·Ø§Ù‚ Ø§Ù„Ù…Ø¬Ø§Ù„
      document-id.ts          â­ ØªÙˆÙ„ÙŠØ¯ Ù…ÙØ¹Ø±Ù‘Ù Ù…ØªÙˆØ§ÙÙ‚ (Â§7.5)

  ipc/                        âœŽ channels.ts Â· api.ts Â· handlers/ (4 Ù…Ø¹Ø§Ù„Ø¬Ø§Øª)

src/shared/
  ipc-contract.d.ts           âœŽ Ù…ÙˆØ³Ù‘Ø¹ Ø¨Ù€ DTO Ù„Ù„ÙˆØ§Ø¬Ù‡Ø© (Ø¨Ù„Ø§ Ø±Ù…ÙˆØ²ØŒ Ø¨Ù„Ø§ Ù…Ø³ØªÙ†Ø¯Ø§Øª)
  domain-view.d.ts            ðŸ†• Ø¥Ø³Ù‚Ø§Ø· Ø¢Ù…Ù† Ù„Ù†Ù…Ø§Ø°Ø¬ Ø§Ù„Ù…Ø¬Ø§Ù„ Ù†Ø­Ùˆ Ø§Ù„ÙˆØ§Ø¬Ù‡Ø©

tests/
  domain/         ðŸ†• Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª ØµØ§ÙÙŠØ© (node --testØŒ Ø¨Ù„Ø§ Ø´Ø¨ÙƒØ©)
  repositories/   ðŸ†• fetch Ù…ÙØ¯Ø®ÙŽÙ„ â€” ÙŠØªØ­Ù‚Ù‚ Ù…Ù† Ø§Ù„Ù…Ø³Ø§Ø±Ø§Øª ÙˆØ§Ù„Ø­Ù…ÙˆÙ„Ø§Øª
  emulator/       Ù…Ø¬Ù…ÙˆØ¹Ø© Stage 3 Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©Ø› ØªÙÙˆØ³ÙŽÙ‘Ø¹ Ø¨Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª Ø­Ù‚ÙŠÙ‚ÙŠØ©
```

### 9.1 Ù„Ù…Ø§Ø°Ø§ Ù‡Ø°Ø§ Ø§Ù„Ù…ÙˆØ¶Ø¹ ØªØ­Ø¯ÙŠØ¯Ù‹Ø§ØŸ

| Ø§Ù„Ù‚Ø±Ø§Ø± | Ø§Ù„Ø³Ø¨Ø¨ |
|---|---|
| `domain/` Ù…Ù†ÙØµÙ„ ØªÙ…Ø§Ù…Ù‹Ø§ | `tsconfig` ØµØ§Ø±Ù… (`noUnusedLocals`, `noImplicitAny`). Ø§Ù„Ø¹Ø²Ù„ ÙŠØ¬Ø¹Ù„ Ø§Ø®ØªØ¨Ø§Ø± Ù‚ÙˆØ§Ø¹Ø¯ Ø§Ù„Ø£Ø¹Ù…Ø§Ù„ Ù…Ù…ÙƒÙ†Ù‹Ø§ Ø¨Ù€ `node --test` Ø¨Ù„Ø§ Electron ÙˆØ¨Ù„Ø§ Ù…Ø­Ø§ÙƒÙŠ. |
| `repositories/contracts/` Ù…Ù†ÙØµÙ„Ø© | ÙŠØ³Ù…Ø­ Ø¨ØªØ¨Ø¯ÙŠÙ„ Ø§Ù„Ù†Ù‚Ù„ Ù„Ø§Ø­Ù‚Ù‹Ø§ Ø¯ÙˆÙ† Ù„Ù…Ø³ Ù…Ù†Ø·Ù‚ Ø§Ù„Ù…Ø¬Ø§Ù„. |
| `mappers/` ÙƒØ­Ø¯Ù‘ ÙˆØ­ÙŠØ¯ | ÙƒÙ„ ØªØ³Ø§Ù…Ø­ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø© (Â§10) ÙŠØªØ±Ùƒ ÙÙŠ Ø·Ø¨Ù‚Ø© ÙˆØ§Ø­Ø¯Ø© Ù‚Ø§Ø¨Ù„Ø© Ù„Ù„Ø§Ø®ØªØ¨Ø§Ø±ØŒ ÙÙ„Ø§ ÙŠØªØ³Ø±Ù‘Ø¨ Ø¥Ù„Ù‰ Ø§Ù„Ù…Ø¬Ø§Ù„. |
| Ø¥Ø¨Ù‚Ø§Ø¡ `firestore-rest.ts` ÙÙŠ `services/` | Ù†Ù‚Ù„Ù‡ Ø§Ù„Ø¢Ù† ÙŠÙƒØ³Ø± Ø¨Ù†ÙŠØ© Ù…ÙØ®ØªØ¨ÙŽØ±Ø© Ø¨Ù€ 81 Ø§Ø®ØªØ¨Ø§Ø±Ù‹Ø§. |

### 9.2 Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø§ØªØ¬Ø§Ù‡ (imports)

```
renderer â†’ ipc/api â†’ ipc/handlers â†’ services â†’ repositories/contracts â†’ domain
                                                    â†“
                                    repositories/firestore â†’ services/firestore-rest
```
`domain` **Ù„Ø§ ÙŠØ³ØªÙˆØ±Ø¯** Ø£ÙŠÙ‹Ù‘Ø§ Ù…Ù…Ø§ Ø³Ø¨Ù‚. `repositories/contracts` Ù„Ø§ ÙŠØ³ØªÙˆØ±Ø¯ `services`.


---

## 10. ØªØ¹Ø§Ø±Ø¶Ø§Øª Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª (Data Inconsistencies)

> âš ï¸ **Ù„Ù… Ø£Ø¹Ø¯Ù‘Ù„ ÙˆÙ„Ø§ Ø£Ø±Ø­Ù‘Ù„ Ø£ÙŠ Ø¨ÙŠØ§Ù†Ø§Øª.** ØªÙˆØ«ÙŠÙ‚ + ØªÙˆØµÙŠØ© ÙÙ‚Ø·.
> **Ø§Ù„Ø¯Ù„ÙŠÙ„:** A8 `audit_report.json` (26 Ø·Ù„Ø¨Ù‹Ø§ØŒ 5 Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ†ØŒ 8 Ø´ÙˆØ§Ù‡Ø¯) Ùˆ A9 `users_backup_*.json`.

### D1 ðŸ”´ Ø­Ø±Ø¬ â€” `monthYear` Ø¨Ø£Ø±Ù‚Ø§Ù… Ù‡Ù†Ø¯ÙŠØ© Ø¹Ø±Ø¨ÙŠØ© Ù…Ù‚Ø§Ø¨Ù„ ASCII

**Ø¯Ù„ÙŠÙ„ Ù…Ù† Ø¨ÙŠØ§Ù†Ø§Øª Ø¥Ù†ØªØ§Ø¬ÙŠØ© Ø­Ù‚ÙŠÙ‚ÙŠØ© (A8):**

```json
{ "userId": "VYFQiosm5LSGhaMHbshGWu9P4AD2", "lastOrderMonthYear": "Ù Ù¦-Ù¢Ù Ù¢Ù¦" }  // 06-2026
{ "userId": "nGelWLP1kyfUIFbF8GY6KqK87fj2", "lastOrderMonthYear": "Ù Ù¥-Ù¢Ù Ù¢Ù¦" }  // 05-2026
{ "userId": "rZrWw2nEIKPgzwk6ksGqDJnsK6H2", "lastOrderMonthYear": "Ù Ù¦-Ù¢Ù Ù¢Ù¦" }
{ "userId": "u59Q91tsTua3RniyrqwVjpSZhxo2", "lastOrderMonthYear": "Ù Ù¦-Ù¢Ù Ù¢Ù¦" }
```
â‡’ **4 Ù…Ù† 4** Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ† Ù„Ø¯ÙŠÙ‡Ù… Ø·Ù„Ø¨Ø§Øª ØªØ­Ù…Ù„ `monthYear` Ø¨Ø£Ø±Ù‚Ø§Ù… Ù‡Ù†Ø¯ÙŠØ© Ø¹Ø±Ø¨ÙŠØ© (U+0660â€¦U+0669).

**Ø§Ù„Ø³Ø¨Ø¨ â€” Ø«Ù„Ø§Ø«Ø© Ù…ÙˆØ§Ø¶Ø¹ØŒ Ø§Ø«Ù†Ø§Ù† Ø¨Ù„ØºØ© Ø§Ù„Ù†Ø¸Ø§Ù…:**

| Ø§Ù„Ù…ÙˆØ¶Ø¹ | Ø§Ù„Ø´ÙŠÙØ±Ø© | Ø§Ù„Ù†Ø§ØªØ¬ |
|---|---|---|
| `AdminOrderProcessor.kt:89` | `SimpleDateFormat("MM-yyyy", **Locale.US**)` | **ASCII** `06-2026` |
| `MainActivity.kt:149` | `SimpleDateFormat("MM-yyyy", **Locale.getDefault()**)` | **Ù‡Ù†Ø¯ÙŠ Ø¹Ø±Ø¨ÙŠ** Ø¹Ù„Ù‰ Ø¬Ù‡Ø§Ø² Ø¹Ø±Ø¨ÙŠ |
| `MedicineOrderActivity.kt:172` | `SimpleDateFormat("MM-yyyy", **Locale.getDefault()**)` | **Ù‡Ù†Ø¯ÙŠ Ø¹Ø±Ø¨ÙŠ** Ø¹Ù„Ù‰ Ø¬Ù‡Ø§Ø² Ø¹Ø±Ø¨ÙŠ |

**Ø§Ù„Ø£Ø«Ø± (Ø­Ø±Ø¬):** ÙØ­Øµ A2:139
```kotlin
if (user.lastOrderMonthYear.isNotBlank() && user.lastOrderMonthYear == requestMonthYear)
```
`"Ù Ù¥-Ù¢Ù Ù¢Ù¦" == "05-2026"` â‡’ **false Ø¯Ø§Ø¦Ù…Ù‹Ø§**. Ø£ÙŠ Ø£Ù† **Ù‚Ø§Ø¹Ø¯Ø© Â«Ø·Ù„Ø¨ ÙˆØ§Ø­Ø¯ ÙÙŠ Ø§Ù„Ø´Ù‡Ø±Â» Ù…Ø¹Ø·Ù‘Ù„Ø© ØªÙ…Ø§Ù…Ù‹Ø§** Ù„ÙƒÙ„ Ù…Ø³ØªØ®Ø¯Ù… ÙŠØ­Ù…Ù„ ØªØ§Ø±ÙŠØ®Ù‹Ø§ Ø¨Ø§Ù„Ù‡Ù†Ø¯ÙŠØ© Ø§Ù„Ø¹Ø±Ø¨ÙŠØ© â€” ÙŠÙ…ÙƒÙ†Ù‡ Ø§Ù„Ø·Ù„Ø¨ Ù…Ø±Ø§Ø±Ù‹Ø§ ÙÙŠ Ø§Ù„Ø´Ù‡Ø± Ù†ÙØ³Ù‡.

**Ø§Ù„Ø³Ù„Ø·Ø©:** A2 Ù‡Ùˆ Ø§Ù„Ù…Ø¹ÙŠØ§Ø± Ø§Ù„Ø¯Ù„Ø§Ù„ÙŠ (`Locale.US` â‡’ ASCII) ÙˆÙŠÙˆØ§ÙÙ‚Ù‡ A7 â€” Ù„ÙƒÙ† **Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© ØªØ®Ø§Ù„ÙÙ‡**.

**ØªÙˆØµÙŠØ© Ù„Ø·Ø¨Ù‚Ø© ÙˆÙŠÙ†Ø¯ÙˆØ² (Ø¨Ø¯ÙˆÙ† ØªØ±Ø­ÙŠÙ„):**
1. `domain/month-year.ts` ÙŠÙˆÙÙ‘Ø± `normalizeMonthYear(v): string | null` ØªÙØ­ÙˆÙ‘Ù„ Ø§Ù„Ø£Ø±Ù‚Ø§Ù… Ø§Ù„Ù‡Ù†Ø¯ÙŠØ© Ø¥Ù„Ù‰ ASCII.
2. ÙƒÙ„ Ø§Ù„Ù…Ù‚Ø§Ø±Ù†Ø§Øª Ø§Ù„Ø´Ù‡Ø±ÙŠØ© ÙÙŠ ÙˆÙŠÙ†Ø¯ÙˆØ² ØªÙ…Ø±Ù‘ Ø¹Ø¨Ø±Ù‡Ø§. **Ù„Ø§ ØªÙÙƒØªØ¨ Ù‚ÙŠÙ…Ø© Ø¬Ø¯ÙŠØ¯Ø© Ø¥Ù„Ø§ Ø¨ØµÙŠØºØ© ASCII.**
3. â›” **Ù‚Ø±Ø§Ø± Ù…Ø·Ù„ÙˆØ¨ Ù…Ù† ØµØ§Ø­Ø¨ Ø§Ù„Ù…Ø´Ø±ÙˆØ¹:** Ù‡Ù„ ØªÙØµØ­ÙŽÙ‘Ø­ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©ØŸ Ø§Ù„Ù…Ø³ØªÙ†Ø¯ **Ù„Ø§ ÙŠÙØªØ±Ø¶ ÙˆÙ„Ø§ ÙŠÙ†ÙÙ‘Ø°** Ø°Ù„Ùƒ â€” Ø§Ù„ØªØ±Ø­ÙŠÙ„ Ù‚Ø±Ø§Ø± Ù…Ù†ÙØµÙ„ ÙŠØªØ·Ù„Ù‘Ø¨ `--apply` Ù…Ø«Ù„ `migration/migrate-user-orders.js`.

### D2 ðŸŸ¡ Ø§Ù„Ù…Ù†Ø·Ù‚Ø© Ø§Ù„Ø²Ù…Ù†ÙŠØ©: Ø¯Ù…Ø´Ù‚ Ù…Ù‚Ø§Ø¨Ù„ Ù…Ù†Ø·Ù‚ Ø§Ù„Ø¬Ù‡Ø§Ø²

| Ø§Ù„Ù…ÙˆØ¶Ø¹ | Ø§Ù„Ù…Ù†Ø·Ù‚Ø© |
|---|---|
| `AdminOrderProcessor.getDamascusCalendar` (A2:80) | `Asia/Damascus` âœ… |
| A7 `BUSINESS_TIMEZONE` | `Asia/Damascus` âœ… |
| `MedicineOrderActivity:129` | `Calendar.getInstance()` = **Ù…Ù†Ø·Ù‚Ø© Ø§Ù„Ø¬Ù‡Ø§Ø²** |
| `MainActivity:148-149` | `java.util.Date()` = **Ù…Ù†Ø·Ù‚Ø© Ø§Ù„Ø¬Ù‡Ø§Ø²** |

**Ø§Ù„Ø£Ø«Ø±:** ÙØ­Øµ Ø§Ù„Ù†Ø§ÙØ°Ø© Ø§Ù„Ø²Ù…Ù†ÙŠØ© ÙˆØ§Ù„Ø¬Ù…Ø¹Ø© ÙÙŠ Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© Ù‚Ø¯ ÙŠØ¹Ø·ÙŠ **Ù†ØªÙŠØ¬Ø© Ù…Ø®ØªÙ„ÙØ©** Ø¹Ù† ÙØ­Øµ A2 Ø¹Ù„Ù‰ Ø¬Ù‡Ø§Ø² ÙÙŠ Ù…Ù†Ø·Ù‚Ø© Ø£Ø®Ø±Ù‰.
**Ø§Ù„Ø³Ù„Ø·Ø©:** `Asia/Damascus` (Ø§ØªÙØ§Ù‚ A2 + A7). **ØªÙˆØµÙŠØ©:** `domain/schedule.ts` ÙŠØ¹Ø²Ù„ Ø§Ù„Ù…Ù†Ø·Ù‚Ø© ÙƒØ«Ø§Ø¨Øª ÙˆØ§Ø­Ø¯Ø› Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© ØªØ¹Ø±Ø¶ ØªÙˆÙ‚ÙŠØª Ø¯Ù…Ø´Ù‚ ØµØ±Ø§Ø­Ø©Ù‹.

### D3 ðŸŸ¡ `stock_logs.uid` Ù„Ù‡ Ø¯Ù„Ø§Ù„ØªØ§Ù† Ù…ØªØ¹Ø§Ø±Ø¶ØªØ§Ù†

| Ø§Ù„ÙƒØ§ØªØ¨ | Ø§Ù„Ù‚ÙŠÙ…Ø© | Ø§Ù„Ø¯Ù„Ø§Ù„Ø© Ø§Ù„ÙØ¹Ù„ÙŠØ© |
|---|---|---|
| `AdminOrderProcessor.kt:368` | `uid` (Ù…Ù† `order_requests`) | **Ù…Ø¹Ø±Ù‘Ù Ø§Ù„Ù…ÙˆØ¸Ù** Ø§Ù„Ø°ÙŠ Ø·Ù„Ø¨ |
| `AdminActivity.kt:415ØŒ 463ØŒ 591ØŒ 886` | `adminUid` | **Ù…Ø¹Ø±Ù‘Ù Ø§Ù„Ù…Ø¯ÙŠØ±** Ø§Ù„Ø°ÙŠ Ù†ÙÙ‘Ø° |

**Ø§Ù„Ø³Ù„Ø·Ø©:** Ù„Ø§ Ù…ØµØ¯Ø± Ù…ÙˆØ­Ù‘Ø¯. **ØªÙˆØµÙŠØ©:** ØªØ³Ù…ÙŠØ© Ø§Ù„Ù…Ø¬Ø§Ù„ `actorUid` Ù…Ø¹ ØªÙˆØ«ÙŠÙ‚ Ø£Ù†Ù‡Ø§ Â«Ù…Ù† Ù†ÙÙ‘Ø° Ø§Ù„Ø­Ø±ÙƒØ©Â»ØŒ ÙˆØ§Ù„Ø§Ø¹ØªÙ…Ø§Ø¯ Ø¹Ù„Ù‰ `orderId`/`requestId` Ù„ØªØ­Ø¯ÙŠØ¯ Ø§Ù„Ù…ÙˆØ¸Ù.

### D4 ðŸ”´ `timestamp` â€” ØªÙ…Ø«ÙŠÙ„ Ø§Ù„ØªØ®Ø²ÙŠÙ† Ù…Ù‚Ø§Ø¨Ù„ Ù‚Ø¯Ø±Ø© Ø§Ù„Ù…ÙØ±Ù…ÙÙ‘Ø²

| Ø§Ù„ØªÙ…Ø«ÙŠÙ„ | Ø£ÙŠÙ† |
|---|---|
| `Timestamp` (ÙƒØ§Ø¦Ù†) | A2:212 `getTimestamp("requestDate")` |
| `{_seconds, _nanoseconds}` | A8 / A9 (ØªØ³Ù„Ø³Ù„ Admin SDK) |
| **Ù†Øµ ISO** | `firestore-codec.ts` â­ `decodeValue` ÙŠÙØ±Ø¬Ø¹ `timestampValue` **ÙƒÙ†Øµ** |

**Ø§Ù„ÙØ¬ÙˆØ© Ø§Ù„Ø­Ø§Ø³Ù…Ø©:** `firestore-codec.ts` ÙŠØ°ÙƒØ± Ø£Ù† `serverTimestamp` **Ù…Ù‚ØµÙˆØ¯Ù‹Ø§ ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ…**. Ù„ÙƒÙ†:
- A5:249 ÙŠÙƒØªØ¨ `requestDate` Ø¨Ù€ `FieldValue.serverTimestamp()`.
- A2:212 ÙŠÙ‚Ø±Ø¤Ù‡ Ø¨Ù€ `getTimestamp()` â‡’ **Ø¥Ù† ÙƒØ§Ù† Ù†ØµÙ‹Ø§ ÙŠÙØ±Ø¬Ø¹ `null`** â‡’ ÙØ´Ù„ `Missing request timestamp`.

> **Ø§Ù„Ø£Ø«Ø±:** Ù„Ùˆ ÙƒØªØ¨Øª ÙˆÙŠÙ†Ø¯ÙˆØ² `requestDate` ÙƒÙ†Øµ ISOØŒ **Ø³ÙŠÙ‚Ø±Ø£Ù‡ Ø£Ù†Ø¯Ø±ÙˆÙŠØ¯ ÙƒÙ€ `null` ÙˆÙŠÙÙØ´Ù„ Ø§Ù„Ø·Ù„Ø¨**.
> **ØªÙˆØµÙŠØ© (Ø´Ø±Ø· Ù…ÙØ³Ø¨Ù‚):** Ø¥Ù…Ù‘Ø§ (Ø£) Ø¥Ø¶Ø§ÙØ© ØªØ±Ù…ÙŠØ² `serverTimestamp` Ø¥Ù„Ù‰ `firestore-codec.ts`ØŒ Ø£Ùˆ (Ø¨) ØªÙ…Ø±ÙŠØ± ÙƒØ§Ø¦Ù† `Date` (Ù…Ø¯Ø¹ÙˆÙ… ÙÙŠ `encodeValue`) ÙÙŠÙÙ†ØªØ¬ `timestampValue` ØµØ­ÙŠØ­Ù‹Ø§.
> **Ù…Ù„Ø§Ø­Ø¸Ø© Ø£Ù…Ù†ÙŠØ©:** Ø§Ù„Ø®ÙŠØ§Ø± (Ø¨) ÙŠØ¬Ø¹Ù„ **Ø³Ø§Ø¹Ø© Ø§Ù„Ø¹Ù…ÙŠÙ„** Ù…ØµØ¯Ø± `requestDate` Ø¨Ø¯Ù„ Ø®Ø§Ø¯Ù… FirebaseØŒ ÙØªØ®Ø¶Ø¹ `validateScheduleAndTime` Ù„Ø«Ù‚Ø© Ø§Ù„Ø¹Ù…ÙŠÙ„. ØªØ¹ÙˆÙŠØ¶ Ø£Ù…Ù†ÙŠ Ø­Ù‚ÙŠÙ‚ÙŠ ÙŠØ³ØªØ­Ù‚ Ù‚Ø±Ø§Ø±Ù‹Ø§ ØµØ±ÙŠØ­Ù‹Ø§.

### D5 ðŸŸ  `FieldValue.increment` ØºÙŠØ± Ù…ØªØ§Ø­ ÙÙŠ REST

A4 ÙŠØ³ØªØ®Ø¯Ù…Ù‡ ÙÙŠ 6 Ù…ÙˆØ§Ø¶Ø¹ (380ØŒ 412ØŒ 458ØŒ 586ØŒ 880ØŒ 881). REST Ù„Ø§ ÙŠÙˆÙÙ‘Ø±Ù‡. â†’ Â§7.4.

### D6 ðŸŸ¡ `userId` Ù…Ù‚Ø§Ø¨Ù„ `uid` â€” ØªØ³Ù…ÙŠØªØ§Ù† Ù„Ù„Ù…Ù„ÙƒÙŠØ©

| Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹Ø© | Ø­Ù‚Ù„ Ø§Ù„Ù…Ù„ÙƒÙŠØ© | Ø³Ø·Ø± A1 |
|---|---|---|
| `orders` | **`userId`** | 77 |
| `order_requests` | **`uid`** | 92 |
| `users` | Ø§Ù„Ù‡ÙˆÙŠØ© Ù†ÙØ³Ù‡Ø§ (`uid`) | 37 |
| `stock_logs` | `uid` (ØºÙŠØ± Ù…Ù‚ÙŠÙŽÙ‘Ø¯ Ø¨Ø§Ù„Ù…Ù„ÙƒÙŠØ©) | 86 |

**Ø§Ù„Ø³Ù„Ø·Ø©:** A1 Ù…ÙØ«Ø¨ÙŽÙ‘Øª ÙÙŠ Ø­Ù‚Ù„Ù‡ Ù„ÙƒÙ„ Ù…Ø¬Ù…ÙˆØ¹Ø©. **Ù„Ø§ ØªÙˆØ­ÙŠØ¯.** Ø§Ù„Ù€ mappers ÙÙŠ ÙˆÙŠÙ†Ø¯ÙˆØ² **ØªØ­ØªØ±Ù…** Ø§Ù„Ø§Ø®ØªÙ„Ø§Ù.

### D7 ðŸŸ  Ù…Ø³ØªÙ†Ø¯ Ù…Ø¯ÙŠØ± Ø¥Ù†ØªØ§Ø¬ÙŠ Ø¨Ù„Ø§ `hasException`

A9 ÙŠØ«Ø¨Øª Ø£Ù† Ù…Ø³ØªÙ†Ø¯ Ø§Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠ = `{uid, role, name, employeeId, status}` ÙÙ‚Ø·.
**Ø§Ù„Ø£Ø«Ø±:** A1:46 ØªØ´ØªØ±Ø·Ù‡ **Ø¹Ù†Ø¯ Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡ ÙÙ‚Ø·**Ø› Ø§Ù„Ù‚Ø±Ø§Ø¡Ø© Ù„Ø§ ØªØªØ·Ù„Ù‘Ø¨Ù‡ â‡’ Ù„Ø§ ÙƒØ³Ø±. ÙˆA2 ÙŠÙ‚Ø±Ø£ `getBoolean("hasException") == true` â‡’ `false` Ø¨Ø£Ù…Ø§Ù†.
**ØªÙˆØµÙŠØ©:** Ø§Ù„Ù€ mapper ÙŠØ¹Ø§Ù…Ù„ Ø§Ù„ØºÙŠØ§Ø¨ ÙƒÙ€ `false`ØŒ Ù„Ø§ ÙƒØ®Ø·Ø£.

### D8 ðŸŸ¡ `null` Ù…Ù‚Ø§Ø¨Ù„ Â«Ø­Ù‚Ù„ ØºØ§Ø¦Ø¨Â»

Ù‚Ø¨Ù„ Ø§Ù„ØªØ±Ø­ÙŠÙ„: Ù…Ø³ØªÙ†Ø¯Ùˆ `users` **Ù„Ø§ ÙŠØ­ØªÙˆÙˆÙ†** `lastOrder*` Ø¥Ø·Ù„Ø§Ù‚Ù‹Ø§ (A9). Ø¨Ø¹Ø¯ Ø§Ù„ØªØ±Ø­ÙŠÙ„ (A8): ÙƒÙØªØ¨Øª **Ù‚ÙŠÙ… `null` ØµØ±ÙŠØ­Ø©**.
â‡’ ÙƒÙ„Ø§ Ø§Ù„Ø´ÙƒÙ„ÙŠÙ† Ù‚Ø§Ø¦Ù… ÙÙŠ Ø§Ù„Ø¥Ù†ØªØ§Ø¬. **ØªÙˆØµÙŠØ©:** ÙƒÙ„ Ø­Ù‚Ù„ Ø§Ø®ØªÙŠØ§Ø±ÙŠ ÙŠÙÙ‚Ø±Ø£ Ø¨Ù€ `?? Ø§ÙØªØ±Ø§Ø¶ÙŠ` (Ù„Ø§ `typeof`).

### D9 ðŸŸ¡ `settings` â€” Ù…Ø¹Ø±Ù‘Ù Ø«Ø§Ø¨Øª ÙˆØ­Ù‚ÙˆÙ„ Ù…ÙŠØªØ©

- Ø§Ù„Ù…Ø¹Ø±Ù‘Ù **`app`** (A5:84ØŒ A2:246). Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª Stage 3 Ø§Ø³ØªØ®Ø¯Ù…Øª `settings/schedule` ÙƒÙ€ fixture.
- `maxDailyOrders` Ùˆ `assistantId` **ÙŠÙÙƒØªØ¨Ø§Ù† ÙˆÙ„Ø§ ÙŠÙÙ‚Ø±Ø¢Ù†** ÙÙŠ Ø£ÙŠ Ù…Ø³Ø§Ø± Ø·Ù„Ø¨ (Â§2.8).
**ØªÙˆØµÙŠØ©:** `SettingsRepository` ÙŠØ³ØªØ®Ø¯Ù… `settings/app` **Ø­ØµØ±ÙŠÙ‹Ø§**.

### D10 ðŸŸ¡ `stock_logs.userName` Ù†Øµ ÙˆØµÙÙŠ Ø­Ø±

Ù‚ÙŠÙ… Ø­Ù‚ÙŠÙ‚ÙŠØ© Ù…Ù† A4: `Â«Ø¥Ù„ØºØ§Ø¡ Ø·Ù„Ø¨: â€¦Â»`ØŒ `Â«Ø­Ø°Ù ØµÙ†Ù Ù…Ù† Ø·Ù„Ø¨: â€¦Â»`ØŒ `Â«ØªØ¹Ø¯ÙŠÙ„ ÙƒÙ…ÙŠØ© ÙÙŠ Ø·Ù„Ø¨: â€¦ (Ù…Ù† 3 Ø¥Ù„Ù‰ 5)Â»`ØŒ `Â«Ø§Ù„Ù…Ø¯ÙŠØ±Â»`ØŒ `Â«Ø§Ù„Ù…Ø¯ÙŠØ± (Ø¯ÙˆØ§Ø¡ Ø¬Ø¯ÙŠØ¯)Â»`.
**Ù„Ø§ ÙŠÙ…ÙƒÙ†** Ø¹Ø±Ø¶Ù‡ ÙƒÙ€Â«Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…Â». **ØªÙˆØµÙŠØ©:** Ø­Ù‚Ù„ Ù…Ø³Ù…Ù‘Ù‰ `label` ÙÙŠ Ø§Ù„Ù…Ø¬Ø§Ù„.


---

## 11. Ø§Ù„ØªØ¹Ø§Ø±Ø¶Ø§Øª Ø§Ù„Ù…ÙƒØªØ´ÙØ© (Conflicts)

> ÙƒÙ„ ØªØ¹Ø§Ø±Ø¶ ÙŠÙØ°ÙƒØ± **Ø¨ÙƒÙ„ Ø£Ø·Ø±Ø§ÙÙ‡** Ù…Ø¹ ØªØ­Ø¯ÙŠØ¯ Ø§Ù„Ø³Ù„Ø·Ø©. Ù„Ø§ Ø§Ø®ØªÙŠØ§Ø± ØµØ§Ù…Øª.

| # | Ø§Ù„ØªØ¹Ø§Ø±Ø¶ | Ø§Ù„Ø£Ø·Ø±Ø§Ù | **Ø§Ù„Ø³Ù„Ø·Ø©** | Ø§Ù„Ù‚Ø±Ø§Ø± Ø§Ù„Ù…ÙˆØ«Ù‘Ù‚ |
|---|---|---|---|---|
| **C1** | `AdminActivity` ØºÙŠØ± Ù…ÙÙØ¹ÙŽÙ‘Ù„ ÙÙŠ ØªØ·Ø¨ÙŠÙ‚ Ø£Ù†Ø¯Ø±ÙˆÙŠØ¯: ØºÙŠØ± Ù…ÙØ³Ø¬ÙŽÙ‘Ù„ ÙÙŠ `AndroidManifest.xml`ØŒ ÙˆÙ„Ø§ ÙŠØ·Ù„Ù‚Ù‡ Ø£ÙŠ ÙƒÙˆØ¯ (A6 ÙŠØ¹Ø±Ø¶ Ø±Ø³Ø§Ù„Ø© ÙÙ‚Ø· Ø¹Ù†Ø¯ `role=="admin"`). â‡’ `AdminOrderProcessor` **Ù„Ø§ ÙŠØ¹Ù…Ù„** ÙÙŠ Ø§Ù„Ø¨Ù†Ø§Ø¡ Ø§Ù„Ù…ÙØ³Ù„ÙŽÙ‘Ù…. | A4 Â· A6 Â· Manifest | **A1** (Ù„Ø§ ØªØªØ£Ø«Ø±) | â›” **Ù„Ø§ ØªÙ†Ø³Ø® Ù‡Ø°Ø§.** ØªØ·Ø¨ÙŠÙ‚ ÙˆÙŠÙ†Ø¯ÙˆØ² Ø³ÙŠØ­ØªØ§Ø¬ Ù…Ø³Ø§Ø± Ù…Ø¹Ø§Ù„Ø¬Ø© Ø®Ø§ØµÙ‹Ø§ Ø¨Ù‡. Ù…Ø´Ø±ÙˆØ¹ Ø£Ù†Ø¯Ø±ÙˆÙŠØ¯ Ù…ØªØ±ÙˆÙƒ. |
| **C2** | **Ù…ÙØ¹Ø§Ù„Ø¬Ø§Ù† Ù…Ø®ØªÙ„ÙØ§Ù† Ù„Ù„Ø·Ù„Ø¨ Ù†ÙØ³Ù‡.** A7 (Cloud Function) Ø¹Ù† A2 (Ù…Ø¹Ø§Ù„Ø¬ Ø§Ù„Ø¹Ù…ÙŠÙ„). A7: (Ø£) ÙŠÙ†ÙÙ‘Ø° `where().get()` **Ø¯Ø§Ø®Ù„** `runTransaction` â€” Ù…Ø®Ø§Ù„Ù Ù„Ù€ `migration/README.md`Ø› (Ø¨) ÙŠÙ‚Ø±Ø£ Ù…Ù† Ù…Ø¬Ù…ÙˆØ¹Ø© `orders` Ù„Ø§ Ù…Ù† Ø§Ù„Ø­Ù‚ÙˆÙ„ Ø§Ù„Ù…ÙƒØ±Ù‘Ø±Ø©Ø› (Ø¬) â­ **Ù„Ø§ ÙŠÙƒØªØ¨ `users.lastOrder*` Ø¥Ø·Ù„Ø§Ù‚Ù‹Ø§** (ÙŠØ­Ø¯Ù‘Ø« `hasException` ÙÙ‚Ø·) â‡’ ÙŠØªØ±Ùƒ Ù…Ù„Ø®Ù‘Øµ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… **Ù‚Ø¯ÙŠÙ…Ù‹Ø§**. | A2 Â· A7 Â· README | **A2** | `README` ÙŠØ´Ø±Ø­ Ø£Ù† Ø§Ù„Ø­Ù‚ÙˆÙ„ Ø§Ù„Ù…ÙƒØ±Ù‘Ø±Ø© ÙˆÙØ¬Ø¯Øª **Ù„Ø£Ù† A2 Ù„Ø§ ÙŠØ³ØªØ·ÙŠØ¹ Ø§Ù„Ø§Ø³ØªØ¹Ù„Ø§Ù… Ø¯Ø§Ø®Ù„ Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø©**. Ø¥Ø°Ù† **A2 Ù‡Ùˆ Ø§Ù„Ù…Ø¹ÙŠØ§Ø±** ÙˆA7 Ø³Ù„Ù Ù…Ù‡Ø¬ÙˆØ±. â›” **Ù„Ø§ ØªÙ†Ø´Ø± A7.** |
| **C3** | `monthYear`: ASCII (A2:89) Ù…Ù‚Ø§Ø¨Ù„ Ù‡Ù†Ø¯ÙŠ Ø¹Ø±Ø¨ÙŠ (A5:172ØŒ A6:149) â€” ÙˆØ§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø¥Ù†ØªØ§Ø¬ÙŠØ© Ø¨Ø§Ù„Ù‡Ù†Ø¯ÙŠ. | A2 Â· A5 Â· A6 Â· A8 | **A2** Ø¯Ù„Ø§Ù„ÙŠÙ‹Ø§ | Â§10-D1. â›” **Ù„Ø§ ØªÙØµÙ„ÙŽÙ‘Ø­ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª ÙÙŠ Ù‡Ø°Ù‡ Ø§Ù„Ù…Ø±Ø­Ù„Ø©.** |
| **C4** | ÙØ­Øµ ØµÙ„Ø§Ø­ÙŠØ§Øª ÙÙŠ Ø§Ù„Ø¹Ù…ÙŠÙ„: A6:54 ÙˆA4:986 ÙŠÙ‚Ø§Ø±Ù†Ø§Ù† `email == "assistant@drugapp.internal"` Ù„ÙØ±Ø¶ Ø³Ù„ÙˆÙƒ Ø¥Ø¯Ø§Ø±ÙŠØŒ Ø¨ÙŠÙ†Ù…Ø§ A1 ÙŠØ¹ØªÙ…Ø¯ `role`. | A1 Â· A4 Â· A6 | **A1** | â›” **Ø·Ø¨Ù‚Ø© ÙˆÙŠÙ†Ø¯ÙˆØ² Ù„Ø§ ØªÙ†Ø³Ø® Ù‡Ø°Ø§ Ø§Ù„Ù†Ù…Ø·.** Ø§Ù„Ø¯ÙˆØ± ÙŠÙÙ‚Ø±Ø£ Ù…Ù† `users.role`Ø› ÙØ­Øµ Ø§Ù„Ø¨Ø±ÙŠØ¯ Ù„Ø§ ÙŠØµÙ„Ø­ ÙƒØµÙ„Ø§Ø­ÙŠØ©. |
| **C5** | â›” **ÙØ¬ÙˆØ© `updateMask`:** A2:363 `transaction.update(medRef, "stock", v)` (Ø­Ù‚Ù„ ÙˆØ§Ø­Ø¯) Ø¨ÙŠÙ†Ù…Ø§ `commitWrites` (A10:432) ÙŠØ±Ø³Ù„ `update` Ø¨Ù„Ø§ `updateMask` â‡’ **Ø§Ø³ØªØ¨Ø¯Ø§Ù„ ÙƒØ§Ù…Ù„ Ù„Ù„Ù…Ø³ØªÙ†Ø¯**. | A2 Â· A10 | **A2** Ø¯Ù„Ø§Ù„ÙŠÙ‹Ø§ | Â§7.3. **Ø¥ØµÙ„Ø§Ø­ Ù…ÙÙ„Ø²Ù… Ù‚Ø¨Ù„ Ø£ÙŠ ÙƒØªØ§Ø¨Ø© ÙÙŠ Stage 5.** |
| **C6** | â›” **`serverTimestamp` ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ…** ÙÙŠ `firestore-codec.ts`ØŒ Ø¨ÙŠÙ†Ù…Ø§ A5:249 ÙŠÙƒØªØ¨Ù‡ ÙˆA2:212 ÙŠÙ‚Ø±Ø£Ù‡ Ø¨Ù€ `getTimestamp`. | A2 Â· A5 Â· A10 | **A2** | Â§10-D4. **Ù‚Ø±Ø§Ø± Ù…Ø·Ù„ÙˆØ¨: Ø³Ø§Ø¹Ø© Ø§Ù„Ø®Ø§Ø¯Ù… Ø£Ù… Ø³Ø§Ø¹Ø© Ø§Ù„Ø¹Ù…ÙŠÙ„ØŸ** |
| **C7** | A1:77 ÙˆA1:92 ÙŠØ³ØªØ®Ø¯Ù…Ø§Ù† Ø­Ù‚Ù„ÙŽÙŠ Ù…Ù„ÙƒÙŠØ© Ù…Ø®ØªÙ„ÙÙŠÙ† (`userId` / `uid`) Ù„Ù†ÙØ³ Ø§Ù„Ù…ÙÙ‡ÙˆÙ…. | A1 | **A1** Ù„ÙƒÙ„ Ù…Ø¬Ù…ÙˆØ¹Ø© | Â§10-D6. **Ù„Ø§ ØªÙˆØ­ÙŠØ¯.** |
| **C8** | `stock` ÙŠÙØ®ØµÙ… Ø¹Ù†Ø¯ Ø§Ù„Ø·Ù„Ø¨ (A2) Ø¨ÙŠÙ†Ù…Ø§ `totalOutward` ÙŠÙØ²Ø§Ø¯ Ø¹Ù†Ø¯ Ø§Ù„Ù‚Ø¨ÙˆÙ„ (A4:381) â‡’ `stock â‰  totalInward âˆ’ totalOutward`. | A2 Â· A4 | **A4** Ù„ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø¬Ø±Ø¯ | Â§2.3. ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø¬Ø±Ø¯ ÙŠØ¬Ø¨ Ø£Ù† ÙŠÙØ´ØªÙ‚ Ù…Ù† `stock_logs` ÙƒÙ…Ø§ ÙÙŠ A4:743-745. |
| **C9** | `maxQuantity` Ù…Ø¹Ø±Ù‘Ù ÙƒÙ€Â«Ø­Ø¯ Ø£Ø¹Ù„Ù‰ Ù„Ù„Ø·Ù„Ø¨Â» (A2:310ØŒ A4:961) Ø¨ÙŠÙ†Ù…Ø§ `Models.kt:18` ÙŠØ¹Ø±Ø¶Ù‡ Ø¨Ù„Ø§ ØªÙˆØ«ÙŠÙ‚ Ø¶Ù…Ù† Ù†Ù…ÙˆØ°Ø¬ medicine. | A2 Â· A3 Â· A4 | **A2 + A4** (Ø¹Ù†Ø¯Ù‡Ø§ Ù…Ø¹Ù†Ù‰ ØµØ±ÙŠØ­) | Â§4.2. `Models.kt` **Ø³Ø·Ø­ÙŠ ÙˆÙ„ÙŠØ³ Ù…Ø±Ø¬Ø¹Ù‹Ø§**. |
| **C10** | `maxDailyOrders` Ù…Ø®Ø²ÙŽÙ‘Ù† ÙÙŠ `settings/app` Ù„ÙƒÙ† ÙØ­ØµÙ‡ **Ù…Ø¹Ø·ÙŽÙ‘Ù„ Ø¹Ù…Ø¯Ù‹Ø§** (A5:232-233). | A5 Â· settings | **A5** (Ù‚Ø±Ø§Ø± Ø§Ù„Ù…Ù†ØªØ¬) | Â§2.8. Ù„Ø§ ØªÙ†ÙÙ‘Ø°Ù‡. |
| **C11** | A3 (`Models.kt`) Ù„Ø§ ÙŠØºØ·ÙŠ `lastOrder*` ÙˆÙ„Ø§ `isExceptionOrder` ÙˆÙ„Ø§ `requestId` â€” Ù†Ù…ÙˆØ°Ø¬Ù‡ **Ù†Ø§Ù‚Øµ** Ù…Ù‚Ø§Ø±Ù†Ø© Ø¨Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„ÙØ¹Ù„ÙŠØ©. | A3 Â· A8 | **A8 + A9** | Â§2 ÙÙŠ Ù‡Ø°Ø§ Ø§Ù„Ù…Ø³ØªÙ†Ø¯ Ù‡Ùˆ Ø§Ù„Ù…Ø±Ø¬Ø¹. **Ù„Ø§ ØªÙ†Ø³Ø® A3 Ø­Ø±ÙÙŠÙ‹Ø§.** |

### 11.1 Ù…Ù„Ø®Øµ: Ù…Ù† Ø£ÙŠ Artifact Ù†Ø£Ø®Ø° Ø§Ù„Ù…Ø±Ø¬Ø¹

| Ø§Ù„Ø¬Ø§Ù†Ø¨ | Ø§Ù„Ù…Ø±Ø¬Ø¹ Ø§Ù„Ù…Ø¹ØªÙ…Ø¯ | Ø§Ù„Ù…Ø±ÙÙˆØ¶ |
|---|---|---|
| Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ§Øª | **A1** | A4 Â· A6 (ÙØ­ÙˆØµ Ø¹Ù…ÙŠÙ„) |
| Ù…Ø¹Ø§Ù„Ø¬Ø© Ø§Ù„Ø·Ù„Ø¨ | **A2** | **A7** |
| Ø§Ù„ÙˆÙ‚Øª ÙˆØ§Ù„Ù…Ù†Ø·Ù‚Ø© | **A2** (Ø¯Ù…Ø´Ù‚) | A5 Â· A6 (Ù…Ù†Ø·Ù‚Ø© Ø§Ù„Ø¬Ù‡Ø§Ø²) |
| ØµÙŠØºØ© Ø§Ù„Ø´Ù‡Ø± | **A2** (ASCII) + ØªØ·Ø¨ÙŠØ¹ Ù„Ù„Ù‚Ø¯ÙŠÙ… | A5 Â· A6 (Ù‡Ù†Ø¯ÙŠØ©) |
| Ø§Ù„Ø´ÙƒÙ„ Ø§Ù„ÙØ¹Ù„ÙŠ Ù„Ù„Ø¨ÙŠØ§Ù†Ø§Øª | **A8 + A9** | A3 (Ù†Ø§Ù‚Øµ) |
| Ø¯Ù„Ø§Ù„Ø§Øª Ø§Ù„Ù…Ø®Ø²ÙˆÙ† | **A4** (Ø§Ù„Ø¬Ø±Ø¯ Ù…Ù† `stock_logs`) | Ø¹Ø¯Ù‘Ø§Ø¯Ø§Øª Ø§Ù„Ø¯ÙˆØ§Ø¡ |


---

## 12. Ø§Ø³ØªØ±Ø§ØªÙŠØ¬ÙŠØ© Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± (Testing Strategy)

> **Ù„Ù… ØªÙÙ†Ø´Ø£ Ù…Ø¬Ù…ÙˆØ¹Ø© Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª ÙÙŠ Ù‡Ø°Ù‡ Ø§Ù„Ù…Ø±Ø­Ù„Ø©** â€” Ø§Ù„ØªØµÙ…ÙŠÙ… ÙÙ‚Ø·ØŒ ÙƒÙ…Ø§ Ø·ÙÙ„Ø¨.
> Ø§Ù„Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø­Ø§ÙƒÙ…Ø© Ù„Ù„Ù…Ø´Ø±ÙˆØ¹: `npm run typecheck` Â· `npm run build` Â· `npm test` â€” Ùˆ**ÙŠØ¬Ø¨ Ø£Ù† ÙŠØ¨Ù‚Ù‰ `npm test` Ø£Ø®Ø¶Ø±Ù‹Ø§ (81 Ø§Ø®ØªØ¨Ø§Ø±Ù‹Ø§ Ø­Ø§Ù„ÙŠÙ‹Ø§)**.

| # | Ø§Ù„Ø·Ø¨Ù‚Ø© | Ø§Ù„Ø£Ø¯Ø§Ø© | Ø§Ù„Ø¹Ø¯Ø¯ | Ø§Ù„Ø£ÙˆÙ„ÙˆÙŠØ© |
|---|---|---|---|---|
| T1 | Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª Ø§Ù„Ù…Ø¬Ø§Ù„ (Ù†Ù‚ÙŠØ©) | `node --test`ØŒ Ø¨Ù„Ø§ Ø´Ø¨ÙƒØ© | ~30 | ðŸ”´ Ù…ÙÙ„Ø²Ù…Ø© |
| T2 | Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª Ø§Ù„Ù€ mappers | `node --test` + fixtures | ~20 | ðŸ”´ Ù…ÙÙ„Ø²Ù…Ø© |
| T3 | Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª | `fetch` Ù…ÙØ¯Ø®ÙŽÙ„ | ~15 | ðŸŸ  |
| T4 | Ø­Ø¯ÙˆØ¯ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ§Øª | Ù…Ø­Ø§ÙƒÙŠ Ø­Ù‚ÙŠÙ‚ÙŠ | ~8 | ðŸ”´ Ù…ÙÙ„Ø²Ù…Ø© |
| T5 | Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø§Øª | Ù…Ø­Ø§ÙƒÙŠ Ø­Ù‚ÙŠÙ‚ÙŠ | ~6 | ðŸ”´ Ù…ÙÙ„Ø²Ù…Ø© |
| T6 | Ø§Ù„ØªÙˆØ§ÙÙ‚ Ù…Ø¹ Ø£Ù†Ø¯Ø±ÙˆÙŠØ¯ | fixtures Ù…Ù† A8/A9 | ~10 | ðŸŸ  |

### 12.1 T1 â€” Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª Ø§Ù„Ù…Ø¬Ø§Ù„ (Ù†Ù‚Ù„ Ø­Ø±ÙÙŠ Ù„Ù€ `AdminOrderProcessorTest`)

ØªÙÙ†Ù‚Ù„ Ø§Ù„Ù€ 17 Ø§Ø®ØªØ¨Ø§Ø±Ù‹Ø§ Ø§Ù„Ù…ÙˆØ¬ÙˆØ¯Ø© ÙÙŠ `AdminOrderProcessorTest.kt` **Ø­Ø±ÙÙŠÙ‹Ø§** Ø¥Ù„Ù‰ `tests/domain/`:
`testValidRequestScheduleAndTime` Â· `testFridayRestriction` Â· `testOutsideOperatingHours` Â· `testPendingPreviousOrderLock` Â· `testRejectedNonExceptionRetry` Â· `testRejectedExceptionOrderLock` Â· `testSameMonthRestriction` Â· `testMinimumDayViolation` Â· `testExceptionUserBypass` Â· `testDuplicateMedicineIdsAggregation` Â· `testLargeLongQuantityAndOverflowProtection` Â· `testItemValidationLogic` Â· `testMoreThanFiveItems` Â· `testInvalidItemStructure` Â· `testEmptyItemsList` Â· `testUnapprovedUser` Â· `testParseTimeToMinutes`

> â­ **Ø¨Ø§Ù„Ø¥Ø¶Ø§ÙØ© Ø¥Ù„ÙŠÙ‡Ø§** (ØªØºØ·Ù‘ÙŠ D1):
```
âœ” normalizes "Ù Ù¥-Ù¢Ù Ù¢Ù¦" to "05-2026"
âœ” treats "Ù Ù¥-Ù¢Ù Ù¢Ù¦" and "05-2026" as the SAME month   â† ÙŠÙ…Ù†Ø¹ ØªÙƒØ±Ø§Ø± Ø®Ù„Ù„ D1
âœ” rejects non-ASCII monthYear on output
âœ” diffDays floors 14.9 days to 14 (rejected at minDays=15)
âœ” hasException bypasses the "already pending" lock
```

### 12.2 T2 â€” Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª Ø§Ù„Ù€ mappers (ØªØ­Ù…Ù„ ØªØ³Ø§Ù…Ø­ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø©)

| Ø§Ù„Ø­Ø§Ù„Ø© | Ø§Ù„Ø£Ø«Ø± |
|---|---|
| Ø·Ù„Ø¨ Ø¨Ù„Ø§ `isExceptionOrder` (8 Ù…Ù† 26 Ø­Ù‚ÙŠÙ‚ÙŠÙ‹Ø§) | â‡’ `false` Ø¨Ù„Ø§ Ø®Ø·Ø£ |
| Ù…Ø³ØªÙ†Ø¯ Ø¨Ù„Ø§ `hasException` (A9) | â‡’ `false` |
| `lastOrderId: null` **Ùˆ** Ø­Ù‚Ù„ ØºØ§Ø¦Ø¨ | ÙƒÙ„Ø§Ù‡Ù…Ø§ â‡’ `null` |
| `lastOrderMonthYear = "Ù Ù¦-Ù¢Ù Ù¢Ù¦"` | â‡’ `normalizeMonthYear` ØªÙØ¹ÙŠØ¯ ASCII |
| `status` Ø¨Ù‚ÙŠÙ…Ø© ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙØ© | â‡’ Ù„Ø§ ÙŠØ±Ù…ÙŠØ› ÙŠÙØ¨Ù„ÙŽÙ‘Øº |
| `stock_logs.userName = "ØªØ¹Ø¯ÙŠÙ„ ÙƒÙ…ÙŠØ© ÙÙŠ Ø·Ù„Ø¨: â€¦"` | â‡’ Ø­Ù‚Ù„ `label` |
| `quantity` ÙƒÙ€ `doubleValue` Ù„Ø§ `integerValue` | ÙŠÙÙ‚Ø¨Ù„ ÙƒØ¹Ø¯Ø¯ |
| Ù…Ø³ØªÙ†Ø¯ ÙØ§Ø±Øº `{}` | â‡’ Ù‚ÙŠÙ… Ø§ÙØªØ±Ø§Ø¶ÙŠØ© Ù…ÙˆØ«Ù‘Ù‚Ø© |

### 12.3 T3 â€” Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª (Ø³Ù„Ø§Ù…Ø© Ø§Ù„Ù†Ù‚Ù„ Ù„Ø§ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ§Øª)

```
âœ” users repo: GET users/{uid} Ø¨Ù…Ø³Ø§Ø± ØµØ­ÙŠØ­ ÙˆØ±Ù…Ø² Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…
âœ” order-requests repo: POST Ø¨Ù…ÙØ§ØªÙŠØ­ {uid, items, status, requestDate} ÙÙ‚Ø·  â† A1 hasOnly
âœ” ÙƒÙ„ ÙƒØªØ§Ø¨Ø© goods ØªØ­Ù…Ù„ updateMask ØµØ±ÙŠØ­                                    â† C5
âœ” settings repo: ÙŠÙƒØªØ¨ Ø¯Ø§Ø¦Ù…Ù‹Ø§ settings/app Ù„Ø§ settings/schedule           â† D9
âœ” ÙƒÙ„ Ù…ÙØ¹Ø±Ù‘Ù Ù…ÙˆÙ„ÙŽÙ‘Ø¯ ÙŠØ­ØªØ±Ù… [A-Za-z0-9_-] ÙˆÙ„Ø§ ÙŠØ¨Ø¯Ø£ Ø¨Ù€ __                   â† Â§7.5
```

### 12.4 T4 â€” Ø­Ø¯ÙˆØ¯ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ§Øª (Ø¹Ù„Ù‰ Ø§Ù„Ù…Ø­Ø§ÙƒÙŠ Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠ)

ØªÙˆØ³ÙŠØ¹ Ù„Ù…Ø¬Ù…ÙˆØ¹Ø© Stage 3 (54 Ø§Ø®ØªØ¨Ø§Ø±Ù‹Ø§) â€” Ø§Ù„Ø¬Ø¯ÙŠØ¯ ÙŠØ«Ø¨Øª Ø£Ù† **Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª** Ù„Ø§ ØªÙÙ‚Ø¯ A1:
```
âœ” admin ÙŠÙÙ‚Ø¨Ù„ approve()        â†’ 200
âœ” employee ÙŠÙØ±ÙØ¶ approve()     â†’ 403 (Ù„ÙŠØ³ 404 ÙˆÙ„Ø§ 500)
âœ” repo Ù„Ø§ ÙŠØ¹ÙŠØ¯ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ø¹Ù†Ø¯ 403
âœ” repo ÙŠØªØ±Ø¬Ù… 403 Ø¥Ù„Ù‰ TypedError Ø¨Ù„Ø§ ØªØ³Ø±ÙŠØ¨ Ø±Ù…Ø²
```

### 12.5 T5 â€” Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø§Øª (Ø¹Ù„Ù‰ Ø§Ù„Ù…Ø­Ø§ÙƒÙŠ Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠ)

```
âœ” Ø¯ÙˆØ±Ø© ÙƒØ§Ù…Ù„Ø©: begin â†’ batchGet â†’ commit â†’ Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† 5 ÙƒØªØ§Ø¨Ø§Øª
âœ” commit ØºÙŠØ± Ù…ØµØ±Ù‘Ø­ â†’ 403 + ØªØ£ÙƒÙŠØ¯ Ø£Ù† stock Ù„Ù… ÙŠØªØºÙŠÙ‘Ø±
âœ” Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø¹Ø§Ù„Ø¬Ø© Ù„Ù†ÙØ³ Ø§Ù„Ø·Ù„Ø¨ â†’ Ù„Ø§ Ø·Ù„Ø¨ Ø«Ø§Ù†Ù (AlreadyProcessed)
âœ” â›” Ø§Ù†Ø­Ø¯Ø§Ø±: update Ø¨Ù„Ø§ updateMask Ù„Ø§ ÙŠÙ…Ø­Ùˆ Ø­Ù‚ÙˆÙ„ Ø§Ù„Ø¯ÙˆØ§Ø¡                    â† C5
âœ” rollback ÙŠÙØ¨Ø·Ù„ Ø§Ù„Ù…Ø¹Ø§Ù…Ù„Ø©
```

### 12.6 T6 â€” Ø§Ù„ØªÙˆØ§ÙÙ‚ Ù…Ø¹ Ø£Ù†Ø¯Ø±ÙˆÙŠØ¯ (fixtures Ù…Ù† A8/A9 Ø¨Ø£Ø³Ù…Ø§Ø¡ Ù…ÙØ¬Ù‡ÙŽÙ‘Ù„Ø©)

```
âœ” ÙŠÙ‚Ø±Ø£ lastOrderMonthYear Ø¨Ø§Ù„Ù‡Ù†Ø¯ÙŠØ© Ø§Ù„Ø¹Ø±Ø¨ÙŠØ© ÙˆÙŠØ·Ø¨Ù‘Ø¹Ù‡Ø§
âœ” ÙŠÙ‚Ø±Ø£ lastOrderDate Ø¨ØµÙŠØºØ© { _seconds, _nanoseconds }
âœ” order.status = "accepted" â‡’ enum ØµØ­ÙŠØ­
âœ” order_request.status = "processed" Ù…Ø¹ orderId â‡’ OrderRequest ÙƒØ§Ù…Ù„
```

---

## 13. Ø£Ø³Ø¦Ù„Ø© Ù…ÙØªÙˆØ­Ø© ØªØªØ·Ù„Ù‘Ø¨ Ù‚Ø±Ø§Ø±Ù‹Ø§ (Ù„Ø§ Ù†ÙØ¬ÙŠØ¨ Ø¹Ù†Ù‡Ø§ ØªÙ„Ù‚Ø§Ø¦ÙŠÙ‹Ø§)

1. **Â§10-D1** â€” Ù‡Ù„ ØªÙØµØ­ÙŽÙ‘Ø­ Ù‚ÙŠÙ… `monthYear` Ø§Ù„Ù‡Ù†Ø¯ÙŠØ© ÙÙŠ Ø§Ù„Ø¥Ù†ØªØ§Ø¬ØŸ (Ø£Ø«Ø±Ù‡ Ø¹Ù„Ù‰ ØªØ´ØºÙŠÙ„ä¸šåŠ¡ Ù‚Ø§Ø¦Ù…Ø› Ù„Ø§ ÙŠÙØ­Ø³Ù… ØªÙ‚Ù†ÙŠÙ‹Ø§.)
2. **Â§10-D4** â€” `requestDate`: Ø³Ø§Ø¹Ø© **Ø§Ù„Ø®Ø§Ø¯Ù…** (ØªØ­ØªØ§Ø¬ ØªØ±Ù…ÙŠØ² `serverTimestamp`) Ø£Ù… Ø³Ø§Ø¹Ø© **Ø§Ù„Ø¹Ù…ÙŠÙ„** (Ø£Ø³Ù‡Ù„ØŒ Ù„ÙƒÙ† ÙŠÙØ¶Ø¹Ù ÙØ­Øµ Ø§Ù„Ù†Ø§ÙØ°Ø© Ø§Ù„Ø²Ù…Ù†ÙŠØ©)ØŸ
3. **Â§11-C1** â€” Ù‡Ù„ Ø³ÙŠØ¹Ø§Ù„Ø¬ ØªØ·Ø¨ÙŠÙ‚ ÙˆÙŠÙ†Ø¯ÙˆØ² Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ø¨Ù†ÙØ³Ù‡ (ÙƒÙ…Ø§ ØµÙÙ…Ù‘Ù… ÙÙŠ A2)ØŒ Ø£Ù… Ø³ÙŠØ¨Ù‚Ù‰ Ù‡Ù†Ø§Ùƒ Ù…Ø¹Ø§Ù„ÙØ¬ Ù…ÙØ´ØºÙŽÙ‘Ù„ØŸ
4. **Â§7.5** â€” ØµÙŠØºØ© Ø§Ù„Ù…ÙØ¹Ø±Ù‘Ù Ø§Ù„Ù…ÙˆÙ„ÙŽÙ‘Ø¯: Ù†Ø­Ø§ÙƒÙŠ ØµÙŠØºØ© Firestore (20 Ù…Ø­Ø±ÙÙ‹Ø§) Ø£Ù… UUID ÙƒÙ…Ø§ ÙÙŠ `order_requests` (A5:242)ØŸ

---

## 14. Ø­Ø§Ù„Ø© Ø§Ù„ØªØ³Ù„ÙŠÙ… (Stage 4)

| Ø§Ù„Ø¨Ù†Ø¯ | Ø§Ù„Ø­Ø§Ù„Ø© |
|---|---|
| ØªÙ†ÙÙŠØ° ÙƒÙˆØ¯ | â›” **Ù„Ø§ Ø´ÙŠØ¡.** Ù…Ø³ØªÙ†Ø¯ ÙˆØ§Ø­Ø¯ ÙÙ‚Ø·. |
| Ø´Ø§Ø´Ø§Øª / Ù…Ù†Ø·Ù‚ Ø£Ø¹Ù…Ø§Ù„ / Ù…Ø¹Ø§Ù„Ø¬Ø© Ø·Ù„Ø¨Ø§Øª / Ù…Ø®Ø²ÙˆÙ† | â›” Ù„Ø§ Ø´ÙŠØ¡ |
| Ù†Ø´Ø± / Ø§ØªØµØ§Ù„ Ø¥Ù†ØªØ§Ø¬ÙŠ | â›” Ù„Ø§ Ø´ÙŠØ¡ |
| Ù…Ø´Ø±ÙˆØ¹ Ø£Ù†Ø¯Ø±ÙˆÙŠØ¯ | âœ… **Ù„Ù… ÙŠÙÙ…Ø³Ù‘** (Ù‚Ø±Ø§Ø¡Ø© ÙÙ‚Ø·) |
| `firestore.rules` | âœ… **Ù„Ù… ÙŠÙÙ…Ø³Ù‘** (Ø¨ØµÙ…Ø© `1FA3C607â€¦DC63B` Ù‚Ø¨Ù„ ÙˆØ¨Ø¹Ø¯) |
| Cloud Functions | âœ… **Ù„Ù… ÙŠÙÙ…Ø³Ù‘ ÙˆÙ„Ù… ÙŠÙÙ†Ø´Ø±** |
| Firebase Ø¥Ù†ØªØ§Ø¬ÙŠ | âœ… **Ù„Ù… ÙŠÙØªØµÙ„ Ø¨Ù‡** |
| Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª Ø§Ù„Ù…Ø´Ø±ÙˆØ¹ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© | âœ… **81/81 ØªÙ…Ø±Ù‘** |

### 14.1 Ø§Ù„Ù…Ù„ÙØ§Øª Ø§Ù„Ù…ÙÙ†Ø´Ø£Ø© ÙÙŠ Ù‡Ø°Ù‡ Ø§Ù„Ù…Ø±Ø­Ù„Ø©

| Ø§Ù„Ù…Ù„Ù | Ø§Ù„ØºØ±Ø¶ |
|---|---|
| `docs/domain-data-architecture.md` | Stage 4 ÙƒØ§Ù…Ù„ â€” Ø§Ù„ØªØ¯Ù‚ÙŠÙ‚ ÙˆØ§Ù„ØªØµÙ…ÙŠÙ… |

**Ù„Ø§ Ù…Ù„ÙØ§Øª Ù…ØµØ¯Ø±ÙŠØ© Ø¬Ø¯ÙŠØ¯Ø©. Ù„Ø§ ØªØ¹Ø¯ÙŠÙ„ Ø¹Ù„Ù‰ Ø£ÙŠ Ù…Ù„Ù Ù…ÙˆØ¬ÙˆØ¯.**

---

# 15. Stage 5B â€” Ø§Ù„ØªÙ†ÙÙŠØ° Ø§Ù„ÙØ¹Ù„ÙŠ (Domain + Repository)

> Ù‡Ø°Ù‡ Ù‡ÙŠ Ø§Ù„Ø´ÙŠÙØ±Ø© Ø§Ù„Ù…Ù†ÙÙŽÙ‘Ø°Ø©. ÙƒÙ„ Ù…Ø§ Ø³Ø¨Ù‚ (Â§0â€“Â§14) Ù‡Ùˆ Ø§Ù„ØªØ¯Ù‚ÙŠÙ‚ Ø§Ù„Ø°ÙŠ Ø£ÙØ±Ø²Ù‡Ø§.
> **Ø§Ù„Ù†Ø·Ø§Ù‚ Ø§Ù„Ù…Ù†ÙÙŽÙ‘Ø°:** Ù†Ù…Ø§Ø°Ø¬ Ø§Ù„Ù…Ø¬Ø§Ù„ØŒ Ù‚ÙŠÙ… Ù…ØºÙ„Ù‚Ø©ØŒ Ø·Ø¨Ù‚Ø© Ø§Ù„ØªØ­ÙˆÙŠÙ„ØŒ ÙˆØ§Ø¬Ù‡Ø§Øª Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§ØªØŒ ØªÙ†ÙÙŠØ°Ø§ØªÙ‡Ø§ØŒ ÙˆØ§Ø®ØªØ¨Ø§Ø±Ø§Øª.
> **ØºÙŠØ± Ù…Ù†ÙÙŽÙ‘Ø° Ø¹Ù…Ø¯Ù‹Ø§:** Ø§Ù„Ø´Ø§Ø´Ø§ØªØŒ Ù…Ù†Ø·Ù‚ Ø§Ù„Ø£Ø¹Ù…Ø§Ù„ØŒ Ù…Ø¹Ø§Ù„Ø¬Ø© Ø§Ù„Ø·Ù„Ø¨Ø§ØªØŒ ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ù…Ø®Ø²ÙˆÙ†ØŒ Ø§Ù„Ù„ÙˆØ­Ø§ØªØŒ Ø§Ù„ØªÙ‚Ø§Ø±ÙŠØ±.

## 15.1 Ø§Ù„Ø¨Ù†ÙŠØ© Ø§Ù„Ù…Ù†ÙÙŽÙ‘Ø°Ø©

```
electron/
  domain/                          â¬… Ù†Ù‚ÙŠ 100% Ø¨Ù„Ø§ I/O
    models.ts                      User, Medicine, Order, OrderRequest, OrderItem, StockLog, AppSettings
    values.ts                      Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹Ø§Øª Ø§Ù„Ù…ØºÙ„Ù‚Ø© + Ø§Ù„Ø­ÙØ±Ù‘Ø§Ø³ (enums Ù…Ù†Ø·Ù‚ÙŠØ© Ù„Ø§ TS enums)
    month-year.ts                  ØªÙˆØ§ÙÙ‚ Ø§Ù„Ù‚Ø±Ø§Ø¡Ø© Ù„Ù€ monthYear (D1)
    errors.ts                      DomainError, MalformedDataError, InvalidInputError
    index.ts                       barrel

  repositories/
    contracts/                     â¬… Ø§Ù„ÙˆØ§Ø¬Ù‡Ø§Øª (Ø¨Ù„Ø§ ØªÙ†ÙÙŠØ°)
      common.ts                    TransactionId + Ø­Ø¯ÙˆØ¯ Ù…Ø¹Ø§Ù…Ù„Ø© Stage 6 (Ù…ÙØ¹Ù„ÙŽÙ†Ø©ØŒ ØºÙŠØ± Ù…Ù†ÙÙŽÙ‘Ø°Ø©)
      users-repository.ts
      medicines-repository.ts      MedicinesRepository + SettingsRepository
      order-repository.ts           OrderRequests/Orders/StockLogs
    firestore/                     â¬… Ø§Ù„ØªÙ†ÙÙŠØ° ÙÙˆÙ‚ Stage 5A
      repository-support.ts         ØªØ±Ø¬Ù…Ø© Ø§Ù„Ø£Ø®Ø·Ø§Ø¡ + Ø£Ø¯ÙˆØ§Øª Ø§Ù„Ù…Ø³Ø§Ø±/Ø§Ù„Ø­Ø¯ÙˆØ¯
      users-repository.ts
      medicines-repository.ts
      order-repository.ts
      mappers/                     â¬… Ø§Ù„Ø­Ø¯Ù‘ Ø§Ù„ÙˆØ­ÙŠØ¯ Ù…Ø¹ ØªÙ†Ø³ÙŠÙ‚ Firestore
        readers.ts                 Ù‚Ø±Ø§Ø¡Ø§Øª ØµØ§Ø±Ù…Ø©/Ø§ÙØªØ±Ø§Ø¶ÙŠØ© Ù…ÙˆØ«Ù‘Ù‚Ø©
        user-mapper.ts
        medicine-mapper.ts
        order-request-mapper.ts
        order-mapper.ts            Order + StockLog + AppSettings
    index.ts
```

**Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø§ØªØ¬Ø§Ù‡ Ø§Ù„Ù…ÙØ·Ø¨ÙŽÙ‘Ù‚Ø© (Ù…Ø·Ø§Ø¨Ù‚Ø© Ù„Ù€ Â§9.2):**
`renderer â†’ ipc â†’ services â†’ repositories/contracts â†’ domain`ØŒ Ùˆ`repositories/firestore â†’ services/firestore-rest`.
`domain/` **Ù„Ø§ ÙŠØ³ØªÙˆØ±Ø¯** Ø£ÙŠÙ‹Ù‘Ø§ Ù…Ù…Ø§ Ø³Ø¨Ù‚ (Ø¹Ø¯Ø§ Ù†ÙˆØ¹ `FirestoreTimestamp` Ø§Ù„Ø°ÙŠ ÙŠÙØ¹Ø§Ø¯ ØªØ³Ù…ÙŠØªÙ‡ Ø¥Ù„Ù‰ `DomainTimestamp`).

## 15.2 Ù‚Ø±Ø§Ø± Ù…Ø¹Ù…Ø§Ø±ÙŠ: Ø£ÙŠÙ† ØªØ¹ÙŠØ´ Ø§Ù„Ù‚ÙŠÙ… Ø§Ù„Ù…ØºÙ„Ù‚Ø©ØŸ

âš ï¸ **ØªØ¹Ø§Ø±Ø¶ Ø­Ù‚ÙŠÙ‚ÙŠ Ø§ÙƒØªÙØ´Ù Ø£Ø«Ù†Ø§Ø¡ Ø§Ù„ØªÙ†ÙÙŠØ° ÙˆÙˆÙØ«ÙÙ‘Ù‚ Ø¨Ø¯Ù„ Ø¥Ø®ÙØ§Ø¦Ù‡:**

ÙƒÙ†Øª Ù‚Ø¯ ÙˆØ¶Ø¹ØªÙ `UserRole` Ùˆ `UserStatus` â€¦ ÙÙŠ `services/firestore-codec.ts`. Ù„ÙƒÙ† Stage 3 ØªÙØ´ØºÙ‘Ù„ Ø­Ø±Ø§Ø³Ø© Ù…Ø¹Ù…Ø§Ø±ÙŠØ© (`firestore-architecture.test.ts`) **ØªÙ…Ù†Ø¹ Ø­Ø±ÙÙŠØ§Ù‹** ÙˆØ¬ÙˆØ¯ Ø§Ù„Ø³Ù„Ø§Ø³Ù„ `isAdmin` / `'admin'` / `'approved'` â€¦ ÙÙŠ Ù…Ù„ÙØ§Øª Ø·Ø¨Ù‚Ø© Ø§Ù„Ù†Ù‚Ù„:

```ts
// tests/firestore-architecture.test.ts â€” "keeps the REST client role-agnostic"
for (const forbidden of ['isAdmin', "'admin'", "'approved'", ...]) {
  assert.equal(content.includes(forbidden), false, ...);
}
```

**Ø§Ù„Ø³Ø¨Ø¨ Ø§Ù„Ø¯Ù‚ÙŠÙ‚ Ù„Ù„Ø­Ø±Ø§Ø³Ø©:** ÙƒÙ„Ù…Ø© Ø¯ÙˆØ± Ø¯Ø§Ø®Ù„ Ø·Ø¨Ù‚Ø© Ø§Ù„Ù†Ù‚Ù„ Ù‡ÙŠ **Ø®Ø·ÙˆØ© ÙˆØ§Ø­Ø¯Ø© بعيدة** Ù…Ù† ÙØ­Øµ ØµÙ„Ø§Ø­ÙŠØ§Øª ÙÙŠ Ø§Ù„Ø¹Ù…ÙŠÙ„. ÙˆÙ‡ÙŠ ÙÙŠ Ø§Ù„Ù…Ø§Ø¶ÙŠ Ø§ÙƒØªÙØ´ÙØª Ø®Ø·Ø£Ù‹ (`MainActivity` ÙƒØ§Ù† ÙŠÙØ­Øµ `email == "assistant@â€¦"`) â€” C4.

**Ø§Ù„Ø­Ù„:** Ù†ÙÙ‚Ù„Øª Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹Ø§Øª Ø§Ù„Ù…ØºÙ„Ù‚Ø© Ø¥Ù„Ù‰ `domain/values.ts`. Ù‡Ø°Ø§ Ù„ÙŠØ³ ØªØ­Ø§ÙŠÙ„Ø§Ù‹ Ø¹Ù„Ù‰ Ø§Ù„Ø­Ø±Ø§Ø³Ø© (ØªØ¹Ù„ÙŠÙ‚ Ø¨Ù„Ø§ Ù…Ø¹Ù†Ù‰)ØŒ Ø¨Ù„ Ø§Ù„Ù…ÙˆØ¶Ø¹ Ø§Ù„ØµØ­ÙŠØ­: Ø§Ù„Ù…ÙØ±Ø¯Ø§Øª **Ù…Ø¹Ø±ÙØ© Ù…Ø¬Ø§Ù„** Ù„Ø§ Ù…Ø¹Ø±ÙØ© ØªÙ†Ø³ÙŠÙ‚ Ø³Ù„Ùƒ. ÙˆØ§Ù„Ù†ØªÙŠØ¬Ø© Ø£Ù† `firestore-codec.ts` Ø¹Ø§Ø¯ Ø¥Ù„Ù‰ Ù…Ø­Ø§ÙŠØ¯ ØªÙ…Ø§Ù…Ø§Ù‹ ØªØ¬Ø§Ù‡ Ø§Ù„Ø£Ø¯ÙˆØ§Ø±.

## 15.3 Ù†Ù…Ø§Ø°Ø¬ Ø§Ù„Ù…Ø¬Ø§Ù„ Ø§Ù„Ù…Ù†ÙÙŽÙ‘Ø°Ø©

| Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ | Ù…Ù„Ø§Ø­Ø¸Ø§Øª Ø§Ù„ØªÙ†ÙÙŠØ° |
|---|---|
| `UserProfile` + `UserOrderSummary` | `uid` ÙŠØ£ØªÙŠ Ù…Ù† **Ù…Ø¹Ø±Ù‘Ù Ø§Ù„Ù…Ø³ØªÙ†Ø¯** Ù„Ø§ Ù…Ù† Ø§Ù„Ø­Ù‚Ù„ Ø§Ù„Ù…Ø®Ø²ÙŽÙ‘Ù†. ÙƒÙ„ Ø­Ù‚ÙˆÙ„ `lastOrder*` Ø§Ø®ØªÙŠØ§Ø±ÙŠØ© ÙˆØªØªØ­Ù…Ù‘Ù„ `null` **Ùˆ** ØºÙŠØ§Ø¨Ø§Ù‹. |
| `Medicine` | `maxQuantity` = Ø­Ø¯ Ø§Ù„Ø·Ù„Ø¨ Ø§Ù„ÙˆØ§Ø­Ø¯ØŒ **Ù„ÙŠØ³** Ø§Ù„Ø±ØµÙŠØ¯. |
| `Order` | `monthYear` **Ø®Ø§Ù…** (Ù‚Ø¯ ÙŠÙƒÙˆÙ† Ù‡Ù†Ø¯ÙŠÙ‹Ø§ Ø¹Ø±Ø¨ÙŠÙ‹Ø§). `isExceptionOrder` = `false` Ø¹Ù†Ø¯ Ø§Ù„ØºÙŠØ§Ø¨. |
| `OrderRequest` | `requestDate` Ù…Ù† Ù†ÙˆØ¹ `DomainTimestamp` **Ø¥Ù„Ø²Ø§Ù…ÙŠ** (A2 ÙŠÙ‚Ø±Ø£Ù‡ Ø¨Ù€ `getTimestamp`ØŒ ÙˆÙ†ØµÙŒÙ‘ ÙŠØ¬Ø¹Ù„Ù‡ `null`). |
| `StockLog` | Ø¥Ø¹Ø§Ø¯Ø© ØªØ³Ù…ÙŠØ© Ù…Ø­Ù…ÙˆÙ„Ø©: `userName â†’ label` (D10ØŒ Ù„ÙŠØ³ Ø§Ø³Ù… Ù…Ø³ØªØ®Ø¯Ù…) Ùˆ `uid â†’ actorUid` (D3ØŒ Ø¯Ù„Ø§Ù„ØªØ§Ù† Ù…ØªØ¹Ø§Ø±Ø¶ØªØ§Ù†). |
| `AppSettings` | Ø§Ù„Ø³ØªØ© Ø­Ù‚ÙˆÙ„Ø› Ø§Ù„Ø§Ø«Ù†Ø§Ù† Ø§Ù„Ù…ÙŠØªØ§Ù† (`maxDailyOrders`, `assistantId`) Ù…ÙˆØ«Ù‘Ù‚Ø§Ù† ÙƒÙ…ÙŠØªÙŽÙŠÙ† Ù„Ø§ Ù…Ø®ÙÙŠÙŽÙ‘ÙŠÙ†. |

**Ø¨Ù„Ø§ `any`:** ÙƒÙ„ Ù†Ù…ÙˆØ°Ø¬ ØµØ±ÙŠØ­ØŒ ÙˆÙƒÙ„ Ù‚Ø±Ø§Ø¡Ø© ØªØ³ØªØ®Ø¯Ù… Ø­Ø§Ø±Ø³ Ù†ÙˆØ¹.

## 15.4 Ø·Ø¨Ù‚Ø© Ø§Ù„ØªØ­ÙˆÙŠÙ„ (Ø§Ù„Ù…Ø³Ø§Ø± Ø§Ù„ÙˆØ­ÙŠØ¯ Ù…Ø¹ ØªÙ†Ø³ÙŠÙ‚ Firestore)

```
Firestore REST document
  â†’ FirestoreRestClient.toDocument()      (Stage 3 â€” ÙŠÙÙƒÙ‘ Ø§Ù„ØªØ´ÙÙŠØ±)
  â†’ mappers/readers.ts                    (Ù‚Ø±Ø§Ø¡Ø© ØµØ§Ø±Ù…Ø©/Ø§ÙØªØ±Ø§Ø¶ÙŠØ©)
  â†’ domain model                          (Ù†Ù‚ÙŠ)
```

**Ù‚Ø§Ø¹Ø¯ØªØ§Ù† Ø­Ø§ÙƒÙ…ØªØ§Ù† ÙÙŠ `readers.ts`:**

1. **Ø¥Ù„Ø²Ø§Ù…ÙŠ Ù…Ù‚Ø§Ø¨Ù„ Ø§Ø®ØªÙŠØ§Ø±ÙŠ.** Ø­Ù‚Ù„ ØªØ¹ØªÙ…Ø¯ Ø¹Ù„ÙŠÙ‡ ÙƒÙ„ÙŠÙ‘Ø© Ø§Ù„Ù…Ø¹Ø§Ù„Ø¬Ø© (`requestDate`) **Ø¥Ù„Ø²Ø§Ù…ÙŠ**: ØºÙŠØ§Ø¨Ù‡ Ø£Ùˆ Ù†ÙˆØ¹Ù‡ Ø§Ù„Ø®Ø§Ø·Ø¦ â‡’ `MalformedDataError`ØŒ Ù„Ø§ Ù‚ÙŠÙ…Ø© Ø§ÙØªØ±Ø§Ø¶ÙŠØ©. Ø­Ù‚Ù„ ØªØ¹ØªØ±Ù Ø§Ù„Ù‚ÙˆØ§Ø¹Ø¯ Ø£Ù†Ù‡ Ø§Ø®ØªÙŠØ§Ø±ÙŠ (`isExceptionOrder`, ØºØ§Ø¦Ø¨ ÙÙŠ 8 Ù…Ù† 26 Ø·Ù„Ø¨Ù‹Ø§ Ø­Ù‚ÙŠÙ‚ÙŠÙ‹Ø§) ÙŠÙÙ‚Ø±Ø£ Ø¨Ù‚ÙŠÙ…Ø© Ù…ÙˆØ«Ù‘Ù‚Ø©.
2. **Ù„Ø§ Ø¥ÙƒØ±Ø§Ù‡ ØµØ§Ù…Øª.** `doubleValue` ÙŠÙÙ‚Ø¨Ù„ ÙƒØ¹Ø¯Ø¯ (Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠØ© ØªÙØ¹Ù„)ØŒ Ù„ÙƒÙ† **Ù†Øµ ØºÙŠØ± Ø±Ù‚Ù…ÙŠ Ù„Ø§ ÙŠÙØ­ÙˆÙŽÙ‘Ù„** Ø¥Ù„Ù‰ Ø±Ù‚Ù…ØŒ ÙˆÙ‚ÙŠÙ…Ø© enum ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙØ© **Ù„Ø§ ØªÙØ¹Ø§Ø¯ ÙƒØªØ§Ø¨ØªÙ‡Ø§** â€” Ø¨Ù„ ØªÙØ¨Ù„ÙŽÙ‘Øº Ø¹Ø¨Ø± `onWarning` ÙˆØªÙÙ‚Ø±Ø£ Ø¨Ù‚ÙŠÙ…Ø© Ø§ÙØªØ±Ø§Ø¶ÙŠØ©.

**تحويل الطوابع الزمنية:** `requireTimestamp` لا تقبل إلا `FirestoreTimestamp` (Stage 5A). نصٌّ في حقل طابع ؞ `MalformedDataError`، لأن A2 كان سيقرأه `getTimestamp()` فيعيد `null` ويفشل الطلب — وافتراض أن اللحظة معروفة أخطر من رفضها.

## 15.5 المستودعات: المنفّذ وغير المنفّذ

**users** — `getUser` · `listAllUsers` · `approveUser` · `rejectUser` · `grantSingleOrderException` · `revokeSingleOrderException` · `renameUser`.

غير موجود عمدًا: `deleteUser` (لا يطلبه التصميم؛ وزر الحذف في الأندرويد غير مفعّل — C1) · `updateUser(user)` (كتابة غير مقيّدة) · `setUserRole` · `setUserEmployeeId` (**مجمَد** بالقواعد).

⚠️ **كل كتابة إدارية مقنّعة** بـ `updateMask`، وإلا مسح `approveUser` كل حقول `lastOrder*` (Stage 5A C5). مثبَت على المحاكي: اعتماد مستند بملخّص كامل يُبقيه كاملًا.

**medicines / settings** — `getMedicine` · `listMedicines` · `getAppSettings` · `saveAppSettings` (يكتب دائمًا `settings/app` لا `settings/schedule` — D9).
غير موجود: `adjustStock` · `addStockInward` · `setMaxQuantity` · `deleteMedicine` — كلها **تعديل مخزون**، خارج نطاق Stage 5B.

**order_requests / orders / stock_logs** — `getOrderRequest` · `listPendingOrderRequests` · `submitPendingRequest` · `getOrder` · `listOrdersByUser` · `listStockLogs` · `listStockLogsByOrder`.
غير موجود: `markProcessed` / `markFailed` (Stage 6) · `deleteRequest` · `appendStockLog`.

### `submitPendingRequest` — يجعل غير القانوني غير قابل للتعبير

- **لا معامل `status`** ⇒ يستحيل إرسال غير `pending` (403).
- **لا معامل `requestDate`** ⇒ يستحيل ساعة الجهاز؛ `SERVER_TIMESTAMP` دومًا (D4).
- **حمولة من مفاتيح ثابتة** (`ALLOWED_CREATE_KEYS`) ⇒ يستحيل إضافة `source` أو `idempotencyKey`.
- `currentDocument.exists = false` ⇒ إنشاء، فلا يُطمس طلب موجود.
- المعرّف من `generateAutoId()` (20 محرفًا) لأنه يُعرف قبل الـcommit.

## 15.6 توافق `monthYear` (D1) — بلا ترحيل

```ts
normalizeMonthYear('٠٦-٢٠٢٦')          // '06-2026'   ← من البيانات الإنتاجية الحقيقية
normalizeMonthYear('')                        // null        ← "لم يطلب قط" (قيمة A8)
isSameMonthYear('٠٥-٢٠٢٦', '05-2026')  // true        ← هذه الدالة تُبطل الخلل
formatMonthYear(new Date())                   // '06-2026'   ← ASCII, Asia/Damascus
```

- **القيمة الخامة محفوظة** في `User.lastOrderMonthYear` و `Order.monthYear`.
- **التعديم صريح واختياري**， ولا يحدث إلا بطلب المستدعي.
- **لا كتابة إلى Firestore** في هذا المسار إطلاقًا.
- مُثبَت على المحاكي: مستند `٠٥-٢٠٢٦` يمرّ عبر `approve` دون أن يتغيّر.

## 15.7 حدود الاستفسار (PART 12)

| المطلوب | الحالة |
| --- | --- |
| `status == 'pending'` | ✅ `EQUAL` مدعوم |
| `userId == x` | ✅ `EQUAL` مدعوم |
| `orderBy date DESC` | ❌ ⇒ غير مرتّب وموثّق كذلك |
| `date` بين قيمتين | ❌ لم ُنفّذ؛ لم يُنفّذ |
| تنزيل المجموعة | ❌ كل قائمة تتطلب `limit > 0` |

**اكتشاف مُثبَت على المحاكي:** فلتر `EQUAL` **لا يطابق** مستندًا تنقصه الحقل المفلتَر. فطابور `pending` لا يبتلع طلبًا مشوّهًا.

## 15.8 حدّ الأمان

المستودع **لا يفحص أي دور**. `approveUser` ليست "if admin then allow" — بل إرسال طلب وقراءة الحكم:

```
FirestoreRestError(reason='PERMISSION_DENIED')  →  DomainError(kind='NOT_AUTHORIZED')
```

لا `FirestoreRestError` يتجاوز طبقة المستودع. وما يضمنه العقد ليس الصلاحيات، بل أن **العمليات التي تمنعها القواعد غير قابلة للتعبير**.

**السلطة remain:** `firestore.rules`. والمحرّسة المعمارية (Stage 3) خضراء: `firestore-codec.ts` و `firestore-rest.ts` **بلا أي حرف دور**.
## 15.9 حدود معاملة Stage 6 (مُعلّنة، غير منفّذة)

`OrderProcessingTransaction` فـ `contracts/common.ts` يثبّت التسلسل نفسَه حرفيًا:

```
R1 order_requests/{id}   (status != pending ⇒ لا تُكتب شيء — مفتاح الذرّية)
R2 users/{uid}           (الملخّص المكرّر هو مصدر الأهلية)
R3 settings/app
R4 medicines/{id} لكل صنف
------ ثم بالضبط، لا قبلها ------
W1 orders/{autoId}      W2 medicines.stock = قيمة مطلقة (لا increment في REST)
W3 stock_logs(outward)  W4 users/{uid}.lastOrder*
W5 order_requests ⇒ 'processed'
```

**لماذا هذا الترتيب:** A2 يقرأ قبل أي كتابة، و `transaction.get` في Firestore يفرض ذلك. وكل كتابة **مقنّعة**، وكل القيم **مطلقة** لا متزايدة.

**لماذا معاملة واحدة:** القواعد تُقيّم **مرتين** (`:batchGet` ثم `:commit`)، فالرفض قد يظهر عند القراءة أو عند الكتابة.

## 15.10 الاختبارات

| الملف | التغطية |
| --- | --- |
| `tests/domain/month-year.test.ts` | تعديم ASCII/هندي؛ تسوية دمشقوط |
| `tests/domain/user-medicine-mapping.test.ts` | مستند إنتاجي حقيقي بلا `lastOrder*`; `lastOrderStatus` فارغ; نقر مجهول |
| `tests/domain/order-request-mapping.test.ts` | `requestDate` إلزامي; `backend-v1`; حقول المعالجة |
| `tests/domain/stock-log-settings-mapping.test.ts` | `userName → label`; قيم حركة مجهولة; fallbacks |
| `tests/domain/write-mapping.test.ts` | **أربعة مفاتيح بالضبط**; `REQUEST_TIME` |
| `tests/repositories/repositories.test.ts` | المسارات والأجسم; ترجمة 403; رفض مدخل قبل الشبكة |
| `tests/repositories/repository-emulator.test.ts` | **محاكي حقيقي**: قراءة/كتابة/رفض حسب القواعد |

**الأرقام:** `npm test` = **178/178** (without حذف أي اختبار) · Stage 3/5A = **68/68** · Stage 5B repositories = **20/20**.

⚠️ **ملاحظة تشغيلية:** مجموعتان المحاكي تتشاركان محاكيًا واحداً، وكلّ ينظّف مستنداته. تشغيلهما **متزامنين** يجعل أحدهما يحذف بيانات الآخر، لذلك أضفت السكريبت `test:emulator:repositories`.

## 15.11 ما لم يُنفّذ

الشاشات · منطق الأعمال · **معالجة الطلبات (Stage 6)** · **تعديل المخزون** · اللوحات · التقارير · الإشعارات · ترحيل بيانات الإنتاج · تعديل الأندرويد · تعديل القواعد · نشر شيء.
