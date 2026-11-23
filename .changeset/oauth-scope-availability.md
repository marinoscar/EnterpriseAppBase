---
"@marinoscar/platform-api": minor
---

Let an app tie a registered OAuth scope to a runtime condition: `OAuthScopeDefinition.available?(ctx)`, with `ctx` typed `OAuthScopeAvailabilityContext` (`{ userId?: string; orgId?: string | null }`), and the exported helper `availableScopes(scopeIds, ctx)` of `@marinoscar/platform-api/identity`. An unavailable scope is left out of `scopes_supported` in both metadata documents, dropped at `/authorize` (`invalid_scope` when nothing other than `offline_access` is left), hidden on the consent page, never granted by the decision, and confers no permission at token resolution; the grant row keeps it, so the scope works again when the predicate returns `true`. The predicate fails closed (only a literal `true` counts; a throw or rejection makes the scope unavailable, with one warning naming the scope ids and never the context) and runs once per request at token resolution. `buildAuthorizationServerMetadata` and `buildProtectedResourceMetadata` stay synchronous and take an optional `availableScopeIds`.

Additive: an app that defines no predicate sees no change.
