# معمارية المجال والبيانات — المرحلة الرابعة (تصميم) والمرحلة الخامسة B (تنفيذ)

> **§0–§14 تصميم Stage 4 فقط (تدقيق).** **§15 هو تنفيذ Stage 5B الفعلي**: نماذج المجال، طبقة التحويل، المستودعات، وحدود المعاملات.
> الهدف: طبقة مجال/بيانات لتطبيق ويندوز **متوافقة مع نموذج بيانات مشروع الأندرويد ومنطقه القائم**، مع بقاء **قواعد أمان Firestore هي مصدر الصلاحيات الوحيد**.

---

## 0. النطاق والمصادر المُلزِمة

### 0.1 المصادر المُلزِمة المستخدمة في هذا التدقيق

| الرمز | Artifact | الدور |
|---|---|---|
| **A1** | `mobile/drug/firestore.rules` | **سلطة الصلاحيات القصوى.** لا تُعدَّل. بصمة SHA-256 `1FA3C607…DC63B` |
| **A2** | `AdminOrderProcessor.kt` (348 سطرًا) | **سلطة دلالات معالجة الطلب.** مُختبَر بـ 17 حالة Robolectric |
| **A3** | `Models.kt` | نموذج Kotlin السطحي (ناقص — انظر C11) |
| **A4** | `AdminActivity.kt` (935 سطرًا) | إجراءات الإدارة. **غير مُفعَّل فعليًا** — انظر C1 |
| **A5** | `MedicineOrderActivity.kt` | مسار الموظف + أهلية العميل |
| **A6** | `MainActivity.kt` | عرض الحالة + فحص أدوار |
| **A7** | `functions/src/index.ts` | Cloud Function **قديم/غير منشور** — انظر C2 |
| **A8** | `migration/audit_report.json` | **بيانات إنتاجية حقيقية**: 26 طلبًا، 5 مستخدمين، 8 شواهد |
| **A9** | `migration/users_backup_*.json` | لقطة خام لمستندات `users` الحقيقية |
| **A10** | `electron/services/firestore-rest.ts` | طبقة النقل القائمة (Stage 3) |
| **A11** | `src/shared/ipc-contract.d.ts` | عقد الواجهة الحالي |

### 0.2 معايرة Sources of Truth: أيُّ مصدرٍ في أيّ جانب؟

| الجانب | السلطة | السبب |
|---|---|---|
| من يملك حق الوصول لأي مستند | **A1** | هو ما يُنفَّذ على الخادم؛ لا يمكن لعميل أن يوسّعه |
| معنى `role = "admin"` | **A1** | A1 هو من يقرأ الحقل ويقرّر |
| ترتيب خطوات معالجة الطلب | **A2** | معالج مُختبَر، ومذكور في `migration/README.md` كمحرك تفاوض |
| صيغة `monthYear` المعتمدة | **A2** (`Locale.US` ⇒ ASCII) | الخيار المتّسق مع A7 — لكن البيانات القائمة تخالفه (D1) |
| المنطقة الزمنية للأعمال | **A2 + A7** (اتفاق على `Asia/Damascus`) | واجهة الموظف تستخدم منطقة الجهاز ⇒ استشارية فقط (D2) |
| شكل مستند `settings` | **A4** | ي写出 الحقول الستة؛ A2 يقرأ أربعة |
| الشكل الفعلي للبيانات | **A8 + A9** | A3 ناقص ولا يغطي `lastOrder*` |

---

## 1. المجموعات المُحلَّلة

| المجموعة | مُعرّف المستند | قراءة A1 | كتابة A1 |
|---|---|---|---|
| `users` | `{uid}` = Firebase Auth UID | المالك أو `isAdmin()` | `isAdmin()` كامل · المالك: `name`,`status` فقط |
| `medicines` | `{autoId}` | أي مستخدم مُصادَق | `isAdmin()` فقط |
| `orders` | `{autoId}` | `isAdmin()` أو `resource.data.userId == auth.uid` | `isAdmin()` فقط |
| `order_requests` | **UUID من العميل** | `isAdmin()` أو `resource.data.uid == auth.uid` | إنشاء: `isApproved()` + `hasOnly` · تعديل/حذف: `isAdmin()` |
| `stock_logs` | `{autoId}` | `isAdmin()` فقط | `isAdmin()` فقط |
| `settings` | **`app` (مفرد ثابت)** | أي مستخدم مُصادَق | `isAdmin()` فقط |

> ⚠️ اختبارات Stage 3 استخدمت `settings/schedule` كـ fixture. **المعرّف الإنتاجي المعتمد هو `settings/app`** (A5:84، A2:246). A1 تسمح بأي `docId`، لكن طبقة ويندوز تتعامل مع `settings/app` حصريًا (D9).


---

## 2. نماذج المجال (Domain Models)

> **أنواع فقط** — لا منطق، لا I/O، لا اعتماد على Electron أو Firestore. تُكتب في `electron/domain/` وتُختبَر بـ `node --test` مباشرة. تُصدَّر نسخة آمنة للواجهة عبر `src/shared/`.

### 2.1 القيم المُغلقة — مطابقة حرفيًا لـ A1/A2

```ts
export type UserRole            = 'admin' | 'assistant' | 'employee';
export type UserStatus          = 'pending' | 'approved' | 'rejected';
export type OrderStatus         = 'pending' | 'accepted' | 'rejected';
export type OrderRequestStatus  = 'pending' | 'processed' | 'failed';
export type StockMovementType   = 'inward' | 'outward';
```

> ⚠️ **حساسية حالة الأحرف.** A1 يقارن `== 'admin'` و `== 'approved'` بأحرف صغيرة حصرًا؛ `Admin` أو `Approved` تُعامَل كمستخدم عادي. لا تُطبّع الحالة عند الكتابة إطلاقًا؛ طبّعها عند القراءة للتحذير فقط.

### 2.2 `User`

```ts
export interface UserProfile {
  readonly uid: string;            // Firestore doc id = Firebase Auth UID
  readonly name: string;
  readonly employeeId: string;     // مجمّد: A1:54 يمنع تغييره
  readonly role: UserRole;         // مصدر الحقيقة: A1 سطر 20
  readonly status: UserStatus;     // مصدر الحقيقة: A1 isApproved()
  readonly hasException: boolean;  // A1:46 تشترطه عند الإنشاء؛ قد غائبًا (D7)
}

/** حقول ملخّص المكرّرة. مصدر الحقيقة للأهلية في A2. */
export interface UserOrderSummary {
  readonly lastOrderId: string | null;
  readonly lastOrderDate: string | null;   // ISO-8601 نصي في ويندوز (D4)
  readonly lastOrderMonthYear: string;     // «MM-yyyy» — قد يكون هنديًا عربيًا (D1)
  readonly lastOrderStatus: OrderStatus | '' | null;
  readonly lastOrderIsException: boolean;
}

export type User = UserProfile & UserOrderSummary;
```

> **لماذا الملخّص المكرّر؟** `migration/README.md` يشرح أنه موجود لأن محرك A2 **لا يستطيع تنفيذ استعلامات داخل `runTransaction()`** على خطة Spark. متطلب معماري لا تكرار عشوائي.
> **النتيجة:** مصدر الحقيقة للأهلية هو `users/{uid}.lastOrder*`، **وليس** مجموعة `orders`.

### 2.3 `Medicine`

```ts
export interface Medicine {
  readonly id: string;
  readonly name: string;
  readonly maxQuantity: number;    // الحد الأعلى في الطلب الواحد (A2:310) — لا الرصيد
  readonly stock: number;          // يُخصم عند الطلب (A2) لا عند القبول
  readonly totalInward: number;    // لا يقرأه A2 إطلاقًا — A4 فقط
  readonly totalOutward: number;   // لا يقرأه A2 — A4 فقط عند status=accepted
}
```

> ⚠️ **تعارض دلالي:** `stock` يُخصم عند الطلب، `totalOutward` يُزاد عند القبول. إذن **`stock ≠ totalInward − totalOutward`** عمدًا. تقرير الجرد في A4 (`generateInventoryPdf`) يحسب الوارد/الصادر من **`stock_logs`** لا من عدّادات الدواء — وهذا السلوك الصحيح الواجب تكراره (C8).

### 2.4 `OrderItem` / `OrderRequestItem`

```ts
export interface OrderItem {
  readonly medicineId: string;
  readonly medicineName: string;  // نسخة عند الكتابة؛ A1 لا تتحقق منها
  readonly quantity: number;
}
```

> A1 يفرض على `order_requests.items` الشرط `items is list` فقط — **لا يتحقق من محتوى كل عنصر**. فحص `medicineId`/`quantity` يتم في A2 بعد القراءة. طبقة ويندوز تتحقق قبل الكتابة (UX) مع بقاء A2 كسلطة نهائية.

### 2.5 `Order`

```ts
export interface Order {
  readonly id: string;
  readonly userId: string;              // حقل الملكية. A1:77
  readonly userName: string;
  readonly items: readonly OrderItem[];
  readonly date: string;                // ISO-8601
  readonly monthYear: string;           // «MM-yyyy» — D1
  readonly status: OrderStatus;
  readonly isExceptionOrder: boolean;   // غائب في 8 من 26 طلبًا (A8) ⇒ false
  readonly requestId: string | null;    // رابط order_requests/{id}
}
```

