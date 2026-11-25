---
"@marinoscar/platform-db": minor
---

Identity: `PersonalAccessToken` is now marked `// @extensible`, so an app fragment can declare the back-relation of a foreign key to `personal_access_tokens` (for example a device row that records the token it paired with) with `extend model PersonalAccessToken { ... }`. Marker only: no column, key or index changes, no migration.
