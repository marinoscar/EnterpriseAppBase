# @marinoscar/platform-contract/identity

The wire shapes of identity: the closed set of sign-in failure codes, `GET /api/auth/me`, the access-token responses, personal access tokens, the device authorization flow (RFC 8628), and organization, member and invitation administration, as zod schemas plus their inferred types and zod-free constants. `@marinoscar/platform-api/identity` wraps the request schemas as its nestjs-zod DTOs (so the OpenAPI document is generated from them); the web app takes its types and the sign-in error codes from here. Added by issue #727 (PP-6.6); it depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One source for what the identity routes send and accept, so the API and the web app can no longer drift apart. The pain it removes: the sign-in error codes were kept in step by hand between the API (`auth-error-codes.ts`) and the web app (`signInErrorContent.ts`); both now import `AUTH_ERROR_CODES` from here.

The slice follows the contract layout: `constants.ts` (zod-free: the error codes, tenancy modes, assignable org roles, statuses, the personal-access-token limits and the device-flow codes), `schemas.ts` (request and response schemas, inferred types) and `index.ts`.

Two kinds of schema live here:

- **Request schemas** (`switchOrgSchema`, `createPatSchema`, the device-flow requests, the organization, member and invitation bodies and queries) moved here verbatim from the API's DTO files. The API's DTOs wrap them, so their field order, messages, `.describe()` texts and enum orders are part of the published OpenAPI document.
- **Response schemas** of routes whose OpenAPI is documented by `@ApiProperty` classes (`currentUserSchema`, `tokenResponseSchema`, the personal-access-token and device-flow responses) describe the same payload for clients. The organization response schemas are the OpenAPI source themselves.

Not here: the routes, services, guards and decorators (`@marinoscar/platform-api/identity`), the users and allowlist DTOs (API-only), and the sign-in error copy (presentation, in the web app).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { AUTH_ERROR_CODES, currentUserSchema } from '@marinoscar/platform-contract/identity';
import type { AuthErrorCode, CurrentUser } from '@marinoscar/platform-contract/identity';
```

None beyond the package's own peer, `zod` (`^4.4.3`). A browser that imports only the constants and the types never bundles `zod`: the package is `"sideEffects": false` and `constants.ts` imports no zod.

## Quick start

The web slice keys its sign-in error copy off the contract's list ([`sign-in-error-content.ts`](../../../platform-web/src/identity/ui/sign-in-error-content.ts) of `@marinoscar/platform-web/identity/ui`), so a new code is a type error there until it has copy:

```ts
import { AUTH_ERROR_CODES, DEFAULT_AUTH_ERROR_CODE, isAuthErrorCode } from '@marinoscar/platform-contract/identity';

export function resolveSignInErrorCode(value: string | null | undefined) {
  return isAuthErrorCode(value) ? value : DEFAULT_AUTH_ERROR_CODE;
}
```

The API integration test proves the `/api/auth/me` wire matches the contract exactly ([`auth.integration.spec.ts`](../../../../apps/api/test/auth/auth.integration.spec.ts)):

```ts
import { currentUserSchema } from '@marinoscar/platform-contract/identity';

// Extended in app code, never edited: refuse any field the contract does not declare.
currentUserSchema.strict().parse(response.body.data);
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `currentUserSchema` | schema | `ZodObject<{ id; email; displayName; profileImageUrl; providerProfileImageUrl; hasUploadedProfileImage; isActive; roles; permissions; tenancyMode; activeOrg; memberships }>` | Validate or `.extend()` the `/api/auth/me` payload in app code (a stricter test, an app-side field on the client) | stable | [example](../../../../apps/api/test/auth/auth.integration.spec.ts) |

Supporting exports (stable):

