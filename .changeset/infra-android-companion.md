---
"@marinoscar/platform-infra": minor
---

Ship the Android companion's infra: the `platform/android-app.conf` nginx snippet (`/.well-known/assetlinks.json`, the unbuffered APK upload and download routes), and `android/platform-core`, a Kotlin Android library module distributed as files (TWA launcher, server configuration, device-flow pairing, encrypted token store, API client, app updates, notification-permission rules, and `identity.gradle.kts` deriving the Android identity from `identity.json`). An app includes it from `settings.gradle.kts` with `include(":platform-core")`.
