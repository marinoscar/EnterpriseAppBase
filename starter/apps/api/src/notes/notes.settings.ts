import {
  registerSystemSettingsNamespaces,
  type SystemSettingsNamespace,
  type SystemSettingsService,
} from '@marinoscar/platform-api/settings';

import { notesSettingsPatchSchema, notesSettingsSchema, type NotesSettings } from './notes.schemas';

/**
 * The `notes` namespace of the system settings document: one declaration,
 * registered before `SettingsModule.forRoot()` composes the request bodies
 * (src/platform/platform.ts imports this file first). `GET/PATCH
 * /api/system-settings` then carry it, and the archive job reads it.
 */
export const NOTES_SYSTEM_SETTINGS = {
  key: 'notes',
  description: 'Notes: when an untouched note is archived.',
  storedSchema: notesSettingsSchema,
  patchSchema: notesSettingsPatchSchema,
  putSchema: notesSettingsSchema,
  wirePatchSchema: notesSettingsPatchSchema,
  responseSchema: notesSettingsSchema,
  defaults: { archiveAfterDays: 0 },
  requiredOnPut: false,
  merge: (current, patch) => ({ archiveAfterDays: patch?.archiveAfterDays ?? current.archiveAfterDays }),
} satisfies SystemSettingsNamespace<'notes', NotesSettings, Partial<NotesSettings>>;

registerSystemSettingsNamespaces([NOTES_SYSTEM_SETTINGS as SystemSettingsNamespace]);

/**
 * The stored `notes` namespace, validated, or its defaults. Read through the
 * untyped accessor and parsed here: augmenting `SystemSettingsNamespaces`
 * from an installed package does not type `getNamespace('notes')` (seam
 * request in the starter README).
 */
export async function readNotesSettings(settings: SystemSettingsService): Promise<NotesSettings> {
  const parsed = notesSettingsSchema.safeParse(await settings.readNamespaceValue('notes'));
  return parsed.success ? parsed.data : NOTES_SYSTEM_SETTINGS.defaults;
}
