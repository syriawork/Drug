# drug-manager (Windows Desktop)

تطبيق سطح مكتب لإدارة الطلبات والمخزون.

> **المرحلات 5A + 5B:** طبقة اقراءة المجال، اقيمة `updateMask` أصلحة، طبعات الزمن للخادم، ومستودعات Firestore. **المرحلة الثالثة (Stage 3):** مصادقة Firebase Auth عبر REST + وصول Firestore عبر REST بمعرّف Firebase ID token، بحيث تكون **قواعد أمان Firestore** (نفس ملف مشروع الأندرويد) هي حدّ الصلاحيات الوحيد.
> **المرحلة السابعة (Stage 7):** طبقة التطبيق والحدّ الآمن مع الواجهة — الواجهة لا تتحدث مع Firebase إطلاقًا، بل عبر قنوات IPC مسمّاة فقط، والواجهة تستقبل DTO آمنًا بلا أي رمز (token) وبلا أي صيغة Firestore سلكية.
> **المرحلة الثامنة (Stage 8):** واجهة تسجيل الدخول ولوحة الإدارة — عربية RTL بالكامل، وتستخدم عمليات Stage 7 المسمّاة فقط، ولا تقرأ أي رمز (token).
> **المرحلة التاسعة (Stage 9):** شاشة إدارة المستخدمين — عرض وبحث محلي وتعديل الاسم والحالة والاستثناء فقط. `role` و`employeeId` للعرض فقط لأن عقد المستودع لا يتيح كتابتهما، وقواعد Firestore هي المرجع النهائي.
> **المرحلة العاشرة (Stage 10):** شاشة إدارة الأدوية — عرض الكتالوج وبحث محلي، وتعديل `maxQuantity` (الحدّ الأقصى للطلب) فقط. `name` للعرض فقط لأن تطبيق الجوال لا يملك عملية إعادة تسمية أصلًا، و`stock` و`totalInward` و`totalOutward` للعرض فقط لأن كل كتابة مخزون في تطبيق الجوال تكتب أيضًا سجل `stock_logs`، وهو ما تعجز ويندوز عن إنتاجه؛ لذلك لم تُعرَض أي كتابة مخزون هنا. المخزون يُعرض كما هو مخزَّن تمامًا ولا يُحسَب من `totalInward - totalOutward`.
> **المرحلة الحادية عشرة (Stage 11):** شاشة إدارة الطلبات (Order Requests) — عرض طابور الطلبات بحالاته الثلاث (`pending` / `processed` / `failed`)، وبحث محلي بالاسم أو الدواء، وتصفية محلية بالحالة، وتفاصيل للقراءة فقط لكل طلب. المعالجة **لا تُنفَّذ في الواجهة إطلاقًا**: تمرّر معرّف الطلب فقط إلى خدمة Stage 6 نفسها بعد تأكيد صريح من المدير، وتُعاد القراءة بعد كل محاولة لتُعرض حالة المستند الحقيقية. **سلطة المعالجة الوحيدة تبقى Stage 6** — لا حساب للمخزون ولا تجميع للمكرّرات ولا تحقّق للأهلية ولا منطق شهري أو جمعة في ويندوز. اسم الموظف enrichment للعرض فقط: المستند يبقى مصدر الحقيقة، والواجهة ترجع إلى الـ uid إن تعذّر حل الاسم.
> **المرحلة الثانية عشرة (Stage 12):** شاشة سجل الطلبات (Orders History) — **قراءة فقط بالكامل**. تقرأ مستند `orders` المكتوبة أصلًا بواسطة Stage 6 عبر عملية واحدة مسمّاة وبلا أي حمولة (`orders.list()`)، وتعرضها مع بحث محلي وتصفية محلية بالحالة وتحديث ونافذة تفاصيل. **لا يوجد أي زر كتابة في هذه الشاشة**: لا حفظ ولا معالجة ولا حذف ولا نموذج. التاريخ يعرض **عدد البنود** كما خزّنته Stage 6 ولا يجمع الكميات ولا يدمج المكرّرات، والشهر يُعرض كما هو مخزَّن ولا يُحسَب من التاريخ. اسم الموظف يأتي من لقطة `userName` المخزَّنة أصلًا في الطلب؛ واسم الملف الشخصي الحيّ زينة احتياطية فقط. `orders` و`order_requests` ذاكرتان وصفحتان منفصلتان، وحالة الطلب المخزَّنة تبقى منفصلة عن حالة الطلب المُرسَل. **سلطة إنشاء الطلبات وكتابتها تبقى Stage 6 وحدها** — عقد `OrdersRepository` لا يملك أي دالة create/update/delete، والفهرسة تُضاف قراءةً فقط.
> **المرحلة الثالثة عشرة (Stage 13):** شاشة إعدادات النظام (System Settings) — **قراءة فقط بالكامل**، ب عربية RTL. تقرأ مستند `settings/app` عبر عملية مسمّاة واحدة وبلا أي حمولة (`settings.get()`، بلا وسائط إطلاقًا). **لا يوجد أي زر كتابة في هذه الشاشة**: لا حفظ ولا نموذج ولا مفتاح تبديل؛ كما أن `settings.get` هي العملية الوحيدة في قناة الإعدادات، فلا قناة حفظ ولا تحديث ولا حذف موجودة أصلًا. تعرض الحقول الستة الفعلية كما خزَّنها المستند بلا أي تحويل: `minDaysBetweenOrders` و`maxDailyOrders` و`allowFridayOrders` و`startTime` و`endTime` و`assistantId`. عند غياب المستند تظهر القيم الافتراضية مع **لافتة إرشادية** تقول صراحة إن المستند غير مُهيّأ، فلا تُعرض قيمة افتراضية وكأنها مخزَّنة. حقلا `maxDailyOrders` و`assistantId` معروضان صراحةً على أنهما **غير مُفعّلين** (ميت في تطبيق الجوال) ولم يُضف أي تطبيع أو مصالحة بينهما. **سلطة كتابة الإعدادات تبقى تطبيق الجوال وحده** — قواعد Firestore تسمح بالكتابة للإدارة، ولذلك فإن صفة القراءة_only هنا تقوم على تصميم الصفحة (لا قناة كتابة فيها) لا على القواعد وحدها. لم تُعدَّل قواعد Android، ولم يُضف أي حفظ أو تحديث، ولم تتغيّر Stage 6.
> **المرحلة الرابعة عشرة (Stage 14):** شاشة سجل حركة المخزون (Stock Movement Audit) — **قراءة فقط بالكامل**. تقرأ مجموعة `stock_logs` عبر عملية مسمّاة واحدة وبلا أي حمولة (`stockLogs.list()`، بلا وسائط إطلاقًا)؛ وهي أول شاشة تستهلك مستودعًا كان مكتوبًا ومختبَرًا منذ Stage 5B لكنه غير موصول. **لا يوجد أي زر كتابة في هذه الشاشة**: لا حفظ ولا تعديل ولا إضافة حركة؛ وعقد `StockLogsRepository` نفسه لا يملك أي دالة create/update/delete/append، فلا يمكن كتابة حركة مخزون من ويندوز حتى من داخل التطبيق. تعرض كل حركة كما خُزِّنت: `medicineId` والوصف المخزَّن (`label` — وهو نص حر وليس اسم مستخدم، D10) والاتجاه (`type`) والكمية (`quantity`) والتاريخ والمنفّذ (`actorUid`) والمرجع (`orderId`/`requestId`). **لا يُحسب أي رقم مشتق**: الكمية المخزَّنة **مقدار موجب في الاتجاهين** ولا تحمل إشارة سالبة، والاتجاه وحده يحمل الإشارة — لذلك لا جمع ولا طرح صافي ولا رصيد جارٍ ولا إجمالي وارد/صادر، ولا يُشتق `stock` من `totalInward - totalOutward`. الرصيد الحالي حقل مخزَّن في `medicines.stock` ولا تعرضه هذه الشاشة ولا تتحقق منه. **لا يُدَّعى أي ترتيب زمني**: عميل REST لا يدعم `orderBy`، فتصل الصفوف بترتيب الخادم، وكل صف يعرض تاريخه المخزَّن وحده. البحث وتصفية الاتجاه محليّان على الصفوف المحمّلة ولا يُرسلان أي طلب. القراءة محمية فعليًا بالقواعد: `stock_logs` إدارية بالكامل (سطر 86)، فيقرأها المدير والمساعد ويُرفض على الموظف بـ `AUTHORIZATION_DENIED`. لم تُعدَّل قواعد Android، ولم تُضَف أي كتابة، ولم تتغيّر Stage 6.
> بلا أي SDK من Firebase، وبلا Admin SDK، وبلا حساب خدمة، وبلا Cloud Functions (غير منشورة).
> لا توجد بعد: تقارير، أو كتابة مخزون مباشرة من ويندوز. (شاشة الإعدادات نفسها أُضيفت في Stage 13، وما زالت قراءة فقط بالكامل.)

