---
"@marinoscar/platform-contract": minor
---

Add `@marinoscar/platform-contract/identity` (#727): `AUTH_ERROR_CODES` as the single source of the sign-in failure codes (the API and the web app both import it), the `/api/auth/me`, token, personal-access-token and device-flow response schemas, and the request schemas of switch-org, personal access tokens, the device flow and organization administration, moved verbatim from the API's DTO files. Zod-free constants for the error codes, tenancy modes, org roles and statuses. Stability: `stable`. No wire or OpenAPI change.
