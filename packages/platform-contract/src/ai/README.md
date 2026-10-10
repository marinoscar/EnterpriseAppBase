# @marinoscar/platform-contract/ai

The AI platform's wire contract (issue #739, PP-8.6), as zod schemas with their inferred types, plus the zod-free provider ids, key policies and bounds. `@marinoscar/platform-api/ai` registers the `ai` settings namespaces from these schemas and validates its org-key and feature routes with them; the reference app's settings schemas re-export them, and a web client types `/api/ai/features` and `/api/admin/ai/org-keys` with them. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One definition of the AI policy and of the organization-tier shapes, shared by the API, the web and a script.

| File | What |
|---|---|
| `constants.ts` | `AI_PROVIDER_IDS`, `AI_KEY_POLICIES`, `AI_OPENAI_API_STYLES`, the limit, MCP-host, Azure and endpoint bounds, `aiEndpointUrlProblem`, `ORG_AI_KEY_MIN`/`MAX`, and the literal-union types. zod-free |
| `schemas.ts` | The `ai` system namespace (`systemAiSchema` stored, `systemAiPatchSchema`, the PUT/PATCH wire branches `aiSettingsSchema`/`aiSettingsPatchSchema`, the response branch `aiResponseSchema`), its limits (`systemAiLimitsSchema`, with `perOrg` since #739), the org layer (`orgAiSettingsSchema`) and its merge (`tightenAiPolicy`), the per-user namespace (`userAiSettingsSchema`), and the compile-time `AI_SETTINGS_CARRIES_NO_SECRET` proof |
| `org-keys.ts` | `setOrgAiKeySchema` (`PUT /api/admin/ai/org-keys/:provider`) and `orgAiKeyViewSchema` (masked), with the `ORG_AI_KEY_VIEW_CARRIES_NO_SECRET` proof |
| `features.ts` | `aiFeatureViewSchema`, one row of `GET /api/ai/features` |

Not here: the AI runtime's request and response types (provider-neutral TypeScript in `@marinoscar/platform-api/ai`'s `core/`), and the other HTTP DTOs of `/api/ai/*` and `/api/admin/ai/*`, which stay in the API slice for now (they share its core constants).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { AI_KEY_POLICIES, systemAiSchema, tightenAiPolicy } from '@marinoscar/platform-contract/ai';
import type { OrgAiKeyView, SystemAiValue } from '@marinoscar/platform-contract/ai';
```

None beyond the package's own peer, `zod`. A consumer that needs only a constant or a type pulls no zod (the constants are in `constants.ts`).

## Quick start

The reference app's settings schemas re-export the namespace ([`settings.schema.ts`](../../../../apps/api/src/common/schemas/settings.schema.ts)), and the org layer's merge is one call:

```ts
import { tightenAiPolicy } from '@marinoscar/platform-contract/ai';

const effective = tightenAiPolicy(deploymentPolicy, { enabled: false }); // AI off for this organization
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

None. The schemas describe the platform's own namespace and routes; a built-in provider added to the package appends to `AI_PROVIDER_IDS` and its slot in the schemas (docs/specs/ai-platform.md §4); an app cannot add one yet (PP-14.6).

## Data

None. The schemas describe a JSONB settings document and HTTP bodies; the tables are the API slice's (`@marinoscar/platform-db`'s `ai` fragment).

## Permissions and settings

None declared here. The schemas are the `ai` system namespace (org-overridable; the org layer is `orgAiSettingsSchema`, gated by `org_ai_config:read`/`write`) and the per-user `ai` namespace; the API slice registers both.

## UI

None. `@marinoscar/platform-web/ai` types its pages with these shapes.

## Infra

None. Pure schemas.

## Observability

None. Pure schemas.

## Security notes

- **No key in a settings document.** `AiSettingsCarriesNoSecret` resolves to `never`, and this package stops compiling, if a secret-bearing field (`AiSecretFieldNames`) is added to the `ai` namespace. Keys live in the credential stores.
- **Write-only org keys.** `orgAiKeyViewSchema` has no field able to carry a key (`OrgAiKeyViewCarriesNoSecret` over `KeyMaterialFieldNames`): only whether one is stored, its last four characters and when it verified.
- **Tighten-only.** `tightenAiPolicy` can only narrow the deployment's policy: an organization cannot switch AI on, widen the key policy, enable a provider or raise a cap.

## Conformance suite

None. `test/ai.test.ts` pins the namespace's defaults-free parsing, the org layer's tighten-only merge and the no-secret proofs, and `test/no-zod-in-constants.test.ts` the zod-free constants.

## Upgrade notes

New subpath in this version (#739): the schemas moved verbatim from the reference app's `common/schemas/settings.schema.ts`, `system-settings-wire.schemas.ts` and `system-settings-response.schemas.ts`, which re-export them unchanged. New: `deploymentKeyServesOrgs` (required in the stored and response shapes, optional on the wire; absent keeps the stored value, default `true`), `limits.perOrg`, `orgAiSettingsSchema`, `tightenAiPolicy`, the org-key and feature shapes, and the named enum types `AiKeyPolicyEnum` and `AiOpenAiApiStyleEnum`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Type 'true' is not assignable to type 'never'` on `AI_SETTINGS_CARRIES_NO_SECRET` | A field named like a secret was added to the `ai` namespace | Store the secret in the credential store; keep only its presence in settings |
| A `PATCH` of `ai` changes nothing | The body's `ai` member did not match `aiSettingsPatchSchema` (an unknown field is stripped) | Send only the namespace's own fields |
| An organization's override is ignored | It tried to loosen the policy (`tightenAiPolicy` only narrows) | Change the deployment's policy instead |

## Links

- [Package README](../../README.md)
- [API slice](../../../platform-api/src/ai/README.md)
- [Web counterpart](../../../platform-web/src/ai/README.md)
- [Spec: AI platform](../../../../docs/specs/ai-platform.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
