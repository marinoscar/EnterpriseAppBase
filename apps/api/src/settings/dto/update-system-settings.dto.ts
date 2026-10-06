import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  notificationsSettingsSchema,
  jobsSettingsSchema,
  nodesSettingsSchema,
  databaseBackupSettingsSchema,
  maintenanceSettingsSchema,
  storageSettingsSchema,
  aiSettingsSchema,
  telemetrySettingsSchema,
  retentionSettingsSchema,
  notificationsSettingsPatchSchema,
  jobsSettingsPatchSchema,
  nodesSettingsPatchSchema,
  databaseBackupSettingsPatchSchema,
  maintenanceSettingsPatchSchema,
  storageSettingsPatchSchema,
  aiSettingsPatchSchema,
  telemetrySettingsPatchSchema,
  retentionSettingsPatchSchema,
} from './system-settings-wire.schemas';

// The per-namespace branches live in `system-settings-wire.schemas.ts`, which
// carries their rationale (and the section on why only `notifications` is
// required in a PUT body).

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
  // #423, epic #419 — optional for the same reason, carried forward the same
  // way.
  ai: aiSettingsSchema.optional(),
  // Epic #528, story #533 — optional for the same reason, carried forward the
  // same way.
  telemetry: telemetrySettingsSchema.optional(),
  // #681 — optional for the same reason, carried forward the same way.
  retention: retentionSettingsSchema.optional(),
});

export class UpdateSystemSettingsDto extends createZodDto(
  updateSystemSettingsSchema,
) {}

// Partial update (PATCH)
export const patchSystemSettingsSchema = z.object({
  notifications: notificationsSettingsPatchSchema.optional(),
  jobs: jobsSettingsPatchSchema.optional(),
  nodes: nodesSettingsPatchSchema.optional(),
  databaseBackup: databaseBackupSettingsPatchSchema.optional(),
  maintenance: maintenanceSettingsPatchSchema.optional(),
  storage: storageSettingsPatchSchema.optional(),
  ai: aiSettingsPatchSchema.optional(),
  telemetry: telemetrySettingsPatchSchema.optional(),
  retention: retentionSettingsPatchSchema.optional(),
});

export class PatchSystemSettingsDto extends createZodDto(
  patchSystemSettingsSchema,
) {}
