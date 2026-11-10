import type { Locator, Page } from '@playwright/test';

export interface TestUserOptions {
  email: string;
  role?: 'admin' | 'contributor' | 'viewer';
  displayName?: string;
}

/**
 * Login as a test user via the test login page.
 * This bypasses OAuth and is only available in development/test environments.
 */
export async function loginAsTestUser(
  page: Page,
  options: TestUserOptions
): Promise<void> {
  await page.goto('/testing/login');

  // Fill email
  await page.fill('[data-testid="test-email-input"]', options.email);

  // Select role if specified
  if (options.role) {
    await page.click('[data-testid="test-role-select"]');
    await page.click(`[data-value="${options.role}"]`);
  }

  // Fill display name if specified
  if (options.displayName) {
    await page.fill('input[name="displayName"]', options.displayName);
  }

  // Submit form
  await page.click('[data-testid="test-login-button"]');

  // Wait for redirect to complete (auth callback then home)
  await page.waitForURL('/', { timeout: 10000 });
}

/**
 * Login as an admin test user.
 */
export async function loginAsAdmin(
  page: Page,
  email = 'admin@test.local'
): Promise<void> {
  await loginAsTestUser(page, { email, role: 'admin' });
}

/**
 * Login as a contributor test user.
 */
export async function loginAsContributor(
  page: Page,
  email = 'contributor@test.local'
): Promise<void> {
  await loginAsTestUser(page, { email, role: 'contributor' });
}

/**
 * Login as a viewer test user.
 */
export async function loginAsViewer(
  page: Page,
  email = 'viewer@test.local'
): Promise<void> {
  await loginAsTestUser(page, { email, role: 'viewer' });
}

/**
 * The app bar's account button: the avatar that opens the user menu
 * (`components/navigation/UserMenu.tsx`). It renders only for a signed-in user.
 */
export function accountButton(page: Page): Locator {
  return page.locator('button[aria-haspopup="true"]').filter({ has: page.locator('.MuiAvatar-root') });
}

/**
 * Check if the user is logged in by checking for the account button.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await accountButton(page).waitFor({ state: 'visible', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Logout the current user.
 */
export async function logout(page: Page): Promise<void> {
  await page.click('[data-testid="user-menu"]');
  await page.click('[data-testid="logout-button"]');
  await page.waitForURL('/login');
}
