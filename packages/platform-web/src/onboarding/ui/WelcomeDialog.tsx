// =============================================================================
// WelcomeDialog (issue #745): the one-time welcome
// =============================================================================
//
// Open while `settings.welcomeSeenAt` is null. Two variants, chosen by what
// the API returned (never a role check in the browser): an administrator
// (the response has an admin block) is pointed at the Setup guide; everyone
// else at Get started. The app supplies each variant's body through `slots`
// (EvoPath's goal question is a `userPane`), and may hand extra fields to
// store with the "seen" write (`extra`).
//
// Every way out (the primary button, Later, Escape, the backdrop) marks the
// welcome seen, so it never comes back on its own; "Getting started" in the
// user menu brings it back. ARIA dialog pattern: `aria-labelledby` and
// `aria-describedby`, focus moved in and returned (MUI), full screen below
// `sm`, no transition under `prefers-reduced-motion`.
// =============================================================================

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useId, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useOnboarding } from '../headless/provider.js';
import type { OnboardingSettingsWrite } from '../headless/client.js';
import { GETTING_STARTED_PATH, SETUP_GUIDE_PATH } from './copy.js';

/**
 * What a pane slot receives.
 *
 * @stability experimental
 */
export interface WelcomePaneProps {
  /** The id the pane's describing paragraph must carry (`aria-describedby`). */
  descriptionId: string;
  /** The app's name. */
  appName: string;
  /** Records fields to store with the "seen" write when the primary action is taken (a goal). */
  setExtra(extra: OnboardingSettingsWrite): void;
}

/**
 * The parts an app may replace.
 *
 * @stability experimental
 */
export interface WelcomeDialogSlots {
  /** The administrator's body. Default: "a few things must be configured first". */
  adminPane?: (props: WelcomePaneProps) => ReactNode;
  /** Everyone else's body. Default: a greeting pointing at the checklist. */
  userPane?: (props: WelcomePaneProps) => ReactNode;
}

/**
 * What {@link WelcomeDialog} takes.
 *
 * @stability experimental
 */
export interface WelcomeDialogProps {
  /** Replaceable bodies. */
  slots?: WelcomeDialogSlots;
  /** Where "Start setup" goes. Default `/admin/settings/setup`. */
  setupPath?: string;
  /** Where "Get started" goes. Default `/settings/getting-started`. */
  gettingStartedPath?: string;
}

function DefaultAdminPane({ descriptionId, appName }: WelcomePaneProps): ReactElement {
  return (
    <Typography id={descriptionId}>
      You are the administrator of {appName}. A few things must be configured before people can use it; the setup guide
      checks each one for you and links to where it is done.
    </Typography>
  );
}

function DefaultUserPane({ descriptionId, appName }: WelcomePaneProps): ReactElement {
  return (
    <Typography id={descriptionId}>
      Welcome to {appName}. A short checklist walks you through your first steps; each one ticks itself when it is done.
    </Typography>
  );
}

/**
 * The one-time welcome. Mount it once, inside the app's layout, under the
 * `OnboardingProvider` (`/onboarding/headless`); it renders nothing until it should open.
 *
 * @param props - see {@link WelcomeDialogProps}.
 * @returns the dialog, or `null`.
 *
 * @example
 * ```tsx
 * <WelcomeDialog slots={{ userPane: (pane) => <GoalQuestion {...pane} /> }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export function WelcomeDialog(props: WelcomeDialogProps): ReactElement | null {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const navigate = useNavigate();
  const { state, appName, markWelcomeSeen } = useOnboarding();
  const [extra, setExtra] = useState<OnboardingSettingsWrite>({});
  const titleId = useId();
  const descriptionId = useId();

  if (state === null || state.settings.welcomeSeenAt !== null) return null;

  const isAdmin = state.admin !== null;
  const pane: WelcomePaneProps = { descriptionId, appName, setExtra: (next) => setExtra((current) => ({ ...current, ...next })) };
  const Pane = isAdmin ? (props.slots?.adminPane ?? DefaultAdminPane) : (props.slots?.userPane ?? DefaultUserPane);

  const later = () => void markWelcomeSeen();
  const primary = () => {
    void markWelcomeSeen(extra);
    navigate(isAdmin ? (props.setupPath ?? SETUP_GUIDE_PATH) : (props.gettingStartedPath ?? GETTING_STARTED_PATH));
  };

  return (
    <Dialog
      open
      onClose={later}
      fullScreen={fullScreen}
      maxWidth="sm"
      fullWidth
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      transitionDuration={reduceMotion ? 0 : undefined}
      data-testid="welcome-dialog"
    >
      <DialogTitle id={titleId}>{`Welcome to ${appName}`}</DialogTitle>
      <DialogContent>
        <Pane {...pane} />
        {isAdmin && state.admin && state.admin.total > 0 ? (
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            {`${state.admin.completed} of ${state.admin.total} done so far.`}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={later} sx={{ minHeight: 44 }}>
          Later
        </Button>
        <Button variant="contained" onClick={primary} sx={{ minHeight: 44 }}>
          {isAdmin ? 'Start setup' : 'Get started'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
