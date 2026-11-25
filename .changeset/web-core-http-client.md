---
'@marinoscar/platform-web': minor
---

Add `PlatformHttpClient` and `ApiError` to `@marinoscar/platform-web/core`: the browser transport (access-token holder, one-shot refresh and retry, cross-page refresh lock, session-expired signal) moved from the reference app, with the API base, the refresh lock name and an error-response hook as options (experimental; `ApiError` stable).
