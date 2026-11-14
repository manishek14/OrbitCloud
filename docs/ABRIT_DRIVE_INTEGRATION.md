# مستندات یکپارچه‌سازی پنل کاربری AbrIT با AbrIT Drive (Nextcloud)

نسخه: ۱.۰ — ۱۴۰۵
دامنه: اتصال «پنل کاربری AbrIT» به سرویس «AbrIT Drive» بر پایه Nextcloud (`https://drive.abrit.cloud`) از طریق
API رسمی مدیریت کاربران (OCS User Provisioning API).

---

## ۱. خلاصه اجرایی

- اتصال به Nextcloud **فقط از بک‌اند** و با `OCS-APIRequest: true` + اعتبارنامه Basic یک حساب مدیریتی انجام می‌شود؛
  هیچ اعتبارنامه‌ای به فرانت‌اند یا مخزن کد نمی‌رسد.
- هر کاربر پنل، حداکثر **یک** حساب Drive دارد (unique در دو سطح: کاربر پنل و نام کاربری Nextcloud) — درخواست‌های
  تکراری حساب جدید نمی‌سازند (idempotent).
- سهمیه بر اساس پلن اعمال می‌شود؛ پلن آزمایشی = **۱۰۰ مگابایت** (طبق راهنمای اتصال)، پلن‌های سازمانی مطابق
  سند پکیج‌های ۱۴۰۵ (۱۰/۲۵/۵۰/۱۰۰/۲۵۰ گیگابایت).
- تغییر پلن از پنل، بلافاصله در Nextcloud اعمال می‌شود؛ فعال/غیرفعال‌سازی حساب نیز از پنل انجام می‌شود.
- وضعیت سرویس (متصل/در انتظار/در دسترس نیست)، میزان مصرف و کل سهمیه، و لینک ورود به Drive در پنل نمایش داده
  می‌شود. **هیچ وضعیتی جعل نمی‌شود** (سیاست «حالت صادقانه» مطابق پیاده‌سازی Orchard).
- ورود یکپارچه (SSO) فعلاً خارج از دامنه است و جداگانه بررسی می‌شود.

---

## ۲. یافته‌های بررسی مستندات و کدهای موجود

### ۲.۱ پروژه Orchard (Abrit-Orchard-master)

- پنل فعلی AbrIT بر پایه Orchard Core 3.0.1 / .NET 10 است (`AbrITPortal`).
- یکپارچه‌سازی Drive موجود (`AbrITPortal/Drive/`) از **WebDAV** استفاده می‌کند، نه OCS:
  یک «حساب فنی» واحد + پوشه اختصاصی هر مشتری با نام `u-<sha256-16hex>` (بدون نشت شناسه کاربر)؛
  `PROPFIND` برای وضعیت/سهمیه و `MKCOL` برای راه‌اندازی؛ حالت‌های NotConfigured/Unreachable/Missing/Ready با
  جزئیات ثابت و بدون افشای زیرساخت؛ فقط HTTPS؛ کش ۶۰ ثانیه‌ای per-user.
- **OCS User Provisioning وجود ندارد**: ممیزی PHASE5_GAP_AUDIT صراحتاً اعلام می‌کند «No Nextcloud/provisioning
  code found» و INTEGRATION_TEST_REPORT نیز «Nextcloud provisioning wiring» را از کارهای آینده فهرست می‌کند.
- مدل پلن‌های تجاری (`Commercial/CommercialModels.cs`) فیلدی برای سهمیه فضای ابری ندارد.
- ثبت‌نام/ورود پنل: کاربران بومی Orchard با ایمیل + تأیید ایمیل؛ ثبت‌نام موبایلی با OTP
  (`Mobile/MobileIdentityService.cs`).

### ۲.۲ پیاده‌سازی قبلی (abrit-website / نسخه لوکال قدیمی)

- در مواد ارسالی (Abrit-Orchard-master.zip، PDF پورتال، DOCX پکیج‌ها) **کدی از abrit-website یا فرم قدیمی
  Nextcloud یافت نشد**؛ جستجو برای `ocs`، `cloud/users`، `nextcloud` (به‌جز WebDAV فوق) نتیجه‌ای نداشت.
