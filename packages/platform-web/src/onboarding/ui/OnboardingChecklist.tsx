// =============================================================================
// OnboardingChecklist (issue #745): one audience's derived steps, as a list
// =============================================================================
//
// Presentation only: every status comes from `GET /api/onboarding`; nothing
// here can tick a step. Accessibility:
//   - a real list per group (`required`, `recommended`, `optional` when
//     `grouped`), each labelled by its subheader;
//   - each step's status is a WORD ("Done", "To do", "Blocked", "Skipped")
//     beside an icon, never colour alone;
//   - progress is visible text ("3 of 5 done") and a determinate bar with
//     `aria-valuetext`;
//   - a step to do is a link to the page where it is done.
// =============================================================================

import { ONBOARDING_TIERS } from '@marinoscar/platform-contract/onboarding';
import type { OnboardingStep, OnboardingTier } from '@marinoscar/platform-contract/onboarding';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlineOutlined';
import {
  Box,
  Button,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Typography,
} from '@mui/material';
import { useId } from 'react';
import type { ReactElement } from 'react';
import { Link as RouterLink } from 'react-router-dom';

/**
 * The heading of each tier's group.
 *
 * @stability experimental
 */
export const ONBOARDING_TIER_LABELS: Readonly<Record<OnboardingTier, string>> = Object.freeze({
  required: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
});

/**
 * A step's status in words.
 *
 * @param step - the step.
 * @returns "Done", "To do", "Blocked" or "Skipped".
 *
 * @stability experimental
 */
export function onboardingStatusWord(step: OnboardingStep): string {
  if (step.status === 'done') return 'Done';
  if (step.skipped) return 'Skipped';
  return step.status === 'blocked' ? 'Blocked' : 'To do';
}

/**
 * What {@link OnboardingChecklist} takes.
 *
 * @stability experimental
 */
export interface OnboardingChecklistProps {
  /** The steps, in order. */
  steps: readonly OnboardingStep[];
  /** How many are done. */
  completed: number;
  /** How many there are. */
  total: number;
  /** Accessible name of the list and the progress bar. Default "Getting started". */
  label?: string;
  /** Group the steps under their tier's heading. */
  grouped?: boolean;
  /** Called when a step's link is followed (to close a surrounding dialog). */
  onNavigate?: () => void;
  /** Offers Skip / Undo on skippable steps that are not done. */
  onSkip?: (stepId: string, skipped: boolean) => void;
}

function StepRow({ step, onNavigate, onSkip }: { step: OnboardingStep } & Pick<OnboardingChecklistProps, 'onNavigate' | 'onSkip'>): ReactElement {
  const done = step.status === 'done';
  const word = onboardingStatusWord(step);
  const hint = done ? null : step.status === 'blocked' ? step.blockedReason : step.detail;
  const Icon = done ? CheckCircleIcon : step.skipped ? RemoveCircleOutlineIcon : step.status === 'blocked' ? BlockIcon : RadioButtonUncheckedIcon;
  const icon = (
    <ListItemIcon sx={{ minWidth: 40 }}>
      <Icon color={done ? 'success' : 'action'} aria-hidden />
    </ListItemIcon>
  );
  const text = (
    <ListItemText
      primary={step.title}
      secondary={
        <>
          <Box component="span" sx={{ fontWeight: 500, color: done ? 'success.main' : 'text.secondary' }}>
            {word}
          </Box>
          {hint ? <Box component="span">{` · ${hint}`}</Box> : null}
        </>
      }
    />
  );
  const skip =
    onSkip && step.skippable && !done ? (
      <Button size="small" onClick={() => onSkip(step.id, !step.skipped)} sx={{ minHeight: 36, flexShrink: 0 }}>
        {step.skipped ? 'Undo skip' : 'Skip'}
      </Button>
    ) : null;

  if (done || step.status === 'blocked') {
    return (
      <ListItem data-testid={`onboarding-step-${step.id}`} data-status={step.status} secondaryAction={skip}>
        {icon}
        {text}
      </ListItem>
    );
  }

  return (
    <ListItem disablePadding data-testid={`onboarding-step-${step.id}`} data-status={step.status} secondaryAction={skip}>
      <ListItemButton component={RouterLink} to={step.href} onClick={onNavigate} sx={{ minHeight: 48, pr: skip ? 12 : undefined }}>
        {icon}
        {text}
        <ChevronRightIcon color="action" aria-hidden />
      </ListItemButton>
    </ListItem>
  );
}

/**
 * One audience's checklist: a list of links with each status in words and
 * an icon, and a "3 of 5 done" progress line.
 *
 * @param props - see {@link OnboardingChecklistProps}.
 * @returns the checklist.
 *
 * @example
 * ```tsx
 * <OnboardingChecklist steps={user.steps} completed={user.completed} total={user.total} onSkip={setSkipped} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function OnboardingChecklist(props: OnboardingChecklistProps): ReactElement {
  const { steps, completed, total, label = 'Getting started', grouped = false, onNavigate, onSkip } = props;
  const baseId = useId();
  const progressText = `${completed} of ${total} done`;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const groups = grouped
    ? ONBOARDING_TIERS.map((tier) => ({ key: tier, label: ONBOARDING_TIER_LABELS[tier], steps: steps.filter((s) => s.tier === tier) })).filter(
        (group) => group.steps.length > 0,
      )
    : [{ key: 'all', label: null as string | null, steps }];

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }} data-testid="onboarding-progress-text">
        {progressText}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={percent}
        aria-label={`${label} progress`}
        aria-valuetext={progressText}
        sx={{ mb: 1, height: 6, borderRadius: 3 }}
      />
      {groups.map((group) => {
        const headerId = `${baseId}-${group.key}`;
        return (
          <List
            key={group.key}
            aria-labelledby={group.label ? headerId : undefined}
            aria-label={group.label ? undefined : label}
            subheader={
              group.label ? (
                <ListSubheader id={headerId} component="div" disableSticky sx={{ px: 0, bgcolor: 'transparent' }}>
                  {group.label}
                </ListSubheader>
              ) : undefined
            }
          >
            {group.steps.map((step) => (
              <StepRow key={step.id} step={step} onNavigate={onNavigate} onSkip={onSkip} />
            ))}
          </List>
        );
      })}
    </Box>
  );
}
