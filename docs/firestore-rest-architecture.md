# توثيق معمارية Firestore REST — المراحل 3 و 5A

> **Stage 3:** طبقة الوصول الأساسية. **Stage 5A (§11):** تقوية نفس الطبقة (أقنعة التحديث `updateMask` + الطوابع الزمنية للخادم) دون أي توسيع للنطاق.

## 0. النطاق

هذه المرحلة تربط تطبيق سطح المكتب `drug-manager` بـ **Firestore** باستخدام **واجهة REST العامة فقط**، مع **Firebase ID token** الخاص بالمستخدم المُسجَّل، بحيث تبقى **قواعد أمان Firestore** (المشتركة مع مشروع الأندرويد) هي حدّ الصلاحيات الوحيد.

ما تم تنفيذه: طبقة وصول REST مُحدَّدة الأنواع في العملية الرئيسية + اختبارات أمان حقيقية ضد محاكيات Firebase المحلية.
ما لم يتم تنفيذه (مقصود): شاشة الدخول، إدارة الأدوية، الطلبات، المخزون، التقارير، أي منطق أعمال، أي إعداد Firebase إنتاجي.

---

## 1. لماذا Firestore REST؟

| السبب | التفصيل |
| --- | --- |
| **تطبيق القواعد فعليًا** | طلبات REST تحمل هوية المستخدم نفسه (`request.auth.uid`)، فتُقيَّم القواعد على الخادم تمامًا كما تفعل مع تطبيق الأندرويد. |
| **لا SDK في تطبيق سطح مكتب** | لا حزم `firebase` أو `@firebase/*` ولا أي تبعية وقت تشغيل: `package.json.dependencies` فارغة تمامًا، والعميل مكتوب فوق `fetch` المدمجة في Node.js. |
| **تحكم كامل في الرموز** | الرمز يُقرأ من طبقة المصادقة (Stage 2) ويُمرَّر كترويسة `Authorization` فقط، ولا يُسجَّل ولا يُخزَّن ولا يُرسَل إلى الواجهة. |
| **تشغيل بلا بناء معقّد** | لا bundling ولا مصافحة gRPC؛ تصحيح الأخطاء عبر HTTP مباشر (كل استجابة خطأ تحمل `status` و `message` من Firestore). |
| **نفس النموذج الأمني للموبايل** | لا يوجد "مسار متميّز" لتطبيق سطح المكتب، فلا يمكن أن ينحرف سلوكه الأمني عن التطبيق الأندرويدي. |

---

## 2. لماذا لا نستخدم Google.Cloud.Firestore أو Admin SDK؟

| البديل | لماذا هو مرفوض في هذا المشروع |
| --- | --- |
| **Firebase Admin SDK** | يعمل بهوية **حساب خدمة** متجاوزًا Firebase Security Rules بالكامل (صلاحيات إدارية عليا)، ويعتمد على ملف اعتماد سرّي. استخدامه يعني إلغاء القواعد المرجعية وإلغاء التمييز بين المستخدمين. |
| **Google.Cloud.Firestore (Google Cloud client libraries)** | نفس المشكلة: اعتماد على Application Default Credentials / service account، وتجاوز `request.auth`. |
| **ملف `service-account.json`** | سرّ طويل الأجل لا يمكن شحنه داخل تطبيق سطح مكتب دون تحويله إلى ثغرة. ممنوع صراحةً في هذا المشروع. |
| **Firebase Web SDK (JS)** | يسحب شبكة تبعيات ضخمة إلى العملية الرئيسية، ويخفي تفاصيل الرموز والطلبات، ويشوّش حدّ المسؤوليات الذي نصمّمه يدويًا. |
| **Cloud Functions كوسيط** | تضيف سطح تنفيذ إداري آخر وتتطلب نشرًا إنتاجيًا. ممنوعة في هذه المرحلة. |

> النتيجة: **العميل لا يملك أي قدرة على تجاوز القواعد**، فهو يرسل طلبًا عاديًا بهوية المستخدم، والقرار يأتي من الخادم.

---

## 3. كيف يُمرَّر Firebase ID token إلى Firestore REST

