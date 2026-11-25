/**
 * EXAMPLE (#923, PP-14.5): the generated form of a pluggable kind, in an app.
 *
 * The API side of this kind is `apps/api/src/platform-extensions/core/greeter.kind.ts`:
 * two implementations (`plain`, `signed`), the second with a declared secret.
 * What a consuming slice serves is `greeterKind.describeAll(presence)`: one
 * descriptor per implementation. This example takes those descriptors as
 * data (hand-written JSON below, the shape `describeAll` produces) and shows
 * the three moving parts a page has:
 *
 *   1. `usePluggableConfigForm(descriptor, stored)` holds the state: the
 *      non-secret settings and the write-only secrets.
 *   2. `<PluggableConfigForm ... />` renders the fields.
 *   3. `form.payload()` is what to send: the settings, and only the secrets
 *      the user typed. The page decides where (here: `onSave`).
 *
 * The page owns the save button and the permission: the UI presents, the API
 * decides.
 */
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import { usePluggableConfigForm } from '@marinoscar/platform-web/settings/headless';
import type { PluggableConfigPayload } from '@marinoscar/platform-web/settings/headless';
import { PluggableConfigForm } from '@marinoscar/platform-web/settings/ui';
import { Button, Stack } from '@mui/material';

/** `greeterKind.describeAll(...)` for the `plain` implementation, as served. */
export const PLAIN_DESCRIPTOR: PluggableDescriptor = {
  kind: 'greeter',
  id: 'plain',
  label: 'Plain greeter',
  description: 'Says the greeting, optionally shouted and repeated.',
  fields: [
    { name: 'greeting', kind: 'string', maxLength: 40, label: 'Greeting', help: 'The word said before the name' },
    { name: 'shout', kind: 'boolean', label: 'Shout', help: 'Upper-case the whole greeting' },
    { name: 'repeat', kind: 'number', min: 1, max: 3, integer: true, label: 'Repeat', help: 'How many times to say it' },
  ],
};

/** The same for `signed`: an enum, an optional URL and the declared `apiKey` secret. */
export const SIGNED_DESCRIPTOR = (hasValue: boolean): PluggableDescriptor => ({
  kind: 'greeter',
  id: 'signed',
  label: 'Signed greeter',
  description: 'Signs every greeting with its API key.',
  fields: [
    { name: 'greeting', kind: 'string', maxLength: 40, label: 'Greeting' },
    { name: 'style', kind: 'enum', options: ['formal', 'casual'], label: 'Style', help: 'How the signature is worded' },
    { name: 'endpoint', kind: 'string', label: 'Endpoint', help: 'Where a real implementation would call' },
    {
      name: 'apiKey',
      kind: 'secret',
      label: 'Signing key',
      help: 'Stored encrypted; never shown again after saving.',
      hasValue,
      required: true,
    },
  ],
});

export interface GreeterSettingsFormProps {
  descriptor: PluggableDescriptor;
  /** The implementation's stored (non-secret) settings. */
  stored: Record<string, unknown>;
  canWrite: boolean;
  onSave: (id: string, payload: PluggableConfigPayload) => void;
}

/** One implementation's form with its Save and Reset buttons. */
export function GreeterSettingsForm({ descriptor, stored, canWrite, onSave }: GreeterSettingsFormProps) {
  const form = usePluggableConfigForm(descriptor, stored);
  return (
    <Stack spacing={2}>
      <PluggableConfigForm
        descriptor={descriptor}
        value={form.value}
        onChange={form.setField}
        secrets={form.secrets}
        onSecretChange={form.setSecret}
        disabled={!canWrite}
      />
      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          disabled={!canWrite || !form.dirty}
          // A real page sends this, refetches, and passes the new `stored`; then `form.reset()` adopts it.
          onClick={() => onSave(descriptor.id, form.payload())}
        >
          Save
        </Button>
        <Button disabled={!form.dirty} onClick={form.reset}>
          Reset
        </Button>
      </Stack>
    </Stack>
  );
}
