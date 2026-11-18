/**
 * The Android app page's markup did not move (PP-14.24).
 *
 * `AndroidAppPage` gained the page-slot contract (`PageSlotsBase`) and its three
 * sections became exports. The snapshot beside this file (`__snapshots__/`) was
 * RECORDED FROM THE PAGE AS IT WAS BEFORE THAT CHANGE (the same fixtures,
 * rendered by the old page), so passing means the page an administrator sees
 * with no slot passed is, element for element and class for class, the one they
 * had. The only normalisation is React's generated ids (`_r_1f_`); the release
 * date prints in the test machine's locale, so it is replaced. Re-record only
 * for a deliberate change of the page.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { AndroidAppPage } from '../../src/android-app/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';

const SHA = Array.from({ length: 32 }, (_, i) => ((i * 3 + 17) % 256).toString(16).toUpperCase().padStart(2, '0')).join(':');

const html = (root: Element): string =>
  root.innerHTML.replace(/_r_[0-9a-z]+_/g, '_rX_').replace(/\d+\/\d+\/\d{4}, [\d:]+ [AP]M/g, '<date>');

async function mount(permissions: string[]): Promise<string> {
  const host = createTestPlatformHost({
    permissions,
    responses: {
      'GET /admin/android-app': {
        trustedApps: [{ packageName: 'com.example.app', sha256: SHA }],
        reportedApps: [{ packageName: 'com.example.phone', sha256: SHA, deviceCount: 2, lastSeenAt: null, trusted: false }],
        assetLinks: [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: { namespace: 'android_app', package_name: 'com.example.app', sha256_cert_fingerprints: [SHA] },
          },
        ],
        pushSubscriptions: { androidApp: 1, browser: 2, androidAppUsers: 1 },
      },
      'GET /admin/android-app/releases': [
        {
          id: '00000000-0000-4000-8000-000000000001',
          packageName: 'com.example.app',
          versionName: '1.4.0',
          versionCode: 14,
          fileSha256: 'a'.repeat(64),
          sizeBytes: '4194304',
          notes: null,
          createdAt: '2026-10-08T00:00:00.000Z',
          signingSha256: SHA,
          isCurrent: true,
          storageProvider: 's3',
          uploadedBy: null,
        },
      ],
    },
  });
  const { container, unmount } = render(
    <MemoryRouter>
      <PlatformHostProvider host={host}>
        <AndroidAppPage />
      </PlatformHostProvider>
    </MemoryRouter>,
  );
  await screen.findByText('com.example.phone (2 devices)');
  await screen.findByText('1.4.0 (14)', { exact: false });
  const out = html(container);
  unmount();
  return out;
}

describe("the Android app page's markup is unchanged", () => {
  it('writable', async () => {
    expect(await mount(['system_settings:read', 'system_settings:write'])).toMatchSnapshot();
  });

  it('read-only', async () => {
    expect(await mount(['system_settings:read'])).toMatchSnapshot();
  });
});
