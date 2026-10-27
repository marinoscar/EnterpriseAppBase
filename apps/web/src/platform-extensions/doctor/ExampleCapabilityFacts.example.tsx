/**
 * Reference example (PP-14.23): an app draws the facts of its own Doctor check
 * inside the check's row, with no package edit.
 *
 * The API example check `example.capability`
 * (`apps/api/src/examples/doctor/example-capability.doctor-check.ts`) reports
 * `data: { configured, enabled }`. The packaged Doctor page prints a check's
 * status, detail, remedy and error but leaves `data` out, because what a fact
 * means is the check's own business. `registerExampleCapabilityRenderer()`
 * registers this component for that check id; the page then draws it in the
 * row, after the remedy and before the "Open settings" link. Rows of other
 * checks are drawn as they always were.
 *
 * Call the registration at module scope of the app's entry, before the page
 * renders. The reference app does not call it (the check is not mounted by the
 * API either): it ships compiled and tested, like the other web examples.
 */
import type { ReactElement } from 'react';
import { Chip, Stack } from '@mui/material';
import { registerDoctorCheckRenderer } from '@marinoscar/platform-web/doctor/headless';
import type { DoctorCheckRendererProps } from '@marinoscar/platform-web/doctor/headless';

/** The check id the API example registers. */
export const EXAMPLE_CAPABILITY_CHECK_ID = 'example.capability';

export function ExampleCapabilityFacts({ check }: DoctorCheckRendererProps): ReactElement | null {
  if (!check.data) return null;
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 0.5, flexWrap: 'wrap' }} aria-label="Capability facts">
      <Chip size="small" variant="outlined" label={check.data.configured ? 'Configured' : 'Not configured'} />
      <Chip size="small" variant="outlined" label={check.data.enabled ? 'Switched on' : 'Switched off'} />
    </Stack>
  );
}

/** Registers {@link ExampleCapabilityFacts} for the example check; returns the function that removes it. */
export function registerExampleCapabilityRenderer(): () => void {
  return registerDoctorCheckRenderer(EXAMPLE_CAPABILITY_CHECK_ID, ExampleCapabilityFacts);
}
