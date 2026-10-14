// The android-app web slice (#746): the TWA launch helpers, the update
// banner (only inside the TWA, only when a newer versionCode exists), and the
// admin page (trusted apps, releases, test notification; writes gated).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import {
  androidIdentity,
  captureTwaLaunch,
  getInstalledAppVersion,
  isRunningInTwa,
  twaSessionKeys,
} from '../../src/android-app/headless/index.js';
import { AndroidAppPage, AndroidUpdateBanner, androidAppSettingsPage } from '../../src/android-app/ui/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiRequest, TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';

const SHA = Array.from({ length: 32 }, (_, i) => ((i * 3 + 17) % 256).toString(16).toUpperCase().padStart(2, '0')).join(':');

function renderWith(host: TestPlatformHost, element: ReactElement, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PlatformHostProvider host={host}>{element}</PlatformHostProvider>
    </MemoryRouter>,
  );
}

const RELEASE = {
  id: '00000000-0000-4000-8000-000000000001',
  packageName: 'com.example.app',
  versionName: '1.4.0',
  versionCode: 14,
  fileSha256: 'a'.repeat(64),
  sizeBytes: '4194304',
  notes: null,
  createdAt: '2026-10-08T00:00:00.000Z',
};

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe('TWA launch helpers', () => {
  it('reads the launch flags once and keeps them after the query string is gone', () => {
    expect(isRunningInTwa()).toBe(false);
    captureTwaLaunch('?source=twa&appVersion=1.2.0&appVersionCode=12');
    expect(isRunningInTwa()).toBe(true);
    expect(getInstalledAppVersion()).toEqual({ versionName: '1.2.0', versionCode: 12 });
    captureTwaLaunch('');
    expect(getInstalledAppVersion()).toEqual({ versionName: '1.2.0', versionCode: 12 });
  });

  it('ignores an ordinary launch and a malformed version code', () => {
    captureTwaLaunch('?source=web&appVersionCode=12');
    expect(isRunningInTwa()).toBe(false);
    captureTwaLaunch('?source=twa&appVersionCode=12x');
    expect(isRunningInTwa()).toBe(true);
    expect(getInstalledAppVersion()).toBeNull();
  });

  it('namespaces the keys by prefix', () => {
    captureTwaLaunch('?source=twa&appVersionCode=3', 'acme');
    expect(window.sessionStorage.getItem(twaSessionKeys('acme').versionCode)).toBe('3');
    expect(isRunningInTwa()).toBe(false);
    expect(isRunningInTwa('acme')).toBe(true);
  });

  it('treats an android-app:// referrer as the TWA', () => {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'referrer');
    Object.defineProperty(document, 'referrer', { configurable: true, get: () => 'android-app://com.example.app/' });
    try {
      expect(isRunningInTwa()).toBe(true);
    } finally {
      delete (document as unknown as Record<string, unknown>).referrer;
      if (original) Object.defineProperty(Document.prototype, 'referrer', original);
    }
  });

  it('shares the Gradle identity rule', () => {
    expect(androidIdentity({ productName: 'Acme Hub', repoSlug: 'acme/acme-hub' }).applicationId).toBe('com.acmehub.android');
  });
});

describe('AndroidUpdateBanner', () => {
  const host = (latest: TestApiResponse = RELEASE) => createTestPlatformHost({ responses: { 'GET /android-app/releases/latest': latest } });

  it('renders nothing and requests nothing outside the TWA', async () => {
    const h = host();
    const { container } = renderWith(h, <AndroidUpdateBanner />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    expect(h.requests).toEqual([]);
  });

  it('shows inside the TWA when a newer versionCode exists, and remembers a dismissal', async () => {
    captureTwaLaunch('?source=twa&appVersion=1.2.0&appVersionCode=12');
    const h = host();
    const { unmount } = renderWith(h, <AndroidUpdateBanner />);
    expect(await screen.findByTestId('android-update-banner')).toHaveTextContent('Android app 1.4.0 is available.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notice' }));
    expect(screen.queryByTestId('android-update-banner')).toBeNull();
    unmount();
    renderWith(h, <AndroidUpdateBanner />);
    await waitFor(() => expect(h.requests.length).toBeGreaterThan(1));
    expect(screen.queryByTestId('android-update-banner')).toBeNull();
  });

  it('stays hidden when the installed build is current, or none is published', async () => {
    captureTwaLaunch('?source=twa&appVersionCode=14');
    const h = host();
    renderWith(h, <AndroidUpdateBanner />);
    await waitFor(() => expect(h.requests).toHaveLength(1));
    expect(screen.queryByTestId('android-update-banner')).toBeNull();

    const none = host(() => {
      throw createTestApiError(404, 'No Android release has been published on this server.', 'NO_RELEASE');
    });
    renderWith(none, <AndroidUpdateBanner />);
    await waitFor(() => expect(none.requests).toHaveLength(1));
    expect(screen.queryByTestId('android-update-banner')).toBeNull();
  });
});