- بنابراین مطابق دستور «در صورت دسترسی، از همان پیاده‌سازی استفاده شود»: پیاده‌سازی استاندارد و رسمی
  OCS (که همان رفتار توصیف‌شده فرم قدیمی است: «دریافت نام کاربری و رمز → ایجاد حساب با ۱۰۰ مگابایت») به‌کار
  رفت؛ بخش ۳ همین سند نقشه دقیق آن است.

### ۲.۳ سند پکیج‌های ۱۴۰۵ (Abrit_Packages_1405_Final.docx)

نگاشت سهمیه فضای ابری (ردیف Cloud Storage Included):

| پلن | سهمیه | قیمت ماهانه (تومان) |
| --- | --- | --- |
| پایه (Essential) | ۱۰ GB | ۱۲,۹۵۰,۰۰۰ |
| استاندارد (Standard) | ۲۵ GB | ۱۹,۵۰۰,۰۰۰ |
| حرفه‌ای (Professional) | ۵۰ GB | ۳۲,۹۰۰,۰۰۰ |
| سازمانی (Business) | ۱۰۰ GB | ۵۲,۹۰۰,۰۰۰ |
| سازمانی پلاس (Enterprise) | ۲۵۰ GB | ۷۹,۹۰۰,۰۰۰ |

> نکته: در جدول امکانات، ردیف «Nextcloud/File Sharing» برای پلن پایه «-» است ولی ردیف Cloud Storage برای
> پایه ۱۰GB درج شده؛ این تعارض باید توسط واحد تجاری نهایی شود. در این پیاده‌سازی، مقدار ۱۰GB برای پایه
> لحاظ شده و نگاشت در `src/lib/drive/plans.ts` به‌سادگی قابل تغییر است.

### ۲.۴ سند پورتال مشتریان (PDF)

بخش ۴ (یکپارچه‌سازی با AbrIT Drive): اتصال به Nextcloud از طریق API؛ ایجاد خودکار حساب پس از تأیید سفارش؛
اختصاص فضای ذخیره‌سازی مطابق پلن؛ نمایش وضعیت و اطلاعات دسترسی در پنل؛ مدیریت خطاها و جلوگیری از حساب
تکراری — همگی در این پیاده‌سازی پوشش داده شده است.

### ۲.۵ سرویس drive.abrit.cloud

- از این محیط قابل دسترسی است؛ `status.php` نسخه **Nextcloud 35.0.1** را برمی‌گرداند (نصب‌شده، بدون maintenance).
- برای اتصال واقعی فقط اعتبارنامه مدیریتی لازم است (بخش ۶).

---

## ۳. معماری پیاده‌سازی (پنل Next.js این پروژه)

### ۳.۱ اجزا

```
src/lib/nextcloud/config.ts     ← خواندن env (حالت live/simulation، اعتبارنامه، timeout)
src/lib/nextcloud/client.ts     ← کلاینت OCS (fetch + Basic + OCS-APIRequest + JSON)
src/lib/nextcloud/errors.ts     ← خطاهای نوع‌دار با پیام فارسی ثابت (بدون افشای زیرساخت)
src/lib/drive/plans.ts          ← کاتالوگ پلن‌ها + نگاشت سهمیه + قالب «100 MB»
src/lib/drive/service.ts        ← ارکستریشن: فعال‌سازی idempotent، تغییر سهمیه، فعال/غیرفعال، همگام‌سازی، audit
src/lib/auth/{password,session} ← scrypt + نشست کوکی (DB-backed)
src/app/api/...                 ← auth/register|login|logout، me، drive/activate|quota|enabled|sync|health
mini-services/nextcloud-mock    ← شبیه‌ساز Nextcloud (OCS + صفحه ورود) روی درگاه ۳۰۳۱
prisma/schema.prisma            ← PanelUser, Session, DriveAccount, DriveEvent
```

### ۳.۲ نگاشت قابلیت‌ها به OCS API