### 2.6 `OrderRequest`

```ts
export interface OrderRequest {
  readonly id: string;              // UUID من العميل
  readonly uid: string;             // حقل الملكية. A1:92 — D6
  readonly items: readonly OrderItem[];
  readonly status: OrderRequestStatus;
  readonly requestDate: string;     // ISO-8601. A2:212 يقرؤه بـ getTimestamp — D4
  // حقول يكتبها المعالج A2 ولا يوقّعها A1 على الإنشاء:
  readonly orderId: string | null;
  readonly error: string | null;
  readonly processedBy: string | null;   // adminUid أو "backend-v1"
  readonly processedAt: string | null;
}
```

> 🔒 **قيد A1 الحاسم (سطر 99):** `request.resource.data.keys().hasOnly(['uid','items','status','requestDate'])`
> أي كتابة من ويندوز **يجب ألا تحتوي أي مفتاح إضافي** — لا `idempotencyKey`، لا `clientTimestamp`، لا `source`. مخالفة واحدة ⇒ `403`.

### 2.7 `StockLog`

```ts
export interface StockLog {
  readonly id: string;
  readonly medicineId: string;
  readonly medicineName: string;
  readonly quantity: number;        // مطلق موجب دائمًا (A4:595 Math.abs)
  readonly type: StockMovementType;
  readonly date: string;            // ISO-8601
  /** ⚠️ حقل محمّل — ليس اسم مستخدم. A2: اسم الموظف · A4: نص وصفي حر */
  readonly label: string;
  readonly actorUid: string | null; // دلالتان متعارضتان — D3
  readonly requestId: string | null;   // A2 فقط
  readonly orderId: string | null;     // A2 فقط
}
```

### 2.8 `AppSettings`

```ts
export interface AppSettings {
  readonly minDaysBetweenOrders: number;   // A2:262 fallback = 15
  /** ⚠️ ميت وظيفيًا: A5:232-233 علّق الفحص صراحةً. لا تنفّذه. */
  readonly maxDailyOrders: number;
  readonly allowFridayOrders: boolean;     // A2:259 fallback = false
  readonly startTime: string;              // «HH:mm» — A2:260 fallback = "06:00"
  readonly endTime: string;                // «HH:mm» — A2:261 fallback = "10:00"
  /** لا يقرأه A2 ولا A5 إطلاقًا. حقل عرض/إدارة فقط. */
  readonly assistantId: string;
}
```


---

## 3. حدود المستودعات (Repository Boundaries)

### 3.1 القاعدة الحاكمة

```
electron/domain/          ← نقي: أنواع + قواعد صرفة. لا Electron، لا Firestore، لا I/O.
        ▲
electron/repositories/    ← واجهات + تنفيذات Firestore. تعتمد على FirestoreRestClient فقط.
        ▲
electron/services/        ← حالات استخدام (application). تنسّق مستودعات متعدّدة.
        ▲
electron/ipc/             ← معالجات + تحويل إلى DTO. لا قواعد صلاحيات.
        ▲
src/renderer/             ← عرض فقط. لا وصول لـ Firestore، لا فحص أدوار.
```

**قواعد صارمة:**

1. `domain/` **لا يستورد** من `repositories/` ولا `services/` ولا `config/` — يُختبَر وحده.
2. `repositories/` **لا يستورد** من `services/` — يعرف `FirestoreRestClient` فقط.
3. `ipc/` **لا يحتوي** منطق أعمال — كل قرار يعود إلى `services/`.
4. `repositories/` **لا يطبّق** أي فحص صلاحيات — الاعتماد على A1 حصريًا؛承担 `403` فقط.
5. `renderer/` **لا يستقبل** مستندات Firestore ولا رموزًا — يستقبل DTO مُسقَطة.

### 3.2 واجهات المستودعات المقترحة

كل واجهة مقسّمة إلى ثلاثة أقسام صريحة، لأن A1 يجعلها سلطات مختلفة تمامًا.

```ts
// ── UsersRepository ───────────────────────────────────────────
export interface UsersRepository {
  // (1) القراءة
  getOwnProfile(uid: string): Promise<User | null>;   // A1: isOwner
  getProfile(uid: string): Promise<User>;            // A1: isOwner || isAdmin
  listAll(): Promise<readonly User[]>;               // A1: isAdmin فقط
  // (2) كتابات إدارية
  approve(uid: string): Promise<void>;               // status = 'approved'
  reject(uid: string): Promise<void>;                // status = 'rejected'
  grantSingleOrderException(uid: string): Promise<void>;   // hasException = true
  revokeException(uid: string): Promise<void>;             // hasException = false
  rename(uid: string, name: string): Promise<void>;         // A1 يسمح للمالك
  resubmitAfterRejection(uid: string, name: string): Promise<void>; // rejected → pending
  deleteUser(uid: string): Promise<void>;                    // A1: isAdmin فقط
  // (3) معاملات
  /** A2:382-389 — hasException=false + كل حقول lastOrder*. */
  commitProcessedOrderSummary(tx, userRef, summary): Promise<void>;
}

// ── MedicinesRepository ──────────────────────────────────────
export interface MedicinesRepository {
  // (1) القراءة — A1: أي مستخدم مُصادَق
  listCatalog(opts?: { stockGreaterThanZero?: boolean }): Promise<readonly Medicine[]>;
  getMedicine(id: string): Promise<Medicine>;
  // (2) كتابات إدارية — A1: isAdmin
  create(input: { name: string; maxQuantity: number; initialStock: number }): Promise<Medicine>;
  updateMaxQuantity(id: string, maxQuantity: number): Promise<void>;
  deleteMedicine(id: string): Promise<void>;
  // (3) معاملات
  /** A4:877-897 — يزيد stock و totalInward معًا ويكتب stock_log inward. */
  addStockTransactionally(medicineId: string, quantity: number, actor: ActorInfo): Promise<void>;
  /** A2:363 — خصم مطلق محسوب داخل المعاملة (REST لا يدعم increment). */
  decrementStockTransactionally(tx, medicineId: string, newAbsoluteStock: number): Promise<void>;
  /** A4:381 — يزيد totalOutward فقط عند قبول الطلب. */
  incrementTotalOutwardTransactionally(tx, medicineId: string, newAbsoluteValue: number): Promise<void>;
}
```


```ts
// ── OrdersRepository ─────────────────────────────────────────
export interface OrdersRepository {
  getOrder(id: string): Promise<Order>;                    // قراءة: isOwner || isAdmin
  listRecent(limit: number): Promise<readonly Order[]>;     // قراءة: isAdmin
  listOwnOrders(userId: string, limit: number): Promise<readonly Order[]>;
  // كتابات إدارية — A1: isAdmin
  createOrderTransactionally(tx, draft: NewOrder): Promise<string /*orderId*/>;  // A2:358
  setStatusTransactionally(tx, orderId, expected, next): Promise<boolean>;      // A4:370/399
  replaceItemsTransactionally(tx, orderId, items): Promise<void>;               // A4:454
}

// ── OrderRequestsRepository ──────────────────────────────────
export interface OrderRequestsRepository {
  getOwnRequest(id: string): Promise<OrderRequest | null>;
  listPendingForProcessing(): Promise<readonly OrderRequest[]>;   // A1: isAdmin
  /** 🔒 A1:99 hasOnly(['uid','items','status','requestDate']). لا مفتاح إضافي. */
  submitPending(request: NewOrderRequest): Promise<void>;         // الكتابة الوحيدة للموظف
  // معاملات — كلها إدارية
  markProcessedTransactionally(tx, requestId, orderId, adminUid): Promise<void>;
  markFailedTransactionally(tx, requestId, reason, actor): Promise<void>;
}

// ── StockLogsRepository ──────────────────────────────────────
export interface StockLogsRepository {
  listAll(): Promise<readonly StockLog[]>;                                    // isAdmin فقط
  listBetween(fromIso: string, toIso: string): Promise<readonly StockLog[]>;  // A4:743-745
  listByOrder(orderId: string): Promise<readonly StockLog[]>;
  appendTransactionally(tx, entry: NewStockLog): Promise<void>;   // لا كتابة مباشرة
}

// ── SettingsRepository ───────────────────────────────────────
export interface SettingsRepository {
  getAppSettings(): Promise<AppSettings>;                   // قراءة: أي مستخدم مُصادَق
  saveAppSettings(settings: AppSettings): Promise<void>;    // كتابة: A1 isAdmin فقط
}
```

**لماذا هذا التقسيم؟** A1 يجعل العملية نفسها «مسموحة» أو «ممنوعة» حسب هوية المتصل. التقسيم يعلن ذلك **في التوقيع** بدل أن يكون اكتشافًا وقت التشغيل:

| القسم | المتصل المسموح | عند مخالفة A1 |
|---|---|---|
| قراءة | حسب المجموعة | `403 PERMISSION_DENIED` |
| كتابة إدارية | `isAdmin()` فقط | `403` |
| معاملات | `isAdmin()` (عدا `submitPending`) | `403` عند `:commit` |

