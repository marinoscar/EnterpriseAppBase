---
"@marinoscar/platform-api": minor
"@marinoscar/platform-contract": minor
"@marinoscar/platform-web": minor
---

Add the email slice: `@marinoscar/platform-api/email` (`EmailModule.forRoot`, the SES and SMTP transports with inline attachments, the `email` settings row on `SystemSettingsRowStore`, the template registry with `EmailTemplateDataMap` augmentation and explicit overrides, the layout theme and brand-mark slot, the safe-HTML helpers, the `email` conformance suite at `/email/testing`), `@marinoscar/platform-contract/email` (the admin route DTOs) and `@marinoscar/platform-web/email` (`useEmailSettings`, `EmailSettingsPage`); `SystemSettingsRowStore.write` accepts `auditMeta`, and `PlatformViewer` an optional `email`.
