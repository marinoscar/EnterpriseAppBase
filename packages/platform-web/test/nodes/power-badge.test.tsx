// The node power badge (issue #1045): battery with its charge and charging
// state, plug on AC, nothing for an unknown or absent source; warning at 20% or
// under, error at 10% or under; the state always in the accessible label.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  NODE_BATTERY_CRITICAL_PERCENT,
  NODE_BATTERY_WARNING_PERCENT,
  describeNodePower,
} from '../../src/nodes/headless/index.js';
import { NodePowerBadge } from '../../src/nodes/ui/NodePowerBadge.js';
import { buildWorkerNodeColumns } from '../../src/nodes/ui/workersTable.js';
import { node } from './harness.js';

describe('describeNodePower', () => {
  it('describes a discharging battery', () => {
    expect(describeNodePower({ source: 'battery', batteryPercent: 42, charging: false })).toEqual({
      source: 'battery',
      percent: 42,
      charging: false,
      level: 'normal',
      text: '42%',
      label: 'On battery, 42%, discharging',
    });
  });

  it('raises the level at the warning and critical lines', () => {
    expect(NODE_BATTERY_WARNING_PERCENT).toBe(20);
    expect(NODE_BATTERY_CRITICAL_PERCENT).toBe(10);
    expect(describeNodePower({ source: 'battery', batteryPercent: 21 })?.level).toBe('normal');
    expect(describeNodePower({ source: 'battery', batteryPercent: 20 })?.level).toBe('warning');
    expect(describeNodePower({ source: 'battery', batteryPercent: 11 })?.level).toBe('warning');
    expect(describeNodePower({ source: 'battery', batteryPercent: 10 })?.level).toBe('error');
    expect(describeNodePower({ source: 'battery', batteryPercent: 3 })?.level).toBe('error');
  });

  it('says what it knows and leaves out what it does not', () => {
    expect(describeNodePower({ source: 'battery' })?.label).toBe('On battery');
    expect(describeNodePower({ source: 'battery' })?.text).toBe('Battery');
    expect(describeNodePower({ source: 'battery', batteryPercent: 55, charging: true, lowPowerMode: true })?.label).toBe(
      'On battery, 55%, charging, low power mode',
    );
    expect(describeNodePower({ source: 'ac' })?.label).toBe('On AC power');
    expect(describeNodePower({ source: 'ac', batteryPercent: 80, charging: true })?.label).toBe(
      'On AC power, battery 80%, charging',
    );
  });

  it('describes nothing for an unknown or absent source', () => {
    expect(describeNodePower({ source: 'unknown' })).toBeNull();
    expect(describeNodePower(undefined)).toBeNull();
    expect(describeNodePower(null)).toBeNull();
  });
});

describe('NodePowerBadge', () => {
  it('draws a battery with its charge, labelled in words', () => {
    render(<NodePowerBadge power={{ source: 'battery', batteryPercent: 42, charging: false }} data-testid="badge" />);
    const badge = screen.getByRole('img', { name: 'On battery, 42%, discharging' });
    expect(badge).toHaveTextContent('42%');
    expect(badge).toHaveAttribute('data-power-source', 'battery');
    expect(badge).toHaveAttribute('data-power-level', 'normal');
  });

  it('marks a low and a critical battery', () => {
    const { unmount } = render(<NodePowerBadge power={{ source: 'battery', batteryPercent: 15 }} data-testid="badge" />);
    expect(screen.getByTestId('badge')).toHaveAttribute('data-power-level', 'warning');
    unmount();
    render(<NodePowerBadge power={{ source: 'battery', batteryPercent: 8, charging: true }} data-testid="badge" />);
    expect(screen.getByTestId('badge')).toHaveAttribute('data-power-level', 'error');
    expect(screen.getByRole('img', { name: 'On battery, 8%, charging' })).toBeInTheDocument();
  });

  it('draws a plug on AC, without a percentage', () => {
    render(<NodePowerBadge power={{ source: 'ac', batteryPercent: 100 }} data-testid="badge" />);
    const badge = screen.getByRole('img', { name: 'On AC power, battery 100%' });
    expect(badge).toHaveAttribute('data-power-source', 'ac');
    expect(badge).not.toHaveTextContent('%');
  });

  it('draws nothing for an unknown or absent source', () => {
    const { container } = render(
      <>
        <NodePowerBadge power={{ source: 'unknown' }} />
        <NodePowerBadge power={undefined} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the fleet table name cell', () => {
  const nameColumn = buildWorkerNodeColumns(new Date('2026-01-01T12:00:00.000Z')).find((column) => column.id === 'name')!;

  it('carries the power badge for a node that reports power', () => {
    const row = node({ name: 'node-alpha', lastVitals: { power: { source: 'battery', batteryPercent: 9 } } });
    render(<>{nameColumn.render!(row)}</>);
    expect(screen.getByText('node-alpha')).toBeInTheDocument();
    expect(screen.getByTestId(`node-power-${row.id}`)).toHaveAttribute('data-power-level', 'error');
    expect(screen.getByRole('img', { name: 'On battery, 9%' })).toBeInTheDocument();
  });

  it('is unchanged for a node without power', () => {
    const row = node({ name: 'node-alpha' });
    render(<>{nameColumn.render!(row)}</>);
    expect(screen.queryByTestId(`node-power-${row.id}`)).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
