/**
 * The shell's navigation markup did not move (PP-14.25).
 *
 * `ShellDestination` gained `badge`, `group`, `external` and `onClick`, and
 * `ShellBottomNav` gained `maxItems` with a "More" sheet. The snapshot beside
 * this file (`__snapshots__/`) was RECORDED FROM THE COMPONENTS AS THEY WERE
 * BEFORE THAT CHANGE (the same fixtures, rendered by the old ones), so passing
 * means a navigation that uses none of the new fields, and has no more
 * destinations than `maxItems`, is, element for element and class for class,
 * the one it was.
 *
 * The only normalisation is React's generated ids (`_r_1f_`), which depend on
 * render order. Re-record only for a deliberate change.
 */
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetSettingsFeaturesForTests } from '../../src/settings/headless/features.js';
import { ShellBottomNav, ShellNavigationRail, ShellUserMenu } from '../../src/shell/ui/index.js';
import { setViewportWidth } from '../viewport.js';
import { ADMIN, NAVIGATION, railPreference, renderShell } from './fixtures.js';

const html = (root: Element): string => root.innerHTML.replace(/_r_[0-9a-z]+_/g, '_rX_');

beforeEach(() => {
  railPreference.railCollapsed = false;
  resetSettingsFeaturesForTests();
});

describe("the shell navigation's markup is unchanged", () => {
  it('the bottom bar on a phone, an administrator', () => {
    setViewportWidth(375);
    const { container } = renderShell(<ShellBottomNav navigation={NAVIGATION} />, { user: ADMIN, route: '/settings/profile' });
    expect(html(container)).toMatchSnapshot();
  });

  it('the rail, expanded on a desktop', () => {
    setViewportWidth(1400);
    const { container } = renderShell(<ShellNavigationRail navigation={NAVIGATION} />, { user: ADMIN, route: '/settings' });
    expect(html(container)).toMatchSnapshot();
  });

  it('the rail, collapsed on a tablet', () => {
    setViewportWidth(800);
    const { container } = renderShell(<ShellNavigationRail navigation={NAVIGATION} />, { user: ADMIN, route: '/' });
    expect(html(container)).toMatchSnapshot();
  });

  it('the rail in Console mode', () => {
    setViewportWidth(1400);
    const { container } = renderShell(<ShellNavigationRail navigation={NAVIGATION} />, { user: ADMIN, route: '/admin/settings/jobs' });
    expect(html(container)).toMatchSnapshot();
  });

  it('the user menu, open', async () => {
    setViewportWidth(1400);
    const { baseElement } = renderShell(<ShellUserMenu navigation={NAVIGATION} />, { user: ADMIN });
    await userEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(html(baseElement)).toMatchSnapshot();
  });
});
