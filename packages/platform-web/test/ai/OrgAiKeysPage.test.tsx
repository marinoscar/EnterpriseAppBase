// The Organization AI keys page (#739), rendered from the package with a test
// host: masked rows per provider, set and remove behind org_ai_config:write,
// the effective policy read-only, the single-org note, and a key that is
// never shown back.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OrgAiKeysPage } from '../../src/ai/ui/index.js';
import { PlatformHostProvider } from '../../src/core/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';

const SECRET = 'sk-typed-into-the-page-0000';

const KEYS = [
  { provider: 'openai', displayName: 'OpenAI', configured: true, hint: '••••9999', verifiedAt: '2026-10-01T00:00:00.000Z' },
  { provider: 'anthropic', displayName: 'Anthropic', configured: false, hint: null, verifiedAt: null },
];

const POLICY = {
  enabled: true,
  keyPolicy: 'byok_with_org_fallback',
  limits: { perOrg: { requestsPerDay: 500 } },
};

function renderPage(permissions: string[], overrides: Record<string, unknown> = {}) {
  const host = createTestPlatformHost({
    permissions,
    responses: {
      'GET /admin/ai/org-keys': KEYS,
      'GET /org-settings': { effective: { ai: POLICY } },
      'PUT /admin/ai/org-keys/anthropic': { provider: 'anthropic', displayName: 'Anthropic', configured: true, hint: '••••0000', verifiedAt: '2026-10-08T00:00:00.000Z' },
      'DELETE /admin/ai/org-keys/openai': undefined,
      ...overrides,
    },
  });
  render(
    <PlatformHostProvider host={host}>
      <OrgAiKeysPage />
    </PlatformHostProvider>,
  );
  return host;
}

describe('OrgAiKeysPage (package)', () => {
  it('lists every provider masked, with the effective policy and the single-org note', async () => {
    renderPage(['org_ai_config:read']);
    const openai = await screen.findByTestId('org-ai-key-openai');
    expect(within(openai).getByText('Key set')).toBeInTheDocument();
    expect(within(openai).getByText(/••••9999/)).toBeInTheDocument();
    expect(within(screen.getByTestId('org-ai-key-anthropic')).getByText('No organization key')).toBeInTheDocument();
    expect(await screen.findByText(/Requests per day for the organization: 500/)).toBeInTheDocument();
    expect(screen.getByText(/deployment key on the AI settings page/)).toBeInTheDocument();
  });

  it('is read-only without org_ai_config:write', async () => {
    renderPage(['org_ai_config:read']);
    expect(await screen.findByText(/\(read-only\)/)).toBeInTheDocument();
    const row = await screen.findByTestId('org-ai-key-anthropic');
    expect(within(row).getByLabelText('API key')).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('sets a key once and clears the field; the key is never shown back', async () => {
    const host = renderPage(['org_ai_config:read', 'org_ai_config:write']);
    const row = await screen.findByTestId('org-ai-key-anthropic');
    fireEvent.change(within(row).getByLabelText('API key'), { target: { value: SECRET } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(within(screen.getByTestId('org-ai-key-anthropic')).getByText('Key set')).toBeInTheDocument());
    expect(host.requests.find((r) => r.method === 'PUT')).toMatchObject({ path: '/admin/ai/org-keys/anthropic', body: { apiKey: SECRET } });
    expect(document.body.textContent ?? '').not.toContain(SECRET);
  });

  it('removes a key', async () => {
    const host = renderPage(['org_ai_config:read', 'org_ai_config:write']);
    const row = await screen.findByTestId('org-ai-key-openai');
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(within(screen.getByTestId('org-ai-key-openai')).getByText('No organization key')).toBeInTheDocument());
    expect(host.requests.some((r) => r.method === 'DELETE' && r.path === '/admin/ai/org-keys/openai')).toBe(true);
  });

  it('a rejected key shows the reason and stores nothing', async () => {
    renderPage(['org_ai_config:read', 'org_ai_config:write'], {
      'PUT /admin/ai/org-keys/anthropic': () => {
        throw Object.assign(new Error('rejected'), { status: 400, details: { reason: 'AI_KEY_INVALID' } });
      },
    });
    const row = await screen.findByTestId('org-ai-key-anthropic');
    fireEvent.change(within(row).getByLabelText('API key'), { target: { value: SECRET } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('org-ai-keys-error')).toHaveTextContent('The provider rejected this key. Nothing was saved.');
  });
});
