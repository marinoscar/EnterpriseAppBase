/**
 * Reference example (PP-14.24b): an app adds its own notes to the packaged
 * Getting started page and Setup guide through their `slots`, with no package
 * edit.
 *
 * `Sections` is drawn at both ends of the page body, so a slot returns `null`
 * for the position it does not want: here a "need help" note after the
 * checklist (`bottom`) and a change-freeze note above the Setup guide's
 * buttons (`top`). The steps themselves are not a slot: an app adds a step by
 * registering it with the API's onboarding step registry. Both slots hold fixed
 * text; none calls the API.
 *
 * Wire them where the routes render the pages (`App.tsx`):
 * `<GettingStartedPage slots={GETTING_STARTED_SLOTS} />` and
 * `<SetupGuidePage slots={SETUP_GUIDE_SLOTS} />`. The reference app does not
 * wire them: they ship compiled and tested, like the other web examples.
 */
import { Alert, Typography } from '@mui/material';
import type { GettingStartedPageSlots, SetupGuidePageSlots } from '@marinoscar/platform-web/onboarding/ui';
import type { PageSectionsSlotProps } from '@marinoscar/platform-web/core';

/** A "need help" note after the checklist. */
export function NeedHelpNote({ position }: PageSectionsSlotProps) {
  if (position !== 'bottom') return null;
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
      Stuck on a step? Ask in the team channel.
    </Typography>
  );
}

/** A change-freeze note above the Setup guide's buttons. */
export function ChangeFreezeNote({ position }: PageSectionsSlotProps) {
  if (position !== 'top') return null;
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      Configuration changes are frozen on Fridays.
    </Alert>
  );
}

/** The Getting started page slots this example fills. */
export const GETTING_STARTED_SLOTS: GettingStartedPageSlots = { Sections: NeedHelpNote };

/** The Setup guide slots this example fills. */
export const SETUP_GUIDE_SLOTS: SetupGuidePageSlots = { Sections: ChangeFreezeNote };
