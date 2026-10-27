/**
 * The web half of a sign-in provider that owns its flow (PP-14.9): a worked
 * example of `mode: 'custom'` and the login page's provider slots.
 *
 * A provider the API lists with `mode: 'custom'` has no `/api/auth/<id>`
 * redirect route (an app's own controller finishes it with
 * `AuthService.completeExternalLogin`). On the web two things make it usable
 * with no package edit:
 *
 *   - `registerAuthProvider({ id, label, start })` gives the login page's
 *     button its look AND the function `login(id)` runs instead of navigating
 *     (a popup, a native SDK, a form);
 *   - the `BeforeProviders` / `AfterProviders` slots of `LoginPage` hold any
 *     extra control, and receive `providers` and `login`.
 *
 * Not mounted by this app: a fork registers its own provider's look in
 * `identity/authProviders.ts` and passes its slots in `identity/LoginPage.tsx`.
 * The test (`__tests__/examples/identity/company-sso.test.tsx`) mounts both.
 */
import { Box, Button, Typography } from '@mui/material';
import { registerAuthProvider } from '@marinoscar/platform-web/identity/headless';
import type { LoginProvidersSlotProps } from '@marinoscar/platform-web/identity/ui';

/** The provider id the API registers (`registerAuthProvider` of `@marinoscar/platform-api/identity`, `mode: 'custom'`). */
export const COMPANY_SSO_ID = 'company-sso';

/**
 * Registers the button's look and its `start` (called by `login('company-sso')`).
 *
 * @param start - opens the provider's own flow, for example a popup.
 * @returns a function that removes the registration (tests).
 */
export function registerCompanySso(start: () => void | Promise<void>): () => void {
  return registerAuthProvider({ id: COMPANY_SSO_ID, label: 'Continue with company SSO', start });
}

/**
 * An `AfterProviders` slot: a hint under the buttons, shown only when the API
 * actually offers the provider. It starts the sign-in through `login`, so the
 * return URL handling is the page's own.
 */
export function CompanySsoHint({ providers, login }: LoginProvidersSlotProps) {
  if (!providers.some((provider) => provider.name === COMPANY_SSO_ID)) return null;
  return (
    <Box sx={{ mt: 2, textAlign: 'center' }}>
      <Typography variant="body2" color="text.secondary">
        Working for the company?
      </Typography>
      <Button size="small" onClick={() => login(COMPANY_SSO_ID)}>
        Use company single sign-on
      </Button>
    </Box>
  );
}

/** The login page slots this example fills. */
export const COMPANY_SSO_LOGIN_SLOTS = { AfterProviders: CompanySsoHint };
