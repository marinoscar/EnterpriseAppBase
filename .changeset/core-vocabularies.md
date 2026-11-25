---
"@marinoscar/platform-api": minor
"@marinoscar/platform-web": minor
---

Open the access-reason, principal/credential-kind and error-code vocabularies, and let an extension package declare a web host port (PP-14.14, #932).

`@marinoscar/platform-api/core`: `registerSystemAccessReason({ id, description })` and `systemAccessReasonRegistry`; the platform's nine reasons register through it. `SystemAccessReason` is `BuiltinSystemAccessReason | (string & {})` and the bypass entry points (`forSystem`, `runAsSystem`, `systemScopeExtension`) check the registry, so an unregistered reason still throws `ScopedAccessError`. Opening which reason does not open who may bypass: the system-client injection allowlist is unchanged. `SYSTEM_ACCESS_REASONS` stays as a deprecated alias of `BUILTIN_SYSTEM_ACCESS_REASONS`.

`PrincipalKind` and `CredentialKind` are `keyof` the augmentable `PrincipalKinds` and `CredentialKinds` interfaces (unaugmented, exactly the old unions; the closed originals are `BuiltinPrincipalKind` and `BuiltinCredentialKind`), with `registerPrincipalKind`, `registerCredentialKind`, `requireCredentialKind` and `UnknownCredentialKindError`. Unknown means denied: `toPrincipal` of the identity slice answers 401 for a credential kind that is not registered, or whose principal kind has no factory there, and a custom kind never becomes a node principal.

`registerErrorCode({ code, status, description })` and `errorCodeRegistry` (the ten status-derived codes plus `PAYLOAD_TOO_LARGE` register through it). `HttpExceptionFilter` passes a thrown payload's `code` through only when it is registered for the exception's own status; every other response is unchanged. `ErrorMapper` and `PlatformHostCoreModule.forRoot({ errorMappers })` map a foreign error (a Prisma `P2002`) to an `HttpException`; mappers see only values that are not already an `HttpException`, and the foreign error's message is never copied into the response. OpenAPI: `ErrorDto.code` changes from a closed enum to a string whose `examples` list every registered code (the only difference in `openapi.json`). `describeVocabularyConformance` (`@marinoscar/platform-api/core/testing`) is the kit.

`@marinoscar/platform-web/core`: `PlatformWebHost.extensions` (an optional record of ports keyed by string or symbol), `usePlatformPort<T>(key)` (throws, naming the key, when the app did not supply it) and `useOptionalPlatformPort<T>(key)`; `createTestPlatformHost({ extensions })`.

Migration: none for an app that registers nothing. Code that relied on `toPrincipal` treating an unregistered credential kind as a user now gets a 401.
