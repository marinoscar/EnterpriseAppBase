/**
 * The host slice's pages and prompts did not move (PP-14.24).
 *
 * `MaintenancePage` gained the page-slot contract (`PageSlotsBase`) and
 * `MaintenanceScreen`, `InstallPrompt` and `MaintenanceBanner` gained optional
 * parts (`logo`/`actions`/`children`, `icon`/`copy`, `copy`/`actions`). The
 * snapshot beside this file (`__snapshots__/`) was RECORDED FROM THE COMPONENTS
 * AS THEY WERE BEFORE THAT CHANGE (the same fixtures, rendered by the old
 * components), so passing means what an administrator or a viewer sees with
 * none of those passed is, element for element and class for class, what they
 * had. (The About page has its own, `about-page.dom.test.tsx`.)
 *
 * The only normalisation is React's and MUI's generated ids. Re-record only for
 * a deliberate change of a component.
 */
import { act, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { clearMaintenanceBlock } from '../../src/host/headless/index.js';
import type { MaintenanceBlock, MaintenanceStatus } from '../../src/host/headless/index.js';
import { InstallPrompt, MaintenanceBanner, MaintenancePage, MaintenanceScreen } from '../../src/host/ui/index.js';
import { mockAdminUser, mockUser, render, reset, serve } from './render.js';

const html = (root: Element): string =>
  root.innerHTML.replace(/_r_[0-9a-z]+_/g, '_rX_').replace(/:r[0-9a-z]+:/g, ':rX:')
    .replace(/\d+\/\d+\/\d{4}, [\d:]+ [AP]M/g, '<date>');

const STATUS: MaintenanceStatus = {
  enabled: true,
  message: 'Back at 03:00 UTC.',
  allowAdmins: true,
  startedAt: '2026-01-01T02:00:00.000Z',
  startedById: 'admin-user-id',
  source: 'persisted',
  layers: {
    env: { present: false, enabled: null },
    memory: { present: false, override: null },
    persisted: {
      readable: true,
      value: {
        enabled: true,
        message: 'Back at 03:00 UTC.',
        allowAdmins: true,
        startedAt: '2026-01-01T02:00:00.000Z',
        startedById: 'admin-user-id',
      },
    },
  },
};

const BLOCK: MaintenanceBlock = {
  message: 'We are upgrading the database.\nBack at 03:00 UTC.',
  allowAdmins: true,
  retryAfterSeconds: 30,
};

describe("the host slice's markup is unchanged", () => {
  beforeEach(() => {
    reset();
    clearMaintenanceBlock();
  });

  it('the maintenance page, writable and read-only', async () => {
    serve('GET', '/admin/maintenance', STATUS);
    const writable = render(<MaintenancePage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByText('Where this setting comes from');
    expect(html(writable.container)).toMatchSnapshot();
    writable.unmount();

    const readOnly = render(<MaintenancePage />, {
      wrapperOptions: { user: { ...mockAdminUser, permissions: ['system_settings:read'] } },
    });
    await screen.findByText('Where this setting comes from');
    expect(html(readOnly.container)).toMatchSnapshot();
  });

  it('the maintenance screen, for a visitor and for an administrator', () => {
    const visitor = render(<MaintenanceScreen appName="Example App" block={BLOCK} onRetry={() => undefined} />, {
      wrapperOptions: { user: mockUser },
    });
    expect(html(visitor.container)).toMatchSnapshot();
    visitor.unmount();
    const admin = render(<MaintenanceScreen appName="Example App" block={BLOCK} onRetry={() => undefined} />, {
      wrapperOptions: { user: mockAdminUser },
    });
    expect(html(admin.container)).toMatchSnapshot();
  });

  it('the maintenance banner', async () => {
    serve('GET', '/admin/maintenance', STATUS);
    const { container } = render(<MaintenanceBanner />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByText('Maintenance mode is on');
    expect(html(container)).toMatchSnapshot();
  });

  it('the install prompt', () => {
    window.localStorage.removeItem('pwa_install_dismissed');
    rtlRender(<InstallPrompt appName="Example App" />);
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { platforms: ['web'], prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }) });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(screen.getByText('Install Example App for faster access and notifications')).toBeInTheDocument();
    expect(html(document.body)).toMatchSnapshot();
  });
});
