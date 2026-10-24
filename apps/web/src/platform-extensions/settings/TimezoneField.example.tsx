/**
 * EXAMPLE (PP-14.21): the web side of `profile.timezone`.
 *
 * The API side is `apps/api/src/platform-extensions/settings/examples/profile-timezone.ts`
 * (`extendUserProfile` adds an optional, bounded `timezone` to the stored
 * profile). The packaged profile card draws no field the app added, so an app
 * passes the `ExtraFields` slot:
 *
 *   <UserProfilePage slots={{ ExtraFields: TimezoneField }} />
 *
 * The card holds the state: `values` are what is stored with the edits not saved
 * yet on top, `onChange` records an edit, and the card's own Save button sends
 * the changed fields (a cleared one as `null`) in the same PATCH as the display
 * name. The field decides nothing: the API validates the value.
 *
 * With no slot the card renders exactly what it always did.
 */
import { Button, Stack, TextField } from '@mui/material';
import type { ProfileExtraFieldsProps } from '@marinoscar/platform-web/settings/ui';

/** The IANA zone this device reports (`Europe/Paris`), when the browser knows it. */
function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** The `ExtraFields` slot of the profile card: one text field and a shortcut. */
export function TimezoneField({ values, onChange, disabled }: ProfileExtraFieldsProps) {
  const value = typeof values.timezone === 'string' ? values.timezone : '';
  const device = deviceTimezone();
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
      <TextField
        label="Time zone"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange('timezone', event.target.value)}
        helperText="An IANA name such as Europe/Paris. Leave empty to follow this device."
        slotProps={{ htmlInput: { maxLength: 64 } }}
        fullWidth
      />
      {device && (
        <Button disabled={disabled || value === device} onClick={() => onChange('timezone', device)} sx={{ whiteSpace: 'nowrap', mt: { sm: 1 } }}>
          Use {device}
        </Button>
      )}
    </Stack>
  );
}