## المتطلبات

- Windows 10/11 (64-bit)
- Node.js 20 أو أحدث (تم التطوير والتحقق على Node.js 24.19.0)
- VS Code (لا حاجة إلى Visual Studio)
- Java 17+ لتشغيل محاكي Firestore (اختبارات المحاكي فقط)

## الأوامر

| الأمر | الوصف |
| --- | --- |
| `npm install` | تثبيت تبعيات التطوير (electron + typescript + @types/node فقط) |
| `npm run typecheck` | فحص الأنواع الصارم للعملية الرئيسية والواجهة |
| `npm run build` | تنظيف + فحص أنواع + ترجمة + نسخ ملفات الواجهة إلى `dist/` |
| `npm test` | بناء ثم تشغيل كل الاختبارات (يُشغِّل اختبار المحاكي تلقائيًا إن كان يعمل) |
| `npm run test:stage7` | اختبارات حدّ IPC وطبقة التطبيق وحدها (Stage 7) |
| `npm run test:stage8` | اختبارات واجهة الدخول واللوحة وحدها (Stage 8) |
| `npm run test:stage9` | اختبارات إدارة المستخدمين وحدها (Stage 9) |
| `npm run test:stage10` | اختبارات إدارة الأدوية وحدها (Stage 10) |
| `npm run test:stage11` | اختبارات إدارة الطلبات وحدها (Stage 11) |
| `npm run test:stage12` | اختبارات سجل الطلبات للقراءة فقط وحدها (Stage 12) |
| `npm run test:stage13` | اختبارات شاشة الإعدادات للقراءة فقط وحدها (Stage 13) |
| `npm run test:stage14` | اختبارات سجل حركة المخزون للقراءة فقط وحدها (Stage 14) |
| `npm run emulator:test:stage9` | اختبارات قواعد Firestore الحقيقية لكتابات المستخدمين (Stage 9) |
| `npm run emulator:test:stage10` | اختبارات قواعد Firestore الحقيقية لكتابة `maxQuantity` (Stage 10) |
| `npm run emulator:test:stage11` | اختبارات قواعد Firestore الحقيقية لشاشة الطلبات ومعالجتها عبر Stage 6 (Stage 11) |
| `npm run emulator:test:stage12` | اختبارات قواعد Firestore الحقيقية لسجل الطلبات: من يقرأه ومن يُرفض (Stage 12) |
| `npm run emulator:test:stage13` | اختبارات قواعد Firestore الحقيقية لشاشة الإعدادات: من يقرأ `settings/app` والمستند الغائب (Stage 13) |
| `npm run emulator:test:stage14` | اختبارات قواعد Firestore الحقيقية لسجل حركة المخزون: المدير يقرأ والموظف يُرفض (Stage 14) |
| `npm run development` | بناء ثم تشغيل التطبيق |
| `npm start` | تشغيل التطبيق من آخر بناء |
| `npm run self-test` | تشغيل تحقق آلي داخل التطبيق (نافذة + IPC + RTL + منع الشبكة) ثم الخروج برمز حالة |
| `npm run emulator:setup` | تثبيت أدوات المختبر المعزولة (firebase-tools داخل `emulator-lab/tools`) |
| `npm run emulator:start` | تشغيل محاكيات Auth + Firestore المحلية يدويًا |
| `npm run emulator:test` | تشغيل اختبارات الأمان ضد المحاكيات (يتطلب بناء سابق) |
| `npm run test:emulator` | بناء + تشغيل المحاكيات + اختبارات الأمان + إيقاف تلقائي |
| `npm run test:emulator:repositories` | اختبارات مستودعات Stage 5B ضد محاكي Firestore (تحتاج محاكيًا يعمل) |
| `npm run test:emulator:stage6` | اختبارات معالجة الطلبات (Stage 6) ضد محاكي Firestore + قواعد Android |
| `npm run emulator:test:stage6` | نفس ما سبق دون إعادة البناء (يتطلب بناء سابقًا) |

