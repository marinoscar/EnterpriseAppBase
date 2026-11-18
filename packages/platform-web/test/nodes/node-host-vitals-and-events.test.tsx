// The node detail dialog's host machine section and Events timeline (issue
// #1045): host CPU, memory used of total, load, OS and arch, power; absent
// fields as a dash; and the events list with its labels, unknown-type fallback,
// severity in words, relative time and "Load more".

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';

import { NodesWebAdaptersProvider } from '../../src/nodes/headless/index.js';
import type { NodeVitals, WorkerNodeEvent, WorkerNodeEventList } from '../../src/nodes/headless/index.js';
import { NodeEventsTimeline } from '../../src/nodes/ui/NodeEventsTimeline.js';
import { NodeVitalsDialog } from '../../src/nodes/ui/NodeVitalsDialog.js';
import {
  formatHostCpu,
  formatHostOs,
  formatLoadAverages,
  hostMemoryUsage,
} from '../../src/nodes/ui/workerVitals.js';
import { fakeNodesApi } from './harness.js';
import type { FakeNodesApi } from './harness.js';
import { fullVitals, vitalsNode } from './vitals-fixtures.js';

const NOW = new Date('2026-01-01T12:00:00.000Z');
const GB = 1024 ** 3;

const hostVitals: NodeVitals = {
  ...fullVitals,
  host: {
    cpuPercent: 37,
    cpuCount: 8,
    loadAvg1: 0.52,
    loadAvg5: 0.61,
    loadAvg15: 0.7,
    memTotalBytes: 16 * GB,
    memFreeBytes: 2 * GB,
    memAvailableBytes: 4 * GB,
    osRelease: '6.8.0-45-generic',
    arch: 'x64',
    uptimeSeconds: 3 * 86_400,
  },
  power: { source: 'battery', batteryPercent: 42, charging: false },
};

function renderDialog(lastVitals: NodeVitals | null, api?: FakeNodesApi): void {
  const ui: ReactElement = (
    <NodeVitalsDialog
      node={vitalsNode({ name: 'node-alpha', lastVitals, lastVitalsAt: lastVitals ? '2026-01-01T11:59:00.000Z' : null })}
      now={NOW}
      onClose={() => undefined}
      {...(api ? { Events: NodeEventsTimeline } : {})}
    />
  );
  render(api ? <NodesWebAdaptersProvider adapters={{ api }}>{ui}</NodesWebAdaptersProvider> : ui);
}

describe('host vitals helpers', () => {
  it('computes memory used from total minus available, else free', () => {
    expect(hostMemoryUsage({ memTotalBytes: 16 * GB, memAvailableBytes: 4 * GB, memFreeBytes: 1 * GB })).toEqual({
      used: 12 * GB,
      total: 16 * GB,
      fraction: 0.75,
    });
    expect(hostMemoryUsage({ memTotalBytes: 8 * GB, memFreeBytes: 2 * GB })?.used).toBe(6 * GB);
    expect(hostMemoryUsage({ memTotalBytes: 8 * GB })).toBeNull();
    expect(hostMemoryUsage({ memAvailableBytes: 8 * GB })).toBeNull();
    expect(hostMemoryUsage(undefined)).toBeNull();
  });

  it('words CPU, load and OS, with a dash for what is absent', () => {
    expect(formatHostCpu({ cpuPercent: 37, cpuCount: 8 })).toBe('37% of 8 cores');
    expect(formatHostCpu({ cpuPercent: 4.25 })).toBe('4.3%');
    expect(formatHostCpu({ cpuCount: 8 })).toBe('—');
    expect(formatLoadAverages({ loadAvg1: 0.5, loadAvg15: 1 })).toBe('0.50 · — · 1.00');
    expect(formatLoadAverages({})).toBe('—');
    expect(formatHostOs({ osRelease: '6.8.0', arch: 'arm64' })).toBe('6.8.0 (arm64)');
    expect(formatHostOs({ arch: 'arm64' })).toBe('arm64');
    expect(formatHostOs(undefined)).toBe('—');
  });
});

describe('NodeVitalsDialog: host machine', () => {
  it('shows host CPU, memory used of total, load, OS and arch, and power', () => {
    renderDialog(hostVitals);
    const section = screen.getByTestId('node-host-vitals');
    expect(within(section).getByRole('heading', { name: 'Host machine' })).toBeInTheDocument();
    expect(within(section).getByRole('progressbar', { name: 'Host CPU' })).toHaveAttribute('aria-valuetext', '37% of 8 cores');
    expect(within(section).getByRole('progressbar', { name: 'Host memory used' })).toHaveAttribute(
      'aria-valuetext',
      '12 GB of 16 GB (75%)',
    );
    const field = (label: string) => within(section).getByText(label).nextElementSibling;
    expect(field('Load average (1, 5, 15 min)')).toHaveTextContent('0.52 · 0.61 · 0.70');
    expect(field('Operating system')).toHaveTextContent('6.8.0-45-generic (x64)');
    expect(field('Host uptime')).toHaveTextContent('3d 0h');
    expect(within(section).getByTestId('node-vitals-power')).toHaveTextContent('On battery, 42%, discharging');
  });

  it('renders absent host fields as a dash, never zero, and draws no bar it cannot compute', () => {
    renderDialog({ ...fullVitals, host: { arch: 'arm64' } });
    const section = screen.getByTestId('node-host-vitals');
    expect(within(section).queryByRole('progressbar')).not.toBeInTheDocument();
    const field = (label: string) => within(section).getByText(label).nextElementSibling;
    expect(field('Load average (1, 5, 15 min)')).toHaveTextContent('—');
    expect(field('Operating system')).toHaveTextContent('arm64');
    expect(field('Host uptime')).toHaveTextContent('—');
    expect(within(section).queryByText('Power')).not.toBeInTheDocument();
  });

  it('is absent for a node that reports no host vitals or an unknown power source', () => {
    renderDialog({ ...fullVitals, power: { source: 'unknown' } });
    expect(screen.queryByTestId('node-host-vitals')).not.toBeInTheDocument();
  });
});