```
Electron Main Process
    │
    ├─(1) FirebaseAuthService  ── POST /identitytoolkit.googleapis.com/v1/accounts:signInWithPassword
    │        يحفظ idToken + refreshToken في الذاكرة فقط (لا ملفات، لا Renderer)
    │
    ├─(2) FirestoreRestClient(config, getAccessToken = () => authService.getValidIdToken())
    │
    ├─(3) GET/PATCH/POST/POST:commit ... Authorization: Bearer <Firebase ID token>
    │
    └─(4) Firestore / Emulator  ── يقيّم قواعد الأمان بـ request.auth.uid
```

- `FirebaseAuthService.getValidIdToken()` تُجدّد الرمز تلقائيًا قبل انتهائه بـ60 ثانية، وتُرجِع `null` إن فشلت الجلسة.
- `FirestoreRestClient` **لا يُرسل أي طلب بدون رمز**: إن لم يوجد رمز يرمي `FirestoreRestError` بالسبب `UNAUTHENTICATED` و `requestSent = false` (لا شبكة إطلاقًا).
- الرمز لا يظهر أبدًا في كائنات الأخطاء: تُنقّى أي رسالة قادمة من الخادم عبر `sanitizeServerMessage` (إخفاء `Bearer …`، `eyJ…`، `key=…`).
---

## 4. كيف تُفرض الصلاحيات فعليًا (Firebase Security Rules)

القواعد عاملة على الخادم (Firestore / Firestore Emulator) وليس في العميل. كل قرار في هذه المرحلة مأخوذ من الملف المرجعي `firestore.rules` الخاص بمشروع الأندرويد، وهو يعتمد على:

```javascript
function isAdmin()      { ... getUserData().role == 'admin' || ... == 'assistant' }
function isApproved()   { ... getUserData().status == 'approved' }
function isOwner(userId){ return isAuthenticated() && request.auth.uid == userId; }
```

| حالة اختبارها فعليًا | القاعدة التي قرّرت | النتيجة المرصودة |
| --- | --- | --- |
| موظف يقرأ ملف موظف آخر | `match /users/{userId} allow read: isOwner(userId) \|\| isAdmin()` | HTTP 403 |
| مدير يقرأ نفس المستند | نفس القاعدة | HTTP 200 |
| موظف يعدّل حقول نفسه المسموحة (`name`) | `affectedKeys().hasOnly(['name','status'])` | HTTP 200 |
| موظف يحاول تغيير `role` إلى `admin` | نفس الشرط + `role == resource.data.role` | HTTP 403 |
| موظف `pending` يحاول اعتماد نفسه | `status == resource.data.status \|\| (rejected → pending)` | HTTP 403 |
| موظف غير مُعتمد ينشئ `order_requests` | `isApproved()` | HTTP 403 |
| موظف مُعتمد بنفس الحمولة | `isApproved()` | HTTP 200 |
| موظف يقرأ `stock_logs` | `allow read, write: if isAdmin()` | HTTP 403 |
| موظف يقرأ طلب موظف آخر | `resource.data.uid == request.auth.uid` | HTTP 403 |

**القواعد ليست مُرشِّحات (Rules are not filters):** الاستعلام الذي لا يمكن إثبات مشروعيته يُرفض بالكامل.
- استعلام على `orders` مع فلتر `userId == request.auth.uid` ⇒ HTTP 200 ويُرجع مستندات المستخدم فقط.
- نفس الاستعلام بدون الفلتر ⇒ **HTTP 403** (وليس نتيجة مُقلَّصة).
- `listDocuments` على `users` كموظف ⇒ HTTP 403، وكلِمدير ⇒ HTTP 200.

**لماذا هذه الأدلة تكفي لإثبات أن القرار من القواعد:** نفس الرابط ونفس الطريقة مع رمز مختلف ⇒ نتيجة مختلفة (403 مقابل 200)، ورمز مستخدم واحد لم يتغير بعد أن اعتُمِد حسابه تغيّرت صلاحياته في الطلب التالي ⇒ إذن القرار يُقرأ من Firestore في كل طلب وليس من العميل، والعميل لا يحتوي أي فحص أدوار (محمي باختبار معماري).

---