---

## 4. خريطة الحقول (Firestore Field Mapping)

### 4.1 `users/{uid}`

| Firestore | النوع | مطلوب؟ | المعنى | مصدر الحقيقة |
|---|---|---|---|---|
| `uid` | string | نعم عند الإنشاء (A1:43) | UID من Auth | A1 يفرض `== request.auth.uid` |
| `name` | string | نعم عمليًا | الاسم الكامل | قابل للتعديل (مالك + `isAdmin()`) |
| `employeeId` | string | نعم عمليًا | الرقم الوظيفي | **مجمّد** (A1:54) |
| `role` | string | نعم | `admin`/`assistant`/`employee` | **A1** سطر 20 |
| `status` | string | نعم | `pending`/`approved`/`rejected` | **A1** `isApproved()` |
| `hasException` | boolean | نعم عند الإنشاء (A1:46) | استثناء لطلب واحد | A2 يستهلكه |
| `lastOrderId` | string \| null | لا | id آخر طلب | A2 يكتبه |
| `lastOrderDate` | timestamp \| null | لا | تاريخ آخر طلب | A2 يكتبه |
| `lastOrderMonthYear` | string | لا | «MM-yyyy» | ⚠️ **محل تعارض** (D1) |
| `lastOrderStatus` | OrderStatus \| '' \| null | لا | حالة آخر طلب | A2 + A4 |
| `lastOrderIsException` | boolean | لا | هل كان استثناءً | A2 + الترحيل |

**دليل A9:** مستند المدير الإنتاجي = `{uid, role, name, employeeId, status}` فقط — بلا `hasException` وبلا أي `lastOrder*`.

### 4.2 `medicines/{id}`

| Firestore | النوع | مطلوب؟ | المعنى | مصدر الحقيقة |
|---|---|---|---|---|
| `name` | string | نعم | اسم المستحضر | `isAdmin()` |
| `maxQuantity` | integer | نعم | **الحد الأعلى في الطلب الواحد** | `isAdmin()` |
| `stock` | integer | نعم | الرصيد الحالي | A2 يخصم، A4 يزيد |
| `totalInward` | integer | لا | مجموع الوارد | A4 فقط |
| `totalOutward` | integer | لا | مجموع الصادر **المقبول** | A4 فقط |

### 4.3 `orders/{id}`

| Firestore | النوع | مطلوب؟ | المعنى | مصدر الحقيقة |
|---|---|---|---|---|
| `userId` | string | نعم | **المالك** (A1:77) | A2 |
| `userName` | string | لا | نسخة اسم | A2 |
| `items` | array\<map\> | نعم | `{medicineId, medicineName, quantity}` | A2 |
| `date` | timestamp | نعم | تاريخ الطلب | A2 |
| `monthYear` | string | نعم | «MM-yyyy» | ⚠️ D1 |
| `status` | OrderStatus | نعم | `pending`/`accepted`/`rejected` | A2 + A4 |
| `isExceptionOrder` | boolean | **لا** (8/26 غائبة) | هل كان استثناءً | A2 |
| `requestId` | string | لا | رابط `order_requests/{id}` | A2 |

### 4.4 `order_requests/{id}`

| Firestore | النوع | مطلوب؟ | المعنى | في `hasOnly`؟ |
|---|---|---|---|---|
| `uid` | string | نعم | **المالك** (A1:92) | ✅ |
| `items` | array | نعم | نفس شكل `orders.items` | ✅ |
| `status` | string | نعم | `pending` عند الإنشاء (A1:97) | ✅ |
| `requestDate` | timestamp | نعم | وقت الطلب | ✅ |
| `orderId` | string | لا | ناتج المعالجة | ❌ |
| `error` | string | لا | سبب الفشل | ❌ |
| `processedBy` | string | لا | من عالج الطلب | ❌ |
| `processedAt` | timestamp | لا | وقت المعالجة | ❌ |

> 🔒 كتابة أي مفتاح من الأربعة الأخيرة عند الإنشاء ⇒ `403`.

### 4.5 `stock_logs/{id}`

| Firestore | النوع | مطلوب؟ | المعنى | ملاحظة |
|---|---|---|---|---|
| `uid` | string | نعم | ⛔ **دلالتان متعارضتان** | A2: الموظف · A4: المدير (D3) |
| `medicineId` | string | نعم | معرّف الدواء | |
| `medicineName` | string | نعم | نسخة اسم | |
| `quantity` | integer | نعم | **مطلق موجب دائمًا** | A4:595 `Math.abs(diff)` |
| `type` | string | نعم | `inward` \| `outward` | لا قيمة ثالثة |
| `date` | timestamp | نعم | وقت الحركة | |
| `userName` | string | نعم | ⛔ **نص وصفي حر** | ليس اسم مستخدم (D10) |
| `requestId` | string | لا | من A2 فقط | |
| `orderId` | string | لا | من A2 فقط | |

### 4.6 `settings/app`

| Firestore | النوع | مطلوب؟ | المعنى | يقرأه A2؟ |
|---|---|---|---|---|
| `minDaysBetweenOrders` | integer | نعم | الفاصل الأدنى بالأيام | ✅ |
| `allowFridayOrders` | boolean | نعم | السماح بالجمعة | ✅ |
| `startTime` | string «HH:mm» | نعم | بداية النافذة | ✅ |
| `endTime` | string «HH:mm» | نعم | نهاية النافذة | ✅ |
| `maxDailyOrders` | integer | نعم | **غير مستخدم** (§2.8) | ❌ |
| `assistantId` | string | نعم | **غير مستخدم** | ❌ |


---

## 5. ملكية قواعد الأعمال (Business-Rule Ownership)

| القاعدة | A1 `firestore.rules` | طبقة المجال (ويندوز) | الواجهة |
|---|---|---|---|
| **من يملك حق الكتابة أصلًا** (صلاحية) | ✅ **السلطة الوحيدة** | ❌ لا تفحص | ❌ لا تفحص |
| `users` — المالك يعدّل `name` فقط | ✅ `hasOnly(['name','status'])` | — | — |
| `users` — تصعيد `role` | ✅ ممنوع | — | إخفاء الزر (UX فقط) |
| `users` — اعتماد ذاتي | ✅ ممنوع | — | إخفاء الزر |
| `order_requests` — الإنشاء يتطلّب `isApproved()` | ✅ | تحذير مسبق (UX) | توضيح |
| `order_requests` — شكل المفاتيح | ✅ `hasOnly` | **بناء الالتزام** | — |
| حد 5 أصناف | ❌ | ✅ **تنفيذ** (A2) | ✅ منع |
| `quantity > maxQuantity` | ❌ | ✅ **تنفيذ** (A2) | ✅ منع |
| `quantity > stock` | ❌ | ✅ **تنفيذ** (A2) | ✅ منع |
| تجميع تكرار نفس الدواء | ❌ | ✅ **تنفيذ** (A2) | — |
| طلب مُعلّق واحد | ❌ | ✅ **تنفيذ** (A2) | عرض |
| طلب واحد/شهر | ❌ | ✅ **تنفيذ** (A2) | عرض |
| فاصل 15 يوم | ❌ | ✅ **تنفيذ** (A2) | عرض |
| نافذة الوقت / الجمعة | ❌ | ✅ **تنفيذ** (A2) | عرض |
| `hasException` يتجاوز كل شيء | ❌ | ✅ **تنفيذ** (A2) | عرض |
| ذرّية المخزون | ❌ | ✅ **تنفيذ** (المعاملة) | — |

### 5.1 القاعدة الذهبية

> **A1 هو الحدّ النهائي، ولا يُكرَّر في أي مكان آخر كبديل عنه.**

عميل REST في ويندوز **لا يستطيع** تجاوز A1. لذلك:

1. `repositories/` **لا يحتوي** أي فحص `role`/`status` — مسؤولة عن النقل فقط.
2. `domain/` يحتوي **القواعد التجارية** (maxQuantity، 5 أصناف، النافذة الزمنية…) لأنها **ليست** صلاحيات — A1 لا يمنع طلبًا بمخزون سالب.
3. `renderer/` يعرض ما تُعيده العملية الرئيسية. **لا يخزّن `role` ولا يتّخذ على أساسه قرارًا يمنع أو يسمح.**
4. عند `403` من A1: تُترجم إلى رسالة UX. **لا يُعاد الطلب ولا يُخفى الخطأ.**

> ⚠️ **سلوك A6 الموجود ويجب عدم تكراره:** `MainActivity:54` و `SettingsFragment:986` يفحصان `email == "assistant@drugapp.internal"` لفرض سلوك إداري. هذا **فحص صلاحيات في العميل**، بينما A1 يعتمد `role` لا على البريد. طبقة ويندوز **لا تنسخ هذا النمط** (C4).

---

## 6. تحليل دلالات `AdminOrderProcessor` (A2)

> المتطلب: التنفيذ في ويندوز يحفظ هذه الدلالات **بالترتيب نفسه**.

### 6.1 الدوال الصافية (تُنقل حرفيًا إلى `domain/`)

