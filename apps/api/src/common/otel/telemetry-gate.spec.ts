import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import {
  AggregationTemporality,
  InstrumentType,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

import {
  GatedLogRecordExporter,
  GatedPushMetricExporter,
  GatedSpanExporter,
  telemetryGate,
} from './telemetry-gate';

// =============================================================================
// Runtime telemetry gate (issue #532, epic #528)
// =============================================================================
//
// The gate is the only thing standing between an installed SDK (OTEL_ENABLED)
// and an administrator who switched telemetry off, so the properties proven
// here are: it starts CLOSED, a closed gate never reaches the inner exporter
// yet acknowledges the batch as SUCCESS (dropping is intended, not an error to
// retry), an open gate delegates verbatim, and lifecycle calls always delegate
// whatever the gate says — a shutdown must flush even when export is off.
// =============================================================================

type Case = {
  name: string;
  make: () => {
    gated: { export(items: unknown, cb: (r: ExportResult) => void): void; shutdown(): Promise<void>; forceFlush(): Promise<void> };
    inner: { export: jest.Mock; shutdown: jest.Mock; forceFlush: jest.Mock };
    payload: unknown;
  };
};

function innerMock() {
  return {
    export: jest.fn((_items: unknown, cb: (r: ExportResult) => void) =>
      cb({ code: ExportResultCode.SUCCESS }),
    ),
    shutdown: jest.fn().mockResolvedValue(undefined),
    forceFlush: jest.fn().mockResolvedValue(undefined),
  };
}

const cases: Case[] = [
  {
    name: 'GatedSpanExporter',
    make: () => {
      const inner = innerMock();
      const gated = new GatedSpanExporter(inner as unknown as SpanExporter);
      return { gated: gated as never, inner, payload: [{ name: 'span' }] as unknown as ReadableSpan[] };
    },
  },
  {
    name: 'GatedLogRecordExporter',
    make: () => {
      const inner = innerMock();
      const gated = new GatedLogRecordExporter(inner as unknown as LogRecordExporter);
      return { gated: gated as never, inner, payload: [{ body: 'log' }] };
    },
  },
  {
    name: 'GatedPushMetricExporter',
    make: () => {
      const inner = innerMock();
      const gated = new GatedPushMetricExporter(inner as unknown as PushMetricExporter);
      return { gated: gated as never, inner, payload: { scopeMetrics: [] } as unknown as ResourceMetrics };
    },
  },
];

describe('telemetryGate', () => {
  afterEach(() => telemetryGate.setEnabled(false));

  it('starts closed', () => {
    // Evaluated in a fresh module registry so an earlier test's setEnabled()
    // cannot mask the initial state.
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('./telemetry-gate') as typeof import('./telemetry-gate');
      expect(fresh.telemetryGate.isEnabled()).toBe(false);
    });
  });

  it('reflects setEnabled', () => {
    telemetryGate.setEnabled(true);
    expect(telemetryGate.isEnabled()).toBe(true);
    telemetryGate.setEnabled(false);
    expect(telemetryGate.isEnabled()).toBe(false);
  });
});

describe.each(cases)('$name', ({ make }) => {
  afterEach(() => telemetryGate.setEnabled(false));

  it('drops the batch while the gate is closed, reporting SUCCESS', () => {
    const { gated, inner, payload } = make();
    const cb = jest.fn();

    gated.export(payload, cb);

    expect(inner.export).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it('delegates the batch and callback verbatim while the gate is open', () => {
    const { gated, inner, payload } = make();
    const cb = jest.fn();
    telemetryGate.setEnabled(true);

    gated.export(payload, cb);

    expect(inner.export).toHaveBeenCalledTimes(1);
    expect(inner.export).toHaveBeenCalledWith(payload, cb);
    expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it('observes the gate per call, not at construction', () => {
    const { gated, inner, payload } = make();

    gated.export(payload, jest.fn());
    telemetryGate.setEnabled(true);
    gated.export(payload, jest.fn());

    expect(inner.export).toHaveBeenCalledTimes(1);
  });

  it('delegates shutdown and forceFlush even while closed', async () => {
    const { gated, inner } = make();

    await gated.shutdown();
    await gated.forceFlush();

    expect(inner.shutdown).toHaveBeenCalledTimes(1);
    expect(inner.forceFlush).toHaveBeenCalledTimes(1);
  });
});

describe('GatedSpanExporter without an inner forceFlush', () => {
  it('resolves forceFlush instead of throwing', async () => {
    const inner = { export: jest.fn(), shutdown: jest.fn().mockResolvedValue(undefined) };
    const gated = new GatedSpanExporter(inner as unknown as SpanExporter);

    await expect(gated.forceFlush()).resolves.toBeUndefined();
  });
});

describe('GatedPushMetricExporter aggregation selectors', () => {
  it('delegates selectAggregationTemporality and selectAggregation when the inner has them', () => {
    const inner = {
      ...innerMock(),
      selectAggregationTemporality: jest.fn(() => AggregationTemporality.DELTA),
      selectAggregation: jest.fn(() => ({ type: 'DEFAULT' })),
    };
    const gated = new GatedPushMetricExporter(inner as unknown as PushMetricExporter);

    expect(gated.selectAggregationTemporality?.(InstrumentType.COUNTER)).toBe(
      AggregationTemporality.DELTA,
    );
    expect(inner.selectAggregationTemporality).toHaveBeenCalledWith(InstrumentType.COUNTER);
    expect(gated.selectAggregation?.(InstrumentType.HISTOGRAM)).toEqual({ type: 'DEFAULT' });
    expect(inner.selectAggregation).toHaveBeenCalledWith(InstrumentType.HISTOGRAM);
  });

  it('leaves the selectors undefined when the inner lacks them, so the reader keeps its defaults', () => {
    const gated = new GatedPushMetricExporter(innerMock() as unknown as PushMetricExporter);

    expect(gated.selectAggregationTemporality).toBeUndefined();
    expect(gated.selectAggregation).toBeUndefined();
  });
});
