# Stage 23 — ترقيم صفحات سجل الطلبات الإداري

> **المرحلة 23:** تُضيف ترقيم صفحات إلى سجل الطلبات الإداري فوق REST Firestore، بحيث يقرأ المدير أول صفحة بحد أقصى 500 طلب، ثم يطلب صفحات تالية عند الحاجة. رمز الاستمرار (continuation token) يبقى في Main Process ولا يعبر الجسر إلى Renderer.

هذا الملف تدقيق معماري لسلوك Stage 23 كما هو منفذ في الشيفرة، وليس مقترحًا. كل مسار ملف مذكور أدناه يشير إلى الشيفرة الفعلية.

## 0. الخلاصة

| # | القرار | الموضع |
| --- | --- | --- |
| D1 | حجم الصفحة ثابت عند 500، لا يتحكم به الـ Renderer | `MANAGER_LIST_LIMITS.orders` |
| D2 | رمز الاستمرار يبقى في Main ولا يُسقط عبر IPC | `electron/application/manager-data.service.ts` |
| D3 | كلتا القناتين بلا حمولة تمامًا | `electron/ipc/channels.ts` |
| D4 | الفشل يُبقي الرمز السابق لإعادة المحاولة | `loadMoreOrderHistory` |
| D5 | الرمز المكرر يوقف الترقيم بدل حلقة لا نهائية | `ordersHistoryPageTokens` |
| D6 | التحديث يبدأ نافذة جديدة من الصفر | `resetOrderHistoryPagination` |
| D7 | البحث والتصفية محليان على الصفحات المحمّلة | `mergeOrderHistoryPages` |
| D8 | الاستجابات المتأخرة تُهمَل عند تغيّر الجلسة | `isCurrentOrderHistoryRequest` |

## 1. لماذا الترقيم موجود أصلًا

قبل Stage 23 كانت `listOrders` قراءة واحدة غير مفلترة بحد 500 عنصر. الحدّ موجود منذ Stage 12 (`docs/domain-data-architecture.md` §15.6) كحجم نافذة موحّد، لكن النافذة كانت **غير قابلة للتوسيع**: ما لا يدخل في أول 500 طلب لا يمكن رؤيته إطلاقًا.

الطبقة البرمجية الأساسية لا تدعم `orderBy` ولا النطاقات ولا المؤشرات (راجع `electron/services/firestore-rest.ts`)، لذا لم يكن أي ترتيب زمني متاحًا أصلًا. لذلك:

- الترقيم هنا **ليس** على واجهة `orderBy`؛ هو ترقيم على مستوى المستند (`listDocuments` مع `pageSize` و`pageToken`).
- النتيجة **ليست مرتبة زمنيًا**. المستند يقول ذلك صراحةً: REST لا يضمن ترتيبًا، و`listDocuments` لا يمرّر `orderBy`.
- الصفحات **ليست لقطة متسقة** (consistent snapshot). الطلب الذي كُتب بين صفحتين قد يظهر أو لا يظهر حسب توقيت القراءة.

لهذا السبب يحدّد نص الواجهة (Stage 22) نفسه ما يطبعه: «يشمل التقرير الطلبات المحمّلة والمصفّاة محليًا حاليًا؛ لا يُضمن الترتيب الزمني أو اتساق اللقطة».

## 2. طبقة النقل — `listDocuments`

النقل يضيف معاملين فقط إلى طلب REST القياسي (`electron/services/firestore-rest.ts`):

```ts
export interface ListDocumentsOptions {
  readonly pageSize?: number | undefined;
  readonly pageToken?: string | undefined;
}

export interface FirestoreListResult {
  readonly documents: readonly FirestoreDocument[];
  readonly nextPageToken: string | null;
}

public async listDocuments(
  collectionPath: string,
  options: ListDocumentsOptions = {},
): Promise<FirestoreListResult> {
```

