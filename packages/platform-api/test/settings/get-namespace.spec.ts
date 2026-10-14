// SystemSettingsService.getNamespace (issue #865): the key overload (typed by
// the `SystemSettingsNamespaces` augmentation) and the declaration overload
// (typed by the declaration's `storedSchema`, no augmentation needed) read the
// same salvaged value; the declaration overload refuses a namespace the
// registry does not hold.
import { z } from 'zod';

import { withTemporaryEntries } from '../../src/core/index';
import { systemSettingsNamespaceRegistry, type SystemSettingsNamespace } from '../../src/settings/index';
import { ALICE, services } from './support';

const notesStored = z.object({ archiveAfterDays: z.number().int().min(0).max(3650), label: z.enum(['short', 'long']) });
type NotesValue = z.infer<typeof notesStored>;

// An app's namespace, declared the way an app declares it (`satisfies`, so the
// object keeps its precise type) and never added to `SystemSettingsNamespaces`.
const NOTES_NS = {
  key: 'notesSample',
  description: 'A sample app namespace read through its declaration.',
  storedSchema: notesStored,
  patchSchema: notesStored.partial(),
  putSchema: notesStored,
  wirePatchSchema: notesStored.partial(),
  responseSchema: notesStored,
  defaults: { archiveAfterDays: 0, label: 'short' },
  requiredOnPut: false,
  merge: (current, patch) => ({
    archiveAfterDays: patch?.archiveAfterDays ?? current.archiveAfterDays,
    label: patch?.label ?? current.label,
  }),
} satisfies SystemSettingsNamespace<'notesSample', NotesValue, Partial<NotesValue>>;

const withNotes = (fn: () => Promise<void>) => () => withTemporaryEntries(systemSettingsNamespaceRegistry, [NOTES_NS], fn);

describe('SystemSettingsService.getNamespace(declaration)', () => {
  it(
    'returns the defaults before anything is stored, without creating the row',
    withNotes(async () => {
      const s = services();
      const notes = await s.system.getNamespace(NOTES_NS);
      expect(notes).toEqual({ archiveAfterDays: 0, label: 'short' });
      expect(s.prisma.systemSettings.rows.size).toBe(0);
    }),
  );

  it(
    'returns the stored, salvaged value: the same one the key overload reads',
    withNotes(async () => {
      const s = services();
      await s.system.patchSettings({ notesSample: { archiveAfterDays: 14 } } as never, ALICE);

      const notes = await s.system.getNamespace(NOTES_NS);
      expect(notes).toEqual({ archiveAfterDays: 14, label: 'short' });
      expect(await s.system.getNamespace('notesSample' as never)).toEqual(notes);

      // Typed by the declaration: no augmentation of SystemSettingsNamespaces.
      const days: number = notes.archiveAfterDays;
      const label: 'short' | 'long' = notes.label;
      expect([days, label]).toEqual([14, 'short']);
      const typeOnly = (): void => {
        // @ts-expect-error a field the declaration's storedSchema does not have.
        void notes.retentionDays;
      };
      expect(typeof typeOnly).toBe('function');
    }),
  );

  it('throws naming the key and the remedy when the namespace is not registered', async () => {
    const s = services();
    await expect(s.system.getNamespace(NOTES_NS)).rejects.toThrow(
      /"notesSample" is not registered.*registerSystemSettingsNamespaces/,
    );
  });
});
