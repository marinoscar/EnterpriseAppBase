/**
 * The sign-in flow end to end, over the packaged identity slice (#727, PP-6.6):
 * the API's `@marinoscar/platform-api/identity` (test login, `/auth/me`,
 * refresh, logout) and the web's `@marinoscar/platform-web/identity`
 * (`AuthProvider`, `RequireAuth`, `LoginPage` with the app's footer slot,
 * `AuthCallbackPage`, `SignInErrorView`, the Users & Allowlist and Access
 * Tokens pages), as the reference app composes them.
 *
 * Needs a running stack with the test login enabled (any non-production
 * `NODE_ENV`): `infra/compose` (`BASE_URL` defaults to http://localhost:3535),
 * or the API on :3000 and the Vite dev server on :5173 with
 * `BASE_URL=http://localhost:5173` and the API's `APP_URL` set to the same.
 */
import { test, expect } from '@playwright/test';
import { accountButton, loginAsAdmin, loginAsTestUser } from '../helpers/auth.helper';

test.describe('Sign-in over the packaged identity slice', () => {
  test('renders the packaged login page with the app footer slot', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    await expect(page.getByText('Sign in to continue')).toBeVisible();
    // The reference app's `Footer` slot (apps/web/src/identity/LoginPage.tsx).
    await expect(page.getByText('By signing in, you agree to our Terms of Service and Privacy Policy')).toBeVisible();
  });

  test('sends a signed-out visitor of a protected route to /login', async ({ page }) => {
    await page.goto('/settings');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  });

  test('signs in through the callback and signs out', async ({ page }) => {
    await loginAsTestUser(page, { email: 'identity-e2e-viewer@test.local' });

    await expect(page).toHaveURL(/\/$/);
    await expect(accountButton(page)).toBeVisible();

    await accountButton(page).click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Signed out for real: the protected route sends the visitor back.
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('explains a closed sign-in error code and never shows a free-text one', async ({ page }) => {
    await page.goto('/auth/callback?error=not_allowlisted');
    await expect(page.getByText("You don't have access yet")).toBeVisible();

    await page.goto('/auth/callback?error=%3Cb%3Einjected%3C%2Fb%3E');
    await expect(page.getByText('injected')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('restores the session from the refresh cookie on a full page load', async ({ page }) => {
    await loginAsTestUser(page, { email: 'identity-e2e-tokens@test.local' });

    // A full navigation drops the in-memory access token: the packaged
    // AuthProvider refreshes from the HttpOnly cookie, then reads /auth/me.
    await page.goto('/settings/tokens');
    await expect(page.getByRole('heading', { name: 'Access Tokens', level: 1 })).toBeVisible();
  });

  test('lets an admin open Users & Allowlist with both tabs', async ({ page }) => {
    await loginAsAdmin(page, 'identity-e2e-admin@test.local');

    await page.goto('/admin/settings/users');
    await expect(page.getByRole('heading', { name: 'Users & Allowlist', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Users' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Allowlist' })).toBeVisible();
  });

  test('keeps a viewer out of Users & Allowlist', async ({ page }) => {
    await loginAsTestUser(page, { email: 'identity-e2e-no-admin@test.local', role: 'viewer' });

    await page.goto('/admin/settings/users');
    await expect(page).toHaveURL(/\/$/);
  });
});