## 5. نقاط النهاية (REST Endpoints) المستخدمة

القاعدة: `https://firestore.googleapis.com/v1/projects/{projectId}/databases/{databaseId}/documents`
مع المحاكي: `http://127.0.0.1:8080/v1/projects/{projectId}/databases/(default)/documents`

| العملية | الطلب | ملاحظات على القواعد |
| --- | --- | --- |
| قراءة مستند | `GET .../documents/{path}` | تُقيَّم `allow read` |
| قراءة مجموعة | `GET .../documents/{collection}?pageSize=&pageToken=` | تعمل كـ `list` (قواعد غير مُرشِّحة) |
| إنشاء مستند | `POST .../documents/{collection}?documentId={id}` | تُقيَّم `allow create` |
| تعديل/دمج مستند | `PATCH .../documents/{path}?updateMask.fieldPaths=&currentDocument.exists=` | تُقيَّم `allow update` (و`create` إن لم يوجد) |
| استعلام مُهيكل | `POST .../documents:runQuery` | الفلاتر تُثبت مشروعية الاستعلام |
| بدء معاملة | `POST .../documents:beginTransaction` | — |
| قراءة داخل معاملة | `POST .../documents:batchGet` مع `transaction` | تُقيَّم قواعد القراءة |
| تنفيذ الكتابات | `POST .../documents:commit` مع `transaction` و `writes[].currentDocument` | تُقيَّم قواعد الكتابة **عند التنفيذ** |
| إلغاء معاملة | `POST .../documents:rollback` | — |

- `kind: 'create'` ⇒ `currentDocument.exists = false`، و`kind: 'update'` ⇒ `exists = true`، و`upsert` ⇒ بلا شرط مسبق.
- `DELETE` **غير منفَّذ** عمدًا في هذه المرحلة (خارج الحد الأدنى المطلوب)، لذا اختبارات حذف المدير غير مشمولة.
---

## 6. معمارية اختبار المحاكيات (Emulator Test Architecture)

مختبر معزول بالكامل داخل `emulator-lab/` — لا يعدّل أي ملف من مشروع الأندرويد ولا أي إعداد إنتاجي:

```
emulator-lab/
  firebase.json          auth: 127.0.0.1:9099 | firestore: 127.0.0.1:8080 | ui: معطّل
  firestore.rules        نسخة مطابقة بايت-ببايت لقواعد مشروع الأندرويد (تُتحقَّق بالبصمة SHA-256 قبل أي تشغيل)
  tools/                 تثبيت معزول لـ firebase-tools (لا يدخل في package.json للتطبيق إطلاقًا)
  scripts/lab-paths.mjs  المسارات والمنافذ ومعرّف المشروع المحلي (demo-drug-manager-stage3)
  scripts/start.mjs      تشغيل المحاكيات يدويًا (foreground)
  scripts/run-emulator-tests.mjs  تشغيل الاختبار التكاملي عبر firebase emulators:exec
  README.md              دليل المختبر
```

مسارات التشغيل:

```powershell
npm run emulator:setup     # تثبيت أدوات المختبر المعزولة (مرة واحدة)
npm run test:emulator      # بناء + تشغيل محاكيات حقيقية + تشغيل اختبارات الأمان ثم إيقافها
npm run emulator:start     # (اختياري) تشغيل المحاكيات يدويًا لفحص الـ REST بنفسك
npm test                   # كل اختبارات Stage 1..3؛ اختبار المحاكي يُشغَّل تلقائيًا إن كان المحاكي يعمل، وإلا يُعلَن تخطّيه بوضوح
```

**كيف تُبنى البيانات (Fixtures):**
1. إنشاء الحسابات عبر **Auth Emulator الحقيقي** (`accounts:signUp`) — admin, assistant, employees بأحوال `approved/pending/rejected`.
2. كتابة مستندات `users/{uid}` بمفتاح **admin bypass الخاص بالمحاكي فقط** (`Authorization: Bearer owner`) — هذا ليس حساب خدمة ولا اعتمادًا إنتاجيًا، ويُستخدم لتهيئة البيانات قبل أي تأكيد أمني، ولا يُستعمل في أي تأكيد على القواعد.
3. تسجيل الدخول للحصول على الرموز يمرّ عبر **طبقة المصادقة الخاصة بالتطبيق** (`FirebaseAuthService`) وليس عبر نداء خام.

