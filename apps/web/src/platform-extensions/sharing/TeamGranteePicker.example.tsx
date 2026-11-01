/**
 * Reference example (PP-14.16): a grantee picker for a kind the API
 * registered with `registerGranteeKind` and marked `input: 'custom'`.
 *
 * The share dialog lists the grantee kinds the API serves
 * (`GET /sharing/grantee-kinds`) and collects the grantee of a kind with
 * `input: 'text'` in a plain text field. A kind whose grantee needs more, a
 * team chosen from a short list here, registers a component for it with
 * `registerGranteePicker(kind, Component)`. The component reports the
 * grantee's reference (`onChange`), which the dialog sends as the `ref` of
 * `{ kind: 'custom', granteeKind, ref }` and the API's kind validates. The
 * picker decides nothing about access.
 *
 * The reference app registers it nowhere: the template has no `team` kind
 * (and a grant of an app kind cannot be stored until the sharing storage
 * migration ships). An app registers its own in `src/platform/granteePickers.ts`,
 * inside `registerAppGranteePickers`, before the freeze:
 *
 *   registerGranteePicker('team', TeamGranteePicker);
 *
 * Proven by src/__tests__/examples/sharing/GranteePicker.example.test.tsx.
 */
import { MenuItem, TextField } from '@mui/material';
import type { ReactElement } from 'react';
import type { GranteePickerProps } from '@marinoscar/platform-web/sharing/headless';

/** The teams the example offers (an app would load them from its own API). */
export const EXAMPLE_TEAMS = [
  { id: 'team-design', name: 'Design' },
  { id: 'team-platform', name: 'Platform' },
] as const;

export function TeamGranteePicker({ descriptor, value, onChange, disabled, error }: GranteePickerProps): ReactElement {
  return (
    <TextField
      select
      label={descriptor.label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      error={error !== undefined}
      helperText={error ?? descriptor.description ?? ' '}
      size="small"
      fullWidth
    >
      {EXAMPLE_TEAMS.map((team) => (
        <MenuItem key={team.id} value={team.id}>
          {team.name}
        </MenuItem>
      ))}
    </TextField>
  );
}