- `pageSize` → معامل `pageSize`.
- `pageToken` → معامل `pageToken`، ويُرسل **فقط** عندما يكون معرَّفًا.
- `nextPageToken` يُقرأ من جسم الاستجابة عبر `readNextPageToken`.

و`readNextPageToken` حازم عمدًا:

```ts
if (typeof value !== 'string' || value.length === 0) {
  throw new FirestoreRestError({ reason: 'UNKNOWN', ... });
}
```

رمز فارغ أو من نوع خاطئ **ليس** «نهاية القائمة»؛ إنه استجابة غير متوقعة ترفع خطأً. تمييز هذا مهم: لو عُومِل الرمز الفارغ كـ end-of-list، لتوقّف الترقيم بصمت على بيانات ناقصة. أما `undefined`/`null` فقط هو نهاية القائمة فعلًا.

## 3. طبقة المستودع — `listOrdersPage`

العقد في `electron/repositories/contracts/order-repository.ts`:

```ts
export interface OrdersRepositoryPage {
  readonly orders: readonly Order[];
  readonly nextPageToken: string | null;
}

listOrdersPage(
  limit: number,
  pageToken: string | null,
): Promise<OrdersRepositoryPage>;
```

التنفيذ في `electron/repositories/firestore/order-repository.ts` يفرض ثلاثة أشياء:

1. **`requirePositiveLimit(limit)`** — الحدّ يجب أن يكون عددًا موجبًا صالحًا، وإلا فـ `DomainError` من نوع `INVALID_INPUT`.
2. **رفض الرمز الفارغ قبل الشبكة**: `if (pageToken !== null && (typeof pageToken !== 'string' || pageToken.length === 0))` يرفع `INVALID_INPUT`. أي رمز فارغ يُرفض **دون إصدار طلب**.
3. **الرمز يُمرَّر كما هو** — لا يُفكّ ولا يُعاد ترميزه. هو رمز معتم من Firestore، يعامل كسلسلة مبهمة.

ثم:

```ts
const result = await this.context.client.listDocuments(ORDERS, {
  pageSize: safeLimit,
  ...(pageToken === null ? {} : { pageToken }),
});
```

الشرط `...(pageToken === null ? {} : { pageToken })` مقصود: معامل `pageToken` غائب تمامًا في النداء الأول، لا `undefined` ولا `''`. هذا يطابق عقد REST الذي يمرّر المعامل فقط عندما يكون معرَّفًا.

`listOrders` القديمة لم تُحذف، بل صارت غلافًا:

```ts
public async listOrders(limit: number): Promise<readonly Order[]> {
  return (await this.listOrdersPage(limit, null)).orders;
}
```

### 3.1 ترتيب الأخطاء مهم

في `listOrdersPage` يوجد `try/catch` يحوّل أي خطأ عبر `toDomainError(error, ORDERS)`. هذا يعني أن رفض Firestore Rules (HTTP 403) يصبح `DomainError` من نوع `NOT_AUTHORIZED`، وهو ما يصل إلى التطبيق كـ `AUTHORIZATION_DENIED`.

**لا يُعامل الرفض كـ end-of-list.** لو حدث ذلك، لأخفى Stage 23 رفض القواعد خلف «لا توجد صفحة تالية»، وهو إخفاءٌ لخطأ أمني في الواجهة. اختبار `propagates Firestore authorization failures instead of treating them as end-of-list` يثبّت هذا صراحةً.

### 3.2 لا فحص صلاحيات محلي

المستودع **لا** يفحص الدور. السبب: استعلام `orders` غير المفلتر لا يستطيع إثبات الملكية («rules are not filters»)، فيرفضه Firestore لغير المدير بـ 403. القرار يبقى عند `firestore.rules`، والطبقة العليا تكتفي بتقريره.

## 4. طبقة التطبيق — ملكية الرمز

هذه هي الطبقة الحاسمة. `electron/application/manager-data.service.ts` يحتفظ بحالة الترقيم:

