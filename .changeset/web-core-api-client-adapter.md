---
"@marinoscar/platform-web": minor
---

Add `createPlatformApiClient(http, { postSse? })` to `@marinoscar/platform-web/core`: the adapter from the app's one `PlatformHttpClient` to the `PlatformApiClient` every packaged page calls (the `ApiError` to `PlatformApiError` mapping, `If-Match`, extra headers first, `getBlob`/`postBlob` as `blobWithHeaders`), with `toPlatformApiError` and `toHttpRequestOptions`. Moved from the reference app's platform host.
