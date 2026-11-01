// The alerts UI (issue #1047): the rules table with the enable switch and the
// Built-in chip, the editor per kind building valid payloads, the dry-run
// result, a starter rule that cannot be deleted, the incidents tab with its
// filters, drawer and Acknowledge, the read-only view, the firing banner and
// the admin card as data.
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAlertRuleSchema } from '@marinoscar/platform-contract/alerts';

import {
  ALERTS_PAGE_COPY,
  AlertRuleDialog,
  AlertRuleTestResult,
  AlertsPage,
  FiringAlertsBanner,
  alertsAdminCards,
} from '../../src/alerts/ui/index.js';
import { INCIDENT_ID, KINDS, RULE_ID, SCHEMA, STARTER_ID, hostWith, incident, renderWith, rule, starterRule } from './fixtures.js';

// The first render cold-loads the data grid; on a loaded runner that can pass
// the 1 s default of `findBy*`.
configure({ asyncUtilTimeout: 5000 });

const RULES = 'GET /admin/alerts/rules';
const KINDS_ROUTE = 'GET /admin/alerts/kinds';

function basics(extra: Record<string, unknown> = {}) {
  return {
    [RULES]: [rule(), starterRule()],
    [KINDS_ROUTE]: KINDS,
    'GET /admin/telemetry/schema': SCHEMA,
    ...extra,
  };
}

async function chooseOption(label: string | RegExp, option: string | RegExp) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: option }));
}

async function openRowMenu(index: number, item: RegExp) {
  fireEvent.click((await screen.findAllByRole('button', { name: /^Row actions/ }))[index]!);
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}