```ts
private ordersHistoryNextPageToken: string | null = null;
private readonly ordersHistoryPageTokens = new Set<string>();
private ordersHistoryOwnerUid: string | null = null;
private ordersHistoryNamesByUid: Map<string, string> | null = null;
private ordersHistoryPageInFlight = false;
```

### 4.1 `listOrderHistoryPage` — نافذة جديدة

```ts
if (!state.authenticated || state.uid === null || state.uid.length === 0) {
  this.resetOrderHistoryPagination();
  return applicationRefusal('AUTHENTICATION_FAILED', { retryable: false, ... });
}
if (this.ordersHistoryPageInFlight) {
  return applicationRefusal('INFRASTRUCTURE_FAILURE', { retryable: true, ... });
}

this.ordersHistoryPageInFlight = true;
this.resetOrderHistoryPagination();
this.ordersHistoryOwnerUid = state.uid;
```

تسلسل الخطوات مقصود:

- **الجلسة مطلوبة أولًا.** بلا `uid` لا يمكن ربط الرمز بصاحب، فتُمسح الحالة ويُرفض الطلب.
- **حارس التزامن (`ordersHistoryPageInFlight`)** يمنع طلبين متداخلين. يعيد `INFRASTRUCTURE_FAILURE` قابلًا لإعادة المحاولة — وهو تصنيف صحيح: الطلب المتكرر قد ينجح.
- **`resetOrderHistoryPagination()` قبل القراءة** يضمن أن النافذة الجديدة تبدأ من الصفر: لا رمز متبقٍّ من جلسة سابقة، ولا مجموعة رموز قديمة يمكن أن تُطلق حماية D5 على الصفحة الأولى.

### 4.2 `loadMoreOrderHistory` — تقدّم المؤشر

```ts
if (this.ordersHistoryOwnerUid !== state.uid) {
  this.resetOrderHistoryPagination();
  return applicationRefusal('AUTHENTICATION_FAILED', {
    retryable: false,
    diagnostic: 'orders history cursor belongs to a different authenticated uid',
  });
}
const pageToken = this.ordersHistoryNextPageToken;
if (pageToken === null) {
  return applicationSuccess(Object.freeze({ orders: Object.freeze([]), hasMore: false }));
}
```

**حارس المالك (D2)** هو أهم سطر في Stage 23: الرمز مرتبط بـ `uid` الذي فتح النافذة. لو سجّل مستخدم آخر خروجًا ودخولًا بين الصفحة الأولى والثانية، تُمسح الحالة ويُرفض الطلب بدل أن تُسلَّم بيانات المدير الأول للمستخدم الثاني. مقارنة الـ uid تتم في Main من حالة المصادقة الحقيقية، لا من مدخلات الـ Renderer.

**نهاية القائمة** تُعاد كنجاح فارغ (`orders: []`, `hasMore: false`) لا كخطأ. هذا يتيح للـ Renderer إغلاق زر «تحميل المزيد» دون واجهة خطأ.

### 4.3 D4 — الفشل يُبقي الرمز

النقطة الحرجة في `loadMoreOrderHistory` هي **ما لا يحدث** عند الفشل:

```ts
return await attempt(async () => {
  const page = await this.repositories.orders.listOrdersPage(MANAGER_LIST_LIMITS.orders, pageToken);
  ...
  this.ordersHistoryNextPageToken = page.nextPageToken;
  ...
}, this.onDiagnostic);
```

سطر `this.ordersHistoryNextPageToken = page.nextPageToken` يقع **بعد** نجاح القراءة. إن فشلت القراءة، فإن `attempt` يرمي الاستثناء ويخرج قبل هذا السطر، فيبقى `ordersHistoryNextPageToken` على قيمته السابقة.