- Constants: `AUTH_ERROR_CODES` (the closed sign-in failure set, the single source), `DEFAULT_AUTH_ERROR_CODE`, `isAuthErrorCode()`, `TENANCY_MODES`, `ASSIGNABLE_ORG_ROLES`, `ORG_SLUG_PATTERN`, `ORG_MEMBER_STATUSES`, `ORG_INVITE_STATUSES`, `PAT_DURATION_UNITS`, `PAT_LIMITS`, `DEVICE_TOKEN_TYPES`, `DEVICE_USER_CODE_PATTERN`, `DEVICE_TOKEN_ERROR_CODES`, `DEVICE_SESSION_STATUSES`, and their union types.
- Sign-in: `authErrorCodeSchema`, `authProviderSchema` (`name`, `enabled`, and `mode: 'custom'` for a provider that owns its sign-in flow), `authProvidersResponseSchema`, `authRoleSchema`, `activeOrgSchema`, `authMembershipSchema`, `tokenResponseSchema`, `switchOrgSchema`.
- Personal access tokens: `createPatSchema`, `patCreatedResponseSchema`, `patListItemSchema`.
- Device flow: `deviceTokenTypeSchema`, `deviceClientInfoSchema`, `deviceCodeRequestSchema`, `deviceCodeResponseSchema`, `deviceTokenRequestSchema`, `deviceTokenResponseSchema`, `deviceTokenErrorSchema`, `deviceAuthorizeRequestSchema`, `deviceAuthorizeResponseSchema`, `deviceActivateResponseSchema`, `deviceSessionSchema`, `deviceSessionsResponseSchema`.
- Organizations: `organizationListQuerySchema`, `createOrganizationSchema`, `renameOrganizationSchema`, `organizationResponseSchema`, `orgMemberListQuerySchema`, `updateOrgMemberSchema`, `orgMemberResponseSchema`, `orgInviteListQuerySchema`, `createOrgInviteSchema`, `orgInviteResponseSchema`.
- One inferred type per schema (`CurrentUser`, `TokenResponse`, `CreatePatRequest`, `DeviceTokenResponse`, `OrgMemberResponse`, ...).

## Data

None. The schemas describe HTTP payloads; the identity tables are `@marinoscar/platform-db`'s identity fragment.

## Permissions and settings

None. The routes these payloads travel on are gated by `@marinoscar/platform-api/identity`.

## UI

None. The web app renders sign-in errors from its own copy, keyed by `AUTH_ERROR_CODES`.

## Infra

None. Schemas read no environment variable and ship no deployment configuration.

## Observability

None. Validation is pure.

## Security notes

- `AUTH_ERROR_CODES` is a CLOSED set on purpose: the sign-in redirect carries a code, never free text, so nobody can craft a link that renders attacker-chosen copy on a trusted origin. A client shows `DEFAULT_AUTH_ERROR_CODE` for anything it does not recognise and never echoes the raw value.
- `deviceClientInfoSchema` describes input from an UNAUTHENTICATED caller that is later shown to a human; treat every field as hostile at the point of use.
- `createOrgInviteSchema` and `updateOrgMemberSchema` are `.strict()` and take no org id: the organization always comes from the signed token.
- Never loosen a schema here to accept a payload the API would not send; an app that needs more extends the schema in its own code.

## Conformance suite

None. The slice ships no conformance suite; `test/identity.test.ts` and `test/dual-format.test.ts` cover the schemas and both module formats, `@marinoscar/platform-api` pins that each `@ApiProperty` response class declares the fields of its contract schema, and the app's integration test parses the live `/api/auth/me` with `currentUserSchema.strict()`.

## Upgrade notes

New in this release (#727). The request schemas moved here from the API's DTO files (`switch-org.dto.ts`, `create-pat.dto.ts`, the device-flow request DTOs and the organization DTOs); the API re-exports them under their old names, so no import has to change. The web app's `SIGN_IN_ERROR_CODES` is now `AUTH_ERROR_CODES` itself. The generated OpenAPI document is unchanged.

## Troubleshooting

- **A type error in the web app's sign-in copy after an upgrade.** A sign-in error code was added to `AUTH_ERROR_CODES`; give it copy.
- **`currentUserSchema.strict()` fails in an app test.** The API returns a field the contract does not declare (or the reverse): the contract and the `@ApiProperty` class drifted. Fix the contract, never loosen the test.

## Links

- [Package README](../../README.md): the contract conventions
- [Security architecture](../../../../docs/SECURITY-ARCHITECTURE.md): sessions, credential kinds and the allowlist
- [Device authorization](../../../../docs/DEVICE-AUTH.md) and [personal access tokens](../../../../docs/personal-access-tokens.md)