**قواعد صارمة في اختبارات الأمان:**
- لا محاكاة (mock) لاستجابات Firestore، ولا تقييم قواعد في TypeScript، ولا خادم HTTP وهمي.
- كل تأكيد أمني = طلب HTTP حقيقي إلى `127.0.0.1:8080` بترويسة `Authorization: Bearer <Firebase ID token>` حقيقية.
- تأكيد الرفض يتحقق من: أن الطلب **أُرسل فعلًا** (`requestSent === true`)، ومن HTTP 403، ومن أن السبب `PERMISSION_DENIED` القادم من الخادم.
- الملف المرجعي للقواعد يُقارن ببصمة SHA-256 مع `firestore.rules` في مشروع الأندرويد، ويفشل التشغيل قبل البدء إذا اختلفا.
- مُشغِّل الاختبار يُشغَّل عبر `firebase emulators:exec`، فيُصبح المحاكي جاهزًا قبل بدء الاختبار ويُوقف دائمًا في النهاية.

---

## 7. الفرق بين وصول العميل REST والوصول المميّز بـ Server SDK

| الجانب | **REST + Firebase ID token (هذا المشروع)** | **Admin SDK / Service Account / Google.Cloud.Firestore** |
| --- | --- | --- |
| الهوية | المستخدم نفسه (`request.auth.uid`) | حساب خدمة مميّز |
| هل تُطبَّق Security Rules؟ | **نعم، دائمًا** | **لا، تُتجاوَز بالكامل** |
| الاعتمادات | رمز جلسة قصير الأجل في الذاكرة | ملف اعتماد سرّي طويل الأجل |
| حدود الصلاحيات | محددة بدقة لكل مستخدم/دور/حالة | كامل قاعدة البيانات |
| مكانها المناسب | تطبيقات العميل (سطح مكتب/موبايل) | مهام إدارية على الخادم فقط (مثال مستقبلي: Cloud Functions) |
| الوضع في هذا المشروع | المعتمد الوحيد | **مرفوض وممنوع** |

---

## 8. ضوابط أمان الرموز (Token Security)

1. **العملية الرئيسية فقط:** `idToken` و `refreshToken` يعيشان في ذاكرة `FirebaseAuthService` فقط.
2. **لا حفظ على القرص:** لا ملفات نصية، لا `safeStorage`، لا `electron-store`، لا `localStorage` (محمي باختبار معماري).
3. **لا مرور عبر IPC:** الواجهة تستقبل `SafeAuthState` فقط (uid/email/انتهاء الصلاحية) ولا تستطيع طلب مستند Firestore في هذه المرحلة إطلاقًا.
4. **بلا رمز = بلا طلب:** `FirestoreRestClient` يرفض بناء أي طلب بدون رمز.
5. **تطهير الأخطاء:** `sanitizeServerMessage()` يُخفي `Bearer …` و `eyJ…` و `key=…` قبل تخزين أي رسالة في كائن الخطأ.

---

## 9. الحدود المعروفة (Known Limitations)

