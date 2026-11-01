/**
 * Issue #924 (PP-14.6): an AI provider an app registered shows up on the admin
 * AI page with no web code.
 *
 * The reference app registers `example-transcribe`
 * (apps/api/src/platform-extensions/ai/example-transcribe/) with
 * `registerAiProvider`. The API describes it in `GET /api/admin/ai/config`
 * (`descriptors`), and the packaged page draws the generic card from that
 * descriptor. Nothing is mocked but the network (MSW), so the test proves the
 * wire: the settings save as `{ enabled: true, region: 'eu' }` in the one
 * `PUT /admin/ai/config`, and the write-only key goes out once, alone, in the
 * `PUT /admin/ai/providers/example-transcribe/key` body.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import AiConfigPage from '@marinoscar/platform-web/ai/ui/config-page';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { mockAiAdminConfigWithExample } from '../../mocks/fixtures/ai';

const TYPED_KEY = 'asm-example-key-NEVER-RENDERED-0001';

interface Captured {
  method: string;
  path: string;
  body: unknown;
}

function capture(list: Captured[]) {
  server.events.on('request:start', async ({ request }) => {
    const url = new URL(request.url);
    if (!url.pathname.includes('/admin/ai/')) return;
    let body: unknown = null;
    try {
      body = await request.clone().json();
    } catch {
      body = null;
    }
    list.push({ method: request.method, path: url.pathname, body });
  });
}

describe('example-transcribe on the admin AI page (#924)', () => {
  let captured: Captured[];

  beforeEach(() => {
    server.resetHandlers();
    server.events.removeAllListeners();
    captured = [];
    capture(captured);
    server.use(
      http.get('*/api/admin/ai/config', () => HttpResponse.json({ data: mockAiAdminConfigWithExample })),
      http.put('*/api/admin/ai/config', () => HttpResponse.json({ data: mockAiAdminConfigWithExample })),
      http.put('*/api/admin/ai/providers/:provider/key', () => HttpResponse.json({ data: mockAiAdminConfigWithExample })),
    );
  });

  afterEach(() => {
    server.events.removeAllListeners();
  });

  async function renderCard() {
    const user = userEvent.setup();
    render(<AiConfigPage />, { wrapperOptions: { user: mockAdminUser } });
    const card = await screen.findByTestId('ai-provider-example-transcribe');
    return { user, card: within(card) };
  }

  it('renders the generic card from the descriptor: a switch, the region, a write-only key', async () => {
    const { card } = await renderCard();

    expect(card.getByRole('heading', { name: 'Example Transcribe' })).toBeInTheDocument();
    expect(card.getByRole('switch', { name: 'Enable Example Transcribe' })).not.toBeChecked();
    expect(card.getByRole('combobox', { name: 'Region' })).toHaveTextContent('us');
    expect(card.getByText('Processing region')).toBeInTheDocument();

    const key = card.getByLabelText(/Example Transcribe API key/);
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveValue('');
    expect(key).toBeRequired();
  });

  it('submits { enabled: true, region: "eu" } in the one PUT, beside the built-in unchanged', async () => {
    const { user, card } = await renderCard();

    await user.click(card.getByRole('switch', { name: 'Enable Example Transcribe' }));
    await user.click(card.getByRole('combobox', { name: 'Region' }));
    await user.click(screen.getByRole('option', { name: 'eu' }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(captured.some((c) => c.method === 'PUT' && c.path.endsWith('/admin/ai/config'))).toBe(true));
    const put = captured.find((c) => c.method === 'PUT' && c.path.endsWith('/admin/ai/config'));
    expect((put?.body as { providers: Record<string, unknown> }).providers).toEqual({
      openai: { enabled: false, baseUrl: null },
      'example-transcribe': { enabled: true, region: 'eu' },
    });
  });

  it('sends the typed key once, to the deployment-key route, and never shows it again', async () => {
    const { user, card } = await renderCard();

    const key = card.getByLabelText(/Example Transcribe API key/);
    await user.type(key, TYPED_KEY);
    await user.click(card.getByRole('button', { name: /save key/i }));

    await waitFor(() =>
      expect(captured.filter((c) => c.method === 'PUT' && c.path.endsWith('/providers/example-transcribe/key'))).toHaveLength(1),
    );
    const put = captured.find((c) => c.path.endsWith('/providers/example-transcribe/key'));
    expect(put?.body).toEqual({ apiKey: TYPED_KEY });
    await waitFor(() => expect(key).toHaveValue(''));
    expect(document.body.innerHTML).not.toContain(TYPED_KEY);
    // The key is not in the settings PUT.
    expect(captured.filter((c) => c.path.endsWith('/admin/ai/config') && c.method === 'PUT')).toHaveLength(0);
  });
});