### ملاحظة خاصة بهذا الجهاز

PowerShell على هذا الجهاز يمنع تشغيل `npm.ps1` (ExecutionPolicy مضبوطة على Undefined/Restricted).
لذلك شغّل أوامر npm عبر `cmd` مثل:

```
cmd /c "npm install"
cmd /c "npm run build"
cmd /c "npm test"
cmd /c "npm run test:emulator"
```

## بنية المشروع

```
drug-manager/
  package.json            أوامر npm والتبعيات (بلا أي تبعية وقت تشغيل)
  tsconfig.json           إعداد TypeScript للعملية الرئيسية و preload والاختبارات
  tsconfig.renderer.json  إعداد TypeScript للواجهة (DOM فقط، بلا أنواع Node)
  electron/
    main.ts               العملية الرئيسية: النافذة + تركيب طبقة التطبيق + قنوات IPC
    preload.ts            الجسر الوحيد بين الواجهة والعملية الرئيسية
    ipc/channels.ts       أسماء قنوات IPC
    ipc/api.ts            مصنع الواجهة المكشوفة (قابل للاختبار بلا Electron)
    ipc/handlers/application-handlers.ts  معالجات IPC (تستدعي طبقة التطبيق فقط)
    application/          ⭐ Stage 7 — طبقة التطبيق (حالات الاستخدام)
      index.ts                          جذر التركيب: createManagerApplication
      application-error.ts               تصنيف الأخطاء الآمن (7 رموز مغلقة)
      application-result.ts              غلاف ApplicationResult (لا استثناء عبر IPC)
      auth.service.ts                    دخول/خروج/الحالة الآمنة + displayName/role
      manager-data.service.ts            قراءة المستخدمين والأدوية والطلبات والإعدادات
      order-requests.service.ts          معالجة الطلب عبر خدمة Stage 6 (تفويض فقط)
      users-management.service.ts        ⭐ Stage 9 — التعديل الإداري المسموح فقط
      medicines-management.service.ts   ⭐ Stage 10 — كتابة `maxQuantity` وحدها بقناع مقيَّد
      views.ts                           إسقاط نماذج المجال على العرض الآمن
    services/app-status.ts       خدمة حالة التطبيق (نصوص عربية ثابتة)
    services/firebase-auth.ts    مصادقة Firebase Auth عبر REST (Stage 2)
    services/firestore-rest.ts   عميل Firestore REST (Stage 3/5A) — بلا SDK
    services/order-processing.service.ts  تنسيق معالجة الطلب (Stage 6) — بلا معرفة بـ Firestore
domain/                       نماذج المجال + القيم المغلقة + توافق الشهر (Stage 5B/6)
repositories/                 واجهات المستودعات وتنفيذها على Firestore REST (Stage 5B/6)
    firestore/order-processing-transaction.ts           معاملة W1-W5 (Stage 6)
    firestore/order-processing-transaction-factory.ts  ربط المعاملة بالعميل (Stage 6)
    firestore/mappers/order-write-mapper.ts            أقنعة وكتابات W1-W5 (Stage 6)
    services/firestore-codec.ts  ترميز/فكّ ترميز قيم Firestore REST
  src/shared/
    ipc-contract.d.ts  عقد الأنواع المشترك بين الرئيسية والواجهة
    domain-view.d.ts   ⭐ Stage 7 — العرض الآمن للنطاق (بلا رموز، بلا صيغة سلكية)
    window/security.ts    سياسة أمان النافذة + التحقق منها
    config/app-config.ts       إعدادات التطبيق والتحقق منها
    config/firebase-config.ts  إعداد Firebase Auth ومعالجة المحاكي
    config/firestore-config.ts إعداد Firestore REST + بناء الروابط + منع الأهداف غير المحلية
    util/text.ts          أدوات نصية (كشف الأحرف العربية)
  src/
    shared/ipc-contract.d.ts  عقد الأنواع المشترك (بلا رموز مصادقة إطلاقًا)
    renderer/                 واجهة عربية RTL + CSP صارمة (لا اتصال شبكي)
  scripts/
    clean.mjs             حذف dist
    copy-static.mjs       نسخ index.html و styles.css إلى dist/renderer
  tests/
    foundation.test.ts    اختبارات منطق الأساس (بلا شبكة/بلا Electron)
    firebase-auth.test.ts اختبارات مصادقة Stage 2 (بلا شبكة)
    auth-emulator.test.ts بروتوكول محاكي Auth (خادم وهمي محلي وقت الاختبار فقط)
    architecture.test.ts  حراسة معمارية للتبعيات والحدود الأمنية
    stage7/
      application-boundary.test.ts  ⭐ اختبارات طبقة التطبيق (جلست، أخطاء، تفويض)
      ipc-boundary.test.ts          ⭐ اختبارات حدّ IPC (بلا رموز، بلا قنوات حرة)
      helpers/fakes.ts              بدائل اختبار بلا شبكة وبلا Electron
    stage8/
      login-flow.test.ts            ⭐ تشغيل الحزمة الحقيقية في بيئة DOM وهمية
      renderer-architecture.test.ts ⭐ حراسة RTL والأمان في الواجهة
      helpers/renderer-harness.ts   بيئة DOM صغيرة تُشتق من index.html الحقيقي
    stage9/
      users-application.test.ts       ⭐ تفويض الكتابة ورفض الحقول غير المدعومة
      users-ipc.test.ts               ⭐ قنوات IPC المسمّاة وحدود الحمولة
      users-renderer.test.ts          ⭐ سلوك شاشة المستخدمين على الحزمة الحقيقية
      users-renderer-architecture.test.ts ⭐ حراسة الأمان و RTL لملف المستخدمين
      helpers.ts                      بانيو طبقة التطبيق المشترك
    stage10/
      medicines-application.test.ts       ⭐ تفويض الكتابة ورفض الحقول غير المدعومة
      medicines-ipc.test.ts               ⭐ قناة IPC المسمّاة وحدود الحمولة
      medicines-renderer.test.ts          ⭐ سلوك شاشة الأدوية على الحزمة الحقيقية
      medicines-renderer-architecture.test.ts ⭐ حراسة الأمان و RTL لملف الأدوية
    stage11/
      order-requests-application.test.ts       ⭐ تفويض المعالجة إلى Stage 6 والنتائج الأربعة
      order-requests-ipc.test.ts               ⭐ قنوات IPC المسمّاة وحدود الحمولة
      order-requests-renderer.test.ts          ⭐ سلوك شاشة الطلبات على الحزمة الحقيقية
      order-requests-renderer-architecture.test.ts ⭐ حراسة الأمان و RTL لملف الطلبات
    stage12/
      orders-history-application.test.ts       ⭐ عرض الحقول المخزَّنة وغياب أي كتابة
      orders-history-ipc.test.ts               ⭐ قناة `orders.list` بلا حمولة
      orders-history-renderer.test.ts          ⭐ سلوك شاشة السجل على الحزمة الحقيقية
      orders-history-renderer-architecture.test.ts ⭐ حراسة الأمان و RTL وغياب تجميع الكميات
    stage13/
      settings-application.test.ts             ⭐ مرور الحقول الستة بلا تحويل وغياب أي كتابة
      settings-ipc.test.ts                     ⭐ قناة `settings.get` بلا حمولة ولا قناة حفظ
      settings-renderer.test.ts                ⭐ سلوك شاشة الإعدادات على الحزمة الحقيقية
      settings-renderer-architecture.test.ts  ⭐ حراسة الأمان و RTL وغياب أدوات الكتابة
    stage14/
      stock-movements-application.test.ts             ⭐ مرور الحركات بلا تحويل وبلا أي تجميع
      stock-movements-ipc.test.ts                     ⭐ قناة `stock-logs:list` بلا حمولة ولا قناة كتابة
      stock-movements-renderer.test.ts                ⭐ سلوك شاشة سجل الحركة على الحزمة الحقيقية
      stock-movements-renderer-architecture.test.ts  ⭐ حراسة غياب الأرقام المشتقة وأي مسار كتابة
    repositories/
      medicines-rules-emulator.test.ts ⭐ Stage 10 — كتابة `maxQuantity` مقابل قواعد Android الحقيقية
      order-requests-rules-emulator.test.ts ⭐ Stage 11 — الطابور والمعالجة مقابل قواعد Android الحقيقية
      orders-history-rules-emulator.test.ts ⭐ Stage 12 — قراءة المدير ورفض الموظف مقابل قواعد Android الحقيقية
      settings-rules-emulator.test.ts ⭐ Stage 13 — قراءة `settings/app` وغياب المستند مقابل قواعد Android الحقيقية
      stock-logs-rules-emulator.test.ts ⭐ Stage 14 — سجل حركة المخزون: المدير يقرأ والموظف يُرفض مقابل قواعد Android الحقيقية
    firestore-rest.test.ts        اختبارات وحدة لعميل Firestore REST (fetch مُدخَل، بلا شبكة)
    firestore-architecture.test.ts حراسة Stage 3 (لا SDK/لا رموز في الواجهة/لا فحص أدوار في العميل)
    firestore-rules-emulator.test.ts اختبارات أمان حقيقية ضد محاكيات Firebase الحقيقية
    helpers/firestore-emulator-harness.ts تهيئة المحاكي وبناء الجلسات
  emulator-lab/
    firebase.json         إعداد محاكيات محلي معزول (auth 9099 / firestore 8080)
    firestore.rules       نسخة مطابقة لقواعد مشروع الأندرويد (تُتحقَّق بالبصمة)
    tools/                تثبيت firebase-tools معزول (غير مشمول في التطبيق)
    scripts/              تشغيل المحاكيات وتشغيل الاختبارات
  docs/
    auth-architecture.md            معمارية المصادقة (Stage 2)
    firestore-rest-architecture.md  معمارية Firestore REST وقواعد الأمان (Stage 3)
    domain-data-architecture.md     تدقيق طبقة المجال (Stage 4) + تنفيذ Stage 5B (§15)
```