| الحد | التفصيل |
| --- | --- |
| عميل REST أدنى (Minimal) | لا `DELETE`، ولا حقول `bytes/geoPoint/reference`، ولا استعلامات مركّبة (`orderBy`/`cursor`/`IN`)، ولا مستمعات فورية (`onSnapshot`). أُضيفت عند الحاجة في مرحلة لاحقة. (حقل الطابع الزمني للخادم أُضيف في Stage 5A — انظر §11.) |
| مسارات مُقيَّدة | يقبل العميل الأحرف `A-Za-z0-9_-` و `/` فقط في المسارات (حماية من الحقن). مُعرّفات Firestore بمسافات أو Unicode غير مدعومة حاليًا. |
| دقة الأعداد | `integerValue` يُقرأ كـ `number` (فقدان دقة نظري فوق 2^53). |
| مرحلة المحاكي فقط | يرفض العميل أي هدف غير محلي ما لم يُضبط `FIRESTORE_ALLOW_REMOTE_TARGET=true` صراحةً؛ لا يوجد أي إعداد إنتاجي في هذه المرحلة. |
| **محاكي Firestore لا يتحقق من توقيع JWT** | **قيد جوهري في بيئة الاختبار، لا في التصميم.** محاكي Firestore يقرأ الحمولة (payload) دون التحقق من التوقيع، فيقبل الهوية المُعلَنة. لذلك **لا يمكن** استخدام المحاكي لإثبات مقاومة انتحال الرمز (token forgery). ما يُثبته الاختبار فعليًا هو أن رمزًا يحمل هوية **لا تملك مستند `users/{uid}`** لا يكتسب أي امتياز، لأن `isAdmin()` تُقيَّم على الخادم مقابل `users/{request.auth.uid}`. في الإنتاج، التحقق من التوقيع هو مسؤولية Firebase/Google. |
| معرّفات المستندات المحجوزة | Firestore يرفض أي معرّف يبدأ أو ينتهي بـ `__` بالرمز `400 INVALID_ARGUMENT` **قبل** تقييم أي قاعدة. لذلك يستخدم المسبار `users/stage3-unauthenticated-probe` بدل `__probe__`، وإلا لاختفى القرار الذي يُفترض قياسه. |
| لا منطقة واجهة | لا شاشة دخول ولا أي واجهة بيانات؛ ربط الطبقة بالـ IPC/الواجهة يخص مرحلة لاحقة. |

---

## 10. خريطة الملفات (Stage 3)

| الملف | الدور |
| --- | --- |
| `electron/config/firestore-config.ts` | إعداد Firestore REST + بناء الروابط + منع الأهداف غير المحلية |
| `electron/services/firestore-codec.ts` | ترميز/فكّ ترميز قيم Firestore + الطوابع الزمنية + مسارات الحقول (Stage 5A) |
| `electron/services/firestore-rest.ts` | العميل المُحدَّد الأنواع (get/list/create/patch/query + معاملات + `updateMask`/`updateTransforms` في Stage 5A) |
| `electron/main.ts` | الربط: العميل يأخذ رمزه من `authService.getValidIdToken()` |
| `tests/firestore-rest.test.ts` | اختبارات وحدوية للروابط والترويسات والأخطاء (بلا شبكة) |
| `tests/firestore-architecture.test.ts` | حراسة معمارية (لا SDK، لا اعتمادات، لا تخزين رموز، لا فحص أدوار) |
| `tests/firestore-rules-emulator.test.ts` | اختبارات الأمان الحقيقية ضد محاكيات Firebase |
| `tests/helpers/firestore-emulator-harness.ts` | تهيئة المحاكي (حسابات + مستندات) وبناء الجلسات |
| `emulator-lab/**` | بيئة المحاكي المعزولة |

---

## 11. Stage 5A — تقوية طبقة Firestore REST (أقنعة التحديث والطوابع الزمنية)

هذه المرحلة **تصلح وتقوّي** بنية REST الموجودة فقط. لا نماذج أعمال، ولا طبقة مستودع، ولا معالجة طلبات، ولا واجهات، ولا لوحات، ولا تقارير، ولا ترحيل بيانات إنتاجية.

### 11.1 المشكلة C5 — كان `commitWrites` يحذف بيانات

`commitWrites` كان يرسل `update` **بدون `updateMask`**، فكل تحديث جزئي كان يتحول على الخادم إلى **استبدال كامل للمستند**.

> **خطر مُثبَت تجريبيًا:** طلب `PATCH` بجسم `{"fields":{}}` **يُقبل من Firestore (HTTP 200)** ويمسح كل حقول المستند. الخادم **لا يحمينا** من هذا.

مثال عملي على خطر C5: تحديث `stock` فقط على مستند دواء كان سيمحو `name` و `maxQuantity` و `totalInward` و `totalOutward`.

**الحل:** إضافة `updateMask` حقيقي، مع حراسة قبل الإرسال تمنع الأشكال الخطرة.

### 11.2 تصميم `updateMask` (PART 1)