| نیاز راهنمای اتصال | Endpoint | پیاده‌سازی |
| --- | --- | --- |
| ایجاد حساب (نام کاربری، رمز، ایمیل) | `POST /ocs/v1.php/cloud/users` | `client.createUser` (+ set email/displayname) |
| اختصاص سهمیه بر اساس پلن | `PUT /ocs/v1.php/cloud/users/<id>` با `key=quota` | `client.setQuota("100 MB"/"25 GB")` |
| بررسی وجود حساب و وضعیت کاربر | `GET /ocs/v1.php/cloud/users/<id>` (404/998 = نبود) | `client.getUser` |
| تغییر سهمیه هنگام تغییر پلن | `PUT ... key=quota` | `service.changeQuota` |
| فعال/غیرفعال‌سازی | `PUT .../enable` \| `.../disable` | `service.setEnabled` |
| فضای مصرف‌شده و کل | `GET ...` → `data.quota {used,total,free,relative}` | `service.getOverview` |
| (کمکی) جستجو | `GET /ocs/v1.php/cloud/users?search=` | `client.searchUsers` |
| (کمکی) سلامت سرویس | `GET /status.php` | `client.ping` (بدون احراز هویت) |

هدرهای هر فراخوانی OCS: `Authorization: Basic …`، `OCS-APIRequest: true`، `Accept: application/json`.
کدهای وضعیت Nextcloud که مدیریت می‌شوند: `101` نام کاربری نامعتبر، `102` رمز نامعتبر، `103` تکراری،
`997/401/403` اعتبارنامه، `998/404` کاربر موجود نیست.

### ۳.۳ مدل داده

- `PanelUser`: ایمیل (unique) + scrypt + نشست‌ها.
- `DriveAccount`: `panelUserId` **unique** (یک حساب Drive در هر کاربر پنل)، `ncUsername` **unique**
  (یک نام کاربری در هر حساب)، `planCode`، `quotaBytes` (BigInt)، `status`، `provisionedAt`، `lastSyncedAt`.
- `DriveEvent`: لاگ حسابرسی هر عملیات (provisioned/resumed/quota_changed/enabled/disabled/sync/error).

### ۳.۴ جریان فعال‌سازی (idempotent + بازیافت)

1. اعتبارسنجی ورودی‌ها (نام کاربری: `^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$`؛ رمز: ≥۸ با حرف و رقم؛ پلن معتبر).
2. اگر کاربر پنل از قبل `DriveAccount` دارد → خطای `ALREADY_LINKED` (۴۰۹) — **بدون ساخت حساب جدید**.
3. `getUser(username)` روی سرور:
   - موجود و ایمیلِ همان کاربر پنل است → مسیر «بازیافت» (resume): حساب نیمه‌کاره‌ی ناشی از خرابی قبلی
     بازچینی و لینک می‌شود (رویداد `resumed` ثبت می‌شود) — این همان «در درخواست‌های تکراری، حساب تکراری
     ساخته نشود» است.
   - موجود با ایمیل دیگر → `USERNAME_TAKEN` (۴۰۹).
4. `createUser(userid, password, email)` → سپس `email`/`displayname` ترمیم و `setQuota(پلن)` اعمال می‌شود.
5. ثبت `DriveAccount` + رویداد `provisioned`؛ خواندن وضعیت تازه (bypass cache) و بازگشت به پنل.

### ۳.۵ وضعیت‌های صادقانه (honest states)

`not_provisioned` (فعال نشده) / `ready` (متصل؛ با سهمیه و مصرف واقعی) / `missing_on_server` (حساب در سرور
نیست) / `unreachable` (شبکه/تایم‌اوت) / `auth_failed` (اعتبارنامه رد شد) / `not_configured` (پیکربندی ناقص).
هیچ‌وقت وضعیت «متصل» ساخته نمی‌شود؛ پیام‌های خطا ثابت و فارسی‌اند و متن استثنا فقط در لاگ سرور می‌ماند.
خواندن وضعیت هر کاربر ۳۰ ثانیه کش می‌شود؛ «همگام‌سازی» کش را دور می‌زند.

### ۳.۶ امنیت

- اعتبارنامه Drive فقط در متغیرهای محیطی (`.env.local` / مدیر محیط)؛ هرگز در مخزن یا پاسخ‌های API/HTML.
- در حالت live، درخواست فقط روی HTTPS ارسال می‌شود (`NEXTCLOUD_ALLOW_INSECURE=true` می‌تواند صرفاً برای
  محیط تست، آن را باز کند).
