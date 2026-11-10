---
"@marinoscar/platform-db": minor
---

Add the `android-app` fragment (`AndroidAppRelease`, `sizeBytes` BigInt), `push_subscriptions.platform` and platform migration `0033_add_android_app` with the raw-SQL partial unique index `android_app_releases_one_current_uniq_idx` (listed in `raw-sql-indexes.json`) (#746).