النتيجة العملية: زر «تحميل المزيد» يعيد **نفس** الصفحة بالضبط. لا يوجد «صفحة تخطّت» ولا «صفحة ضائعة» — وهذا بالضبط ما يثبّته اختبار `retains the cursor after a transient subsequent-page failure and retries the same page`.

### 4.4 D5 — حماية من الحلقة اللانهائية

```ts
if (page.nextPageToken !== null && this.ordersHistoryPageTokens.has(page.nextPageToken)) {
  this.ordersHistoryNextPageToken = null;
  throw new ApplicationError('INTERNAL_ERROR', {
    retryable: false,
    diagnostic: 'Firestore repeated an orders history page token',
  });
}
```

`ordersHistoryPageTokens` مجموعة بكل رموز الاستمرار التي رآها Main. إذا أعاد Firestore رمزًا سبق أن رآه، فالترقيم يدور على نفسه حتمًا. التطبيق:

1. **يمسح الرمز الحالي** (`= null`) — فيتوقف الترقيم عند حدّه.
2. **يرفع `INTERNAL_ERROR` غير قابل لإعادة المحاولة** — فيعرض الـ Renderer رسالة ويوقف زر «تحميل المزيد».


### 4.5 كاش الأسماء

`resolveOrderEmployeeNames` تبني خريطة `uid → اسم حيّ` من `users.listAllUsers()`. هذه العملية **best-effort**: أي فشل (بما فيه رفض القواعد للمديرين فقط) يُبتلع ويُعيد خريطة فارغة.

السبب أن هذه **زخرفة لا بيانات**: الطلب يخزّن لقطة اسم في الحقل `userName`، واسم الموظف الحيّ ترقية اختيارية. فشلها يجب ألا يحوّل صفحة قراءة صالحة إلى صفحة خطأ، ولا أن يحذف طلبًا.

الأهم في Stage 23: الكاش يُحفظ في `ordersHistoryNamesByUid` بعد الصفحة الأولى، والصفحات اللاحقة تستخدمه:

```ts
const namesByUid = this.ordersHistoryNamesByUid ?? new Map<string, string>();
```

وهذا يمنع قراءة `users` كاملة في كل صفحة. الجانب المقبول: الاسم الحيّ لصفحة قديمة يُعرض من كاش الصفحة الأولى، فقد يكون الاسم قد تغيّر بعدها. لكن الكاش **يُعاد بناؤه عند كل تحديث** (لأن `resetOrderHistoryPagination` يصفّره)، فلا تتراكم الأسماء القديمة عبر التحديثات.

## 5. الجسر — بلا حمولة

### 5.1 القناتان

```ts
ordersList: 'drug-manager:orders:list',
ordersHistoryLoadMore: 'drug-manager:orders:history-load-more',
```

### 5.2 المعالجان

```ts
[IPC_CHANNELS.ordersList]: guard(async () => application.manager.listOrderHistoryPage()),
[IPC_CHANNELS.ordersHistoryLoadMore]: guard(async () => application.manager.loadMoreOrderHistory()),
```

`guard(async () => ...)` — **بلا معامل**. لا destructuring، لا `payload`، لا حتى متغير غير مستعمل. ليس إهمالًا، بل تصميم: لو قبل المعالج معاملًا لكان على الـ Renderer أن يمرّر «لا شيء» عبر قناة مصممة لتقبل «لا شيء».

### 5.3 عقد الـ preload

```ts
list: async (): Promise<ApplicationResult<OrderHistoryPageView>> => {
  const response = await ipcRenderer.invoke(ORDERS_LIST_CHANNEL);
  return response as ApplicationResult<OrderHistoryPageView>;
},
loadMore: async (): Promise<ApplicationResult<OrderHistoryPageView>> => {
  const response = await ipcRenderer.invoke(ORDERS_HISTORY_LOAD_MORE_CHANNEL);
  return response as ApplicationResult<OrderHistoryPageView>;
},
```

### 5.4 العقد العام