| الدالة | السطر | السلوك الدقيق | ملاحظة |
|---|---|---|---|
| `aggregateItems` | 44 | يرفض فارغًا، يرفض >5 **قبل** التجميع، يجمع المكرّر، يرفض `qty <= 0`، يرفض النوع غير `Number`، `Math.addExact` لكشف overflow | **الحد 5 يُفحص على القائمة الخام لا المجمّعة** |
| `parseTimeToMinutes` | 74 | `split(":")`؛ إن لم يكن جزأين ⇒ `0` | `parseTimeToMinutes("garbage")` = 0 ⇒ منتصف ليل |
| `getDamascusCalendar` | 80 | `Asia/Damascus` دائمًا | منطقة ثابتة |
| `getDamascusMonthYear` | 87 | `SimpleDateFormat("MM-yyyy", Locale.US)` | ⭐ **ASCII** (D1) |
| `validateScheduleAndTime` | 94 | (1) الجمعة، (2) النافذة | `currentMins < start \|\| currentMins > end` — **شامل الطرفين** |
| `validateUserEligibility` | 118 | 6 خطوات مرتّبة (6.2) | ⭐ الترتيب حرج |

### 6.2 ترتيب فحوص الأهلية (A2:118-153) — يُكرَّر حرفيًا

```
1. status != "approved"     ⇒ "User is not approved to make orders"
2. hasException == true     ⇒ return null   ◄── تجاوز كامل لخطوات 3-6
3. canRetryRecord = (lastOrderStatus == "rejected" && !lastOrderIsException)
4. if (!canRetryRecord):
     4a. lastOrderStatus == "pending"        ⇒ "You already have a pending order"
     4b. lastOrderMonthYear == MM-yyyy الآن ⇒ "You have already ordered this month"
     4c. diffDays < minDaysBetweenOrders    ⇒ "Minimum interval … is N days"
5. return null
```

> ⚠️ ثلاث دقائق تغيّر السلوك:
> - الخطوة 2 **قبل** كل شيء: المستثنى يتجاوز حتى قيد «طلب مُعلّق واحد».
> - الخطوة 4b تبدأ بـ `isNotBlank()` — مستخدم جديد (`""`) يتجاوزها، وهذا ما يجعل الفحص آمنًا.
> - `diffDays = millis / 86400000` ** flooring**: 14.9 يوم ⇒ 14 ⇒ مرفوض عند `minDays=15`.

### 6.3 تسلسل المعاملة (A2:157-401)

| # | العملية | السطر | ملاحظة |
|---|---|---|---|
| — | `requestId` فارغ ⇒ فشل | 163 | قبل أي I/O |
| **R1** | قراءة `order_requests/{id}` | 168 | `status == "pending"` وإلا `AlreadyProcessed` |
| | `uid` فارغ / `items` ليست `List` / تجميع / `requestDate` ليس `Timestamp` | 179-221 | كل واحد ⇒ `failed` |
| **R2** | قراءة `users/{uid}` | 225 | من الحقول المكرّرة فقط |
| **R3** | قراءة `settings/app` | 247 | |
| | فحوص الوقت ثم الأهلية | 266 / 278 | |
| **R4** | قراءة `medicines/{id}` لكل صنف | 293 | `maxQuantity` ثم `stock` |
| **W1** | إنشاء `orders/{autoId}` | 358 | |
| **W2** | `medicines.stock = stock - qty` | 363 | **قيمة مطلقة** |
| **W3** | إنشاء `stock_logs` (`outward`) | 365 | `uid` = **الموظف** |
| **W4** | تحديث `users/{uid}` | 389 | `hasException=false` + كل `lastOrder*` |
| **W5** | `order_requests` ⇒ `processed` | 392 | |

> ⭐ **قاعدة `transaction.get`:** A2 يقرأ **قبل** أي كتابة.

### 6.4 حساب المخزون

```kotlin
// A2:321-323
if (item.quantity > stock) { markFailed("Insufficient stock for $medName") }
medicinesToUpdate.add(Triple(medRef, medName, stock - item.quantity));
// A2:363 — يُكتب المطلق
transaction.update(medData.first, "stock", medData.third);
```

> ⭐ **A2 لا يستخدم `FieldValue.increment` إطلاقًا** — يحسب المطلق داخل المعاملة، وهو بالضبط ما تتطلبه REST (§7.4).
> ⭐ **A2 لا يلمس `totalOutward`** — يحدّثه A4 فقط عند `accepted`. لا تنسخ هذا في ويندوز.

### 6.5 الحالات الفاشلة والذرّية

| الحالة | `status` | `error` |
|---|---|---|
| كل فشل تحقّق | `failed` | نص الرسالة + `processedBy` |
| `status != "pending"` | **لا شيء يُكتب** | `AlreadyProcessed(id)` يُعاد |
| نجاح | `processed` | `orderId` + `processedBy` + `processedAt` |

> ⭐ **`AlreadyProcessed` لا يكتب شيئًا** — مفتاح **الذرّية**: إعادة تشغيل المعالج لا تُنتج طلبًا ثانيًا.

### 6.6 التزامن

---

## 7. معمارية المعاملات (Transaction Architecture)

> **تصميم فقط** لما ستحتاجه خدمة معالجة الطلبات في Stage 5.

### 7.1 نقاط النهاية المطلوبة (موجودة أصلًا في A10)

| الخطوة | نقطة النهاية | دالة A10 | ملاحظة |
|---|---|---|---|
| 1. بدء | `POST :beginTransaction` | `beginTransaction()` | يُرجع معرّف `transaction` |
| 2. قراءة | `POST :batchGet` | `batchGetDocuments(paths, tx)` | المفقود يُعاد `null` **بترتيب الطلب** |
| 3. كتابة | `POST :commit` | `commitWrites(writes, tx)` | **يُقيَّم A1 هنا** |
| 4. إلغاء | `POST :rollback` | `rollback(tx)` | لا يرتكب شيئًا |

> ⭐ **A1 يُقيَّم مرتين:** عند `:batchGet` (القراءة) وعند `:commit` (الكتابة). أثبتت Stage 3 الاثنين.

### 7.2 تسلسل المعاملة المستهدف (مطابق لـ A2 §6.3)

```ts
const tx = await client.beginTransaction();
try {
  // ── كل القراءة أولًا (A1 يُقيَّم هنا) ──
  const [req]  = await client.batchGetDocuments([`order_requests/${requestId}`], tx);
  if (req?.data.status !== 'pending') return AlreadyProcessed;   // لا تكتب شيئًا
  const [user] = await client.batchGetDocuments([`users/${uid}`], tx);
  const [set]  = await client.batchGetDocuments(['settings/app'], tx);
  const meds   = await client.batchGetDocuments(medIds.map(m => `medicines/${m}`), tx);
  // ── فحوص صافية ──
  validateScheduleAndTime(...); validateUserEligibility(...); checkItems(...);
  // ── ثم الكتابة (A1 يُقيَّم هنا) ──
  await client.commitWrites([
    { kind: 'create', relativePath: `orders/${orderId}`,             data: {...} },
    ...medIds.map(id => ({ kind: 'update', relativePath: `medicines/${id}`, data: { stock: newAbs } })),
    ...medIds.map(id => ({ kind: 'create', relativePath: `stock_logs/${logId}`, data: {...} })),
    { kind: 'update', relativePath: `users/${uid}`,                 data: {...} },
    { kind: 'update', relativePath: `order_requests/${requestId}`,  data: { status: 'processed', ... } },
  ], tx);
} catch (e) {
  await client.rollback(tx);
  if (deniedByRules(e)) await markFailed(e);   // خارج المعاملة؛ A1 يسمح (isAdmin)
  throw e;
}
```

### 7.3 ⛔ فجوة 1 — `commitWrites` بلا `updateMask` ⇒ خطر إتلاف بيانات

`FirestoreWriteRequest` (A10:111) لا يعرّض `updateMaskPaths`، و`commitWrites` (A10:432) يرسل `update` **بلا قناع**:

```ts
const update = { name: ..., fields: encodeFields(write.data) };   // ❌ بلا updateMask
```

في Firestore REST، `update` **بلا `updateMask` يستبدل المستند بالكامل** ويحذف كل حقل غير مذكور. بينما في أندرويد:

```kotlin
transaction.update(medRef, "stock", medData.third)   // تحديث حقل واحد فقط
```

> 🚨 **لو نُفِّذت معالجة الطلبات بـ `commitWrites` كما هي اليوم، ستُمحى `name` و `maxQuantity` و `totalInward` و `totalOutward` من كل دواء.**
> **الإصلاح الملزم قبل Stage 5:** إضافة `updateMaskPaths` إلى `FirestoreWriteRequest` وتحويله إلى `updateMask: { fieldPaths: [...] }` (C5).

### 7.4 ⛔ فجوة 2 — `increment` غير موجود في REST

أندرويد يستخدم `FieldValue.increment` في 6 مواضع (A4:380، 412، 458، 586، 880، 881). REST لا يوفّره.

> **الفرق الدلالي:** في معاملة أندرويد `increment` **يُعاد حسابه** عند إعادة المحاولة. في REST تُحسب القيمة المطلقة في جسم المعاملة وتُعاد كتابتها. النتيجة متطابقة **بشرط إعادة حساب المطلق في كل محاولة** — وهو ما يفعله A2:363.
> **القاعدة:** طبقة ويندوز **لا تحسب `newStock` إلا بعد `batchGet` داخل نفس المعاملة**، ولا تعتمد على قيمة مقروءة خارجها (D5).

