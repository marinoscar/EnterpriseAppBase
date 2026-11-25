---
"@marinoscar/platform-api": minor
---

Core seams for link shares (#730): `PlatformAccessPort.allowPublic` (optional; the app's marker for a deliberately public route, validated by `definePlatformHost`), the `link-resolution` `SystemAccessReason` (one `grants` row by its token hash), and the secret cipher no longer caches the sub-key of a purpose containing `:` (row-bound domains such as `sharing.link:<grantId>`, like the per-user ones), so the cache cannot grow with the number of rows. The derivation is unchanged.
