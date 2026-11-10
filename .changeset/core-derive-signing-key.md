---
"@marinoscar/platform-api": minor
---

Export `deriveSigningKey(purpose)` from `@marinoscar/platform-api/core`: a 32-byte HMAC key derived from `SECRETS_ENCRYPTION_KEY` under the permanent label `enterpriseappbase:signing-key:v1:`, byte-identical to the app-side copy it replaces (#822).
