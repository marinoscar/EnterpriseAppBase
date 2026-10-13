---
"@marinoscar/platform-api": minor
"@marinoscar/platform-contract": minor
"@marinoscar/platform-web": minor
---

Open the two places sharing hard-coded (PP-14.16, #934): who a grant can name, and how a decision is made.

`@marinoscar/platform-api/sharing`: `registerGranteeKind(GranteeKindDef)` and `registerAccessRule(AccessRuleDef)`. The built-in `user`, `group` and `link` kinds register through `registerGranteeKind` (no private fast path); `AccessPolicy`, `accessibleWhere`, `accessibleSql` and `POST /api/grants` compose the registry, with behaviour and SQL shape unchanged for the built-ins. A kind supplies `validateGrantee`, `describe` and the in-memory (`matchesPrincipal`) and SQL (`resolvePrincipalMatch`, parameterised through the app's SQL kit) spellings of one predicate. An access rule joins the documented order (owner and bypass first, rules `before-grants`, grants, rules `after-grants`, the org default): `deny` from any rule wins, a failing rule denies (logged with the rule id only), the record's user owner and a bypass holder are decided before the rules, and an allow confers a `role` (default the weakest). A rule gives `sql({ allow?, deny? })` so lists agree with decisions; a rule that can deny (`mayDeny`) must. `AccessVia` is open (`BuiltinAccessVia | (string & {})`), and the decision counter's `via` label gains `app`. `GET /api/sharing/grantee-kinds` (`sharing:read`) serves the registered kinds. `POST /api/grants` accepts `{ kind: 'custom', granteeKind, ref }` and answers 422 `GRANTEE_KIND_UNKNOWN`, `GRANTEE_INVALID` or `GRANTEE_KIND_NOT_PERSISTABLE`. New kits in `@marinoscar/platform-api/sharing/testing`: `describeGranteeKindConformance`, `describeAccessRuleConformance`, `recordingSqlKit`, `HOSTILE_STRINGS`.

A grant of an app-registered kind cannot be stored yet: `grants.grantee_kind` is an enum, so `registerGranteeKind` refuses `persisted: true` for a non-built-in kind until the sharing storage migration (tracked with the group-role migration) ships. No migration in this change.

`@marinoscar/platform-contract/sharing`: `BUILTIN_GRANTEE_KINDS`, `GRANTEE_KIND_ID_PATTERN`, `GRANTEE_KIND_INPUTS`, `granteeKindDescriptorSchema`, `granteeKindListSchema`, `customGranteeSchema` (a third `grantGranteeInputSchema` variant; the `user` and `group` shapes keep their validation), `SHARING_LIMITS.granteeRefMax`. `GRANT_GRANTEE_KINDS` is unchanged (the stored vocabulary).

`@marinoscar/platform-web/sharing`: `registerGranteePicker(kind, Component)`, `freezeGranteePickers()`, `useGranteeKinds()`, `SharingClient.listGranteeKinds`, `ShareActions.shareWithGrantee` and the `granteePickers` prop of `ShareDialog`. The dialog offers each non-built-in kind a grant can be stored for as one more choice (a text field, or the registered picker); the DOM is unchanged when only the built-ins are listed.