### 7.5 ⛔ فجوة 3 — توليد مُعرّف المستند

`AdminOrderProcessor` و`AdminActivity` يستخدمان `db.collection("x").document()` أي **معرّفًا تلقائيًا من الخادم**. REST لا يوفّر ذلك.
**المطلوب:** توليد المعرّف في العميل. ⚠️ `assertSafeRelativePath` يسمح بـ `[A-Za-z0-9_-]` فقط ⇒ **المعرّف المولَّد يجب أن يلتزم بذلك** (لا `+` ولا `/`، ولا يبدأ بـ `__` — انظر Stage 3 §9.1).

### 7.6 حدود `runQuery` الحالية

`FirestoreStructuredQuery` (A10:129) يدعم فقط `collectionId` + `where` بمُعامل `EQUAL` + `limit`. **لا `orderBy` ولا range.**

| حاجة | المصدر | الحالة | المطلوب لاحقًا |
|---|---|---|---|
| `orders` الأحدث (100) | A4:331-333 | ❌ | إضافة `orderBy` |
| تقرير الجرد بين تاريخين | A4:743-745 | ❌ | إضافة `>=` / `<=` |
| طلبات `status == pending` | A4:304-305 | ✅ متاح | — |
| آخر طلب للموظف | A2 لا يحتاجه (يقرأ الحقول المكرّرة) | — | — |

> ⚠️ **متطلّب فهارس في الإنتاج:** `whereEqualTo("userId").orderBy("date", DESC).limit(1)` (A5:164) يتطلّب **فهرسًا مركّبًا**؛ A5:199-204 يعالج خطأ الفهرس صراحةً. طبقة ويندوز ستواجه نفس المتطلّب.


---

## 8. نموذج الأمان (Security Model)

### 8.1 السلوك لكل دور (مُستخرَج من A1، ومُثبَت بأدلة Stage 3)

| العملية | `unauth` | `pending emp` | `approved emp` | `assistant` | `admin` |
|---|---|---|---|---|---|
| `GET users/{uid}` — **نفسه** | `401/403` ✅ | `200` | `200` | `200` | `200` |
| `GET users/{uid}` — **غيره** | `403` ✅ | `403` ✅ | `403` ✅ | `200` | `200` |
| `GET users` (list) | `403` ✅ | `403` ✅ | `403` ✅ | `200` | `200` |
| `PATCH` ملفه `{name}` | `403` | `200` | `200` | `200` | `200` |
| `PATCH` ملفه `{status:pending}` | `403` | فقط `rejected→pending` | فقط `rejected→pending` | `200` | `200` |
| `PATCH` ملفه `{role}` / `{employeeId}` | `403` | `403` ✅ | `403` ✅ | `200` | `200` |
| `GET medicines` | `403` | `200` | `200` | `200` | `200` |
| `POST/PATCH/DELETE medicines` | `403` | `403` ✅ | `403` ✅ | `200` | `200` |
| `GET settings/app` | `403` | `200` | `200` | `200` | `200` |
| `PATCH settings/app` | `403` | `403` | `403` | `200` | `200` |
| `GET/PATCH stock_logs` | `403` | `403` ✅ | `403` ✅ | `200` | `200` |
| `POST order_requests` (سليمة) | `403` | `403` ✅ | `200` | `200` | `200` |
| `POST order_requests` (+ مفتاح زائد) | `403` | `403` | `403` ✅ | `403` | `403` |
| `PATCH/DELETE order_requests` | `403` | `403` ✅ | `403` ✅ | `200` | `200` |
| `GET orders/{id}` — ملكه | `403` | `200` | `200` | `200` | `200` |
| `GET orders/{id}` — غيره | `403` | `403` ✅ | `403` ✅ | `200` | `200` |
| `POST/PATCH/DELETE orders` | `403` | `403` ✅ | `403` ✅ | `200` | `200` |
| `:runQuery orders where userId==auth.uid` | `403` | `200` | `200` | `200` | `200` |
| `:runQuery orders` (بلا فلتر) | `403` | `403` ✅ | `403` ✅ | `200` | `200` |

✅ = **مُثبَت فعليًا بطلب HTTP حقيقي** في مجموعة Stage 3 (54 اختبارًا، `exit code 0`).
**النقطة الجوهرية:** كل `403` في صفّ `pending employee` هو **قرار الخادم** على القواعد نفسها التي يقرأها الأندرويد.

### 8.2 مبادئ ملزمة للطبقة الجديدة

1. **`assistant` = `admin` في A1** (سطر 20). لا فرق سلوكي؛ الفرق وظيفي فقط — فحص بريد في A4:986 (C4).
2. **`unauthenticated` لا يقرأ شيئًا.** `FirestoreRestClient` يرفض إرسال طلب بلا رمز أصلًا.
3. **`403` ليس قابلًا لإعادة المحاولة** — هو قرار A1. تعرضه UX ولا يُعاد الطلب.
4. **`200` على مستند غير موجود = `NOT_FOUND` لا `403`.** A5:598-612 يتوقّع هذا صراحةً.
5. **لا عميل REST يمكنه التحايل.** Stage 3 أثبت أن الطلب ذاته برمز مختلف يعطي `403` مقابل `200`.
6. **الرموز تبقى في العملية الرئيسية** — `SafeAuthState` بلا رموز، والواجهة تستقبل DTO بلا `role` لاتخاذ قرار.


---

## 9. البنية المقترحة للمشروع

> مبنية على الهيكل **الفعللي** الموجود (`config/`, `services/`, `ipc/`, `window/`, `util/`) لا على مثال عام.

```
electron/
  main.ts / preload.ts        ✎ تعديل: قنوات ومعالجات IPC الجديدة فقط
  config/  window/  util/     ← قائم بلا تغيير

  services/                   ← النقل والمصادقة (قائم)
    firebase-auth.ts          المرحلة 2
    firestore-rest.ts         المرحلة 3  ◄── يحتاج updateMask (§7.3)
    firestore-codec.ts        المرحلة 3  ◄── يحتاج serverTimestamp (D4)
    app-status.ts
    order-processing.service.ts  🆕 Stage 5 — تصميمه في §7
    eligibility.service.ts        🆕 يقرأ domain/ ويستدعي المستودعات

  domain/                     🆕 نقي 100% — لا Electron، لا Firestore، لا I/O
    enums.ts       models.ts        results.ts      errors.ts
    month-year.ts  ⭐ تطبيع الأرقام الهندية → ASCII (D1)
    schedule.ts    ⭐ نافذة Asia/Damascus + الجمعة
    order-rules.ts ⭐ aggregateItems, maxQuantity, حد 5 أصناف
    eligibility.ts ⭐ منفذ A2 §6.2 حرفيًا

  repositories/
    contracts/                🆕 الواجهات (§3.2) — 6 ملفات
    firestore/                🆕 التنفيذات — 6 ملفات
      mappers/                ↕ حدود الوحيدة بين Firestore ونطاق المجال
      document-id.ts          ⭐ توليد مُعرّف متوافق (§7.5)

  ipc/                        ✎ channels.ts · api.ts · handlers/ (4 معالجات)

src/shared/
  ipc-contract.d.ts           ✎ موسّع بـ DTO للواجهة (بلا رموز، بلا مستندات)
  domain-view.d.ts            🆕 إسقاط آمن لنماذج المجال نحو الواجهة

tests/
  domain/         🆕 اختبارات صافية (node --test، بلا شبكة)
  repositories/   🆕 fetch مُدخَل — يتحقق من المسارات والحمولات
  emulator/       مجموعة Stage 3 القائمة؛ تُوسَّع بمستودعات حقيقية
```

### 9.1 لماذا هذا الموضع تحديدًا؟

| القرار | السبب |
|---|---|
| `domain/` منفصل تمامًا | `tsconfig` صارم (`noUnusedLocals`, `noImplicitAny`). العزل يجعل اختبار قواعد الأعمال ممكنًا بـ `node --test` بلا Electron وبلا محاكي. |
| `repositories/contracts/` منفصلة | يسمح بتبديل النقل لاحقًا دون لمس منطق المجال. |
| `mappers/` كحدّ وحيد | كل تسامح البيانات القديمة (§10) يترك في طبقة واحدة قابلة للاختبار، فلا يتسرّب إلى المجال. |
| إبقاء `firestore-rest.ts` في `services/` | نقله الآن يكسر بنية مُختبَرة بـ 81 اختبارًا. |

### 9.2 قاعدة الاتجاه (imports)

```
renderer → ipc/api → ipc/handlers → services → repositories/contracts → domain
                                                    ↓
                                    repositories/firestore → services/firestore-rest
```
`domain` **لا يستورد** أيًّا مما سبق. `repositories/contracts` لا يستورد `services`.


---

## 10. تعارضات البيانات (Data Inconsistencies)

