# Native Companion Architecture (PWA in a TWA plus a native module)

> **Status:** in progress (#746, PP-9.4). The full spec lands with the Android companion slice.

## Data

- `android_app_releases`: the APKs a deployment hosts, `@@unique([packageName, versionCode])`.
- `android_app_releases_one_current_uniq_idx`: a raw-SQL partial unique index (`ON android_app_releases ((true)) WHERE is_current`), at most one current release deployment-wide. Intentional schema drift: Prisma cannot express it; never declare it as `@@unique` and never replace it with a `findFirst` pre-check.
- `push_subscriptions.platform`: `browser` (default) or `android_app`, with the CHECK constraint `push_subscriptions_platform_check`.
