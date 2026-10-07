/**
 * The telemetry slice as a package (issue #704): what the app hands in
 * through the adapters reaches the pages, an app's own metric group renders
 * with no web code, the client goes through the host's transport (downloads
 * and the assistant stream included), and the admin cards are the registry
 * literals the app declared before the move.
 */
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import TelemetryDashboardPage from '../../src/telemetry/ui/pages/TelemetryDashboardPage.js';
import TelemetrySettingsPage from '../../src/telemetry/ui/pages/TelemetrySettingsPage.js';
import * as ui from '../../src/telemetry/ui/index.js';
import { createTelemetryClient } from '../../src/telemetry/headless/index.js';
import type { DashboardMetrics, TelemetryAssistantAnswer, TelemetryAssistantStep } from '../../src/telemetry/headless/index.js';
import { createTestApiError, createTestBlobResponse, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiRequest } from '../../src/testing/index.js';
import { render, screen, waitFor, within } from './harness.js';
import {
  mockTelemetryAdminConfig,
  mockTelemetryConnectionStored,
  mockTelemetryStackRunning,
  mockTelemetryStatus,
} from './fixtures/telemetry.js';
import { dashboardResponses, mockDashboardMetricGroups, mockDashboardMetrics } from './fixtures/telemetryDashboard.js';

const SETTINGS_RESPONSES = {
  'GET /admin/telemetry/config': mockTelemetryAdminConfig,
  'GET /admin/telemetry/status': mockTelemetryStatus,
  'GET /admin/telemetry/connection': mockTelemetryConnectionStored,
  'GET /admin/telemetry/stack': mockTelemetryStackRunning,
};

describe('TelemetryWebAdapters reach the pages', () => {
  it('the settings page lists the models the app adapter returns, tool-calling first', async () => {
    const user = userEvent.setup();
    render(<TelemetrySettingsPage />, {
      wrapperOptions: {
        telemetryEnabled: true,
        aiEnabled: true,
        route: '/admin/settings/telemetry',
        responses: SETTINGS_RESPONSES,
        models: [
          { id: 'm1', provider: 'acme', modelId: 'plain-1', label: 'Plain One', supportsToolCalling: false },
          { id: 'm2', provider: 'acme', modelId: 'tools-2', label: 'Tools Two', supportsToolCalling: true },
        ],
      },
    });
    await screen.findByRole('switch', { name: 'Collect telemetry' });

    await user.click(screen.getByRole('combobox', { name: /model/i }));
    const listbox = await screen.findByRole('listbox');
    const labels = within(listbox)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(labels.findIndex((text) => text?.includes('Tools Two'))).toBeLessThan(
      labels.findIndex((text) => text?.includes('Plain One')),
    );
    expect(within(listbox).getByText('acme · tool calling')).toBeInTheDocument();
    expect(within(listbox).getByText('acme · tool calling not declared')).toBeInTheDocument();
  });

  it("the settings page shows the app's spinner while the config loads", () => {
    render(<TelemetrySettingsPage />, {
      wrapperOptions: {
        telemetryEnabled: true,
        responses: { ...SETTINGS_RESPONSES, 'GET /admin/telemetry/config': () => new Promise(() => undefined) },
        adapters: { Spinner: () => <span>app spinner</span> },
      },
    });
    expect(screen.getByText('app spinner')).toBeInTheDocument();
  });
});

describe('an app metric group (EvoPath-shaped `coach`)', () => {
  it('renders as a dashboard section titled from the API metadata, with no web code', async () => {
    const coach: DashboardMetrics = {
      ...mockDashboardMetrics.queue,
      group: 'coach',
      tiles: [{ ...mockDashboardMetrics.queue.tiles[0]!, key: 'coachNudges', label: 'Nudges sent' }],
      series: [],
      tables: [],
    };
    const base = dashboardResponses();
    render(
      <Routes>
        <Route path="/admin/settings/telemetry/dashboard" element={<TelemetryDashboardPage />} />
      </Routes>,
      {
        wrapperOptions: {
          telemetryEnabled: true,
          route: '/admin/settings/telemetry/dashboard',
          responses: {
            ...base,
            'GET /admin/telemetry/dashboard/metric-groups': [
              ...mockDashboardMetricGroups,
              { id: 'coach', label: 'Coach', title: 'AI Coach', order: 70 },
            ],
            'GET /admin/telemetry/dashboard/metrics': (request: TestApiRequest) =>
              request.path.includes('group=coach')
                ? coach
                : base['GET /admin/telemetry/dashboard/metrics']!(request),
          },
        },
      },
    );

    const region = await screen.findByRole('region', { name: 'AI Coach' }, { timeout: 15_000 });
    expect(region).toHaveAttribute('id', 'telemetry-section-coach');
    expect(await within(region).findByTestId('tile-coachNudges')).toBeInTheDocument();
  });
});