> ⚠️ **لم أعدّل ولا أرحّل أي بيانات.** توثيق + توصية فقط.
> **الدليل:** A8 `audit_report.json` (26 طلبًا، 5 مستخدمين، 8 شواهد) و A9 `users_backup_*.json`.

### D1 🔴 حرج — `monthYear` بأرقام هندية عربية مقابل ASCII

**دليل من بيانات إنتاجية حقيقية (A8):**

```json
{ "userId": "VYFQiosm5LSGhaMHbshGWu9P4AD2", "lastOrderMonthYear": "٠٦-٢٠٢٦" }  // 06-2026
{ "userId": "nGelWLP1kyfUIFbF8GY6KqK87fj2", "lastOrderMonthYear": "٠٥-٢٠٢٦" }  // 05-2026
{ "userId": "rZrWw2nEIKPgzwk6ksGqDJnsK6H2", "lastOrderMonthYear": "٠٦-٢٠٢٦" }
{ "userId": "u59Q91tsTua3RniyrqwVjpSZhxo2", "lastOrderMonthYear": "٠٦-٢٠٢٦" }
```
⇒ **4 من 4** مستخدمين لديهم طلبات تحمل `monthYear` بأرقام هندية عربية (U+0660…U+0669).

**السبب — ثلاثة مواضع، اثنان بلغة النظام:**

| الموضع | الشيفرة | الناتج |
|---|---|---|
| `AdminOrderProcessor.kt:89` | `SimpleDateFormat("MM-yyyy", **Locale.US**)` | **ASCII** `06-2026` |
| `MainActivity.kt:149` | `SimpleDateFormat("MM-yyyy", **Locale.getDefault()**)` | **هندي عربي** على جهاز عربي |
| `MedicineOrderActivity.kt:172` | `SimpleDateFormat("MM-yyyy", **Locale.getDefault()**)` | **هندي عربي** على جهاز عربي |

**الأثر (حرج):** فحص A2:139
```kotlin
if (user.lastOrderMonthYear.isNotBlank() && user.lastOrderMonthYear == requestMonthYear)
```
`"٠٥-٢٠٢٦" == "05-2026"` ⇒ **false دائمًا**. أي أن **قاعدة «طلب واحد في الشهر» معطّلة تمامًا** لكل مستخدم يحمل تاريخًا بالهندية العربية — يمكنه الطلب مرارًا في الشهر نفسه.

**السلطة:** A2 هو المعيار الدلالي (`Locale.US` ⇒ ASCII) ويوافقه A7 — لكن **البيانات القائمة تخالفه**.

**توصية لطبقة ويندوز (بدون ترحيل):**
1. `domain/month-year.ts` يوفّر `normalizeMonthYear(v): string | null` تُحوّل الأرقام الهندية إلى ASCII.
2. كل المقارنات الشهرية في ويندوز تمرّ عبرها. **لا تُكتب قيمة جديدة إلا بصيغة ASCII.**
3. ⛔ **قرار مطلوب من صاحب المشروع:** هل تُصحَّح البيانات القائمة؟ المستند **لا يفترض ولا ينفّذ** ذلك — الترحيل قرار منفصل يتطلّب `--apply` مثل `migration/migrate-user-orders.js`.

### D2 🟡 المنطقة الزمنية: دمشق مقابل منطق الجهاز

| الموضع | المنطقة |
|---|---|
| `AdminOrderProcessor.getDamascusCalendar` (A2:80) | `Asia/Damascus` ✅ |
| A7 `BUSINESS_TIMEZONE` | `Asia/Damascus` ✅ |
| `MedicineOrderActivity:129` | `Calendar.getInstance()` = **منطقة الجهاز** |
| `MainActivity:148-149` | `java.util.Date()` = **منطقة الجهاز** |

**الأثر:** فحص النافذة الزمنية والجمعة في الواجهة قد يعطي **نتيجة مختلفة** عن فحص A2 على جهاز في منطقة أخرى.
**السلطة:** `Asia/Damascus` (اتفاق A2 + A7). **توصية:** `domain/schedule.ts` يعزل المنطقة كثابت واحد؛ الواجهة تعرض توقيت دمشق صراحةً.

### D3 🟡 `stock_logs.uid` له دلالتان متعارضتان

| الكاتب | القيمة | الدلالة الفعلية |
|---|---|---|
| `AdminOrderProcessor.kt:368` | `uid` (من `order_requests`) | **معرّف الموظف** الذي طلب |
| `AdminActivity.kt:415، 463، 591، 886` | `adminUid` | **معرّف المدير** الذي نفّذ |

**السلطة:** لا مصدر موحّد. **توصية:** تسمية المجال `actorUid` مع توثيق أنها «من نفّذ الحركة»، والاعتماد على `orderId`/`requestId` لتحديد الموظف.

### D4 🔴 `timestamp` — تمثيل التخزين مقابل قدرة المُرمِّز

| التمثيل | أين |
|---|---|
| `Timestamp` (كائن) | A2:212 `getTimestamp("requestDate")` |
| `{_seconds, _nanoseconds}` | A8 / A9 (تسلسل Admin SDK) |
| **نص ISO** | `firestore-codec.ts` ⭐ `decodeValue` يُرجع `timestampValue` **كنص** |

**الفجوة الحاسمة:** `firestore-codec.ts` يذكر أن `serverTimestamp` **مقصودًا غير مدعوم**. لكن:
- A5:249 يكتب `requestDate` بـ `FieldValue.serverTimestamp()`.
- A2:212 يقرؤه بـ `getTimestamp()` ⇒ **إن كان نصًا يُرجع `null`** ⇒ فشل `Missing request timestamp`.

> **الأثر:** لو كتبت ويندوز `requestDate` كنص ISO، **سيقرأه أندرويد كـ `null` ويُفشل الطلب**.
> **توصية (شرط مُسبق):** إمّا (أ) إضافة ترميز `serverTimestamp` إلى `firestore-codec.ts`، أو (ب) تمرير كائن `Date` (مدعوم في `encodeValue`) فيُنتج `timestampValue` صحيحًا.
> **ملاحظة أمنية:** الخيار (ب) يجعل **ساعة العميل** مصدر `requestDate` بدل خادم Firebase، فتخضع `validateScheduleAndTime` لثقة العميل. تعويض أمني حقيقي يستحق قرارًا صريحًا.

### D5 🟠 `FieldValue.increment` غير متاح في REST

A4 يستخدمه في 6 مواضع (380، 412، 458، 586، 880، 881). REST لا يوفّره. → §7.4.

### D6 🟡 `userId` مقابل `uid` — تسميتان للملكية

| المجموعة | حقل الملكية | سطر A1 |
|---|---|---|
| `orders` | **`userId`** | 77 |
| `order_requests` | **`uid`** | 92 |
| `users` | الهوية نفسها (`uid`) | 37 |
| `stock_logs` | `uid` (غير مقيَّد بالملكية) | 86 |

**السلطة:** A1 مُثبَّت في حقله لكل مجموعة. **لا توحيد.** الـ mappers في ويندوز **تحترم** الاختلاف.

### D7 🟠 مستند مدير إنتاجي بلا `hasException`

A9 يثبت أن مستند المدير الحقيقي = `{uid, role, name, employeeId, status}` فقط.
**الأثر:** A1:46 تشترطه **عند الإنشاء فقط**؛ القراءة لا تتطلّبه ⇒ لا كسر. وA2 يقرأ `getBoolean("hasException") == true` ⇒ `false` بأمان.
**توصية:** الـ mapper يعامل الغياب كـ `false`، لا كخطأ.

### D8 🟡 `null` مقابل «حقل غائب»

قبل الترحيل: مستندو `users` **لا يحتوون** `lastOrder*` إطلاقًا (A9). بعد الترحيل (A8): كُتبت **قيم `null` صريحة**.
⇒ كلا الشكلين قائم في الإنتاج. **توصية:** كل حقل اختياري يُقرأ بـ `?? افتراضي` (لا `typeof`).

### D9 🟡 `settings` — معرّف ثابت وحقول ميتة

- المعرّف **`app`** (A5:84، A2:246). اختبارات Stage 3 استخدمت `settings/schedule` كـ fixture.
- `maxDailyOrders` و `assistantId` **يُكتبان ولا يُقرآن** في أي مسار طلب (§2.8).
**توصية:** `SettingsRepository` يستخدم `settings/app` **حصريًا**.

### D10 🟡 `stock_logs.userName` نص وصفي حر

قيم حقيقية من A4: `«إلغاء طلب: …»`، `«حذف صنف من طلب: …»`، `«تعديل كمية في طلب: … (من 3 إلى 5)»`، `«المدير»`، `«المدير (دواء جديد)»`.
**لا يمكن** عرضه كـ«اسم المستخدم». **توصية:** حقل مسمّى `label` في المجال.


---

## 11. التعارضات المكتشفة (Conflicts)

> كل تعارض يُذكر **بكل أطرافه** مع تحديد السلطة. لا اختيار صامت.

