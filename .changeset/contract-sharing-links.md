---
"@marinoscar/platform-contract": minor
---

Link-share wire shapes in `@marinoscar/platform-contract/sharing` (#730): `issuedLinkGrantSchema` (the create response, carrying the token once), `linkGrantListSchema`, `LINK_TOKEN_PREFIX` and `LINK_TOKEN_PATTERN`; `linkGrantCreateSchema` takes an optional `role` (the weakest link role) and `reuseActive`, and `updateGrantSchema` an optional link `label`.
