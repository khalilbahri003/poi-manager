# POI Manager

تطبيق لإدارة نقاط الاهتمام على الخريطة، مبني بـReact وNode.js وExpress وSQLite.

المشروع تطبيق خريطة لإدارة نقاط الاهتمام. أُكملت واجهة React وربطها بواجهة API على Express وقاعدة SQLite بدل ملفات PHP الناقصة. يدعم تسجيل الدخول، وإضافة نقاط أو مناطق، وإدارة المستخدمين وسجل النشاط.

## المتطلبات
- Node.js 20 أو أحدث
- pnpm 10 أو أحدث (يتضمن المشروع ملف القفل `pnpm-lock.yaml`)

## التشغيل محليًا
1. ثبّت الحزم: `pnpm install`
2. انسخ `.env.example` إلى `.env`. أنشئ سر جلسات عشوائيًا بالأمر `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` وضع الناتج في `SESSION_SECRET` داخل `.env`. لا تشارك هذا السر ولا ترفعه إلى GitHub.
3. أنشئ أول مدير: `pnpm create-admin`، ثم أدخل اسم مستخدم وكلمة مرور من 12 حرفًا على الأقل. لا توجد بيانات دخول افتراضية.
4. شغّل الخادم: `pnpm server` (أو `pnpm dev:server` لإعادة التشغيل التلقائي).
5. في نافذة طرفية ثانية شغّل React: `pnpm start`، ثم افتح العنوان الذي يظهر (عادةً `http://localhost:3000`).

خادم React يمرّر `/api` إلى Express على المنفذ 5000. تتكوّن قاعدة البيانات تلقائيًا في `server/data/poi.sqlite`؛ استخدم `DATA_DIR` لتغيير مكانها.

## نشر الإنتاج
نفّذ `pnpm build` ثم شغّل `pnpm start:prod` بعد ضبط `NODE_ENV=production` و`SESSION_SECRET` في إعدادات الاستضافة. يقدّم Express الواجهة والـAPI من نفس المصدر لتجنب إعدادات CORS إضافية. إذا كانت الواجهة على نطاق مختلف، أضف مصدرها الكامل إلى `ALLOWED_ORIGINS` (مفصولًا بفواصل). خلف وكيل عكسي موثوق، اضبط `TRUST_PROXY=1`. استخدم HTTPS وتخزينًا دائمًا لملف SQLite وملفاته المرافقة، واحتفظ بنسخة احتياطية آمنة.

## المسارات
- `POST /api/auth/login`، `POST /api/auth/logout`، `GET /api/auth/me`
- `GET /api/pois`، `POST /api/pois`، `DELETE /api/pois/:id` (الحذف للمدير فقط)
- `GET /api/users`، `POST /api/users`، `DELETE /api/users/:id` (للمدير فقط)
- `GET /api/activity` (للمدير فقط، آخر 200 سجل)
- `GET /api/health`

تُحفظ كلمات المرور على شكل bcrypt hash. يستخدم الخادم ملفات تعريف ارتباط للجلسة من نوع HTTP-only وSameSite، وتدوير معرّف الجلسة عند الدخول، وفحص مصدر الطلب، وحدًا لمحاولات تسجيل الدخول، ورؤوس حماية Helmet، والتحقق من المدخلات والصلاحيات.

## الاختبارات
شغّل `pnpm test:api` لاختبارات الخادم والـAPI.
