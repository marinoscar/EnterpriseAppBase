/**
 * PP-14.24: an app extends the packaged host pages and prompts through their
 * slots and optional parts, with no package edit.
 *
 * `apps/web/src/platform-extensions/host/HostExtras.example.tsx` is the example.
 * This renders the REAL packaged components over MSW responses and asserts each
 * extra is drawn where the contract names, and that the component without it
 * draws none of it.
 */
import { act, render as rtlRender, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  AboutPage,
  InstallPrompt,
  MaintenanceBanner,
  MaintenancePage,
  MaintenanceScreen,
} from '@marinoscar/platform-web/host/ui';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import {
  AppInstallMark,
  AppMark,
  OnCallNotice,
  StatusPageLink,
  SupportAction,
  SupportContacts,
} from '../../../platform-extensions/host/HostExtras.example';

const STATUS = {
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
      value: { enabled: true, message: 'Back at 03:00 UTC.', allowAdmins: true, startedAt: '2026-01-01T02:00:00.000Z', startedById: 'admin-user-id' },
    },
  },
};

const ABOUT = {
  api: { version: '2.4.1', deploymentMode: 'self-hosted' },
  deployInfoStatus: 'ok',
  deployInfoPath: '/srv/app/deploy/info.json',
  deployInfoError: null,
  app: { name: 'Example App', version: '2.4.1', commitSha: '4f21ab9c33de7715b0a1d2e3f4a5b6c7d8e9f001', ref: 'main' },
  installedAt: '2026-01-04T09:12:00.000Z',
  updatedAt: '2026-08-30T18:40:00.000Z',
  deployedBy: { cli: 'appctl', version: '1.9.0' },
  domain: 'app.example.com',
  remote: null,
  run: null,
  runtime: { processStartedAt: '2026-09-01T08:00:00.000Z', nodeVersion: 'v24.0.0', environment: 'production' },
  database: { status: 'up', responseTime: '4ms' },
  databaseError: null,
};

const BLOCK = { message: 'Upgrading.', allowAdmins: true, retryAfterSeconds: 30 };

describe('the host pages with app slots (PP-14.24)', () => {
  beforeEach(() => {
    server.resetHandlers();
    server.use(
      http.get('*/api/admin/maintenance', () => HttpResponse.json({ data: STATUS })),
      http.get('*/api/admin/about', () => HttpResponse.json({ data: ABOUT })),
    );
  });

  it('the Maintenance page draws an app BeforeContent notice above the controls', async () => {
    render(<MaintenancePage slots={{ BeforeContent: OnCallNotice }} />, { wrapperOptions: { user: mockAdminUser } });
    const notice = await screen.findByTestId('on-call-notice');
    const heading = screen.getByRole('heading', { level: 1, name: 'Maintenance' });
    expect(heading.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await screen.findByText('Where this setting comes from');
  });

  it('the About page draws an app Sections card once, under the facts', async () => {
    render(<AboutPage slots={{ Sections: SupportContacts }} />, { wrapperOptions: { user: mockAdminUser } });
    const section = await screen.findByRole('region', { name: 'Support contacts' });
    expect(within(section).getByText('operations@example.com')).toBeInTheDocument();
    const facts = await screen.findByTestId('about-deployment-facts');
    expect(facts.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draw none of it without the slots', async () => {
    render(<AboutPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByTestId('about-deployment-facts');
    expect(screen.queryByRole('region', { name: 'Support contacts' })).not.toBeInTheDocument();
  });
});

describe('the maintenance screen with an app logo, children and actions (PP-14.24)', () => {
  it('replaces the icon, adds the status line under the message and the action after Try again', () => {
    render(
      <MaintenanceScreen appName="Example App" block={BLOCK} onRetry={() => undefined} logo={<AppMark />} actions={<SupportAction />}>
        <StatusPageLink />
      </MaintenanceScreen>,
      { wrapperOptions: { user: mockAdminUser } },
    );
    expect(screen.getByTestId('app-mark')).toBeInTheDocument();
    expect(screen.queryByTestId('BuildCircleOutlinedIcon')).not.toBeInTheDocument();
    expect(screen.getByText('Live status: status.example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', 'mailto:support@example.com');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('is the screen it always was without them', () => {
    render(<MaintenanceScreen appName="Example App" block={BLOCK} onRetry={() => undefined} />, {
      wrapperOptions: { user: mockAdminUser },
    });
    expect(screen.getByTestId('BuildCircleOutlinedIcon')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Contact support' })).not.toBeInTheDocument();
  });
});

describe('the maintenance banner with app copy and actions (PP-14.24)', () => {
  beforeEach(() => {
    server.resetHandlers();
    server.use(http.get('*/api/admin/maintenance', () => HttpResponse.json({ data: STATUS })));
  });

  it('replaces the sentence and adds an action beside Manage', async () => {
    render(<MaintenanceBanner copy={{ message: 'Customers are seeing the maintenance page.' }} actions={<SupportAction />} />, {
      wrapperOptions: { user: mockAdminUser },
    });
    expect(await screen.findByText('Customers are seeing the maintenance page.')).toBeInTheDocument();
    expect(screen.queryByText(/Everyone except administrators/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact support' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage' })).toBeInTheDocument();
  });
});

describe('the install prompt with an app icon and copy (PP-14.24)', () => {
  beforeEach(() => {
    window.localStorage.removeItem('pwa_install_dismissed');
  });

  function offer() {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { platforms: ['web'], prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }) });
    act(() => {
      window.dispatchEvent(event);
    });
  }

  it('draws the icon and the app wording', () => {
    rtlRender(
      <InstallPrompt
        appName="Example App"
        icon={<AppInstallMark />}
        copy={{ title: 'Get the app', body: 'Works offline.', install: 'Add', dismiss: 'Not now' }}
      />,
    );
    offer();
    expect(screen.getByTestId('install-mark')).toBeInTheDocument();
    expect(screen.getByText('Get the app')).toBeInTheDocument();
    expect(screen.getByText('Works offline.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('keeps the platform wording without them', () => {
    rtlRender(<InstallPrompt appName="Example App" />);
    offer();
    expect(screen.getByText('Install Example App for faster access and notifications')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss install prompt' })).toBeInTheDocument();
  });
});