## ما هو غير مُنفَّذ بعد (بشكل مقصود)

- شاشة تسجيل الدخول وأي واجهة بيانات
- إدارة الأدوية والطلبات والمخزون والتقارير (منطق الأعمال)
- أي إعداد Firebase إنتاجي أو نشر
- Cloud Functions
- `DELETE` والاستعلامات المركّبة في عميل REST (أُضيفت عند الحاجة لاحقًا)

التفاصيل الكاملة للحدود والقرارات المعمارية في `docs/firestore-rest-architecture.md`.


## بنية المشروع

```
drug-manager/
  package.json            أوامر npm والتبعيات (بلا أي تبعية وقت تشغيل)
  tsconfig.json           إعداد TypeScript للعملية الرئيسية و preload والاختبارات
  tsconfig.renderer.json  إعداد TypeScript للواجهة (DOM فقط، بلا أنواع Node)
  electron/
    main.ts               العملية الرئيسية: النافذة، قناة IPC واحدة، تقوية الجلسة
    preload.ts            الجسر الوحيد بين الواجهة والعملية الرئيسية
    ipc/channels.ts       أسماء قنوات IPC
    ipc/api.ts            مصنع الواجهة المكشوفة (قابل للاختبار بلا Electron)
    services/app-status.ts خدمة حالة التطبيق (نصوص عربية ثابتة)
    window/security.ts    سياسة أمان النافذة + التحقق منها
    config/app-config.ts  إعدادات التطبيق والتحقق منها
    util/text.ts          أدوات نصية (كشف الأحرف العربية)
  src/
    shared/ipc-contract.d.ts  عقد الأنواع المشترك بين الرئيسية والواجهة
    renderer/
      index.html          واجهة عربية RTL + سياسة CSP صارمة
      styles.css          تنسيق الواجهة
      renderer.ts         منطق الواجهة (يقرأ الحالة عبر IPC فقط)
  scripts/
    clean.mjs             حذف dist
    copy-static.mjs       نسخ index.html و styles.css إلى dist/renderer
  tests/
    foundation.test.ts    اختبارات منطق الأساس (بلا شبكة/بلا Electron)
    architecture.test.ts   حراسة معمارية للتبعيات والحدود الأمنية
  docs/
    ARCHITECTURE.md       البنية وتدفق البيانات والخطوة التالية
    SECURITY.md           الضوابط الأمنية وكيفية التحقق منها
```

