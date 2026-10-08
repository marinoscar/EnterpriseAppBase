/**
 * The sign-in failure copy (#652). Packaged (#727, PP-6.6) in
 * `@marinoscar/platform-web/identity/ui`, which takes the product name as a
 * parameter; this binding names this app. A compatibility module until the
 * imports point at the package directly (PP-6.6 part 5).
 */
import { APP_NAME } from '@app/shared';
import { createSignInErrorContent } from '@marinoscar/platform-web/identity/ui';

export {
  DEFAULT_SIGN_IN_ERROR_CODE,
  SIGN_IN_ERROR_CODES,
  resolveSignInErrorCode,
} from '@marinoscar/platform-web/identity/ui';
export type {
  SignInErrorCode,
  SignInErrorContent,
  SignInErrorPrimaryAction,
  SignInErrorSeverity,
} from '@marinoscar/platform-web/identity/ui';

/** Single source of copy for every sign-in failure code, naming this app. */
export const SIGN_IN_ERROR_CONTENT = createSignInErrorContent(APP_NAME);
