// The consumer's own system-settings namespace (issue #865), declared the way
// an app outside the repository declares one: a `satisfies` declaration and an
// augmentation of `SystemSettingsNamespaces` by the package's PUBLIC specifier.
// `npm run build` (tsc, NodeNext, skipLibCheck off) type-checks both typed
// reads against the installed `.d.ts` files; `settings-typing.check.ts` imports
// this file BEFORE the slices that augment the same interface, the order that
// used to lose the consumer's key.

import { z } from 'zod';
import type { SystemSettingsNamespace, SystemSettingsService } from '@marinoscar/platform-api/settings';

const notesSettingsSchema = z.object({ archiveAfterDays: z.number().int().min(0).max(3650) });
const notesSettingsPatchSchema = notesSettingsSchema.partial();

export type NotesSettings = z.infer<typeof notesSettingsSchema>;

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

declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces {
    notes: NotesSettings;
  }
}

/** Typed by the augmentation above. */
export async function readNotesByKey(settings: SystemSettingsService): Promise<NotesSettings> {
  return settings.getNamespace('notes');
}

/** Typed by the declaration alone. */
export async function readNotesByDeclaration(settings: SystemSettingsService): Promise<NotesSettings> {
  return settings.getNamespace(NOTES_SYSTEM_SETTINGS);
}