- رمز عبور Drive در پاسخ‌ها بازگشته نمی‌شود؛ در DB هم فقط هش scryptِ «رمز پنل» ذخیره می‌شود (رمز Drive فقط
  در Nextcloud نگه داشته می‌شود — جداسازی کامل).
- نشست پنل: کوکی httpOnly + SameSite=Lax + ذخیره SHA-256 توکن.
- خطاها با کد و پیام ثابت فارسی برمی‌گردند؛ جزئیات خام در `console` سرور لاگ می‌شود.

---

## ۴. تنظیمات موردنیاز (متغیرهای محیطی)

| متغیر | پیش‌فرض | توضیح |
| --- | --- | --- |
| `NEXTCLOUD_MODE` | `simulation` | `live` برای اتصال واقعی به drive.abrit.cloud |
| `NEXTCLOUD_BASE_URL` | live: `https://drive.abrit.cloud` — sim: `http://127.0.0.1:3031` | آدرس Nextcloud (بدون اسلش انتهایی) |
| `NEXTCLOUD_ADMIN_USER` | sim: `abrit-portal-admin` | نام کاربری مدیر OCS |
| `NEXTCLOUD_ADMIN_APP_PASSWORD` | sim: `abrit-simulation-app-password` | App Password (Nextcloud → Settings → Security) |
| `NEXTCLOUD_TIMEOUT_MS` | `8000` | مهلت هر فراخوانی |
| `NEXTCLOUD_ALLOW_INSECURE` | `false` | فقط برای تست روی HTTP |
| `DRIVE_LOGIN_URL` | live: `https://drive.abrit.cloud/login` — sim: `/login?XTransformPort=3031` | لینک «ورود به Drive» در پنل |

شبیه‌ساز (`mini-services/nextcloud-mock`) با `MOCK_ADMIN_USER` / `MOCK_ADMIN_PASSWORD` هم‌مقدارِ
پیش‌فرض‌های بالا اجرا می‌شود و روی درگاه ۳۰۳۱ کار می‌کند.

---

## ۵. نتیجه تست‌ها (معیارهای پذیرش راهنما)

تست‌ها در حالت شبیه‌سازی (OCS یک‌به‌یک مطابق Nextcloud واقعی) با ابزار خودکار مرورگر + curl انجام شد:

| # | معیار / سناریو | نتیجه |
| --- | --- | --- |
| ۱ | ایجاد کاربر از طریق فرم پنل (ثبت‌نام → فرم فعال‌سازی) | موفق — حساب در Nextcloud ساخته شد |
| ۲ | ورود به Nextcloud با نام کاربری/رمز تعیین‌شده توسط کاربر | موفق — صفحه فایل‌ها با خوش‌آمد و سهمیه |
| ۳ | سهمیه ۱۰۰ مگابایت (پلن آزمایشی) | موفق — «۱۰۰ MB» در سرور و پنل؛ نوار مصرف ۰٪ |
| ۴ | تغییر حجم از پنل (آزمایشی → استاندارد ۲۵GB) | موفق — سمت سرور «۲۵.۰ گیگابایت» تأیید شد |
| ۵ | درخواست تکراری همان کاربر | `ALREADY_LINKED` (۴۰۹) — حساب جدید ساخته نشد |
| ۶ | نام کاربری تکراری از کاربر دیگر | `USERNAME_TAKEN` (۴۰۹) + خطای فیلد در فرم |
| ۷ | نام کاربری/رمز نامعتبر | `INVALID_USERNAME` / `INVALID_PASSWORD` با پیام فارسی |
| ۸ | قطع/خطای اتصال | `unreachable` با پیام ثابت «سرور Drive در دسترس نیست.» (بدون جعل وضعیت) |
| ۹ | اعتبارنامه ردشده (401/403) | `auth_failed` — «اعتبارنامه Drive پذیرفته نشد.» |
| ۱۰ | فعال/غیرفعال‌سازی از پنل | موفق — ورودِ حساب غیرفعال در Nextcloud رد شد (۴۰۳) و پس از فعال‌سازی مجدد، ۳۰۳ |
| ۱۱ | نمایش فضای مصرف‌شده و کل | موفق — آپلود آزمایشی ۵MB → پنل پس از همگام‌سازی «۵ مگابایت از ۱۰۰ مگابایت — ۵٪» |
| ۱۲ | رابط کاربری | راست‌به‌چپ، فارسی، واکنش‌گرا (بدون اسکرول افقی در ۳۹۰px)، فوتر چسبان، بدون خطای کنسول/hydration |