describe('createTelemetryClient over the host transport', () => {
  it('exports through postBlob and reports the server filename and row headers', async () => {
    const host = createTestPlatformHost({
      responses: {
        'POST /admin/telemetry/export': createTestBlobResponse('a\n1\n', {
          'Content-Disposition': 'attachment; filename="telemetry-x.csv"',
          'X-Telemetry-Row-Count': '1',
          'X-Telemetry-Truncated': 'true',
        }),
      },
    });
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });

    const result = await createTelemetryClient(host.api).exportTelemetry('SELECT 1', 'csv');

    expect(result).toEqual({ filename: 'telemetry-x.csv', rowCount: 1, truncated: true });
    expect(host.requests).toEqual([
      { method: 'POST', path: '/admin/telemetry/export', body: { sql: 'SELECT 1', format: 'csv' } },
    ]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('streams the assistant through postSse, normalising an answer without a report', async () => {
    const host = createTestPlatformHost({
      responses: {
        'POST /admin/telemetry/assistant/stream': [
          { event: 'step', data: { tool: 'run_query', summary: 'Counting errors' } },
          { event: 'answer', data: { answer: 'All good' } },
          { event: 'error', data: { message: 'late failure' } },
        ],
      },
    });
    const steps: TelemetryAssistantStep[] = [];
    const answers: TelemetryAssistantAnswer[] = [];
    const errors: unknown[] = [];

    await createTelemetryClient(host.api).streamTelemetryAssistant(
      { question: 'Anything wrong?' },
      { onStep: (s) => steps.push(s), onAnswer: (a) => answers.push(a), onError: (e) => errors.push(e) },
    );

    expect(steps).toHaveLength(1);
    expect(answers[0]?.report).toBeNull();
    expect(errors).toEqual([{ code: 'ERROR', message: 'late failure' }]);
    expect(host.requests[0]).toMatchObject({ method: 'POST', body: { question: 'Anything wrong?' } });
  });

  it('rejects with the API error when the stream is refused before the first byte', async () => {
    const host = createTestPlatformHost({
      responses: {
        'POST /admin/telemetry/assistant/stream': () => {
          throw createTestApiError(409, 'The assistant is off', 'CONFLICT');
        },
      },
    });
    await expect(createTelemetryClient(host.api).streamTelemetryAssistant({ question: 'q' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('says so instead of failing silently when the transport cannot download or stream', async () => {
    const { postBlob: _blob, postSse: _sse, ...plain } = createTestPlatformHost().api;
    const client = createTelemetryClient(plain);
    await expect(client.exportTelemetry('SELECT 1', 'csv')).rejects.toThrow(/postBlob/);
    await expect(client.streamTelemetryAssistant({ question: 'q' })).rejects.toThrow(/postSse/);
  });

  it('sends If-Match from the expected version on PUT and DELETE', async () => {
    const host = createTestPlatformHost({
      responses: { 'PUT /admin/telemetry/config': {}, 'DELETE /admin/telemetry/connection': {} },
    });
    const client = createTelemetryClient(host.api);
    await client.updateTelemetryAdminConfig({ enabled: true } as never, 4);
    await client.resetTelemetryConnection(0);
    await waitFor(() => expect(host.requests).toHaveLength(2));
    expect(host.requests.map((request) => request.ifMatch)).toEqual(['4', '0']);
  });
});

describe('telemetryAdminCards', () => {
  it('are the three Observability cards, verbatim, in registry order', () => {
    expect(ui.telemetryAdminCards.map(({ Icon: _icon, ...card }) => card)).toEqual([
      {
        title: 'Telemetry',
        description:
          'Turn telemetry collection on, choose how long it is kept, set query limits and configure the AI assistant.',
        path: '/admin/settings/telemetry',
        permission: 'telemetry:read',
      },
      {
        title: 'Telemetry Explorer',
        description: 'Query traces, logs and metrics with SQL, export the results, and ask the AI assistant for help.',
        path: '/admin/settings/telemetry/explorer',
        permission: 'telemetry:query',
        feature: 'telemetry',
      },
      {
        title: 'Telemetry Dashboard',
        description:
          'See at a glance whether anything is wrong: error rate, latency, error logs and the top failing routes.',
        path: '/admin/settings/telemetry/dashboard',
        permission: 'telemetry:query',
        feature: 'telemetry',
      },
    ]);
    // The Telemetry card has no feature: it is where telemetry is switched on.
    expect('feature' in ui.telemetryAdminCards[0]!).toBe(false);
  });

  it('carries the icons the registry used', () => {
    expect(ui.telemetryAdminCards.map((card) => (card.Icon as { type?: { render?: { displayName?: string } } }).type?.render?.displayName ?? (card.Icon as { displayName?: string }).displayName)).toEqual([
      'InsightsOutlinedIcon',
      'TerminalOutlinedIcon',
      'MonitorHeartOutlinedIcon',
    ]);
  });
});
