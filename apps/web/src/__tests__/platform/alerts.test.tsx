/**
 * The app's alerts binding (#1047): the packaged client and hooks, the page
 * with a slot, the rule editor, the dry-run result, the incident drawer and
 * the firing banner, against a test platform host shaped like the API.
 * Invented names only.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { AlertIncident, AlertKind, AlertRule } from '@marinoscar/platform-contract/alerts';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import {
  createAlertsApi,
  useAlertIncident,
  useAlertIncidents,
  useAlertKinds,
  useAlertMetricCatalog,
  useAlertMutations,
  useAlertRule,
  useAlertRules,
  useAlertSummary,
} from '@marinoscar/platform-web/alerts/headless';
import {
  AlertIncidentDrawer,
  AlertRuleDialog,
  AlertRuleTestResult,
  AlertsPage,
  FiringAlertsBanner,
} from '@marinoscar/platform-web/alerts/ui';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';
import type { TestApiResponse, TestPlatformHost } from '@marinoscar/platform-web/testing';

const RULE = '7b1e2c3d-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const INCIDENT = 'c0ffee00-1111-4222-8333-444455556666';

function rule(extra: Partial<AlertRule> = {}): AlertRule {
  return {
    id: RULE,
    key: null,
    starter: false,
    name: 'Org Alpha queue depth',
    description: null,
    enabled: true,
    kind: 'node_event',
    severity: 'warning',
    config: { eventTypes: ['power.battery_low'], resolveAfterSeconds: 3600 },
    forSeconds: 0,
    cooldownSeconds: 900,
    notifyChannels: [],
    webhook: true,
    createdById: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    lastEvaluatedAt: null,
    lastError: null,
    openIncidents: 1,
    ...extra,
  };
}

function incident(extra: Partial<AlertIncident> = {}): AlertIncident {
  return {
    id: INCIDENT,
    ruleId: RULE,
    ruleName: 'Org Alpha queue depth',
    ruleKind: 'node_event',
    labels: { 'node.name': 'Node P1' },
    state: 'firing',
    severity: 'warning',
    pendingSince: null,
    firedAt: '2026-10-31T11:59:00.000Z',
    resolvedAt: null,
    lastValue: null,
    lastSeenAt: '2026-10-31T12:00:00.000Z',
    summary: 'Node P1 battery is low.',
    acknowledgedAt: null,
    acknowledgedById: null,
    createdAt: '2026-10-31T11:59:00.000Z',
    ...extra,
  };
}

const KINDS: AlertKind[] = [
  { id: 'node_event', label: 'Node event', description: 'A node event.', eventDriven: true, builtin: true, configSchema: {} },
];
const SUMMARY = { firing: { critical: 0, warning: 1, info: 0 }, lastEvaluatedAt: null };

function hostWith(responses: Record<string, TestApiResponse>, permissions = ['alerts:read', 'alerts:write']): TestPlatformHost {
  return createTestPlatformHost({ permissions, responses });
}

function wrap(host: TestPlatformHost) {
  return ({ children }: { children: ReactNode }) => (
    <PlatformHostProvider host={host}>
      <MemoryRouter>{children}</MemoryRouter>
    </PlatformHostProvider>
  );
}

function renderWith(host: TestPlatformHost, element: ReactElement) {
  return render(element, { wrapper: wrap(host) });
}

describe('the alerts binding (#1047)', () => {
  it('createAlertsApi addresses /admin/alerts', async () => {
    const host = hostWith({ 'GET /admin/alerts/summary': SUMMARY });
    expect(await createAlertsApi(host.api).summary()).toEqual(SUMMARY);
    expect(host.requests[0]?.path).toBe('/admin/alerts/summary');
  });

  it('the hooks read rules, kinds, incidents, the summary and the metric catalog, and write', async () => {
    const host = hostWith({
      'GET /admin/alerts/rules': [rule()],
      [`GET /admin/alerts/rules/${RULE}`]: rule(),
      'GET /admin/alerts/kinds': KINDS,
      'GET /admin/alerts/incidents': { items: [incident()], total: 1, page: 1, pageSize: 20, totalPages: 1 },
      [`GET /admin/alerts/incidents/${INCIDENT}`]: incident(),
      'GET /admin/alerts/summary': SUMMARY,
      'GET /admin/telemetry/schema': { tables: [{ name: 'app_jobs_settled', rows: 1, columns: [] }] },
      [`PATCH /admin/alerts/rules/${RULE}`]: rule({ enabled: false }),
    });
    const { result } = renderHook(
      () => ({
        rules: useAlertRules(),
        one: useAlertRule(RULE),
        kinds: useAlertKinds(),
        incidents: useAlertIncidents(),
        incident: useAlertIncident(INCIDENT),
        summary: useAlertSummary({ intervalMs: 0 }),
        metrics: useAlertMetricCatalog(),
        mutations: useAlertMutations(),
      }),
      { wrapper: wrap(host) },
    );
    await waitFor(() => expect(result.current.metrics.metrics).toEqual([{ name: 'app_jobs_settled', attributes: [] }]));
    await waitFor(() => expect(result.current.summary.summary).toEqual(SUMMARY));
    expect(result.current.rules.rules).toHaveLength(1);
    expect(result.current.one.rule?.id).toBe(RULE);
    expect(result.current.kinds.kinds).toHaveLength(1);
    expect(result.current.incidents.total).toBe(1);
    expect(result.current.incident.incident?.id).toBe(INCIDENT);
    await act(async () => {
      expect((await result.current.mutations.toggle(RULE, false))?.enabled).toBe(false);
    });
  });

  it('AlertsPage renders a BeforeContent slot over its tabs', async () => {
    const host = hostWith({ 'GET /admin/alerts/rules': [rule()], 'GET /admin/alerts/kinds': KINDS });
    renderWith(host, <AlertsPage slots={{ BeforeContent: () => <p>Escalation policy for Org Alpha</p> }} />);
    expect(await screen.findByText('Escalation policy for Org Alpha')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Org Alpha queue depth' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Incidents' })).toBeInTheDocument();
  });

  it('AlertRuleDialog builds an update for an existing rule', () => {
    const onSubmit = vi.fn();
    render(<AlertRuleDialog open rule={rule()} kinds={KINDS} onSubmit={onSubmit} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Org Alpha queue depth', config: { eventTypes: ['power.battery_low'], resolveAfterSeconds: 3600 } }),
    );
  });

  it('AlertRuleTestResult shows the observations of a dry run', () => {
    render(
      <AlertRuleTestResult
        result={{
          ruleId: RULE,
          kind: 'node_event',
          evaluatedAt: '2026-10-31T12:00:00.000Z',
          durationMs: 2,
          observations: [{ labels: { 'node.name': 'Node P1' }, value: null, breached: true, summary: 'Battery low on Node P1' }],
          error: null,
        }}
      />,
    );
    expect(screen.getByText('Battery low on Node P1')).toBeInTheDocument();
  });

  it('AlertIncidentDrawer acknowledges an incident', async () => {
    const host = hostWith({ [`GET /admin/alerts/incidents/${INCIDENT}`]: incident() });
    const onAcknowledge = vi.fn().mockResolvedValue(incident({ acknowledgedAt: '2026-10-31T12:01:00.000Z' }));
    renderWith(host, <AlertIncidentDrawer incidentId={INCIDENT} canWrite onAcknowledge={onAcknowledge} onClose={() => undefined} />);
    const drawer = await screen.findByRole('region', { name: 'Incident detail' });
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(onAcknowledge).toHaveBeenCalledTimes(1));
  });

  it('FiringAlertsBanner shows what is firing', async () => {
    const host = hostWith({ 'GET /admin/alerts/summary': SUMMARY });
    renderWith(host, <FiringAlertsBanner intervalMs={0} />);
    expect(await screen.findByText('1 alert is firing')).toBeInTheDocument();
  });
});