خروجی لاگ سرور Drive (شبیه‌ساز) در طول تست:
`user created: mohammad.rezaei` → `web login` → `disabled` → `enabled` → `web login` → `user created: zahra.karimi`

> برای اجرای همین تست‌ها روی **سرویس واقعی**: `NEXTCLOUD_MODE=live` + اعتبارنامه مدیریتی را تنظیم کنید و
> سناریوهای ۱ تا ۱۱ را تکرار کنید؛ کد و پروتکل هیچ تغییری نمی‌خواهد.

---

## ۶. اتصال واقعی به drive.abrit.cloud (گام‌به‌گام)

1. در Nextcloud یک «حساب مدیریتی اختصاصی پنل» بسازید (یا از حساب admin استفاده کنید) و از
   `Settings → Security` یک **App Password** بسازید؛ دسترسی آن را به حداقل لازم (مدیریت کاربران) محدود کنید.
2. `.env.local` پروژه را این‌گونه تنظیم کنید:
   ```ini
   NEXTCLOUD_MODE=live
   NEXTCLOUD_BASE_URL=https://drive.abrit.cloud
   NEXTCLOUD_ADMIN_USER=<نام کاربری>
   NEXTCLOUD_ADMIN_APP_PASSWORD=<app-password>
   DRIVE_LOGIN_URL=https://drive.abrit.cloud/login
   ```
3. یک حساب آزمایشی با سهمیه ۱۰۰ مگابایت از پنل بسازید (پلن آزمایشی) و ورود به `https://drive.abrit.cloud`
   را با همان نام کاربری/رمز بررسی کنید.
4. سهمیه را از پنل به «استاندارد» (۲۵GB) تغییر دهید و در Nextcloud (فایل‌ها → سهمیه) تأیید کنید.

---

## ۷. نگاشت به پنل Orchard (برای انتقال به پروژه Abrit-Orchard)

| مفهوم در این پنل (Next.js) | معادل در Orchard |
| --- | --- |
| `src/lib/nextcloud/client.ts` | سرویسی مشابه `DriveStatusService` با `HttpClient` تایپ‌شده؛ هدرها همان است |
| `AbrITDriveOptions` | `NextcloudOptions` جدید با `Mode/Base/AdminUser/AppPassword/TimeoutSeconds` |
| `DriveAccount` (Prisma) | Content Part/YesSql record روی `ContentItem.Owner` (stable user id) |
| `/api/drive/*` | Controller با `[Authorize]` + `ValidateAntiForgeryToken` (الگوی موجود `DriveController`) |
| `DriveEvent` | جدول/outbox جدا برای audit (الگوی SmsOutbox) |
| پیام‌های ثابت فارسی | همان سیاست «جزئیات ثابت، بدون نشت» مستند در SECURITY.md |
| وضعیت‌های صادقانه | همان NotConfigured/Unreachable + Ready با داده واقعی |

نکته مهم: پیاده‌سازی فعلی Orchard (WebDAV + پوشه زیر حساب فنی) با معماری «حساب کاربری واقعی در
Nextcloud» (الزام راهنمای اتصال) جایگزین می‌شود؛ WebDAV می‌تواند برای گزارش سریع سهمیه باقی بماند اما
منبع حقیقت، OCS است.

---

## ۸. ورود یکپارچه (SSO)

خارج از دامنه این نسخه (طبق راهنما). گزینه‌های آینده: OAuth2/OIDC provider در Nextcloud، یا SAML؛
در آن صورت پنل نقش IdP را بازی می‌کند و کاربر بدون ورود مجدد به Drive می‌رسد. تا آن زمان، کاربر با
نام کاربری/رمز مستقل Drive وارد می‌شود و پنل به آن دسترسی ندارد.