describe('AndroidAppPage', () => {
  function adminHost(permissions: string[]) {
    let trustedApps: Array<{ packageName: string; sha256: string }> = [];
    const view = () => ({
      trustedApps,
      reportedApps: [{ packageName: 'com.example.phone', sha256: SHA, deviceCount: 2, lastSeenAt: null, trusted: false }],
      assetLinks: trustedApps.map((app) => ({
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: app.packageName, sha256_cert_fingerprints: [app.sha256] },
      })),
      pushSubscriptions: { androidApp: 1, browser: 2, androidAppUsers: 1 },
    });
    return createTestPlatformHost({
      permissions,
      responses: {
        'GET /admin/android-app': view,
        'PUT /admin/android-app': (request: TestApiRequest) => {
          trustedApps = (request.body as { trustedApps: typeof trustedApps }).trustedApps;
          return view();
        },
        'GET /admin/android-app/releases': [{ ...RELEASE, signingSha256: SHA, isCurrent: true, storageProvider: 's3', uploadedBy: null }],
        'POST /admin/android-app/test-notification': { userId: 'u', androidSubscriptions: 0, results: [], reason: 'NO_ANDROID_SUBSCRIPTION' },
      },
    });
  }

  it('is the card the registry appends: system_settings:read at /admin/settings/android', () => {
    expect(androidAppSettingsPage.card).toMatchObject({ title: 'Android app', path: '/admin/settings/android', permission: 'system_settings:read' });
  });

  it('trusts a reported app, normalising the fingerprint, and previews assetlinks', async () => {
    const h = adminHost(['system_settings:read', 'system_settings:write']);
    renderWith(h, <AndroidAppPage />);
    expect(await screen.findByText('com.example.phone (2 devices)')).toBeInTheDocument();
    expect(screen.getByText('1.4.0 (14)', { exact: false })).toBeInTheDocument();
    const trusted = within(screen.getByRole('region', { name: 'Trusted apps' }));
    fireEvent.change(trusted.getByLabelText('Package name', { selector: 'input' }), { target: { value: 'com.example.app' } });
    fireEvent.change(trusted.getByLabelText('SHA-256 fingerprint'), { target: { value: SHA.replace(/:/g, '').toLowerCase() } });
    fireEvent.click(trusted.getByRole('button', { name: 'Trust' }));
    await waitFor(() => expect(screen.getByTestId('assetlinks-preview')).toHaveTextContent('com.example.app'));
    const put = h.requests.find((request) => request.method === 'PUT');
    expect(put?.body).toEqual({ trustedApps: [{ packageName: 'com.example.app', sha256: SHA }] });
  });

  it('refuses a malformed fingerprint before calling the API', async () => {
    const h = adminHost(['system_settings:read', 'system_settings:write']);
    renderWith(h, <AndroidAppPage />);
    await screen.findByText('com.example.phone (2 devices)');
    const trusted = within(screen.getByRole('region', { name: 'Trusted apps' }));
    fireEvent.change(trusted.getByLabelText('Package name', { selector: 'input' }), { target: { value: 'com.example.app' } });
    fireEvent.change(trusted.getByLabelText('SHA-256 fingerprint'), { target: { value: 'nope' } });
    fireEvent.click(trusted.getByRole('button', { name: 'Trust' }));
    expect(await screen.findByText(/Enter a SHA-256 fingerprint/)).toBeInTheDocument();
    expect(h.requests.some((request) => request.method === 'PUT')).toBe(false);
  });

  it('is read-only without system_settings:write', async () => {
    renderWith(adminHost(['system_settings:read']), <AndroidAppPage />);
    expect(await screen.findByText(/You can view these settings/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send me a test notification' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  });

  it('reports the test notification reason', async () => {
    renderWith(adminHost(['system_settings:read', 'system_settings:write']), <AndroidAppPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send me a test notification' }));
    expect(await screen.findByText(/not enabled notifications inside the Android app/)).toBeInTheDocument();
  });
});