## ما هو غير مُنفَّذ بعد (بشكل مقصود)

- إنشاء ملفات PDF مستقلة أو تقارير قابلة للتنزيل؛ طباعة سجلي الطلبات من المتصفح وميزة Save as PDF متاحة (Stages 21–22).
- شاشة إعدادات النظام (تُقرأ من Stage 11 وتُعرض للقراءة فقط)
- أي كتابة مخزون مباشرة من ويندوز: الكتابة كلها عبر معاملة Stage 6
- معالجة الطلبات من الواجهة نفسها أو أي تنفيذ آخر لـ Stage 6

ما سبق تمّ تنفيذه في مراحل سابقة: مصادقة Firebase عبر REST (Stage 2)، وFirestore REST مع فرض القواعد (Stage 3)، وطبقة المجال والمستودعات (Stage 5B)، ومعالجة الطلبات بمعاملة واحدة W1–W5 (Stage 6)، ثم الطبقات والواجهات (Stage 7–11).

## Stage 16: إرسال طلب أدوية من الموظف

تتيح شاشة **إرسال طلب أدوية** للموظف اختيار أدوية من الكتالوج وإضافة كميات موجبة إلى طلبه. الواجهة ترسل معرّفات الأدوية والكميات فقط عبر `orderRequests.submit()`؛ وتستخرج العملية الرئيسية هوية المستخدم من جلسة Firebase الموثوقة وتحلّ أسماء الأدوية من المستودع. ينشئ مستودع الطلبات الطلب بحالة `pending` ووقت خادم ومعرّف مولّد، بينما تبقى قواعد Firestore حدّ التفويض النهائي وتبقى قرارات الأهلية والمخزون والمعالجة ضمن Stage 6.

