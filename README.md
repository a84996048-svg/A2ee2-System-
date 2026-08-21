# بوت نظام النقاط والأمان

هذا المشروع هو بوت Discord يدعم:

- نظام Access كامل
- نظام النقاط ومتابعة الـ Top
- أذونات رتب النقاط
- إدارة الرتب وحماية الترتيب
- قفل/فتح الروم
- تسجيل العمليات المهمة في روم اللوج
- أوامر Slash وPrefix

## الإعداد السريع

1. انسخ الملف `.env.example` إلى `.env`
2. املأ بيانات البوت:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GUILD_ID`
3. شغّل المشروع:

```bash
npm install
npm start
```

## ملف التهيئة

كل إعدادات البوت موجودة في:

- `src/config.js`

يمكنك تعديل:

- `ownerId`
- `access.users`
- `roles.pointsManager`
- `roles.pointsReceiver`
- `logs.channelId`
- `points.minimum`
- `commands.prefix`
- رسائل الأخطاء

## الملاحظات

- نظام Access يمنع أي مستخدم لا يوجد في القائمة من استخدام البوت.
- صاحب البوت `ownerId` لديه صلاحية كاملة.
- النقاط تحفظ في قاعدة بيانات JSON داخل مجلد `data`.
- لا يمكن أن تصبح النقاط أقل من الصفر.