```ts
interface OrderHistoryPageView {
  readonly orders: readonly OrderHistoryItemView[];
  readonly hasMore: boolean;
}
```

**الرمز ليس في العقد.** لا يوجد حقل `pageToken` ولا `nextPageToken` في `OrderHistoryPageView`. الـ Renderer يتعلم فقط إن كان هناك المزيد (`hasMore`)، ولا يستطيع أن يصيغ رمزًا — لأن:

1. لا يعرف صيغته (مُعمّاة من Main).
2. لا يستطيع حقنها (القناة بلا حمولة).
3. لا يحتاجها أصلًا: `loadMore()` تستدعي Main، وMain يملك الرمز.

هذا هو **D2**، وهو ما يجعل Stage 23 آمنة بالتصميم لا بالاجتهاد.

## 6. الـ Renderer

### 6.1 الحالة

```ts
let ordersHistoryInFlight = false;
let ordersHistoryLoadMoreInFlight = false;
let ordersHistoryHasMore = false;
let ordersHistoryLoadMoreMessage = '';
let ordersHistoryLoadMoreRetryable = false;
let ordersHistoryRequestGeneration = 0;
```

### 6.2 D7 — الدمج المحلي

```ts
function mergeOrderHistoryPages(
  existing: readonly OrderHistoryItemView[],
  incoming: readonly OrderHistoryItemView[],
): readonly OrderHistoryItemView[] {
  const byId = new Map<string, OrderHistoryItemView>();
  for (const order of existing) {
    if (!byId.has(order.id)) {
      byId.set(order.id, order);
    }
  }
  for (const order of incoming) {
    if (!byId.has(order.id)) {
      byId.set(order.id, order);
    }
  }
  return Object.freeze([...byId.values()]);
}
```

الدمج **بالمعرّف `id`** مع «الأولوية للأول». أي أن:

- لا تكرار: نفس الطلب لا يظهر مرتين.
- **الصفحة الأقدم تفوز**: لو أعاد Firestore طلبًا في صفحتين (ونتيجة ممكنة مع الترتيب غير المضمون)، يبقى ما ظهر أولًا.

النتيجة تُجمَّد بـ `Object.freeze` — نفس أسلوب بقية عروض الـ Renderer.

### 6.3 D8 — تجاهل الاستجابات المتأخرة

```ts
function isCurrentOrderHistoryRequest(generation: number, ownerUid: string | null): boolean {
  return generation === ordersHistoryRequestGeneration
    && ownerUid !== null
    && currentAuthState?.authenticated === true
    && currentAuthState.uid === ownerUid;
}
```

بعد كل `await` على الـ bridge يُفحص هذا الشرط. إن لم يعد الطلب هو الأحدث، أو تغيّرت الجلسة، تُتجاهل الاستجابة **تمامًا** — لا تُدمج ولا تُعرض.

هذا يحمي من حالتين:

- مستخدم سجّل خروجًا ثم دخل بحساب آخر بينما كان الطلب الأول معلّقًا: الاستجابة القديمة تُهمل.
- مستخدم ضغط «تحديث» مرتين: الاستجابة الأقدم تُهمل.

`invalidateOrderHistoryRequests()` (ترفع `ordersHistoryRequestGeneration`) تُستدعى في `showLogin()` وفي `showShell()` عند تغيّر الـ uid.

### 6.4 D4 في الـ Renderer

عند فشل صفحة «تحميل المزيد»:

```ts
if (!result.ok) {
  ordersHistoryLoadMoreMessage = result.error.message;
  ordersHistoryLoadMoreRetryable = result.error.retryable;
  if (!result.error.retryable) {
    ordersHistoryHasMore = false;
  }
  renderOrderHistory();
  return;
}
```