النجاح يعني أن الطلب أُنشئ وأُرسل للمراجعة، ولا يعني اعتماده أو معالجته. للتحقق المحلي: `npm run test:stage16` و`npm run emulator:test:stage16`؛ ويعمل مشغّل المحاكي على قواعد Firestore الموجودة دون تعديلها.

## Stage 17: سجل طلبات الموظف

تتيح شاشة **طلباتي المنفَّذة** للموظف عرض نافذة محدودة من طلباته الخاصة. العملية المسمّاة لا تستقبل أي حمولة؛ تستخرج العملية الرئيسية UID من جلسة Firebase الموثوقة وتستخدم `OrdersRepository.listOrdersByUser`، بينما تبقى قواعد Firestore حدّ التفويض النهائي. تعرض الواجهة البيانات المخزّنة دون ترتيب زمني مفترض، ولا تغيّر شاشة سجل الطلبات الإدارية أو تنشئ أي كتابة. للتحقق المحلي: `npm run test:stage17` و`npm run emulator:test:stage17`.

## Stage 18: تحديث حالة طلب الموظف

بعد إرسال طلب بنجاح، تحتفظ الواجهة بالمعرّف الذي أعادته العملية الرئيسية وتقرأ الحالة المخزّنة للطلب عبر `orderRequests.get({ requestId })`. يمكن للموظف تحديث الحالة لهذا الطلب نفسه فقط؛ لا توجد قائمة طلبات أو إدخال معرّف، وتبقى قواعد Firestore مسؤولة عن عزل طلبات المالك. القراءة لا تعالج الطلب ولا تعدّله. للتحقق المحلي: `npm run test:stage18` و`npm run emulator:test:stage18`.

