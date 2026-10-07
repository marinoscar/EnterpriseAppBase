import type { SvgIcon } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined';
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined';
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import BuildCircleOutlinedIcon from '@mui/icons-material/BuildCircleOutlined';
import GroupOffOutlinedIcon from '@mui/icons-material/GroupOffOutlined';
import { APP_NAME } from '@app/shared';

/**
 * The closed set of sign-in failure codes, MIRRORED BY HAND from
 * `apps/api/src/auth/auth-error-codes.ts` (`AUTH_ERROR_CODES`): the web app
 * cannot import from the API. Adding a code there means adding it here, with its
 * copy. The API redirects every failed Google sign-in to
 * `/auth/callback?error=<code>` (#652).
 */
export const SIGN_IN_ERROR_CODES = [
  'not_allowlisted',
  'account_disabled',
  'access_denied',
  'authentication_failed',
  'server_misconfigured',
  'no_organization',
] as const;

export type SignInErrorCode = (typeof SIGN_IN_ERROR_CODES)[number];

/** Used for every unknown, legacy or missing value. Never echo the raw input. */
export const DEFAULT_SIGN_IN_ERROR_CODE: SignInErrorCode = 'authentication_failed';

/**
 * `error` is deliberately calm (`info`/`warning`) for refusals the person can
 * act on, and reserved for faults (`error`).
 */
export type SignInErrorSeverity = 'info' | 'warning' | 'error';

/** What the primary button does. `none`: nothing the person can do themselves. */
export type SignInErrorPrimaryAction = 'different-account' | 'try-again' | 'none';

export interface SignInErrorContent {
  severity: SignInErrorSeverity;
  Icon: typeof SvgIcon;
  headline: string;
  /** What happened, in one sentence. */
  explanation: string;
  /** What to do next, one sentence per step. */
  nextSteps: string[];
  primaryAction: SignInErrorPrimaryAction;
}

/** Single source of copy for every sign-in failure code. */
export const SIGN_IN_ERROR_CONTENT: Record<SignInErrorCode, SignInErrorContent> = {
  not_allowlisted: {
    severity: 'info',
    Icon: LockOutlinedIcon,
    headline: "You don't have access yet",
    explanation: `Your account signed in fine, but it isn't approved to use ${APP_NAME} yet.`,
    nextSteps: [
      'Ask an administrator to add your email address.',
      'Or sign in with a different Google account.',
    ],
    primaryAction: 'different-account',
  },
  account_disabled: {
    severity: 'warning',
    Icon: BlockOutlinedIcon,
    headline: 'Your account has been deactivated',
    explanation: `This account can no longer be used to sign in to ${APP_NAME}.`,
    nextSteps: [
      'Contact an administrator if you think this is a mistake.',
      'Or sign in with a different Google account.',
    ],
    primaryAction: 'different-account',
  },
  access_denied: {
    severity: 'info',
    Icon: UndoOutlinedIcon,
    headline: 'Sign-in was cancelled',
    explanation: 'You left the Google sign-in before it finished, so nothing was changed.',
    nextSteps: ['Try again whenever you are ready.'],
    primaryAction: 'try-again',
  },
  authentication_failed: {
    severity: 'error',
    Icon: ErrorOutlineOutlinedIcon,
    headline: "We couldn't sign you in",
    explanation: 'Something went wrong while completing your sign-in.',
    nextSteps: [
      'Try again in a moment.',
      'If it keeps happening, contact an administrator.',
    ],
    primaryAction: 'try-again',
  },
  server_misconfigured: {
    severity: 'error',
    Icon: BuildCircleOutlinedIcon,
    headline: "This app isn't ready for sign-in",
    explanation: `${APP_NAME} is missing setup that has to be completed on the server.`,
    nextSteps: ['An administrator needs to fix this before anyone can sign in.'],
    primaryAction: 'none',
  },
  // Multi-organization deployments only (TENANCY_MODE=multi, #722): the account
  // signed in fine but belongs to no organization yet.
  no_organization: {
    severity: 'info',
    Icon: GroupOffOutlinedIcon,
    headline: "You're not part of an organization yet",
    explanation: `Your account signed in fine, but it isn't a member of any organization in ${APP_NAME}.`,
    nextSteps: [
      'Ask an administrator of your organization to invite you.',
      'Or sign in with a different Google account.',
    ],
    primaryAction: 'different-account',
  },
};

/**
 * Narrows an untrusted `?error=` value to a known code. Anything else
 * (including legacy free-text values and `null`) becomes the generic failure.
 */
export function resolveSignInErrorCode(value: string | null | undefined): SignInErrorCode {
  return (SIGN_IN_ERROR_CODES as readonly string[]).includes(value ?? '')
    ? (value as SignInErrorCode)
    : DEFAULT_SIGN_IN_ERROR_CODE;
}
