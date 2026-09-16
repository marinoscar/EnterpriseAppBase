import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { notificationEventKeySchema } from '../../common/schemas/user-settings-namespaces.schema';
import {
  MAX_DISABLED_NOTIFICATION_EVENTS,
  BACKUP_TIME_OF_DAY_PATTERN,
  STORAGE_PROVIDER_KINDS,
} from '../../common/schemas/settings.schema';

// The request-body schemas deliberately RESTATE `common/schemas/settings.schema.ts`
// rather than importing it: these are the OpenAPI-visible DTOs (`createZodDto`
// reads them to build the documented request schema) and the service validates
// against the shared schema again on the way in. Both copies must move together
// — `notifications` (#225) is the block that most recently did.

/**
 * Deployment-wide browser-notification policy (#225, epic #215).
 *
 * A MODELLED block: a framework-level, security-adjacent gate needs a real
 * type, a real default and somewhere to document its semantics. Nothing enforces it yet — the browser
 * channel reading these values is issue #226 — so it is stored and editable and
 * no delivery path consults it. See `systemNotificationsSchema`.
 */
const notificationsSettingsSchema = z.object({
  browserEnabled: z.boolean(),
  disabledEvents: z
    .array(notificationEventKeySchema)
    .max(MAX_DISABLED_NOTIFICATION_EVENTS),
});

// =============================================================================
// Operations namespaces on the wire (#256, epic #254)
// =============================================================================
//
// THIS FILE IS THE TRAP THE PARITY GUARD EXISTS FOR. A namespace that reaches
// `systemSettingsSchema` but not the two schemas below is not a validation
// error — it is a SILENT one. The global `ZodValidationPipe` parses the body
// against these schemas first and strips every key they do not declare, so the
// service is handed a body with the caller's change already deleted and
// cheerfully writes the unchanged value back. `common/schemas/settings-parity.spec.ts`
// fails the build when that happens; read its header before editing anything
// here.
//
// WHY THESE FOUR ARE OPTIONAL IN THE PUT BODY WHILE `notifications` IS REQUIRED.
// The rule `notifications` (#225) established is right and unchanged: a PUT
// that omits a modelled block must not silently reset it. The two cases differ
// in who is sending the body. `notifications` shipped together with the admin
// UI that sends it, so requiring it broke nothing and caught real omissions.
// These four ship AHEAD of every consumer, so requiring them would 400 every
// PUT from every client that exists today — including this repo's own settings
// page — the moment this issue merges. That is exactly the "changes behaviour
// for a deployment that has never saved these keys" outcome the issue rules
// out.
//
// SO WHAT STOPS THE SILENT RESET? `replaceSettings` carries an omitted block
// forward from the stored value instead of letting it fall back to the
// defaults — the same rule that file already applies to keys it does not model
// at all, and it is derived from THIS schema (the keys that accept
// `undefined`), not from a second hand-written list. A PUT can therefore change
// these namespaces, but cannot erase them by not mentioning them. When a UI for
// one of them lands and every client is sending it, promoting that block to
// required here is a one-line change with a test that already covers it.

const jobsSettingsSchema = z.object({
  history: z.object({
    retentionDays: z.number().int().min(1).max(3650),
    purgeEnabled: z.boolean(),
  }),
  stuckThresholdMinutes: z.number().int().min(1).max(10080),
});

const nodesSettingsSchema = z.object({
  staleHeartbeatSeconds: z.number().int().min(5).max(86400),
  offlineStaleMultiplier: z.number().int().min(1).max(100),
  offlineRetentionDays: z.number().int().min(1).max(3650),
  jobSecretBrokerEnabled: z.boolean(),
});

const databaseBackupSettingsSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.number().int().min(0).max(6),
  dayOfMonth: z.number().int().min(1).max(28),
  timeOfDay: z
    .string()
    .regex(BACKUP_TIME_OF_DAY_PATTERN, 'Expected a 24-hour HH:MM time'),
  timezone: z.string().min(1).max(64),
  retentionCount: z.number().int().min(1).max(365),
  // No `.min(1)`: `""` is the one spelling of "unset" and is the SHIPPED
  // DEFAULT — it means "whatever provider `storage.provider` names right now".
  // A non-empty value must equal the active provider or the write is a loud
  // 400 (`DatabaseBackupRunnerService.assertStorageProviderUsable`); that check
  // is unchanged. Only the default moved, because a provider id the operator
  // never chose must not be able to redirect or block their backups. See
  // `common/schemas/settings.schema.ts` for the full argument.
  storageProvider: z.string().max(64),
  runStaleMinutes: z.number().int().min(1).max(10080),
  compressionLevel: z.number().int().min(0).max(9),
  restoreRollbackMode: z.enum(['retain_database', 'drop_database']),
  oldDatabaseRetentionHours: z.number().int().min(1).max(8760),
  nodeOffloadEnabled: z.boolean(),
});

const maintenanceSettingsSchema = z.object({
  enabled: z.boolean(),
  message: z.string().min(1).max(1000),
  allowAdmins: z.boolean(),
  startedAt: z.iso.datetime().nullable(),
  startedById: z.string().uuid().nullable(),
});

// =============================================================================
// Storage provider configuration on the wire (#373, epic #372)
// =============================================================================
//
// Restated here rather than imported, for the reason at the top of this file:
// these are the OpenAPI-visible request schemas. Optional in the PUT body like
// the operations namespaces above, and for the identical reason — this block
// ships ahead of every client that knows it exists, so requiring it would 400
// every PUT from this repo's own settings page the moment it merges.
//
// NO `secretAccessKey` FIELD, ON EITHER SCHEMA, EVER. The secret access key is
// written through the credential store (#115, epic #108) at
// `(purpose 'storage', name 'default')`, not through this document. Accepting it
// here would put it in the request body of an endpoint whose audit rows record
// the full merged value, and in the response of the GET that follows. See
// `common/schemas/settings.schema.ts`, which carries the argument and a
// compile-time proof of the absence. `accessKeyId` is fine: it is an identifier
// that rides in the clear in every SigV4 `Authorization` header, the counterpart
// of `smtpUsername`.
//
// Bounds mirror `systemStorageSchema` exactly. No `.min(1)` on the strings:
// empty means "not configured", which is a legal state and the one a fresh
// deployment is in.

const storageSettingsSchema = z.object({
  provider: z.enum(STORAGE_PROVIDER_KINDS),
  bucket: z.string().trim().max(255),
  region: z.string().trim().max(255),
  endpoint: z.string().trim().max(512),
  accountId: z.string().trim().max(255),
  accessKeyId: z.string().trim().max(255),
  // Tri-state, mirroring `systemStorageSchema`: `null` is "use this vendor's
  // convention" and is what a fresh deployment holds.
  forcePathStyle: z.boolean().nullable(),
});

// Full replacement (PUT)
export const updateSystemSettingsSchema = z.object({
  // REQUIRED. A PUT that omits it is a 400 and
  // not a silent reset to the defaults: the value it would reset is an
  // operator's decision to turn a delivery channel off for everyone.
  notifications: notificationsSettingsSchema,
  // OPTIONAL — see the section header above. Omitting one means "leave it as
  // stored", never "reset it to the defaults"; `SystemSettingsService
  // .replaceSettings` is what makes that true.
  jobs: jobsSettingsSchema.optional(),
  nodes: nodesSettingsSchema.optional(),
  databaseBackup: databaseBackupSettingsSchema.optional(),
  maintenance: maintenanceSettingsSchema.optional(),
  // #373, epic #372 — optional for the same reason, and carried forward from
  // storage when omitted by the same `OMITTABLE_ON_PUT` machinery, which derives
  // itself from this shape rather than from a second list.
  storage: storageSettingsSchema.optional(),
});

export class UpdateSystemSettingsDto extends createZodDto(
  updateSystemSettingsSchema,
) {}

