// The sign-in failure copy (issue #652), moved from the reference app's
// `components/auth/signInErrorContent.ts` (issue #727). The product name is a
// parameter (`createSignInErrorContent(appName)`); the package never imports
// the app's identity.
import type { SvgIcon } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined';
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined';
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import BuildCircleOutlinedIcon from '@mui/icons-material/BuildCircleOutlined';
import GroupOffOutlinedIcon from '@mui/icons-material/GroupOffOutlined';
import {
  AUTH_ERROR_CODES,
  DEFAULT_AUTH_ERROR_CODE,
  isAuthErrorCode,
  type AuthErrorCode,
} from '@marinoscar/platform-contract/identity';

/**
 * The closed set of sign-in failure codes. Defined ONCE, in
 * `@marinoscar/platform-contract/identity` (`AUTH_ERROR_CODES`); the API
 * resolves every failed sign-in to one of them and redirects to
 * `/auth/callback?error=<code>`. A code added to the contract is a type error
 * in {@link createSignInErrorContent} until it has copy.
 *
 * @stability stable
 */
export const SIGN_IN_ERROR_CODES: typeof AUTH_ERROR_CODES = AUTH_ERROR_CODES;

/**
 * One sign-in failure code.
 *
 * @stability stable
 */
export type SignInErrorCode = AuthErrorCode;

/**
 * Used for every unknown, legacy or missing value. Never echo the raw input.
 *
 * @stability stable
 */
export const DEFAULT_SIGN_IN_ERROR_CODE: SignInErrorCode = DEFAULT_AUTH_ERROR_CODE;

/**
 * How a failure is coloured. `error` is deliberately calm (`info`/`warning`) for refusals the person can
 * act on, and reserved for faults (`error`).
 *
 * @stability stable
 */
export type SignInErrorSeverity = 'info' | 'warning' | 'error';

/**
 * What the primary button does. `none`: nothing the person can do themselves.
 *
 * @stability stable
 */
export type SignInErrorPrimaryAction = 'different-account' | 'try-again' | 'none';

/**
 * The copy and look of one sign-in failure.
 *
 * @stability stable
 */
export interface SignInErrorContent {
  /** The palette role of the icon ring. */
  severity: SignInErrorSeverity;
  /** The icon in the ring. */
  Icon: typeof SvgIcon;
  /** The heading. */
  headline: string;
  /** What happened, in one sentence. */
  explanation: string;
  /** What to do next, one sentence per step. */
  nextSteps: string[];
  /** What the primary button does. */
  primaryAction: SignInErrorPrimaryAction;
}

/**
 * The single source of copy for every sign-in failure code, naming the product.
 *
 * @param appName - the product name the copy uses (the identity adapters' `appName`).
 * @returns the copy, keyed by code.
 *
 * @stability stable
 */
export function createSignInErrorContent(appName: string): Record<SignInErrorCode, SignInErrorContent> {
  return {
    not_allowlisted: {
      severity: 'info',
      Icon: LockOutlinedIcon,
      headline: "You don't have access yet",
      explanation: `Your account signed in fine, but it isn't approved to use ${appName} yet.`,
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
      explanation: `This account can no longer be used to sign in to ${appName}.`,
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
      explanation: `${appName} is missing setup that has to be completed on the server.`,
      nextSteps: ['An administrator needs to fix this before anyone can sign in.'],
      primaryAction: 'none',
    },
    // Multi-organization deployments only (TENANCY_MODE=multi, #722): the account
    // signed in fine but belongs to no organization yet.
    no_organization: {
      severity: 'info',
      Icon: GroupOffOutlinedIcon,
      headline: "You're not part of an organization yet",
      explanation: `Your account signed in fine, but it isn't a member of any organization in ${appName}.`,
      nextSteps: [
        'Ask an administrator of your organization to invite you.',
        'Or sign in with a different Google account.',
      ],
      primaryAction: 'different-account',
    },
  };
}

/**
 * Narrows an untrusted `?error=` value to a known code. Anything else
 * (including legacy free-text values and `null`) becomes the generic failure.
 *
 * @param value - the untrusted `?error=` value.
 * @returns a known code.
 *
 * @stability stable
 */
export function resolveSignInErrorCode(value: string | null | undefined): SignInErrorCode {
  return isAuthErrorCode(value) ? value : DEFAULT_SIGN_IN_ERROR_CODE;
}
