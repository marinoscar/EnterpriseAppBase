/**
 * Reference example (#745): a `WelcomeDialog` user pane supplied by the app
 * (EvoPath asks for a training goal here). The pane renders the paragraph the
 * dialog is described by, and hands the answer to `setExtra`: it is stored
 * with the "welcome seen" write, in the field the API added with
 * `extendOnboardingSettings({ role })` (see the API example
 * `apps/api/src/platform-extensions/onboarding/examples/activation.example.ts`).
 *
 *   <WelcomeDialog slots={{ userPane: (pane) => <RoleWelcomePane {...pane} /> }} />
 */

import { useState } from 'react';
import { ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import type { WelcomePaneProps } from '@marinoscar/platform-web/onboarding/ui';

const ROLES = [
  { value: 'developer', label: 'I build on it' },
  { value: 'operator', label: 'I run it' },
  { value: 'other', label: 'Something else' },
] as const;

export function RoleWelcomePane({ descriptionId, appName, setExtra }: WelcomePaneProps) {
  const [role, setRole] = useState<string | null>(null);
  return (
    <>
      <Typography id={descriptionId} sx={{ mb: 2 }}>
        {`Welcome to ${appName}. What brings you here? (optional)`}
      </Typography>
      <ToggleButtonGroup
        exclusive
        value={role}
        aria-label="What brings you here"
        onChange={(_event, value: string | null) => {
          setRole(value);
          setExtra({ role: value });
        }}
      >
        {ROLES.map((option) => (
          <ToggleButton key={option.value} value={option.value} sx={{ textTransform: 'none' }}>
            {option.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </>
  );
}