function event(id: string, overrides: Partial<WorkerNodeEvent> = {}): WorkerNodeEvent {
  return {
    id,
    nodeId: vitalsNode().id,
    type: 'power.source_changed',
    severity: 'info',
    attrs: { from: 'ac', to: 'battery', batteryPercent: 64 },
    occurredAt: '2026-01-01T11:57:00.000Z',
    receivedAt: '2026-01-01T11:57:02.000Z',
    ...overrides,
  };
}

function list(items: WorkerNodeEvent[], page: number, total: number, pageSize = 20): WorkerNodeEventList {
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

describe('NodeVitalsDialog: events', () => {
  it('lists the node’s events with labels, severity in words, a summary and a relative time', async () => {
    const api = fakeNodesApi();
    api.listNodeEvents.mockResolvedValue(
      list(
        [
          event('e1'),
          event('e2', { type: 'power.battery_critical', severity: 'critical', attrs: { batteryPercent: 8, threshold: 10 } }),
          event('e3', { type: 'transcode.queue_full', severity: 'warning', attrs: { depth: 12 } }),
        ],
        1,
        3,
      ),
    );
    renderDialog(null, api);

    const section = await screen.findByTestId('node-events');
    await waitFor(() => expect(within(section).queryByText('Loading events…')).not.toBeInTheDocument());
    expect(api.listNodeEvents).toHaveBeenCalledWith(vitalsNode().id, { page: 1, pageSize: 20 });

    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Info');
    expect(items[0]).toHaveTextContent('Power source changed');
    expect(items[0]).toHaveTextContent('AC → Battery (64%)');
    expect(within(items[0]!).getByText('3 minutes ago')).toHaveAttribute('dateTime', '2026-01-01T11:57:00.000Z');
    expect(items[1]).toHaveTextContent('Critical');
    expect(items[1]).toHaveTextContent('Battery critical');
    expect(items[1]).toHaveTextContent('8% (threshold 10%)');
    // An unknown type still shows, humanized.
    expect(items[2]).toHaveTextContent('Warning');
    expect(items[2]).toHaveTextContent('Transcode: queue full');
    expect(items[2]).toHaveTextContent('depth: 12');
    expect(within(section).getByText('Showing 3 of 3')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('loads more when there is a further page', async () => {
    const api = fakeNodesApi();
    api.listNodeEvents
      .mockResolvedValueOnce(list([event('e1')], 1, 2, 1))
      .mockResolvedValueOnce(list([event('e2', { type: 'node.sleep_resumed', attrs: { gapSeconds: 600 } })], 2, 2, 1));
    render(
      <NodesWebAdaptersProvider adapters={{ api }}>
        <NodeEventsTimeline nodeId="node-1" now={NOW} pageSize={1} />
      </NodesWebAdaptersProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Resumed from sleep')).toBeInTheDocument();
    expect(screen.getByText('Asleep for 10m 00s')).toBeInTheDocument();
    expect(api.listNodeEvents).toHaveBeenLastCalledWith('node-1', { page: 2, pageSize: 1 });
    expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('says so when the node has reported no events, and shows a failure in words', async () => {
    const api = fakeNodesApi();
    api.listNodeEvents.mockResolvedValueOnce(list([], 1, 0)).mockRejectedValueOnce(new Error('network down'));
    const { unmount } = render(
      <NodesWebAdaptersProvider adapters={{ api }}>
        <NodeEventsTimeline nodeId="node-1" now={NOW} />
      </NodesWebAdaptersProvider>,
    );
    expect(await screen.findByTestId('node-events-empty')).toBeInTheDocument();
    unmount();

    render(
      <NodesWebAdaptersProvider adapters={{ api }}>
        <NodeEventsTimeline nodeId="node-1" now={NOW} />
      </NodesWebAdaptersProvider>,
    );
    expect(await screen.findByText('Failed to load node events')).toBeInTheDocument();
  });

  it('reads no events when the page passes no Events section', () => {
    renderDialog(hostVitals);
    expect(screen.queryByTestId('node-events')).not.toBeInTheDocument();
  });
});