// Partial update (PATCH)
export const patchSystemSettingsSchema = z.object({
  // `disabledEvents` REPLACES rather than merges — RFC 7396's rule for arrays,
  // and the only workable one here: a merging list could never express
  // "re-enable this event", so unchecking a box on the admin page would be a
  // no-op.
  notifications: z
    .object({
      browserEnabled: z.boolean().optional(),
      disabledEvents: z
        .array(notificationEventKeySchema)
        .max(MAX_DISABLED_NOTIFICATION_EVENTS)
        .optional(),
    })
    .optional(),
  // Optional at the namespace level and field by field inside, so that
  // `{ "databaseBackup": { "enabled": true } }` is a legal body. If this line
  // is missing, that body parses to `{}` and the PATCH is a no-op that returns
  // 200 — the defect `settings-parity.spec.ts` and
  // `test/settings/system-settings.integration.spec.ts` both pin.
  jobs: z
    .object({
      history: z
        .object({
          retentionDays: z.number().int().min(1).max(3650).optional(),
          purgeEnabled: z.boolean().optional(),
        })
        .optional(),
      stuckThresholdMinutes: z.number().int().min(1).max(10080).optional(),
    })
    .optional(),
  nodes: z
    .object({
      staleHeartbeatSeconds: z.number().int().min(5).max(86400).optional(),
      offlineStaleMultiplier: z.number().int().min(1).max(100).optional(),
      offlineRetentionDays: z.number().int().min(1).max(3650).optional(),
      jobSecretBrokerEnabled: z.boolean().optional(),
    })
    .optional(),
  databaseBackup: z
    .object({
      enabled: z.boolean().optional(),
      frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
      dayOfWeek: z.number().int().min(0).max(6).optional(),
      dayOfMonth: z.number().int().min(1).max(28).optional(),
      timeOfDay: z
        .string()
        .regex(BACKUP_TIME_OF_DAY_PATTERN, 'Expected a 24-hour HH:MM time')
        .optional(),
      timezone: z.string().min(1).max(64).optional(),
      retentionCount: z.number().int().min(1).max(365).optional(),
      // No `.min(1)`, matching the PUT schema above: `""` CLEARS the pin back
      // to "whatever provider is active", absent leaves it alone. Rejecting
      // `""` would make the shipped default unreachable by the endpoint that
      // edits it.
      storageProvider: z.string().max(64).optional(),
      runStaleMinutes: z.number().int().min(1).max(10080).optional(),
      compressionLevel: z.number().int().min(0).max(9).optional(),
      restoreRollbackMode: z
        .enum(['retain_database', 'drop_database'])
        .optional(),
      oldDatabaseRetentionHours: z.number().int().min(1).max(8760).optional(),
      nodeOffloadEnabled: z.boolean().optional(),
    })
    .optional(),
  // `startedAt` and `startedById` are `.nullable().optional()`: `null` clears
  // the window's provenance, absent leaves it alone. The service's merge
  // distinguishes the two with `!== undefined` rather than `??`, which would
  // collapse them and make "clear it" impossible to express.
  maintenance: z
    .object({
      enabled: z.boolean().optional(),
      message: z.string().min(1).max(1000).optional(),
      allowAdmins: z.boolean().optional(),
      startedAt: z.iso.datetime().nullable().optional(),
      startedById: z.string().uuid().nullable().optional(),
    })
    .optional(),
  // #373, epic #372. THE LINE THAT MAKES A STORAGE PATCH DO ANYTHING AT ALL.
  // Without it `PATCH { "storage": { "bucket": "my-bucket" } }` parses to `{}`
  // in the global ZodValidationPipe, the service merges nothing, the row is
  // rewritten unchanged and the endpoint answers 200 with a body that looks
  // right — no error, no log line, no audit entry. `common/schemas/settings-parity.spec.ts`
  // is what fails the build if this is ever dropped.
  //
  // An empty string here CLEARS a string field (`''` is how a string says
  // "un-configure this"); absent leaves the stored value alone. The one
  // nullable field, `forcePathStyle`, says the same thing with an explicit
  // `null` — see `systemStorageSchema` for why a boolean needs a third state.
  storage: z
    .object({
      provider: z.enum(STORAGE_PROVIDER_KINDS).optional(),
      bucket: z.string().trim().max(255).optional(),
      region: z.string().trim().max(255).optional(),
      endpoint: z.string().trim().max(512).optional(),
      accountId: z.string().trim().max(255).optional(),
      // Identifier, never the secret half — see the section header above.
      accessKeyId: z.string().trim().max(255).optional(),
      // Absent leaves it alone; explicit `null` restores the vendor default.
      forcePathStyle: z.boolean().nullable().optional(),
    })
    .optional(),
});

export class PatchSystemSettingsDto extends createZodDto(
  patchSystemSettingsSchema,
) {}
