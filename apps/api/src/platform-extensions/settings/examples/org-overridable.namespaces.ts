// =============================================================================
// Reference examples: system settings namespaces WITH an org layer (#733)
// =============================================================================
//
// Two namespaces an app could register in `app-registrations/settings.ts`
// (`APP_SYSTEM_SETTINGS_NAMESPACES`): the second-rung extension point
// `registerSystemSettingsNamespaces` with an `org` block. The reference app
// ships them as compiled examples and does NOT register them in production
// (that would change the system-settings document and the published OpenAPI
// document); the org-settings integration and real-database specs register
// them temporarily. Every namespace this app does register
// (`settings/registry/system-settings.manifest.ts`) is the example WITHOUT an
// org block.
//
//   EXPORT_POLICY_EXAMPLE    `tighten`: an organization may turn exports off
//                            and lower the row cap, never turn them on or
//                            raise it (the shape the AI slice's per-org
//                            policy takes, #739)
//   WORKSPACE_LABEL_EXAMPLE  `override`: an organization's value simply wins
// =============================================================================

import type { SystemSettingsNamespace } from '@marinoscar/platform-api/settings';
import { z } from 'zod';

const exportPolicySchema = z.object({
  enabled: z.boolean(),
  maxRows: z.number().int().min(1).max(1_000_000),
});

/** The stored `exportPolicy` value. */
export type ExportPolicyValue = z.infer<typeof exportPolicySchema>;

export const EXPORT_POLICY_EXAMPLE = {
  key: 'exportPolicy',
  description: 'Whether data exports are allowed, and how many rows one export may hold.',
  storedSchema: exportPolicySchema,
  patchSchema: exportPolicySchema.partial(),
  putSchema: exportPolicySchema,
  wirePatchSchema: exportPolicySchema.partial(),
  responseSchema: exportPolicySchema,
  defaults: { enabled: true, maxRows: 10_000 },
  requiredOnPut: false,
  merge: (current, patch) => ({ ...current, ...(patch ?? {}) }),
  org: {
    schema: exportPolicySchema.partial(),
    // Tighten only: the deployment's value is a ceiling.
    merge: (system, org) => ({
      enabled: system.enabled && (org.enabled ?? true),
      maxRows: Math.min(system.maxRows, org.maxRows ?? system.maxRows),
    }),
    readPermission: 'org_settings:read',
    writePermission: 'org_settings:write',
  },
} satisfies SystemSettingsNamespace<'exportPolicy', ExportPolicyValue, Partial<ExportPolicyValue>>;

const workspaceLabelSchema = z.object({
  label: z.string().min(1).max(60),
  accent: z.enum(['blue', 'green', 'purple']),
});

/** The stored `workspaceLabel` value. */
export type WorkspaceLabelValue = z.infer<typeof workspaceLabelSchema>;

export const WORKSPACE_LABEL_EXAMPLE = {
  key: 'workspaceLabel',
  description: 'The name and accent colour the application shows for a workspace.',
  storedSchema: workspaceLabelSchema,
  patchSchema: workspaceLabelSchema.partial(),
  putSchema: workspaceLabelSchema,
  wirePatchSchema: workspaceLabelSchema.partial(),
  responseSchema: workspaceLabelSchema,
  defaults: { label: 'Workspace', accent: 'blue' },
  requiredOnPut: false,
  merge: (current, patch) => ({ ...current, ...(patch ?? {}) }),
  org: {
    schema: workspaceLabelSchema.partial(),
    merge: 'override',
    readPermission: 'org_settings:read',
    writePermission: 'org_settings:write',
  },
} satisfies SystemSettingsNamespace<'workspaceLabel', WorkspaceLabelValue, Partial<WorkspaceLabelValue>>;

/** Both examples, in the order an app would append them. */
export const ORG_OVERRIDABLE_EXAMPLES: readonly SystemSettingsNamespace[] = [
  EXPORT_POLICY_EXAMPLE as SystemSettingsNamespace,
  WORKSPACE_LABEL_EXAMPLE as SystemSettingsNamespace,
];
