/**
 * Reference example (#745): the Get started checklist embedded in an app page
 * (EvoPath puts it at the top of its Today page).
 *
 * `useOnboarding()` reads the shell's one `GET /api/onboarding` (the app's
 * `OnboardingProvider` in `App.tsx`); `OnboardingChecklist` renders the
 * derived steps with their status in words; the card hides itself once every
 * step is done or skipped, or when the user dismisses it.
 */

import { Button, Card, CardActions, CardContent, Typography } from '@mui/material';
import { useOnboarding } from '@marinoscar/platform-web/onboarding/headless';
import { OnboardingChecklist } from '@marinoscar/platform-web/onboarding/ui';

export function GetStartedCard() {
  const { state, dismissChecklist, setSkipped } = useOnboarding();
  if (!state || state.settings.checklistDismissedAt !== null || state.user.allResolved || state.user.total === 0) {
    return null;
  }

  return (
    <Card variant="outlined" data-testid="get-started-card">
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Get started
        </Typography>
        <OnboardingChecklist
          steps={state.user.steps}
          completed={state.user.completed}
          total={state.user.total}
          onSkip={(id, skipped) => void setSkipped(id, skipped)}
        />
      </CardContent>
      <CardActions>
        <Button onClick={() => void dismissChecklist()}>Hide</Button>
      </CardActions>
    </Card>
  );
}