- **الصفوف المحمّلة تبقى** — لا تُمسح. الفشل في صفحة لاحقة لا يُفقد ما نجح.
- **إن كان الخطأ قابلًا لإعادة المحاولة** → `hasMore` يبقى `true`، ويظل الزر متاحًا.
- **إن لم يكن قابلًا لإعادة المحاولة** → `hasMore = false` فيُخفى الزر. هذا يوقف زرًا لن ينجح.

نصّ الزر يعكس الحالة:

```ts
ordersHistoryLoadMoreInFlight
  ? 'جارٍ تحميل المزيد…'
  : ordersHistoryLoadMoreMessage.length > 0 && ordersHistoryLoadMoreRetryable
    ? 'إعادة محاولة تحميل المزيد'
    : 'تحميل المزيد'
```

### 6.5 D6 — التحديث يبدأ نافذة

`loadOrderHistory('refreshing')` يبدأ بـ:

```ts
ordersHistoryInFlight = true;
ordersHistoryHasMore = false;
ordersHistoryLoadMoreMessage = '';
ordersHistoryLoadMoreRetryable = false;
```

ثم يستبدل النافذة كليًا:

```ts
loadedOrderHistory = mergeOrderHistoryPages([], result.value.orders);
```

الدمج من **مصفوفة فارغة** يعني: التحديث **لا** يضيف إلى السابق، بل يستبدله. زر «تحميل المزيد» يُخفى أثناء التحديث (`hasMore = false`) ثم يعود إن كان هناك المزيد.

كما يُسقَط التحديد إن لم يعد الطلب المحدد موجودًا:

```ts
const selectedId = selectedOrderHistory?.id ?? null;
if (selectedId !== null && !loadedOrderHistory.some((order) => order.id === selectedId)) {
  selectedOrderHistory = null;
}
```

### 6.6 البحث والتصفية لا تقرأ

مستمع البحث والتصفية يستدعيان `renderOrderHistory()` فقط. لا `api.orders.*` في المسار. البحث والتصفية يعملان على **الصفحات المحمّلة فقط**، وهذا مذكور في نص الواجهة.

### 6.7 الطباعة

الطباعة (Stage 22) تعمل على الصفوف المحمّلة والمصفّاة، ولا تقرأ صفحة إضافية. تنويه النطاق في التقرير:

```ts
`يشمل التقرير الطلبات المحمّلة والمصفّاة محليًا حاليًا${ordersHistoryHasMore ? '؛ قد تتوفر صفحات إضافية' : ''}؛ لا يُضمن الترتيب الزمني أو اتساق اللقطة عند تغيّر البيانات بين تحميل الصفحات.`
```

الجزء المتغيّر (`؛ قد تتوفر صفحات إضافية`) يظهر فقط عندما `hasMore` صحيح — أي أن التقرير يصرّح بأن ما طُبع قد يكون ناقصًا.

الترتيب مهم: المسح **قبل** الرمي يضمن أن المحاولة التالية لا تُعيد استخدام الرمز المُعاد.

## 7. خريطة الأخطاء

الترقيم لا يضيف نوع خطأ جديدًا؛ هو **يستعمل** النوع السبعة القائم. المسار الكامل:

| المصدر | الطبقة | النتيجة |
| --- | --- | --- |
| HTTP 401/403 من Firestore | `toDomainError` → `DomainError(NOT_AUTHORIZED)` | `AUTHORIZATION_DENIED` |
| رمز صفحة فارغ/معطوب | `DomainError(INVALID_INPUT)` | `VALIDATION_FAILED` |
| خطأ HTTP/نقل | `FirestoreRestError` → `TRANSPORT_REASONS` | `INFRASTRUCTURE_FAILURE` |
| رمز مكرر من Firestore | `ApplicationError('INTERNAL_ERROR')` | `INTERNAL_ERROR` |
| بلا جلسة | `applicationRefusal('AUTHENTICATION_FAILED')` | `AUTHENTICATION_FAILED` |
| طلبان متداخلان | `applicationRefusal('INFRASTRUCTURE_FAILURE')` | `INFRASTRUCTURE_FAILURE` |

