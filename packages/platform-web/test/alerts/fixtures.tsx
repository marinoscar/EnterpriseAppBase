// Fixtures of the alerts slice tests (issue #1047). Invented names only.
import type { AlertIncident, AlertKind, AlertRule } from '@marinoscar/platform-contract/alerts';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PlatformHostProvider } from '../../src/core/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';

export const RULE_ID = '7b1e2c3d-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
export const STARTER_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
export const INCIDENT_ID = 'c0ffee00-1111-4222-8333-444455556666';

export function rule(extra: Partial<AlertRule> = {}): AlertRule {
  return {
    id: RULE_ID,
    key: null,
    starter: false,
    name: 'Queue depth high on Project P1',
    description: null,
    enabled: true,
    kind: 'metric_threshold',
    severity: 'warning',
    config: { metric: 'app.jobs.queue.depth', aggregation: 'max', windowSeconds: 300, comparator: 'gt', threshold: 100 },
    forSeconds: 120,
    cooldownSeconds: 900,
    notifyChannels: ['email'],
    webhook: true,
    createdById: 'person-a',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    lastEvaluatedAt: '2026-10-31T12:00:00.000Z',
    lastError: null,
    openIncidents: 0,
    ...extra,
  };
}

export function starterRule(extra: Partial<AlertRule> = {}): AlertRule {
  return rule({
    id: STARTER_ID,
    key: 'nodes.offline',
    starter: true,
    name: 'Worker node offline',
    kind: 'node_offline',
    severity: 'critical',
    enabled: false,
    config: {},
    ...extra,
  });
}

export function incident(extra: Partial<AlertIncident> = {}): AlertIncident {
  return {
    id: INCIDENT_ID,
    ruleId: STARTER_ID,
    ruleName: 'Worker node offline',
    ruleKind: 'node_offline',
    labels: { 'node.id': 'node-p1', 'node.name': 'Node P1' },
    state: 'firing',
    severity: 'critical',
    pendingSince: '2026-10-31T11:58:00.000Z',
    firedAt: '2026-10-31T11:59:00.000Z',
    resolvedAt: null,
    lastValue: null,
    lastSeenAt: '2026-10-31T12:00:00.000Z',
    summary: 'Node P1 has not reported for 5 minutes.',
    acknowledgedAt: null,
    acknowledgedById: null,
    createdAt: '2026-10-31T11:58:00.000Z',
    ...extra,
  };
}

function kind(id: string, label: string): AlertKind {
  return { id, label, description: `${label} (example).`, eventDriven: id === 'node_event', builtin: true, configSchema: {} };
}

export const KINDS: AlertKind[] = [
  kind('metric_threshold', 'Metric threshold'),
  kind('node_event', 'Node event'),
  kind('verdict', 'Dashboard verdict'),
  kind('node_offline', 'Node offline'),
  kind('telemetry_unavailable', 'Telemetry unavailable'),
];

export const SCHEMA = {
  tables: [
    {
      name: 'app_jobs_queue_depth',
      rows: 10,
      columns: [
        { name: 'greptime_timestamp', type: 'timestamp', semanticType: 'TIMESTAMP' },
        { name: 'greptime_value', type: 'double', semanticType: 'FIELD' },
        { name: 'job_type', type: 'string', semanticType: 'TAG' },
      ],
    },
    { name: 'opentelemetry_traces', rows: 5, columns: [{ name: 'trace_id', type: 'string', semanticType: 'TAG' }] },
  ],
};

export function hostWith(
  responses: Record<string, TestApiResponse>,
  permissions: readonly string[] = ['alerts:read', 'alerts:write'],
): TestPlatformHost {
  return createTestPlatformHost({ permissions, responses });
}

export function renderWith(host: TestPlatformHost, element: ReactElement, path = '/admin/settings/alerts') {
  return render(
    <PlatformHostProvider host={host}>
      <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
    </PlatformHostProvider>,
  );
}
