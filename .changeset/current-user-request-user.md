---
"@marinoscar/platform-api": patch
---

Identity: `@CurrentUser()` always yields a `RequestUser`. On a bare `@Auth()` route (no `roles` or `permissions`) no guard sets `request.requestUser`, so the decorator returned the raw user graph from `request.user`; it now converts that graph with `toRequestUser` (the new `requestUserOf(request)` helper does the same for any code that reads the request directly). Routes that list permissions are unchanged.