---

## ۹. محدودیت‌ها و گام‌های بعدی

- خرید/پرداخت پلن‌ها (درگاه‌های Mellat/ZarinPal/Zibal مستند شده) در نسخه کامل پنل فعال می‌شود؛ اکنون
  انتخاب پلن فقط سهمیه را تعیین می‌کند.
- تأیید ایمیل ثبت‌نام پنل نیازمند SMTP واقعی است (در نسخه Orchard با pickup توسعه‌ای تست شده).
- سهمیه پلن «پایه» (تعارض سند پکیج‌ها) باید واحد تجاری نهایی کند؛ نگاشت در `src/lib/drive/plans.ts`.
- برای مقیاس بزرگ: صف پس‌زمینه برای provisioning + retry (الگوی BackgroundJobs/SmsOutbox در Orchard)
  و قفل توزیع‌شده توصیه می‌شود.

---

## پیوست: فایل‌های مرجع

- `src/lib/nextcloud/*` — کلاینت OCS
- `src/lib/drive/service.ts` — ارکستریشن و جریان idempotent
- `mini-services/nextcloud-mock/index.ts` — شبیه‌ساز (پروتکل یک‌به‌یک با Nextcloud 35)
- `prisma/schema.prisma` — مدل داده
- `src/app/page.tsx` + `src/components/panel/*` — رابط پنل
- مستند رسمی: https://docs.nextcloud.com/server/stable/admin_manual/configuration_user/user_provisioning_api.html

---

## ۷. افزونه‌های این نسخه (۱۴۰۵ — پس از ممیزی کامل)

### ۷.۱ کاتالوگ تجاری و موتور قیمت‌گذاری (جديد)

- منبع واحد مقادیر تجاری: `src/lib/commerce/catalog.ts` — عیناً از سند نهایی
  «پکیج‌های خدمات مدیریت‌شده — تعرفه ۱۴۰۵» (قیمت‌ها، ظرفیت User/Endpoint/Server/Site،
  SLA، کاربر و Endpoint اضافه، فضای ابری هر پکیج).
- قراردادها: فقط ۳/۶/۱۲ ماهه با تخفیف ۳٪/۵٪/۸٪ (فقط روی قیمت پایه) و Onboarding
  ۵۰٪/۲۵٪/رایگان. قرارداد یک‌ماهه در هیچ لایه‌ای وجود ندارد.
- بیش از ۴۰ کاربر یا ۶۰ Endpoint: به‌جای عدد، پیام «برآورد جداگانه (Enterprise Custom)»
  بازگردانده می‌شود (هیچ عددی از جنس اختراع نمی‌شود).
- محاسبه پیش‌فاکتور فقط سمت سرور: `POST /api/commerce/quote` — خروجی شامل ریز اقلام،
  معادل ماهانه، و «اسنپ‌شات تغییرناپذیر» با `quoteId` و چک‌سام SHA-256 است تا در
  چرخه سفارش آینده قابل راستی‌آزمایی باشد. پرداخت آنلاین در این نسخه صریحاً غیرفعال است.
- کاتالوگ از `GET /api/commerce/catalog` سرو می‌شود؛ هیچ مقدار تجاری در جاوااسکریپت
  سمت کاربر تکرار نشده است.

### ۷.۲ بازیابی رمز عبور پنل (جديد)

- گرنت‌های بازیابی در پایگاه‌داده ماندگارند (مدل `RecoveryGrant`): کد ۶ رقمی فقط به
  صورت هش SHA-255 ذخیره می‌شود؛ اعتبار ۱۰ دقیقه؛ یک‌بار مصرف؛ شمارنده تلاش با
  UPDATE شرطی (حداکثر ۵ بار)؛ مصرف گرنت + تغییر رمز + ابطال نشست‌ها در یک تراکنش.
