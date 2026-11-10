---
"@marinoscar/platform-db": minor
"@marinoscar/platform-contract": minor
"@marinoscar/platform-api": minor
"@marinoscar/platform-web": minor
---

Add STATE and COUNTED inbox notifications (#1077). `NotificationsService.notifyState` keeps ONE live inbox row per user, event and scope, refreshed in place and dismissed when its count drains to zero; `notifyCounted` folds repeated occurrences into one row whose `data.count` grows, optionally inside a rolling window and partitioned by a match object. Both serialize on a transaction-scoped advisory lock, and the database backs them with the partial unique index `notifications_live_dedup_uniq_idx`. Platform migration `0041_notifications_state_counted` adds `data`, `scope_id`, `dismissed_at`, `updated_at` and `dedup_key` to `notifications` (all additive). The inbox gains a Dismiss action (`POST /api/notifications/:id/dismiss`), list and unread count exclude dismissed rows, the wire shape gains `count`, `scopeId`, `dismissedAt` and `updatedAt`, and the retention sweep removes read and dismissed rows by age while STATE and COUNTED rows that are unread are never purged by age. Plain `notify()` is unchanged.
