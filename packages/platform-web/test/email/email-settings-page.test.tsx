// The email settings page, rendered from the package with a test host
// (#737): it reads the viewer's permissions and address from the host, gates
// itself on system_settings:read and its writes on system_settings:write.
// The page's full behaviour is covered in the reference app
// (apps/web/src/__tests__/pages/Admin/EmailSettingsPage*.test.tsx).
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import type { PlatformWebHost } from '../../src/core/index.js';
import { EmailSettingsPage } from '../../src/email/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';

const STATUS = { configured: false, hint: null, updatedAt: null, updatedByUserId: null };
const SETTINGS = {
  provider: 'smtp',
  enabled: true,
  fromAddress: 'no-reply@example.test',
  smtpHost: 'smtp.example.test',
  smtpPasswordStatus: STATUS,
  sesSecretAccessKeyStatus: STATUS,
  settingsError: null,
  version: 1,
  updatedAt: null,
  updatedBy: null,
};

function renderPage(permissions: string[]) {
  const base = createTestPlatformHost({ permissions, responses: { 'GET /email-settings': SETTINGS } });
  const host: PlatformWebHost = { ...base, viewer: { ...base.viewer, email: 'admin@example.test' } };
  return render(
    <PlatformHostProvider host={host}>
      <MemoryRouter initialEntries={['/admin/settings/email']}>
        <Routes>
          <Route path="/admin/settings/email" element={<EmailSettingsPage />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </PlatformHostProvider>,
  );
}

describe('EmailSettingsPage (package)', () => {
  it('names the viewer address the test goes to, for a writer', async () => {
    renderPage(['system_settings:read', 'system_settings:write']);
    expect(await screen.findByText(/Sends a real message to your own address, admin@example.test\./)).toBeInTheDocument();
  });

  it('is read-only for a reader', async () => {
    renderPage(['system_settings:read']);
    expect(await screen.findByText(/\(read-only\)/i)).toBeInTheDocument();
  });

  it('redirects a viewer without system_settings:read', () => {
    renderPage([]);
    expect(screen.getByText('home')).toBeInTheDocument();
  });
});