| العملية | عند حذف `updateMaskPaths` | مع `updateMaskPaths` صريحة |
| --- | --- | --- |
| `kind: 'update'` | **القناع مُشتق** من مفاتيح `data` ← تعديل جزئي (إصلاح C5) | تعديل جزئي بدقة، ويدعم المسارات المتداخلة `meta.batch` |
| `kind: 'upsert'` | استبدال كامل بالمستند (سلوك قديم، لم يتغيّر) | دمج جزئي |
| `kind: 'create'` | كتابة كل الحقول + `currentDocument.exists=false` (سلوك قديم) | تصفية الحقول |
| `patchDocument` | استبدال كامل (سلوك قديم) | `updateMask.fieldPaths` كمعاملات استعلام |

**قواعد السلامة قبل أي إرسال** (كل انتهاك ⇒ خطأ مُصنَّف `INVALID_ARGUMENT` مع `requestSent = false`، وليس تنفيذ عملية أخرى بصمت):

1. **حارس الحذف:** كل مسار في القناع يجب أن يوجد في `data` أو يكون هدف تحويل، وإلا فFirestore **سيحذف** ذلك الحقل.
2. **حارس التجاهل:** كل حقل في `data` يجب أن يغطيه القناع، وإلا فFirestore **سيتجاهله** بصمت.
3. **حارس الفراغ:** كتابة بلا حقول وبلا تحويلات مرفوضة (هي بالضبط عملية المسح أعلاه).
4. **upsert بأ	transformات فقط** مرفوض دون قناع صريح.

