---
"@marinoscar/platform-api": patch
---

Correct two comments and the core README: the app no longer ships a pino `LoggerService`, so packaged code's `new Logger(Context)` reaches the app's logger only when the app sets one with `app.useLogger`.
