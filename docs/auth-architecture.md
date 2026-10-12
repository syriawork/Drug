# توثيق معمارية المصادقة - المرحلة الثانية (Stage 2: Firebase Auth REST Layer)

## 1. المعمارية العامة (Authentication Architecture)
تعتمد المصادقة في نظام `drug-manager` بالكامل على واجهات **Firebase Authentication REST API** المباشرة وتعمل حصرياً داخل العملية الرئيسية (**Electron Main Process**).
* **لا يتم استخدام** أي حزم من `firebase`, `@firebase/*`, `firebase-admin`, أو `google-cloud`.
* **لا يتم استخدام** ملفات الاعتماد الخاصة بحساب الخدمة (`service-account.json`).
* **الواجهة (Renderer)** معزولة تماماً (`contextIsolation: true`, `nodeIntegration: false`) ولا تملك أي اتصال شبكي مباشر (`connect-src 'none'`).
* العملية الرئيسية هي الحافظ الوحيد لرموز المصادقة الحساسة (`idToken`, `refreshToken`) في الذاكرة الحية فقط (`In-Memory`).

---

## 2. توزيع المسؤوليات (Main / Preload / Renderer Responsibilities)

### أ. العملية الرئيسية (Electron Main Process)
1. قراءة إعدادات المشروع أو مشغّل المحاكي (Emulator Host) من البيئة دون تسريبها للواجهة.
2. إدارة دورة حياة الجلسة وتخزين الرموز في بنية خاصة (`InternalTokenSession`).
3. إرسال طلبات الـ HTTP REST مباشرة باستخدام مكتبة `fetch` المدمجة في Node.js.
4. تجديد رمز الهوية (`idToken`) تلقائياً عند اقتراب انتهاء صلاحيته.
5. تحويل كائنات الجلسة إلى كائنات آمنة (`SafeAuthState`) تخلو تماماً من أي رموز قبل إرسالها عبر الـ IPC.
6. مسح الجلسة فوراً عند تسجيل الخروج أو عند فشل التجديد.

### ب. جسر الاتصال الآمن (Preload Bridge)
1. يوفر فقط واجهة مصغرة ومحددة الأنواع (`drugManager.auth`):
   - `signIn(credentials)`
   - `signOut()`
   - `getState()`
2. لا يسمح بتمرير أي دوال عشوائية أو وصول لنظام التشغيل أو Node globals.
3. لا يمرر ولا يعيد أبداً حقل `refreshToken`.

### ج. واجهة العرض (Renderer UI)
1. تستقبل بيانات الحالة العامة فقط: (`authenticated`, `email`, `uid`, `emailVerified`, `expirationTimeIso`).
2. تعرض واجهة المستخدم باللغة العربية واتجاه RTL.
3. ممنوعة تماماً بموجب الـ CSP من إجراء اتصالات شبكية لأي خادم خارجي.

---

## 3. نقاط الاتصال المستخدمة (REST Endpoints Used)

### أ. تسجيل الدخول بالبريد وكلمة المرور (signInWithPassword):
* **Endpoint (Cloud):**
  `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=[API_KEY]`
* **Endpoint (Auth Emulator):**
  `POST http://[EMULATOR_HOST]/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=[API_KEY]`
* **Headers:** `Content-Type: application/json`
* **Body:** `{"email": "...", "password": "...", "returnSecureToken": true}`

### ب. تجديد الرمز المميز (Secure Token Refresh):
* **Endpoint (Cloud):**
  `POST https://securetoken.googleapis.com/v1/token?key=[API_KEY]`
* **Endpoint (Auth Emulator):**
  `POST http://[EMULATOR_HOST]/securetoken.googleapis.com/v1/token?key=[API_KEY]`
* **Headers:** `Content-Type: application/x-www-form-urlencoded`
* **Body:** `grant_type=refresh_token&refresh_token=[REFRESH_TOKEN]`

---

## 4. إجراءات اختبار المحاكي (Emulator Test Procedure)
يدعم وضع التطوير العمل مع محاكي Firebase Auth على الجهاز المحلي:
1. تعيين متغير البيئة:
   ```bash
   set FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
   ```
   يقبل المضيف `localhost` أو `127.0.0.1` أو `[::1]` فقط. وضع المحاكي متاح عندما تكون نسخة Electron غير معبأة (`app.isPackaged === false`)؛ تشغيل نسخة معبأة مع متغير المحاكي يفشل مغلقًا ولا يحوّل الطلبات إلى المحاكي.
2. يتضمن مجلد الاختبارات اختبار تكامل مؤتمت (`tests/auth-emulator.test.ts`) يقوم بمحاكاة بروتوكول شبكة المحاكي واختبار دورة المصادقة والتجديد وتسجيل الخروج كاملة.
3. لتشغيل الاختبارات:
   ```bash
   npm test
   ```

## إعدادات endpoints ومهلة الطلب
تستخدم النسخة المعبأة endpoints Firebase الرسمية عبر HTTPS. إذا عُيّنت `FIREBASE_AUTH_BASE_URL` أو `FIREBASE_TOKEN_BASE_URL`، فيجب أن تكون HTTPS وعلى مضيف Firebase الموافق لمسار `/v1`؛ لا تُقبل عناوين HTTP أو مضيفات بديلة. لا يجوز جمع متغيري endpoint مع إعداد المحاكي. تنتهي طلبات تسجيل الدخول وتجديد الرمز بمهلة 15 ثانية، وتظهر رسالة آمنة قابلة لإعادة المحاولة دون تضمين بيانات الاعتماد أو الرموز.

## 5. قواعد أمان الرموز (Token-Security Rules)
1. **عدم الحفظ في ملفات نصية:** لا يتم تخزين الرموز على القرص الصلب (No local storage / No plain-text files).
2. **عزل الـ Refresh Token:** لا يتم إرجاعه للواجهة مطلقاً تحت أي ظرف، ولا يظهر ضمن الـ IPC Contract (`SafeAuthState`).
3. **تطهير الأخطاء:** لا تسجل رسائل الخطأ أي بيانات اعتماد أو رموز حساسة في السجلات.