| # | التعارض | الأطراف | **السلطة** | القرار الموثّق |
|---|---|---|---|---|
| **C1** | `AdminActivity` غير مُفعَّل في تطبيق أندرويد: غير مُسجَّل في `AndroidManifest.xml`، ولا يطلقه أي كود (A6 يعرض رسالة فقط عند `role=="admin"`). ⇒ `AdminOrderProcessor` **لا يعمل** في البناء المُسلَّم. | A4 · A6 · Manifest | **A1** (لا تتأثر) | ⛔ **لا تنسخ هذا.** تطبيق ويندوز سيحتاج مسار معالجة خاصًا به. مشروع أندرويد متروك. |
| **C2** | **مُعالجان مختلفان للطلب نفسه.** A7 (Cloud Function) عن A2 (معالج العميل). A7: (أ) ينفّذ `where().get()` **داخل** `runTransaction` — مخالف لـ `migration/README.md`؛ (ب) يقرأ من مجموعة `orders` لا من الحقول المكرّرة؛ (ج) ⭐ **لا يكتب `users.lastOrder*` إطلاقًا** (يحدّث `hasException` فقط) ⇒ يترك ملخّص المستخدم **قديمًا**. | A2 · A7 · README | **A2** | `README` يشرح أن الحقول المكرّرة وُجدت **لأن A2 لا يستطيع الاستعلام داخل المعاملة**. إذن **A2 هو المعيار** وA7 سلف مهجور. ⛔ **لا تنشر A7.** |
| **C3** | `monthYear`: ASCII (A2:89) مقابل هندي عربي (A5:172، A6:149) — والبيانات إنتاجية بالهندي. | A2 · A5 · A6 · A8 | **A2** دلاليًا | §10-D1. ⛔ **لا تُصلَّح البيانات في هذه المرحلة.** |
| **C4** | فحص صلاحيات في العميل: A6:54 وA4:986 يقارنان `email == "assistant@drugapp.internal"` لفرض سلوك إداري، بينما A1 يعتمد `role`. | A1 · A4 · A6 | **A1** | ⛔ **طبقة ويندوز لا تنسخ هذا النمط.** الدور يُقرأ من `users.role`؛ فحص البريد لا يصلح كصلاحية. |
| **C5** | ⛔ **فجوة `updateMask`:** A2:363 `transaction.update(medRef, "stock", v)` (حقل واحد) بينما `commitWrites` (A10:432) يرسل `update` بلا `updateMask` ⇒ **استبدال كامل للمستند**. | A2 · A10 | **A2** دلاليًا | §7.3. **إصلاح مُلزم قبل أي كتابة في Stage 5.** |
| **C6** | ⛔ **`serverTimestamp` غير مدعوم** في `firestore-codec.ts`، بينما A5:249 يكتبه وA2:212 يقرأه بـ `getTimestamp`. | A2 · A5 · A10 | **A2** | §10-D4. **قرار مطلوب: ساعة الخادم أم ساعة العميل؟** |
| **C7** | A1:77 وA1:92 يستخدمان حقلَي ملكية مختلفين (`userId` / `uid`) لنفس المفهوم. | A1 | **A1** لكل مجموعة | §10-D6. **لا توحيد.** |
| **C8** | `stock` يُخصم عند الطلب (A2) بينما `totalOutward` يُزاد عند القبول (A4:381) ⇒ `stock ≠ totalInward − totalOutward`. | A2 · A4 | **A4** لتقرير الجرد | §2.3. تقرير الجرد يجب أن يُشتق من `stock_logs` كما في A4:743-745. |
| **C9** | `maxQuantity` معرّف كـ«حد أعلى للطلب» (A2:310، A4:961) بينما `Models.kt:18` يعرضه بلا توثيق ضمن نموذج medicine. | A2 · A3 · A4 | **A2 + A4** (عندها معنى صريح) | §4.2. `Models.kt` **سطحي وليس مرجعًا**. |
| **C10** | `maxDailyOrders` مخزَّن في `settings/app` لكن فحصه **معطَّل عمدًا** (A5:232-233). | A5 · settings | **A5** (قرار المنتج) | §2.8. لا تنفّذه. |
| **C11** | A3 (`Models.kt`) لا يغطي `lastOrder*` ولا `isExceptionOrder` ولا `requestId` — نموذجه **ناقص** مقارنة بالبيانات الفعلية. | A3 · A8 | **A8 + A9** | §2 في هذا المستند هو المرجع. **لا تنسخ A3 حرفيًا.** |

### 11.1 ملخص: من أي Artifact نأخذ المرجع

| الجانب | المرجع المعتمد | المرفوض |
|---|---|---|
| الصلاحيات | **A1** | A4 · A6 (فحوص عميل) |
| معالجة الطلب | **A2** | **A7** |
| الوقت والمنطقة | **A2** (دمشق) | A5 · A6 (منطقة الجهاز) |
| صيغة الشهر | **A2** (ASCII) + تطبيع للقديم | A5 · A6 (هندية) |
| الشكل الفعلي للبيانات | **A8 + A9** | A3 (ناقص) |
| دلالات المخزون | **A4** (الجرد من `stock_logs`) | عدّادات الدواء |


---

## 12. استراتيجية الاختبار (Testing Strategy)

> **لم تُنشأ مجموعة اختبارات في هذه المرحلة** — التصميم فقط، كما طُلب.
> القاعدة الحاكمة للمشروع: `npm run typecheck` · `npm run build` · `npm test` — و**يجب أن يبقى `npm test` أخضرًا (81 اختبارًا حاليًا)**.

| # | الطبقة | الأداة | العدد | الأولوية |
|---|---|---|---|---|
| T1 | اختبارات المجال (نقية) | `node --test`، بلا شبكة | ~30 | 🔴 مُلزمة |
| T2 | اختبارات الـ mappers | `node --test` + fixtures | ~20 | 🔴 مُلزمة |
| T3 | اختبارات المستودعات | `fetch` مُدخَل | ~15 | 🟠 |
| T4 | حدود الصلاحيات | محاكي حقيقي | ~8 | 🔴 مُلزمة |
| T5 | المعاملات | محاكي حقيقي | ~6 | 🔴 مُلزمة |
| T6 | التوافق مع أندرويد | fixtures من A8/A9 | ~10 | 🟠 |

### 12.1 T1 — اختبارات المجال (نقل حرفي لـ `AdminOrderProcessorTest`)

تُنقل الـ 17 اختبارًا الموجودة في `AdminOrderProcessorTest.kt` **حرفيًا** إلى `tests/domain/`:
`testValidRequestScheduleAndTime` · `testFridayRestriction` · `testOutsideOperatingHours` · `testPendingPreviousOrderLock` · `testRejectedNonExceptionRetry` · `testRejectedExceptionOrderLock` · `testSameMonthRestriction` · `testMinimumDayViolation` · `testExceptionUserBypass` · `testDuplicateMedicineIdsAggregation` · `testLargeLongQuantityAndOverflowProtection` · `testItemValidationLogic` · `testMoreThanFiveItems` · `testInvalidItemStructure` · `testEmptyItemsList` · `testUnapprovedUser` · `testParseTimeToMinutes`

> ⭐ **بالإضافة إليها** (تغطّي D1):
```
✔ normalizes "٠٥-٢٠٢٦" to "05-2026"
✔ treats "٠٥-٢٠٢٦" and "05-2026" as the SAME month   ← يمنع تكرار خلل D1
✔ rejects non-ASCII monthYear on output
✔ diffDays floors 14.9 days to 14 (rejected at minDays=15)
✔ hasException bypasses the "already pending" lock
```

### 12.2 T2 — اختبارات الـ mappers (تحمل تسامح البيانات القديمة)

| الحالة | الأثر |
|---|---|
| طلب بلا `isExceptionOrder` (8 من 26 حقيقيًا) | ⇒ `false` بلا خطأ |
| مستند بلا `hasException` (A9) | ⇒ `false` |
| `lastOrderId: null` **و** حقل غائب | كلاهما ⇒ `null` |
| `lastOrderMonthYear = "٠٦-٢٠٢٦"` | ⇒ `normalizeMonthYear` تُعيد ASCII |
| `status` بقيمة غير معروفة | ⇒ لا يرمي؛ يُبلَّغ |
| `stock_logs.userName = "تعديل كمية في طلب: …"` | ⇒ حقل `label` |
| `quantity` كـ `doubleValue` لا `integerValue` | يُقبل كعدد |
| مستند فارغ `{}` | ⇒ قيم افتراضية موثّقة |

### 12.3 T3 — اختبارات المستودعات (سلامة النقل لا الصلاحيات)

```
✔ users repo: GET users/{uid} بمسار صحيح ورمز المستخدم
✔ order-requests repo: POST بمفاتيح {uid, items, status, requestDate} فقط  ← A1 hasOnly
✔ كل كتابة goods تحمل updateMask صريح                                    ← C5
✔ settings repo: يكتب دائمًا settings/app لا settings/schedule           ← D9
✔ كل مُعرّف مولَّد يحترم [A-Za-z0-9_-] ولا يبدأ بـ __                   ← §7.5
```

### 12.4 T4 — حدود الصلاحيات (على المحاكي الحقيقي)

توسيع لمجموعة Stage 3 (54 اختبارًا) — الجديد يثبت أن **المستودعات** لا تفقد A1:
```
✔ admin يُقبل approve()        → 200
✔ employee يُرفض approve()     → 403 (ليس 404 ولا 500)
✔ repo لا يعيد المحاولة عند 403
✔ repo يترجم 403 إلى TypedError بلا تسريب رمز
```