## Stage 19: تفاصيل حركة المخزون للطلب

يعرض حوار تفاصيل سجل الطلبات الإدارية نافذة محدودة من حركات المخزون المرتبطة بالطلب المحدد، عبر العملية المسمّاة `stockLogs.listByOrder({ orderId })` والمستودع الموجود. تعرض الواجهة الحقول المخزّنة فقط، دون حساب أرصدة أو ترتيب زمني مفترض أو كتابة؛ وتظل قواعد Firestore الحالية صاحبة التفويض. للتحقق المحلي: `npm run test:stage19` و`npm run emulator:test:stage19`.

## Stage 20: البحث في سجل الموظف

يتيح سجل **طلباتي المنفَّذة** البحث المحلي بمعرّف الطلب أو اسم الدواء وتصفية الحالات المدعومة معًا، ضمن البيانات المحمّلة فقط. لا يؤدي تغيير عوامل التصفية إلى قراءة إضافية، ويوضح التنويه أن غياب نتيجة لا ينفي وجود طلب خارج النافذة المحدودة. للتحقق: `npm run test:stage20` و`npm run test:stage17`.

## Stage 21: طباعة سجل الموظف

يمكن طباعة النتائج المرئية لسجل الموظف أو اختيار **Save as PDF** من حوار الطباعة في المتصفح. هذا إخراج طباعة محلي وليس إنشاء ملف PDF مستقلًا من التطبيق؛ ولا ينفّذ قراءة بيانات جديدة.

## Stage 22: طباعة سجل المدير

يتيح سجل الطلبات الإداري طباعة النتائج الحالية بعد البحث والتصفية، مع البيانات الوصفية وتنويه النطاق. يستخدم الطباعة المحلية للمتصفح، ولا ينشئ التطبيق ملف PDF منفصلًا أو يقرأ بيانات إضافية.

## Stage 23: صفحات إضافية لسجل المدير

يقرأ سجل المدير أول صفحة بحد أقصى 500 طلب، ثم يتيح **تحميل المزيد** عند الطلب. يحتفظ Main Process برمز الاستمرار ولا يرسله إلى Renderer؛ وتبقى عوامل البحث والحالة محلية على جميع الصفحات المحمّلة. يبدأ التحديث نافذة جديدة، ويحافظ فشل الصفحة التالية على النتائج السابقة ويسمح بإعادة المحاولة. لا يضمن Firestore REST ترتيبًا زمنيًا أو لقطة متسقة بين الصفحات؛ لذلك تقتصر الطباعة على البيانات المحمّلة حاليًا. للتحقق: `npm run test:stage23` مع `npm run test:stage12`, `npm run test:stage19`, `npm run test:stage20`, `npm run test:stage21`, و`npm run test:stage22`.
