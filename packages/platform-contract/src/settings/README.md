# @marinoscar/platform-contract/settings

The wire shapes of the settings slice (issue #733, PP-8.1): the core fields of a user's settings document (`theme`, `profile`), the two UI-preference user namespaces the platform owns (`dataTables`, `navigation`), the base response types of `/api/system-settings` and `/api/user-settings`, and the request and response of `/api/org-settings`, as zod schemas plus inferred types and zod-free constants. `@marinoscar/platform-api/settings` composes them into its request DTOs (so the OpenAPI document is generated from them); the web app takes the types. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One source for what the settings routes accept and return. The schemas moved here verbatim from the reference app (`apps/api/src/common/schemas/settings.schema.ts` and `user-settings-namespaces.schema.ts`, which re-export them): field order, bounds and enum orders are part of the published OpenAPI document. None carries a `.default()`: an absent value means "use the built-in default", computed at read time.

Layout: `constants.ts` (zod-free: theme preferences, profile image sources, the data-table bounds, the org-settings permission ids, field kinds and merge modes, the pluggable id pattern and config field kinds), `types.ts` (zod-free response bases), `schemas.ts` and `index.ts`.

Since PP-14.5 (#923) it also carries the wire shapes of a **pluggable kind**: the field union a generated configuration form renders (`configFieldSchema`, with a write-only `secret` kind) and the descriptor of one implementation (`pluggableDescriptorSchema`). `@marinoscar/platform-api/core` produces them (`definePluggableKind`), `@marinoscar/platform-web/settings/ui` renders them.

Not here: the namespaces other slices own (`ai`, `notifications`, `jobs`, ...; each with its slice), the services and routes (`@marinoscar/platform-api/settings`), the hub (`@marinoscar/platform-web/settings`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { dataTablesSchema, orgSettingsResponseSchema } from '@marinoscar/platform-contract/settings';
import type { DataTablesValue, OrgSettingsResponse } from '@marinoscar/platform-contract/settings';
```

None beyond the package's own peer, `zod` (`^4.4.3`). A browser that imports only the constants and the types never bundles `zod` (`"sideEffects": false`, and `constants.ts` and `types.ts` import no zod).

## Quick start

The reference app's organization settings page types its form with the descriptors ([`OrgSettingsPage.tsx`](../../../platform-web/src/settings/ui/OrgSettingsPage.tsx)):

```ts
import type { OrgSettingsField, OrgSettingsNamespace } from '@marinoscar/platform-contract/settings';
```

and the API's `PATCH /api/org-settings` body is `patchOrgSettingsSchema`, wrapped as a nestjs-zod DTO.

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

The contract declares shapes; extending what a settings document holds is a namespace registration in `@marinoscar/platform-api/settings`, not a contract change. The two wire shapes below are the contract of the pluggable-kind primitive, so a client can type and validate a descriptor.

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `configFieldSchema` | schema | `z.discriminatedUnion('kind', [...])` of `{ name, label, help? }` plus `boolean`, `enum` (`options`), `number` (`min?`, `max?`, `integer?`), `string` (`maxLength?`), `other`, or `secret` (`hasValue`, `required`; write-only, no value on the wire) | Validate or type one field of a generated configuration form | experimental | [example](../../../../apps/api/test/examples/core/pluggable-kind.spec.ts) |
| `pluggableDescriptorSchema` | schema | `z.object({ kind, id, label, description?, fields: ConfigField[] })` | Validate or type the descriptor of one implementation of a pluggable kind, as `PluggableKind.describe` returns it | experimental | [example](../../../../apps/api/test/examples/core/pluggable-kind.spec.ts) |

Supporting exports (stable unless noted): `THEME_PREFERENCES`, `PROFILE_IMAGE_SOURCES`, `PROFILE_DISPLAY_NAME_MAX`, the `DATA_TABLE_*` bounds, `themePreferenceSchema`, `profileImageSourceSchema`, `userProfileSettingsSchema`, `userProfileSettingsPatchSchema`, the `dataTable*` and `navigation*` schemas and their types; experimental: `CONFIG_FIELD_KINDS`, `ConfigFieldKind`, `PLUGGABLE_ID_PATTERN`, `ConfigField`, `PluggableDescriptor`, `SystemSettingsResponseBase`, `UserSettingsResponseBase`, `ORG_SETTINGS_READ_PERMISSION`, `ORG_SETTINGS_WRITE_PERMISSION`, `ORG_SETTINGS_FIELD_KINDS`, `ORG_SETTINGS_MERGE_MODES`, `orgSettingsFieldSchema`, `orgSettingsNamespaceSchema`, `orgSettingsResponseSchema`, `patchOrgSettingsSchema` and their types.

## Data

None. The contract owns no table; the settings tables are the settings fragment of `@marinoscar/platform-db`.

## Permissions and settings

Declares none. `ORG_SETTINGS_READ_PERMISSION` and `ORG_SETTINGS_WRITE_PERMISSION` name the strings `@marinoscar/platform-api/settings` declares and enforces, for a client's own checks.

## UI

None. Types only.

## Infra

None.

## Observability

None.

## Security notes

The bounds on `dataTables` (entry count, ids, column lists, page size) are a control, not ergonomics: `user_settings.value` is a JSONB blob the user writes themselves, and an unbounded record would let one account inflate a row without limit. No schema here may carry a secret: the `secret` config field carries only `hasValue` and `required`, and the schema strips any other key, so a value cannot ride along.

## Conformance suite

None. `test/settings.test.ts` and `test/settings/pluggable.test.ts` pin the schemas' behaviour and `test/no-zod-in-constants.test.ts` keeps the constants zod-free.

## Upgrade notes

PP-14.5 (#923) adds `configFieldSchema`, `pluggableDescriptorSchema`, `CONFIG_FIELD_KINDS` and `PLUGGABLE_ID_PATTERN`; `orgSettingsFieldSchema` is unchanged, so the org settings OpenAPI is too.

New in #733. The reference app's `common/schemas/settings.schema.ts` and `user-settings-namespaces.schema.ts` re-export these names, so its imports are unchanged; no wire or OpenAPI change.

## Troubleshooting

- **A `dataTables` PATCH answers 400 "Too many data table preferences".** The 40-entry cap is enforced by the API after the merge (zod cannot cap a record's keys); send `null` for tables you no longer use.

## Links

- API: [`@marinoscar/platform-api/settings`](../../../platform-api/src/settings/README.md). Web: [`@marinoscar/platform-web/settings`](../../../platform-web/src/settings/README.md).
- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md).