### 12.5 T5 — المعاملات (على المحاكي الحقيقي)

```
✔ دورة كاملة: begin → batchGet → commit → التحقق من 5 كتابات
✔ commit غير مصرّح → 403 + تأكيد أن stock لم يتغيّر
✔ إعادة المعالجة لنفس الطلب → لا طلب ثانٍ (AlreadyProcessed)
✔ ⛔ انحدار: update بلا updateMask لا يمحو حقول الدواء                    ← C5
✔ rollback يُبطل المعاملة
```

### 12.6 T6 — التوافق مع أندرويد (fixtures من A8/A9 بأسماء مُجهَّلة)

```
✔ يقرأ lastOrderMonthYear بالهندية العربية ويطبّعها
✔ يقرأ lastOrderDate بصيغة { _seconds, _nanoseconds }
✔ order.status = "accepted" ⇒ enum صحيح
✔ order_request.status = "processed" مع orderId ⇒ OrderRequest كامل
```

---

## 13. أسئلة مفتوحة تتطلّب قرارًا (لا نُجيب عنها تلقائيًا)

1. **§10-D1** — هل تُصحَّح قيم `monthYear` الهندية في الإنتاج؟ (أثره على تشغيل业务 قائم؛ لا يُحسم تقنيًا.)
2. **§10-D4** — `requestDate`: ساعة **الخادم** (تحتاج ترميز `serverTimestamp`) أم ساعة **العميل** (أسهل، لكن يُضعف فحص النافذة الزمنية)؟
3. **§11-C1** — هل سيعالج تطبيق ويندوز الطلبات بنفسه (كما صُمّم في A2)، أم سيبقى هناك معالِج مُشغَّل؟
4. **§7.5** — صيغة المُعرّف المولَّد: نحاكي صيغة Firestore (20 محرفًا) أم UUID كما في `order_requests` (A5:242)؟

---

## 14. حالة التسليم (Stage 4)

| البند | الحالة |
|---|---|
| تنفيذ كود | ⛔ **لا شيء.** مستند واحد فقط. |
| شاشات / منطق أعمال / معالجة طلبات / مخزون | ⛔ لا شيء |
| نشر / اتصال إنتاجي | ⛔ لا شيء |
| مشروع أندرويد | ✅ **لم يُمسّ** (قراءة فقط) |
| `firestore.rules` | ✅ **لم يُمسّ** (بصمة `1FA3C607…DC63B` قبل وبعد) |
| Cloud Functions | ✅ **لم يُمسّ ولم يُنشر** |
| Firebase إنتاجي | ✅ **لم يُتصل به** |
| اختبارات المشروع القائمة | ✅ **81/81 تمرّ** |

### 14.1 الملفات المُنشأة في هذه المرحلة

| الملف | الغرض |
|---|---|
| `docs/domain-data-architecture.md` | Stage 4 كامل — التدقيق والتصميم |

**لا ملفات مصدرية جديدة. لا تعديل على أي ملف موجود.**

---

# 15. Stage 5B — التنفيذ الفعلي (Domain + Repository)

> هذه هي الشيفرة المنفَّذة. كل ما سبق (§0–§14) هو التدقيق الذي أفرزها.
> **النطاق المنفَّذ:** نماذج المجال، قيم مغلقة، طبقة التحويل، واجهات المستودعات، تنفيذاتها، واختبارات.
> **غير منفَّذ عمدًا:** الشاشات، منطق الأعمال، معالجة الطلبات، تعديل المخزون، اللوحات، التقارير.

## 15.1 البنية المنفَّذة

```
electron/
  domain/                          ⬅ نقي 100% بلا I/O
    models.ts                      User, Medicine, Order, OrderRequest, OrderItem, StockLog, AppSettings
    values.ts                      المجموعات المغلقة + الحُرّاس (enums منطقية لا TS enums)
    month-year.ts                  توافق القراءة لـ monthYear (D1)
    errors.ts                      DomainError, MalformedDataError, InvalidInputError
    index.ts                       barrel

  repositories/
    contracts/                     ⬅ الواجهات (بلا تنفيذ)
      common.ts                    TransactionId + حدود معاملة Stage 6 (مُعلَنة، غير منفَّذة)
      users-repository.ts
      medicines-repository.ts      MedicinesRepository + SettingsRepository
      order-repository.ts           OrderRequests/Orders/StockLogs
    firestore/                     ⬅ التنفيذ فوق Stage 5A
      repository-support.ts         ترجمة الأخطاء + أدوات المسار/الحدود
      users-repository.ts
      medicines-repository.ts
      order-repository.ts
      mappers/                     ⬅ الحدّ الوحيد مع تنسيق Firestore
        readers.ts                 قراءات صارمة/افتراضية موثّقة
        user-mapper.ts
        medicine-mapper.ts
        order-request-mapper.ts
        order-mapper.ts            Order + StockLog + AppSettings
    index.ts
```

**قاعدة الاتجاه المُطبَّقة (مطابقة لـ §9.2):**
`renderer → ipc → services → repositories/contracts → domain`، و`repositories/firestore → services/firestore-rest`.
`domain/` **لا يستورد** أيًّا مما سبق (عدا نوع `FirestoreTimestamp` الذي يُعاد تسميته إلى `DomainTimestamp`).

## 15.2 قرار معماري: أين تعيش القيم المغلقة؟

⚠️ **تعارض حقيقي اكتُشف أثناء التنفيذ ووُثِّق بدل إخفائه:**

كنت قد وضعتُ `UserRole` و `UserStatus` … في `services/firestore-codec.ts`. لكن Stage 3 تُشغّل حراسة معمارية (`firestore-architecture.test.ts`) **تمنع حرفياً** وجود السلاسل `isAdmin` / `'admin'` / `'approved'` … في ملفات طبقة النقل:

```ts
// tests/firestore-architecture.test.ts — "keeps the REST client role-agnostic"
for (const forbidden of ['isAdmin', "'admin'", "'approved'", ...]) {
  assert.equal(content.includes(forbidden), false, ...);
}
```

**السبب الدقيق للحراسة:** كلمة دور داخل طبقة النقل هي **خطوة واحدة بعيدة** من فحص صلاحيات في العميل. وهي في الماضي اكتُشفت خطأً (`MainActivity` كان يفحص `email == "assistant@…"`) — C4.

**الحل:** نُقلت المجموعات المغلقة إلى `domain/values.ts`. هذا ليس تحايلاً على الحراسة (تعليق بلا معنى)، بل الموضع الصحيح: المفردات **معرفة مجال** لا معرفة تنسيق سلك. والنتيجة أن `firestore-codec.ts` عاد إلى محايد تماماً تجاه الأدوار.

## 15.3 نماذج المجال المنفَّذة

| النموذج | ملاحظات التنفيذ |
|---|---|
| `UserProfile` + `UserOrderSummary` | `uid` يأتي من **معرّف المستند** لا من الحقل المخزَّن. كل حقول `lastOrder*` اختيارية وتتحمّل `null` **و** غياباً. |
| `Medicine` | `maxQuantity` = حد الطلب الواحد، **ليس** الرصيد. |
| `Order` | `monthYear` **خام** (قد يكون هنديًا عربيًا). `isExceptionOrder` = `false` عند الغياب. |
| `OrderRequest` | `requestDate` من نوع `DomainTimestamp` **إلزامي** (A2 يقرأه بـ `getTimestamp`، ونصٌّ يجعله `null`). |
| `StockLog` | إعادة تسمية محمولة: `userName → label` (D10، ليس اسم مستخدم) و `uid → actorUid` (D3، دلالتان متعارضتان). |
| `AppSettings` | الستة حقول؛ الاثنان الميتان (`maxDailyOrders`, `assistantId`) موثّقان كميتَين لا مخفيَّين. |

**بلا `any`:** كل نموذج صريح، وكل قراءة تستخدم حارس نوع.

## 15.4 طبقة التحويل (المسار الوحيد مع تنسيق Firestore)

```
Firestore REST document
  → FirestoreRestClient.toDocument()      (Stage 3 — يفكّ التشفير)
  → mappers/readers.ts                    (قراءة صارمة/افتراضية)
  → domain model                          (نقي)
```

**قاعدتان حاكمتان في `readers.ts`:**

1. **إلزامي مقابل اختياري.** حقل تعتمد عليه كليّة المعالجة (`requestDate`) **إلزامي**: غيابه أو نوعه الخاطئ ⇒ `MalformedDataError`، لا قيمة افتراضية. حقل تعترف القواعد أنه اختياري (`isExceptionOrder`, غائب في 8 من 26 طلبًا حقيقيًا) يُقرأ بقيمة موثّقة.
2. **لا إكراه صامت.** `doubleValue` يُقبل كعدد (البيانات الحقيقية تفعل)، لكن **نص غير رقمي لا يُحوَّل** إلى رقم، وقيمة enum غير معروفة **لا تُعاد كتابتها** — بل تُبلَّغ عبر `onWarning` وتُقرأ بقيمة افتراضية.

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
