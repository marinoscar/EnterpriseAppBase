/**
 * EXAMPLE (PP-14.21): the web side of an app's own profile field, `profile.pronouns`.
 *
 * The API side is `apps/api/src/platform-extensions/settings/examples/profile-pronouns.ts`
 * (`extendUserProfile` adds an optional, bounded `pronouns` to the stored
 * profile). The packaged profile card draws no field the app added, so an app
 * passes the `ExtraFields` slot:
 *
 *   <UserProfilePage slots={{ ExtraFields: PronounsField }} />
 *
 * The card holds the state: `values` are what is stored with the edits not saved
 * yet on top, `onChange` records an edit, and the card's own Save button sends
 * the changed fields (a cleared one as `null`) in the same PATCH as the display
 * name. The field decides nothing: the API validates the value.
 *
 * (The time zone used to be this example; it is now a core profile field the
 * card draws itself, with the world-map picker of `@marinoscar/platform-web/timezone/ui`.)
 *
 * With no slot the card renders exactly what it always did.
 */
import { TextField } from '@mui/material';
import type { ProfileExtraFieldsProps } from '@marinoscar/platform-web/settings/ui';

/** The longest value the API side accepts. */
export const PRONOUNS_MAX = 32;

/** The `ExtraFields` slot of the profile card: one short text field. */
export function PronounsField({ values, onChange, disabled }: ProfileExtraFieldsProps) {
  const value = typeof values.pronouns === 'string' ? values.pronouns : '';
  return (
    <TextField
      label="Pronouns"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange('pronouns', event.target.value)}
      helperText="Optional, for example she/her or they/them."
      slotProps={{ htmlInput: { maxLength: PRONOUNS_MAX } }}
      fullWidth
    />
  );
}