**قواعد المسارات (grammar):** المسار = `segment ("." segment)*`، والجزء البسيط `^[a-zA-Z_][a-zA-Z_0-9]*`، والجزء المُقتبس بـ backtick مع هروب `\` و backtick. الأسماء المحجوزة `/^__.*__$/` مرفوضة. `encodeFieldPathSegments` يعيد الترميز بالصيغة المعيارية قبل الإرسال.

### 11.3 الطابع الزمني الحرفي مقابل طابع الخادم (PART 2)

التصميم يميّز **نوعين مختلفين تماماً**، ولا يخلطهما:

| المفهوم | التمثيل على السلك | كيف يُنتج |
| --- | --- | --- |
| **طابع حرفي** (A) | `{ "timestampValue": "2026-03-04T05:06:07.123456Z" }` | `FirestoreTimestamp.parse(...)` أو `FirestoreTimestamp.fromDate(date)` |
| **طابع الخادم** (B) | `"updateTransforms": [{ "fieldPath": "...", "setToServerValue": "REQUEST_TIME" }]` | `SERVER_TIMESTAMP` داخل `data` في `commitWrites` |

**ضوابط صارمة:**
- `SERVER_TIMESTAMP` **ليس** قيمة: `encodeValue(SERVER_TIMESTAMP)` يرمي `FirestoreCodecError`، فلا يمكن أبداً أن يُشحن كـ string أو كقراءة من ساعة windows.
- الطابع الحرفي **ليس** `REQUEST_TIME`: `decodeValue({timestampValue:'REQUEST_TIME'})` يرمي.
- **ساعة windows المحلية ليست مصدرًا موثوقًا** إطلاقًا — يُثبت اختبار المحاكي (D) أن القيمة المولَّدة تقع داخل نافذة التشغيل، فلا يصح أن تأتي من أي طرف غير Firestore.
- العلامة داخل مصفوفة مرفوضة (تحويل Firestore لا يستطيع استهداف عنصر مصفوفة).
- `patchDocument` لا يستطيع تمثيل تحويلات، فيرفض `SERVER_TIMESTAMP` محليًا.

### 11.4 تصميم تشفير/فكّ الطوابع (PART 4)

`timestampValue` يُفكّ إلى `FirestoreTimestamp` (ليس `Date` ولا `string`):

- **يحتفظ بالنص الأصلي كما أعادته Firestore** (`isoValue`) ⇒ لا تُفقد دقة الميكرو/نانوثانية (و `Date` يحتفظ بالمللي ثانية فقط).
- **يبقى مميّزاً عن `stringValue`** (نوع بيانات مختلف) ⇒ لا يمكن خلط نص يشبه طابعاً مع طابع.
- إعادة ترميز طابع مفكوك تُنتج **نفس السلسلة حرفياً**.
- `toDate()` هو التحويل الصريح الفاقد للدقة (بالتصميم).
- يُتحقق من **شكل النص** (RFC 3339) **و من وجود اللحظة تقويمياً** — فالنص `2026-13-45T99:99:99Z` مطابق للنمط لكنه غير موجود ويُرفض.

### 11.5 تأثير المعاملات (PART 5)

| السلوك | النتيجة في Stage 5A |
| --- | --- |
| معرّف المعاملة | بلا تغيير (`beginTransaction` يعيده كما هو) |
| القراءة داخل معاملة | بلا تغيير (`batchGet` يقبل المعاملة ويعيد `null` للمستند المفقود) |
| القناع داخل معاملة | مدعوم: يُحمل في نفس `:commit` مع المعاملة (مُختبَر: E) |
| التحويلات داخل معاملة | مدعومة: `updateTransforms` مع `transaction` (مُختبَر: F) |
| التراجع (rollback) | بلا تغيير: يُبطل المعاملة، والـ commit اللاحق يفشل ولا يكتب (اختبار قائم) |
| بدء المعاملة + قراءة + كتابة | مُختبَرة: يكتب الحقل المقنَّع ويترك البقية |

**لماذا يهم هذا الأمر:** المعاملة هي المسار الذي سيعالج به تطبيق Windows لاحقًا `order_requests` مباشرةً (قرار C1: **بدون Cloud Functions**)، وقناع التحديث هو ما يضمن أن معالجة الطلب تعدّل `stock` دون أن تمسح بقية حقول الدواء.

### 11.6 `order_requests.requestDate` في المستقبل

**قرار D4:** طلبات الطلبات التي سينشئها تطبيق Windows **ستستخدم وقت Firestore الخادمي** كوقت الطلب المرجعي:

```ts
// عند إنشاء طلب طلب جديد من تطبيق Windows
await client.commitWrites([{
  relativePath: `order_requests/${generateAutoId()}`,
  kind: 'create',
  data: { uid, items, status: 'pending', requestDate: SERVER_TIMESTAMP },
}]);
```

- `requestDate` يُرسَل كـ `REQUEST_TIME` ⇒ **Firestore** هو من يولّده، لا ساعة الجهاز.
- **الطوابع الزمنية التاريخية التي أنشأها العميل (الأندرويد) لا تُعاد تفسيرها** كطوابع خادمية؛ تُترك كما هي. تطبيع قيم `monthYear` الإنتاجية إلى أرقام ASCII **مؤجَّل** إلى مرحلة لاحقة (قرار D1) ولم يُنفَّذ في Stage 5A.
- عند قراءة `requestDate` يُرجع `FirestoreTimestamp`؛ تحويله إلى `Date` يتم صراحةً عبر `toDate()`.

**معرّفات المستندات:** عند الحاجة لمعرّف من جانب العميل (مثل إنشاء `order_requests/{id}` داخل معاملة، حيث لا يمكن لـ `CreateDocument` توليد المعرّف) تستخدم `generateAutoId()` ⇒ معرّف بطول **20 محرفًا** بأبجدية Firestore، عبر `crypto.randomInt` (توزيع غير متحيّز).

### 11.7 التحقق عبر المحاكي (PART 6)

جميع الأدلة أدناه **طلبات HTTP حقيقية** إلى `127.0.0.1:8080` برمز Firebase ID token حقيقي، ولا شيء منها mock:

| # | الاختبار | ما يُثبته |
| --- | --- | --- |
| A | تحديث `stock` فقط على مستند دواء كامل | الحقول الأربعة الأخرى لم تتغيّر — تعديل جزئي حقيقي |
| B | تحديث `stock` و `totalOutward` معاً | الحقول غير المقنَّعة لم تتغيّر |
| B2 | قناع متداخل `meta.batch` | الحقل المتداخل تغيّر، شقيقه وبقية الحقول سليمة |
| C | كتابة طابع حرفي وقراءته | يعود `FirestoreTimestamp` وليس string |
| C2 | نفس الأحرف كنص عادي | يبقى `stringValue` — لا خلط بين النوعين |
| D | كتابة `REQUEST_TIME` | الحقل موجود، نوعه طابع، **ليس** `REQUEST_TIME`، وقيمته داخل نافذة التشغيل (أي من Firestore لا من الساعة المحلية) |
| D2 | تحويل مقنَّع على مستند مبذور كامل | أضاف حقلاً واحداً ولم يمسح شيئاً |
| E | `:beginTransaction` → `:batchGet` → `:commit` بقناع | الحقول غير المقنَّعة سليمة داخل المعاملة |
| F | `REQUEST_TIME` داخل معاملة | نوع الطابع صحيح + الحقول سليمة |
| G1 | قناع بمسار غير موجود | رفض محلي، `requestSent=false`، والمستند **لم يتغيّر إطلاقاً** |
| G2 | `create` بلا قناع | دلالات `create` لم تتغيّر بإصلاح C5 |
| G3 | `PATCH {"fields":{}}` خام | **مقبول من الخادم (200) ويمسح كل الحقول** — الخطر مُثبَت |
| G3b | نفس العملية عبر العميل | مرفوضة محلياً، المستند سليم |
| G4 | مسار حقل مشوَّه | لا يصل إلى الشبكة أبداً |

### 11.8 حدود Stage 5A

| الحد | التفصيل |
| --- | --- |
| `updateMask` اختياري | السلوك الافتراضي لـ `upsert` **لم يتغيّر** (استبدال كامل). من يريد تعديلاً جزئياً يستخدم `kind: 'update'` أو قناعاً صريحاً. |
| لا `deleteField` | حذف حقل صراحةً غير مدعوم؛ القناع لا يحذف إلا ما كان سيُحذف أصلاً، والعميل يرفض الأشكال الخطرة. |
| لا `arrayConfig`/`serverValue` أخرى | فقط `REQUEST_TIME` مدعوم. |
| `SERVER_TIMESTAMP` على `patchDocument` | مرفوض: نقطة نهاية PATCH لا تدعم التحويلات. استخدم `commitWrites`. |
| حقوق الكتابة | القناع والطابع الزمني لا يوسّعان الصلاحيات إطلاقاً: `allow update`/`allow create` تبقى تُقيَّم على الخادم مقابل `request.auth`. |
| محاكي Firestore لا يتحقق من توقيع JWT | قيد بيئة الاختبار (قائم من Stage 3)، لا في التصميم. |
| لا اختبار ترابط (concurrency) في هذه المرحلة | اختبار التزامن موجود في حزمة الأندرويد؛ وهو خارج نطاق Stage 5A. |

### 11.9 افتراضات سلامة الإنتاج

1. **لا اتصال بـ Firebase الإنتاجي إطلاقًا:** كل اختبارات Stage 5A تعمل على `demo-drug-manager-stage3` (معرّف `demo-` لا يمكن لـ Firebase أن يحلّه إلا محليًا)، و`assertLocalFirestoreTarget` يرفض أي هدف غير محلي ما لم يُضبط `FIRESTORE_ALLOW_REMOTE_TARGET=true` صراحةً.
2. **لا نشر، ولا ترحيل، ولا كتابة بيانات إنتاجية، ولا تعديل لقواعد الإنتاج، ولا تعديل للأندرويد، ولا نشر لـ Cloud Functions** — لم يحدث أيٌّ منها في هذه المرحلة.
3. **`firestore.rules` لم يُمَسّ:** ملف مختبر القواعد في `emulator-lab/` ما زال **مطابقاً بايت-ببايت** (SHA-256) لقواعد مشروع الأندرويد، ويتحقق المشغّل من ذلك قبل كل تشغيل.
4. **مشروع الأندرويد للقراءة فقط:** لم يُعدَّل أي ملف في `E:\programs and applications\mobile\drug` (بما فيه `AdminActivity` و `functions/`). البصمة تُقرأ فقط للمقارنة.
5. **بدون تبعيات جديدة:** لا Firebase Web SDK، ولا Admin SDK، ولا Google Cloud Firestore SDK، ولا service account، ولا تجاوز لـ Security Rules. المعمار كما هو:

```
Electron Main → Firebase Auth REST → Firebase ID token → Firestore REST → Firebase Security Rules
```