### 7.1 لا شيء token-shaped يعبر الجسر

`toApplicationErrorPayload` يبني الحمولة حقلًا حقلًا:

```ts
export function toApplicationErrorPayload(error: ApplicationError): ApplicationErrorPayload {
  return Object.freeze({
    code: error.kind,
    message: APPLICATION_ERROR_MESSAGES[error.kind],
    retryable: error.retryable,
  });
}
```

الحمولة لا تحمل إلا `code` و`message` و`retryable`. لا مكدّس استدعاءات، ولا مسار مستند، ولا رسالة خادم، ولا رمز استمرار.

**وهذا هو الخطر الذي كان D2 يحرسه.** لو سرّب رمز الاستمرار عبر رسالة خطأ، لأمكن للـ Renderer (أو لطرف مهاجم على القناة) أن يصوغ استعلامًا يقرأ خارج النافذة المملوكة. تصميم الحمولة يجعل هذا مستحيلًا بنيويًا: لا يوجد حقل يمكن أن يحمل رمزًا.

### 7.2 `retryable` قرارٌ في Main

`retryable` يُحدَّد في Main (`RETRYABLE_KINDS` + `ApplicationError`)، لا في الـ Renderer. الـ Renderer **يستهلك** Flag فقط:

```ts
ordersHistoryLoadMoreRetryable = result.error.retryable;
```

وهو بالضبط ما تحتاجه D4: قرار «هل أُبقي الزر متاحًا؟» يُتخذ من مصدر موثوق، لا من تخمين في الواجهة.

### 7.3 `AUTHORIZATION_DENIED` تقرير لا حكم

مبدئي Stage 7 قائم: `AUTHORIZATION_DENIED` **تقرير** عن حكم قطعته `firestore.rules` على الخادم، وليس قرارًا محليًا. Stage 23 لا يغيّر ذلك: لا اسم مستخدم ولا دور يُفحص قبل القراءة. الحارس الوحيد هو أن `uid` في Main هو من يقرر ملكية النافذة.

## 8. التغطية الاختبارية

أربعة ملفات، **22 اختبارًا**، كلها ضمن `npm test` و`npm run test:stage23`.

### 8.1 `tests/stage23/orders-history-pagination-rest-repository.test.ts` (4)

- `passes the opaque continuation token through the repository and preserves identity`
- `treats an omitted token as end-of-list and rejects a malformed token response`
- `rejects an empty continuation token before issuing a request`
- `propagates Firestore authorization failures instead of treating them as end-of-list`

### 8.2 `tests/stage23/orders-history-pagination-application.test.ts` (7)

- `uses a fixed bounded page and never publishes the Main-owned continuation token`
- `retains the cursor after a transient subsequent-page failure and retries the same page`
- `resets to a fresh first page on refresh and performs no read after end-of-list`
- `does not advance when the rules refuse the page and reports the refusal`
- `refuses signed-out paging before touching the repository`
- `stops on a repeated continuation token instead of creating an endless page loop`
- `rejects a multi-token cycle and clears the cursor without another read`

### 8.3 `tests/stage23/orders-history-pagination-ipc.test.ts` (2)

- `keeps list and Load More payload-free and never exposes the continuation token`
- `exposes only zero-argument bridge functions on the fixed history channels`

### 8.4 `tests/stage23/orders-history-pagination-renderer.test.ts` (9)

- `loads one next page, merges by order id, and keeps search and status filters local across pages`
- `refresh replaces the loaded window and resets the Load More lifecycle`
- `preserves loaded rows after a failed page and safely retries the same Load More action`
- `derives initial loaded state from active filters when the first load completes`
- `discards first-page responses from a signed-out session without disturbing a new session load`
- `discards a Load More response after sign-out and loads the new session history afresh`
- `keeps load and refresh errors visible when search and status controls change`
- `does not trigger data reads when filters change or when printing the loaded, filtered rows`
- `prints an explicit empty result state without loading another page`

