// =============================================================================
// The runtime telemetry gate (issue #532, epic #528)
// =============================================================================
//
// TWO SWITCHES, AND THEY ARE NOT THE SAME SWITCH
// -----------------------------------------------------------------------------
//
//   1. `OTEL_ENABLED` (environment, infra). Decides whether the OpenTelemetry
//      SDK is installed in this process AT ALL — read once by
//      `src/instrumentation.ts` before Nest exists. It is `true` when the
//      deployment ships the telemetry overlay (collector + storage backend),
//      and it cannot change without a restart, because auto-instrumentation
//      can only patch modules required AFTER `sdk.start()`.
//
//   2. `telemetry.enabled` (system setting, admin UI). Decides whether what
//      the installed SDK produces is actually EXPORTED. An administrator
//      flips it at runtime with no restart; the telemetry module calls
//      `telemetryGate.setEnabled()` on boot (once settings have loaded) and on
//      every settings refresh.
//
// The SDK keeps running either way — spans are still created, log records
// still correlated, metrics still aggregated — and the gated exporters below
// simply drop each batch while the gate is closed. Dropping is the intended
// behaviour, not a failure: a batch is acknowledged as SUCCESS so the
// processors neither retry it nor log an export error for it.
//
// The gate is read at EXPORT time, not when a span or record is created: a
// batch that was queued while closed and is flushed after the gate opens is
// sent. At worst that is one batch interval (the batch processors' scheduled
// delay, or the metric reader's 60s) on either side of a toggle.
//
// THE GATE STARTS CLOSED. Nothing leaves the process until settings have been
// read and an administrator's choice is known; a deployment that has switched
// telemetry off must not leak the first minute of every boot.
//
// SAFE TO IMPORT BEFORE THE SDK STARTS
// -----------------------------------------------------------------------------
//
// Like `service-name.ts`, this module is imported by `instrumentation.ts`
// ahead of `sdk.start()`. It is kept trivial and side-effect-free on purpose:
// module-level state, three thin wrapper classes, and imports only from the
// OpenTelemetry SDK packages themselves (never `http`, `pg`, `pino` or any
// other module the auto-instrumentation needs to patch). There is no Nest DI
// here because Nest does not exist yet when this runs.
// =============================================================================

import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';
import type {
  AggregationOption,
  AggregationTemporality,
  InstrumentType,
  PushMetricExporter,
  ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

let enabled = false;

/**
 * Process-wide runtime export switch. Starts closed (`false`).
 */
export const telemetryGate = {
  isEnabled(): boolean {
    return enabled;
  },
  setEnabled(next: boolean): void {
    enabled = next;
  },
};

const DROPPED: ExportResult = { code: ExportResultCode.SUCCESS };

/** Forwards spans to `inner` only while the telemetry gate is open. */
export class GatedSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (!telemetryGate.isEnabled()) {
      resultCallback(DROPPED);
      return;
    }
    this.inner.export(spans, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush ? this.inner.forceFlush() : Promise.resolve();
  }
}

/** Forwards log records to `inner` only while the telemetry gate is open. */
export class GatedLogRecordExporter implements LogRecordExporter {
  constructor(private readonly inner: LogRecordExporter) {}

  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    if (!telemetryGate.isEnabled()) {
      resultCallback(DROPPED);
      return;
    }
    this.inner.export(logs, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }
}

/**
 * Forwards metrics to `inner` only while the telemetry gate is open.
 *
 * The optional aggregation selectors are delegated so the reader keeps the
 * inner exporter's temporality (OTLP defaults to cumulative) and aggregation
 * preferences; wrapping must not change what is measured, only whether it is
 * sent.
 */
export class GatedPushMetricExporter implements PushMetricExporter {
  readonly selectAggregationTemporality?: (instrumentType: InstrumentType) => AggregationTemporality;
  readonly selectAggregation?: (instrumentType: InstrumentType) => AggregationOption;

  constructor(private readonly inner: PushMetricExporter) {
    if (inner.selectAggregationTemporality) {
      this.selectAggregationTemporality = inner.selectAggregationTemporality.bind(inner);
    }
    if (inner.selectAggregation) {
      this.selectAggregation = inner.selectAggregation.bind(inner);
    }
  }

  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    if (!telemetryGate.isEnabled()) {
      resultCallback(DROPPED);
      return;
    }
    this.inner.export(metrics, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }
}
