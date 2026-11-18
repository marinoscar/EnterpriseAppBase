---
"@marinoscar/platform-contract": minor
---

Add the grant shapes to `@marinoscar/platform-contract/sharing` (#729): the create, update, list and "shared with me" schemas of `/api/grants` (user and group grantees), the link-grant shapes #730 builds on (`linkGrantCreateSchema`, `linkGrantViewSchema`, `publicLinkResolutionSchema`), the zod-free `GRANT_GRANTEE_KINDS`, `ACCESS_SCOPES`, `SHARED_WITH_ME_VIA`, `SHARING_IDENTIFIER_PATTERN`, `LINK_TOKEN_HEADER` (`x-link-token`) and `buildLinkUrl(appUrl, token)`, which puts the token in the URL fragment (`/s#<token>`).