### 8.5 ما تغطيه الاختبارات وما لا تغطيه

| السلوك | مغطّى |
| --- | --- |
| الرمز لا يعبر الجسر | ✅ (IPC) |
| القنوات بلا حمولة | ✅ (IPC) |
| الرمز الفارغ يُرفض قبل الشبكة | ✅ (مستودع) |
| الرفض الأمني لا يُعامل كنهاية قائمة | ✅ (مستودع + تطبيق) |

## 9. الحدود المعلنة

1. **لا ترتيب زمني.** `listDocuments` لا يمرّر `orderBy`. الصفحات ليست مرتبة بالزمن، ولا يستطيع Stage 23 أن يضيف ذلك دون دعم `orderBy` في طبقة النقل.
2. **لا لقطة متسقة.** الطلبات المكتوبة بين صفحتين قد تظهر في واحدة وتغيب في أخرى.
3. **البحث والتصفية محليان.** بحث في الصفحات المحمّلة فقط. لا يُطلب من Firestore أن يبحث في كل السجل.
4. **الاسم الحيّ من كاش الصفحة الأولى.** قد يكون قديماً لصفحات لاحقة؛ لقطة `userName` المخزَّنة هي الأساس.
5. **الطباعة تقتصر على المحمَّل.** تنويه النطاق يظهر صراحةً في التقرير.
6. **الرمز مرتبط بجلسة واحدة.** تغيير الحساب يُبطل النافذة عمدًا.

## 10. حدود مقصودة في الشيفرة

### 10.1 لا writes في نطاق الترقيم

`OrdersRepository` لا يوفّر `createOrder` / `updateOrder` / `deleteOrder`. الطلبات تُنشأ **فقط** في معاملة Stage 6 (W1). طريقة كتابة هنا ستكون طريقًا ثانيًا غير مراقَب لتزوير طلب — وهو بالضبط ما يجب أن تبقى شاشة السجل قراءةً خالصة.

### 10.2 `guard` بلا معامل

معالجا Stage 23 يمرّران `guard(async () => ...)`. اختبار `exposes only zero-argument bridge functions on the fixed history channels` يثبّت أن دالة الجسر نفسها بلا وسائط — فلا يمكن حتى في الكود أن يُمرَّر رمز.

### 10.3 `Object.freeze` على النتائج

كل ما يعود من التطبيق إلى الجسر مُجمَّد: `Object.freeze({ orders: Object.freeze(orders), hasMore: ... })`. المتصفّح الذي يعرض النتائج لا يستطيع تعديلها، فالواجهة لا تستطيع أن تغيّر ما Main قرّر.

## 11. التحقق

```bash
npm run test:stage23   # 22 اختبار Stage 23
npm test               # المجموعة الكاملة
npm run build          # typecheck + بناء
```

المراجع المتقاطعة: `npm run test:stage12` (سجل الطلبات)، `npm run test:stage19`، `npm run test:stage20`، `npm run test:stage21`، `npm run test:stage22`.

| الفشل يُبقي الرمز | ✅ (تطبيق + renderer) |
| الرمز المكرر يوقف الترقيم | ✅ (تطبيق) |
| التحديث يبدأ من الصفر | ✅ (تطبيق + renderer) |
| الدمج بالمعرّف | ✅ (renderer) |
| تجاهل الاستجابات المتأخرة | ✅ (renderer) |
| البحث والتصفية لا تقرأ | ✅ (renderer) |
| **ترتيب زمني بين الصفحات** | ❌ غير مضمون أصلًا (لا `orderBy`) |
| **لقطة متسقة بين الصفحات** | ❌ غير مضمون أصلًا |
| **سلوك Firestore الحقيقي مع رمز مكرر** | ❌ يُختبر بالمستودع، لا ضد المحاكي |