- نرمال‌سازی ارقام فارسی/عربیِ کد، سمت سرور انجام می‌شود.
- پاسخ عمومی برای ایمیل‌های ناشناس و شناخته‌شده یکسان است (افشای وجود حساب ندارد).
  استثنای مستندشده: در حالت نمایشی (RECOVERY_DELIVERY_MODE=display، پیش‌فرض این
  محیط) کد یک‌بار برای حساب موجود نمایش داده می‌شود؛ در محیط عملیاتی باید
  `RECOVERY_DELIVERY_MODE=email` تنظیم شود تا کد هرگز در پاسخ API ظاهر نشود.
- محدودیت نرخ: حداکثر ۳ گرنت به‌ازای هر ایمیل و ۱۰ گرنت به‌ازای هر IP (هش‌شده)
  در پنجره ۱۵ دقیقه‌ای.

### ۷.۳ انیمیشن و دسترسی‌پذیری (جديد)

- زیرساخت مشترک: `src/components/panel/motion.tsx` (Reveal، Stagger، AnimatedNumber).
- `<MotionConfig reducedMotion="user">` سراسری + قاعده CSS برای
  `prefers-reduced-motion` — همه انیمیشن‌ها برای کاربرانِ «کاهش حرکت» به تغییر لحظه‌ای
  تبدیل می‌شوند.
- وضعیت‌های «در حال ایجاد حساب» و «در حال اعمال سهمیه» با نوار پیشرفت نامعین
  (indeterminate) پیاده شده‌اند — هیچ مرحله‌ای جعلی «تکمیل‌شده» نشان داده نمی‌شود.
- گروه‌های انتخاب پکیج/مدت با RadioGroup واقعی Radix (پیمایش با کلیدهای جهت‌دار)؛
  هیچ عنصر تعاملی تو در تو وجود ندارد.

### ۷.۴ نتیجه تست‌های پذیرش این نسخه (اجرا‌شده — ۱۴۰۵/۰۸/۲۲)

| سناریو | نتیجه |
| --- | --- |
| ثبت‌نام پنل → ورود → داشبورد | موفق |
| بازیابی رمز: صدور کد → تغییر رمز → ورود با رمز جدید / رد رمز قدیم (۴۰۱) / تلاش مجدد کد مصرف‌شده (۴۰۵ منقضی) | موفق |
| فعال‌سازی Drive (پلن آزمایشی): کاربر `e2e.drive.user` با سهمیه دقیق ۱۰۴٬۸۵۷٬۶۰۰ بایت (۱۰۰MB) + ایمیل + نام نمایشی روی Nextcloud | موفق |
| ورود به AbrIT Drive با همان اعتبارنامه (وب شبیه‌سازی) + آپلود آزمایشی ۵MB | موفق |
| همگام‌سازی مصرف: ۵MB از ۱۰۰MB به‌صورت زنده در پنل | موفق |
| تغییر سهمیه از پنل (آزمایشی→پایه ۱۰GB→سازمانی ۱۰۰GB): اعمال فوری روی سرور | موفق |
| غیرفعال‌سازی حساب: enabled=false روی سرور، ورود به Drive با ۴۰۳ رد شد؛ فعال‌سازی مجدد موفق | موفق |
| درخواست تکراری فعال‌سازی: ۴۰۹ ALREADY_LINKED (هیچ حساب تکراری ساخته نشد) | موفق |
| تضاد نام کاربری بین دو کاربر پنل: ۴۰۹ USERNAME_TAKEN | موفق |
| قطع سرور Drive → وضعیت صادقانه «در دسترس نیست» → اتصال مجدد → ready | موفق |
| محاسبه‌گر قیمت: Essential/۱۲ماه/۲ Endpoint اضافه = ۱۵۵٬۴۰۰٬۰۰۰ − ۱۲٬۴۳۲٬۰۰۰ + ۱۸٬۹۶۰٬۰۰۰ = ۱۶۱٬۹۲۸٬۰۰۰ تومان (مطابق جدول سند) | موفق |
| موبایل ۳۹۰px: بدون سرریز افقی؛ منوی موبایل؛ پابرگ چسبیده | موفق |
| خطای کنسول/هیدریشن در کل سناریوها | صفر |

تصاویر شاهد: `docs/ui-review/` (hero-pricing، dashboard-ready-desktop، drive-login، mobile-390، desktop-1440).
