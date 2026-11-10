import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

import { DEFAULT_SERVICE_NAME, Trace } from '../../src/otel-core/index';

// =============================================================================
// @Trace() (moved from the app by issue #700)
// =============================================================================

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

class Widgets {
  constructor(private readonly factor: number) {}

  @Trace()
  async make(n: number): Promise<number> {
    return n * this.factor;
  }

  @Trace('widgets.break', { tracer: 'widgets-tracer' })
  async break(): Promise<never> {
    throw new Error('snapped');
  }
}

const savedServiceName = process.env.OTEL_SERVICE_NAME;

beforeAll(() => {
  delete process.env.OTEL_SERVICE_NAME;
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  trace.disable();
  await provider.shutdown();
  if (savedServiceName !== undefined) process.env.OTEL_SERVICE_NAME = savedServiceName;
});

beforeEach(() => exporter.reset());

describe('@Trace()', () => {
  it('wraps the method in an OK INTERNAL span named Class.method, keeping `this` and the result', async () => {
    await expect(new Widgets(3).make(2)).resolves.toBe(6);

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('Widgets.make');
    expect(span.kind).toBe(SpanKind.INTERNAL);
    expect(span.status.code).toBe(SpanStatusCode.OK);
    expect(span.instrumentationScope.name).toBe(DEFAULT_SERVICE_NAME);
  });

  it('marks the span ERROR, records the exception and rethrows', async () => {
    await expect(new Widgets(1).break()).rejects.toThrow('snapped');

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('widgets.break');
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: 'snapped' });
    expect(span.events.map((e) => e.name)).toEqual(['exception']);
    expect(span.instrumentationScope.name).toBe('widgets-tracer');
  });

  it('names the tracer after OTEL_SERVICE_NAME when set, resolved on first call', async () => {
    process.env.OTEL_SERVICE_NAME = 'svc-from-env';
    try {
      class Late {
        @Trace()
        async run(): Promise<void> {}
      }
      await new Late().run();
      expect(exporter.getFinishedSpans()[0].instrumentationScope.name).toBe('svc-from-env');
    } finally {
      delete process.env.OTEL_SERVICE_NAME;
    }
  });

  it('is a no-op span without an SDK', async () => {
    trace.disable();
    try {
      class Unobserved {
        @Trace()
        async make(n: number): Promise<number> {
          return n * 2;
        }
      }
      await expect(new Unobserved().make(2)).resolves.toBe(4);
      expect(exporter.getFinishedSpans()).toEqual([]);
    } finally {
      trace.setGlobalTracerProvider(provider);
    }
  });
});