describe('AlertsPage: rules', () => {
  it('lists each rule with its kind, severity, Built-in chip and last error', async () => {
    const host = hostWith(basics({ [RULES]: [rule({ lastError: 'No table for the metric yet.' }), starterRule()] }));
    renderWith(host, <AlertsPage />);
    expect(await screen.findByRole('button', { name: 'Queue depth high on Project P1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alerts', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Built-in')).toBeInTheDocument();
    expect(screen.getAllByText('Metric threshold').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
    expect(screen.getByText('No table for the metric yet.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rules', selected: true })).toBeInTheDocument();
  });

  it('enables and disables a rule with its switch', async () => {
    const host = hostWith(basics({ [`PATCH /admin/alerts/rules/${RULE_ID}`]: rule({ enabled: false }) }));
    renderWith(host, <AlertsPage />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Disable Queue depth high on Project P1' }));
    await waitFor(() => expect(host.requests.find((r) => r.method === 'PATCH')?.body).toEqual({ enabled: false }));
  });

  it('creates a metric_threshold rule from the editor, the metric picked from the store', async () => {
    const host = hostWith(basics({ 'POST /admin/alerts/rules': rule({ name: 'Depth' }) }));
    renderWith(host, <AlertsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New alert rule' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Name/ }), { target: { value: 'Depth' } });
    const metric = within(dialog).getByRole('combobox', { name: /Metric/ });
    fireEvent.change(metric, { target: { value: 'app_jobs' } });
    fireEvent.click(await screen.findByRole('option', { name: 'app_jobs_queue_depth' }));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Threshold/ }), { target: { value: '250' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(host.requests.some((r) => r.method === 'POST')).toBe(true));
    const body = host.requests.find((r) => r.method === 'POST')?.body;
    expect(body).toMatchObject({
      name: 'Depth',
      kind: 'metric_threshold',
      config: { metric: 'app_jobs_queue_depth', threshold: 250, aggregation: 'avg', windowSeconds: 300, comparator: 'gt' },
    });
    expect(createAlertRuleSchema.safeParse(body).success).toBe(true);
    expect(await screen.findByText('Rule “Depth” created.')).toBeInTheDocument();
  });

  it('shows the field errors instead of sending an invalid draft', async () => {
    const host = hostWith(basics());
    renderWith(host, <AlertsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New alert rule' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create rule' }));
    expect(await within(dialog).findByText('Enter a name.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a metric.')).toBeInTheDocument();
    expect(host.requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('runs a dry run from a row and shows what it observed', async () => {
    const host = hostWith(
      basics({
        [`POST /admin/alerts/rules/${RULE_ID}/test`]: {
          ruleId: RULE_ID,
          kind: 'metric_threshold',
          evaluatedAt: '2026-10-31T12:00:00.000Z',
          durationMs: 12,
          observations: [{ labels: { job_type: 'export' }, value: 140, breached: true, summary: 'max 140 > 100' }],
          error: null,
        },
      }),
    );
    renderWith(host, <AlertsPage />);
    await screen.findByRole('button', { name: 'Queue depth high on Project P1' });
    await openRowMenu(0, /Test rule/);
    const dialog = await screen.findByRole('dialog', { name: /Test: Queue depth high/ });
    expect(await within(dialog).findByText('max 140 > 100')).toBeInTheDocument();
    expect(within(dialog).getByText('1 of 1 observation would fire.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Nothing was stored/)).toBeInTheDocument();
  });

  it('never offers Delete for a built-in rule, and deletes another one after a confirmation', async () => {
    const host = hostWith(basics({ [`DELETE /admin/alerts/rules/${RULE_ID}`]: null }));
    renderWith(host, <AlertsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Worker node offline' }));
    const starter = await screen.findByRole('dialog', { name: 'Edit Worker node offline' });
    expect(within(starter).getByText(/This is a built-in rule/)).toBeInTheDocument();
    expect(within(starter).getByText('This kind has nothing to configure.')).toBeInTheDocument();
    expect(within(starter).queryByRole('button', { name: 'Delete' })).toBeNull();
    fireEvent.click(within(starter).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Worker node offline' })).toBeNull());

    fireEvent.click(await screen.findByRole('button', { name: 'Queue depth high on Project P1' }));
    const editor = await screen.findByRole('dialog', { name: 'Edit Queue depth high on Project P1' });
    fireEvent.click(within(editor).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this rule?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete rule' }));
    await waitFor(() => expect(host.requests.some((r) => r.method === 'DELETE' && r.path.endsWith(RULE_ID))).toBe(true));
    expect(host.requests.some((r) => r.method === 'DELETE' && r.path.endsWith(STARTER_ID))).toBe(false);
  });

  it('is read-only without alerts:write: no New rule, disabled switches, a disabled form', async () => {
    const host = hostWith(basics(), ['alerts:read']);
    renderWith(host, <AlertsPage />);
    expect(await screen.findByRole('heading', { name: 'Alerts (read-only)', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New rule' })).toBeNull();
    await screen.findByRole('button', { name: 'Queue depth high on Project P1' });
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Queue depth high on Project P1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Queue depth high on Project P1' });
    expect(within(dialog).getByRole('textbox', { name: /Name/ })).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Test' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    // The metric list is not even asked for.
    expect(host.requests.some((r) => r.path.startsWith('/admin/telemetry'))).toBe(false);
  });

  it('renders the slots', async () => {
    const host = hostWith(basics());
    renderWith(host, <AlertsPage slots={{ BeforeContent: () => <p>On-call notice for Org Alpha</p> }} />);
    expect(await screen.findByText('On-call notice for Org Alpha')).toBeInTheDocument();
  });
});

describe('AlertRuleDialog per kind', () => {
  function renderDialog(onSubmit = vi.fn(), extra: Partial<Parameters<typeof AlertRuleDialog>[0]> = {}) {
    render(<AlertRuleDialog open rule={null} kinds={KINDS} onSubmit={onSubmit} onClose={() => undefined} {...extra} />);
    return onSubmit;
  }

  it('node_event: picks event types, an attribute and a recovery', async () => {
    const onSubmit = renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), { target: { value: 'Battery of Node P1' } });
    await chooseOption(/Kind/, 'Node event');
    const types = screen.getByRole('combobox', { name: /^Event types/ });
    fireEvent.change(types, { target: { value: 'battery_low' } });
    fireEvent.click(await screen.findByRole('option', { name: 'power.battery_low' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add attribute' })[0]!);
    fireEvent.change(screen.getByRole('textbox', { name: 'Attribute' }), { target: { value: 'source' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), { target: { value: 'battery' } });
    const recovery = screen.getByRole('combobox', { name: /Recovery event types/ });
    fireEvent.change(recovery, { target: { value: 'recovered' } });
    fireEvent.click(await screen.findByRole('option', { name: 'power.battery_recovered' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const body = onSubmit.mock.calls[0]![0];
    expect(body).toMatchObject({
      name: 'Battery of Node P1',
      kind: 'node_event',
      config: {
        eventTypes: ['power.battery_low'],
        attrs: { source: 'battery' },
        recovery: { eventTypes: ['power.battery_recovered'] },
        resolveAfterSeconds: 3600,
      },
    });
    expect(createAlertRuleSchema.safeParse(body).success).toBe(true);
  });

  it('verdict: the least level', async () => {
    const onSubmit = renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), { target: { value: 'Dashboard degraded' } });
    await chooseOption(/Kind/, 'Dashboard verdict');
    await chooseOption(/Least verdict level/, 'Degraded');
    await chooseOption(/^Severity/, 'Critical');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Push' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      kind: 'verdict',
      severity: 'critical',
      config: { minLevel: 'degraded' },
      notifyChannels: ['push'],
    });
  });

  it('node_offline and telemetry_unavailable: nothing to configure', async () => {
    const onSubmit = renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), { target: { value: 'Offline nodes' } });
    await chooseOption(/Kind/, 'Node offline');
    expect(screen.getByText('This kind has nothing to configure.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ kind: 'node_offline', config: {} });
    await chooseOption(/Kind/, 'Telemetry unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    expect(onSubmit.mock.calls[1]![0]).toMatchObject({ kind: 'telemetry_unavailable', config: {} });
  });

  it('an existing rule: the kind is fixed, the update omits it, and Test shows observations', async () => {
    const onTest = vi.fn().mockResolvedValue({
      ruleId: RULE_ID,
      kind: 'metric_threshold',
      evaluatedAt: '2026-10-31T12:00:00.000Z',
      durationMs: 3,
      observations: [],
      error: 'The telemetry store has no table for the metric "app.jobs.queue.depth" (yet).',
    });
    const onSubmit = renderDialog(vi.fn(), { rule: rule(), onTest });
    expect(screen.getByRole('combobox', { name: /Kind/ })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText(/could not be evaluated: The telemetry store has no table/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const body = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect('kind' in body).toBe(false);
    expect(body['config']).toEqual(rule().config);
  });
});

describe('AlertRuleTestResult', () => {
  it('lists breached observations first, with labels and values, and says when nothing matched', () => {
    const { rerender } = render(
      <AlertRuleTestResult
        result={{
          ruleId: RULE_ID,
          kind: 'node_offline',
          evaluatedAt: '2026-10-31T12:00:00.000Z',
          durationMs: 5,
          observations: [
            { labels: { 'node.name': 'Node P2' }, value: null, breached: false, summary: 'Node P2 is online' },
            { labels: { 'node.name': 'Node P1' }, value: 7, breached: true, summary: 'Node P1 is offline' },
          ],
          error: null,
        }}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByText('Node P1 is offline')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Breached')).toBeInTheDocument();
    expect(within(items[0]!).getByText('node.name=Node P1 · value 7')).toBeInTheDocument();
    expect(within(items[1]!).getByText('OK')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 observations would fire.')).toBeInTheDocument();
    rerender(
      <AlertRuleTestResult
        result={{ ruleId: RULE_ID, kind: 'verdict', evaluatedAt: '2026-10-31T12:00:00.000Z', durationMs: 1, observations: [], error: null }}
      />,
    );
    expect(screen.getByText(/No observations/)).toBeInTheDocument();
  });
});

describe('AlertsPage: incidents', () => {
  const PAGE = { items: [incident()], total: 1, page: 1, pageSize: 20, totalPages: 1 };

  it('opens on ?tab=incidents, filters by state, and acknowledges from the drawer', async () => {
    const host = hostWith(
      basics({
        'GET /admin/alerts/incidents': PAGE,
        [`GET /admin/alerts/incidents/${INCIDENT_ID}`]: incident(),
        [`POST /admin/alerts/incidents/${INCIDENT_ID}/acknowledge`]: incident({ acknowledgedAt: '2026-10-31T12:05:00.000Z' }),
      }),
    );
    renderWith(host, <AlertsPage />, '/admin/settings/alerts?tab=incidents');
    expect(await screen.findByRole('tab', { name: 'Incidents', selected: true })).toBeInTheDocument();
    expect(await screen.findByText('Node P1 has not reported for 5 minutes.')).toBeInTheDocument();
    expect(host.requests.some((r) => r.path === '/admin/alerts/incidents?page=1&pageSize=20')).toBe(true);

    await chooseOption(/^State/, 'Firing');
    await waitFor(() =>
      expect(host.requests.some((r) => r.path === '/admin/alerts/incidents?state=firing&page=1&pageSize=20')).toBe(true),
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Worker node offline' })[0]!);
    const drawer = await screen.findByRole('region', { name: 'Incident detail' });
    expect(await within(drawer).findByText('node.id=node-p1, node.name=Node P1')).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(host.requests.some((r) => r.method === 'POST' && r.path.endsWith('/acknowledge'))).toBe(true));
  });

  it('draws no Acknowledge for a read-only viewer', async () => {
    const host = hostWith(
      basics({ 'GET /admin/alerts/incidents': PAGE, [`GET /admin/alerts/incidents/${INCIDENT_ID}`]: incident() }),
      ['alerts:read'],
    );
    renderWith(host, <AlertsPage />, '/admin/settings/alerts?tab=incidents');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Worker node offline' }))[0]!);
    const drawer = await screen.findByRole('region', { name: 'Incident detail' });
    await within(drawer).findByText('node.id=node-p1, node.name=Node P1');
    expect(within(drawer).queryByRole('button', { name: 'Acknowledge' })).toBeNull();
  });

  it('switches tabs', async () => {
    const host = hostWith(basics({ 'GET /admin/alerts/incidents': PAGE }));
    renderWith(host, <AlertsPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Incidents' }));
    expect(await screen.findByText('Node P1 has not reported for 5 minutes.')).toBeInTheDocument();
  });
});

describe('FiringAlertsBanner', () => {
  it('shows the firing count by severity and links to the incidents', async () => {
    const host = hostWith({ 'GET /admin/alerts/summary': { firing: { critical: 2, warning: 1, info: 0 }, lastEvaluatedAt: null } });
    renderWith(host, <FiringAlertsBanner />, '/admin/settings/telemetry/dashboard');
    const banner = await screen.findByTestId('firing-alerts-banner');
    expect(within(banner).getByText('3 alerts are firing')).toBeInTheDocument();
    expect(within(banner).getByText('2 critical')).toBeInTheDocument();
    expect(within(banner).getByText('1 warning')).toBeInTheDocument();
    expect(within(banner).queryByText(/info/)).toBeNull();
    expect(within(banner).getByRole('link', { name: 'View incidents' })).toHaveAttribute('href', '/admin/settings/alerts?tab=incidents');
  });

  it('draws nothing while nothing fires', async () => {
    const host = hostWith({ 'GET /admin/alerts/summary': { firing: { critical: 0, warning: 0, info: 0 }, lastEvaluatedAt: null } });
    renderWith(host, <FiringAlertsBanner />);
    await waitFor(() => expect(host.requests).toHaveLength(1));
    expect(screen.queryByTestId('firing-alerts-banner')).toBeNull();
  });

  it('asks nothing and draws nothing without alerts:read', () => {
    const host = hostWith({}, []);
    renderWith(host, <FiringAlertsBanner />);
    expect(screen.queryByTestId('firing-alerts-banner')).toBeNull();
    expect(host.requests).toHaveLength(0);
  });
});

describe('alertsAdminCards', () => {
  it('is one Alerts card at /admin/settings/alerts gated on alerts:read, with no feature', () => {
    expect(alertsAdminCards).toHaveLength(1);
    const [card] = alertsAdminCards;
    expect(card).toMatchObject({ title: 'Alerts', path: ALERTS_PAGE_COPY.path, permission: 'alerts:read' });
    expect(card?.path).toBe('/admin/settings/alerts');
    expect('feature' in card!).toBe(false);
    expect(card?.Icon).toBeDefined();
  });
});
