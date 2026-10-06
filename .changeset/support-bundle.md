---
"@marinoscar/platform-contract": minor
"@marinoscar/platform-api": minor
"@marinoscar/platform-web": minor
---

Add the support bundle: `@marinoscar/platform-contract/doctor` (`supportBundleSchema`), `GET <doctor path>/support-bundle` with `SupportBundleRegistry`, `SupportBundleService` and redaction rules v1 in `@marinoscar/platform-api/doctor`, and the "Download support bundle" button and `useSupportBundleDownload` hook in `@marinoscar/platform-web/doctor` (plus the optional `PlatformApiClient.getBlob`).
