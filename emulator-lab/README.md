# مختبر المحاكي المعزول — Stage 3 (Firestore Rules Emulator Lab)

هذا المجلد بيئة اختبار **معزولة تمامًا** للتحقق من أن تطبيق سطح المكتب يعمل عبر Firestore REST وبصلاحيات **قواعد أمان Firestore** الخاصة بمشروع الأندرويد.

## قواعد العزل

| القاعدة | التفصيل |
| --- | --- |
| لا تعديل على مشروع الأندرويد | `firestore.rules` هنا **نسخة** تُقارَن ببصمة SHA-256 مع الملف الأصلي قبل أي تشغيل؛ أي اختلاف يوقف التشغيل. |
| لا تعديل على إعدادات الإنتاج | لا يوجد أي مشروع Firebase إنتاجي؛ المعرّف `demo-drug-manager-stage3` لا يمكن أن يُحلَّ إلا محليًا. |
| لا تبعيات في تطبيق سطح المكتب | أدوات المحاكي مثبّتة في `tools/` بملف `package.json` مستقل، و`package.json` الخاص بالتطبيق يبقى بلا تبعيات وقت تشغيل. |
| منافذ محلية فقط | Auth على `127.0.0.1:9099` و Firestore على `127.0.0.1:8080` و UI معطّل. |

## المتطلبات

- Node.js 20+ (تم التحقق على 24.19.0)
- Java 17+ (مطلوب لمحاكي Firestore الرسمي؛ تم التحقق على OpenJDK 17.0.18)
- اتصال شبكة أول مرة فقط (لتنزيل أدوات المحاكي وجرّة Firestore إن لم تكن مُخزَّنة)

## التشغيل

```powershell
# من جذر مشروع drug-manager
npm run emulator:setup     # تثبيت firebase-tools داخل tools/ (مرة واحدة)
npm run test:emulator      # بناء + تشغيل المحاكيات + اختبارات الأمان + إيقاف تلقائي
```

أو يدويًا:

```powershell
npm run emulator:start     # تشغيل المحاكيات في المقدمة
# في نافذة أخرى:
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
$env:FIREBASE_PROJECT_ID='demo-drug-manager-stage3'
node --test dist/tests/firestore-rules-emulator.test.js
```

## ما الذي يثبته هذا المختبر

- كل تأكيد أمني هو طلب HTTP حقيقي إلى محاكي Firestore الرسمي برمز Firebase ID حقيقي صادر عن محاكي Auth الرسمي.
- لا محاكاة لاستجابات Firestore ولا خادم وهمي ولا تقييم قواعد في TypeScript.
- يطبع المشغّل جدول قرارات كامل (اسم الحالة، الفاعل، الطلب، المتوقع، المرصود) عبر `t.diagnostic`.

## ملفات

| الملف | الدور |
| --- | --- |
| `firebase.json` | إعداد المحاكيات المعزول (auth + firestore) |
| `firestore.rules` | نسخة مطابقة لقواعد مشروع الأندرويد |
| `tools/` | تثبيت معزول لـ `firebase-tools` (غير مشمول في Git) |
| `scripts/lab-paths.mjs` | المسارات والمنافذ ومعرّف المشروع |
| `scripts/start.mjs` | تشغيل المحاكيات يدويًا |
| `scripts/run-emulator-tests.mjs` | التحقق من بصمة القواعد ثم تشغيل الاختبار عبر `emulators:exec` |
