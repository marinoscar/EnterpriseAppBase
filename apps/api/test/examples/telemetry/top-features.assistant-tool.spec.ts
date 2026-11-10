import { z } from 'zod';

import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  TELEMETRY_ERROR_REASONS,
  TelemetryHttpError,
  analyzeStatement,
  registerTelemetryAssistantTool,
  telemetryAssistantToolRegistry,
  type TelemetryAssistantToolDef,
} from '@marinoscar/platform-api/telemetry';
import { buildTelemetryAssistantInstructions } from '@marinoscar/platform-api/telemetry/testing';
import type { TelemetryAssistantEventMap, TelemetryAssistantEventName, TelemetrySchema } from '@marinoscar/platform-contract/telemetry';
import {
  createAiRuntimeHarness,
  HARNESS_MODEL,
  HARNESS_PROVIDER,
  HARNESS_USER,
} from '@marinoscar/platform-api/ai/testing';
import type { FakeAiScriptedResponse } from '@marinoscar/platform-api/ai/testing';
import type { AiInputItem, AiResponseRequest } from '@marinoscar/platform-api/ai';

import type { SystemTelemetryValue } from '../../../src/common/schemas/settings.schema';
import { TOP_FEATURES_TOOL } from '../../../src/platform-extensions/telemetry/top-features.assistant-tool';
import { telemetryProviders } from '../../../src/platform/telemetry/telemetry.config';
import { TelemetryAiAdapter } from '../../../src/platform/telemetry/telemetry-ai.adapter';
import { TelemetryAppInfoAdapter } from '../../../src/platform/telemetry/telemetry-app-info.adapter';

// =============================================================================
// An app-registered assistant tool, through the real assistant service (PP-14.18)
// =============================================================================
//
// `top_features` (platform-extensions/telemetry/top-features.assistant-tool.ts)
// is registered here into the tool registry for the duration of each test. The
// REAL `TelemetryAssistantService` runs the tool loop through the real AI
// platform (`createAiRuntimeHarness` + the fake provider) behind the app's
// `TELEMETRY_AI` adapter; only the telemetry store side is faked.
//
// What is proved:
//   - the tool is offered next to the eight built-ins, and the system prompt names it;
//   - it reads the store ONLY through the guarded facade: every statement is a single
//     read-only one, run as the user with source `assistant`;
//   - its arguments are validated against its schema before it runs;
//   - while an administrator hides results from the model it does not run at all;
//   - a failure of its own never reaches the model or the browser as app text;
//   - its output is bounded.
// =============================================================================

const { TelemetryAssistantService } = telemetryProviders;

const call = (callId: string, name: string, args: unknown): FakeAiScriptedResponse => ({
  output: [{ type: 'function_call', callId, name, arguments: JSON.stringify(args) }],
});
const finalAnswer = (summary = 'done'): FakeAiScriptedResponse => ({
  outputText: JSON.stringify({
    status: 'no_issue_found',
    summary,
    findings: [],
    rootCause: null,
    confidence: 'medium',
    recommendations: [],
    queries: [],
  }),
});

const SCHEMA: TelemetrySchema = { tables: [] };

function policyWith(assistant: Partial<SystemTelemetryValue['assistant']> = {}): SystemTelemetryValue {
  return {
    enabled: true,
    retentionDays: 30,
    instanceId: null,
    query: { maxRows: 1000, timeoutSeconds: 10 },
    assistant: {
      enabled: true,
      provider: HARNESS_PROVIDER,
      modelId: HARNESS_MODEL,
      shareResults: true,
      maxResultRowsToModel: 5,
      maxSteps: 6,
      ...assistant,
    },
  };
}

function outputsOf(req: AiResponseRequest | undefined): Array<{ output: string }> {
  if (!req || typeof req.input === 'string') return [];
  return req.input.filter(
    (item): item is Extract<AiInputItem, { type: 'function_call_output' }> => item.type === 'function_call_output',
  ) as never;
}

function setup(opts: { script: FakeAiScriptedResponse[]; policy?: SystemTelemetryValue; run?: jest.Mock; extraInstructions?: string | null }) {
  const h = createAiRuntimeHarness({ fake: { responses: opts.script as never } });
  const policy = opts.policy ?? policyWith();
  const run =
    opts.run ??
    jest.fn(async () => ({
      columns: [{ name: 'feature' }, { name: 'requests' }, { name: 'errors' }],
      rows: [
        ['/api/storage/objects', '120', '6'],
        ['/api/jobs', 80, 0],
      ],
      rowCount: 2,
      truncated: false,
      elapsedMs: 3,
    }));
  const service = new TelemetryAssistantService(
    new TelemetryAiAdapter(h.ai, { assertEnabled: jest.fn() } as never),
    { isConfigured: jest.fn(() => true), database: 'public' } as never,
    { getPolicy: jest.fn(async () => policy) } as never,
    { run } as never,
    { getSchema: jest.fn(async () => SCHEMA), describeTable: jest.fn(async () => null) } as never,
    { record: jest.fn(async () => undefined) } as never,
    { readFeatureFlag: jest.fn(async () => true) } as never,
    new TelemetryAppInfoAdapter(),
    undefined,
    undefined,
    opts.extraInstructions ?? null,
  );
  const events: Array<{ event: TelemetryAssistantEventName; data: unknown }> = [];
  const emit = <E extends TelemetryAssistantEventName>(event: E, data: TelemetryAssistantEventMap[E]) => {
    events.push({ event, data });
  };
  const of = <E extends TelemetryAssistantEventName>(name: E) =>
    events.filter((e) => e.event === name).map((e) => e.data as TelemetryAssistantEventMap[E]);
  const requests = () => h.fake.callsTo('responses.create').map((c) => c.request);
  return { service, run, emit, of, requests };
}

async function withTool<T>(tool: TelemetryAssistantToolDef, fn: () => Promise<T>): Promise<T> {
  return withTemporaryEntries(telemetryAssistantToolRegistry, [], () => {
    registerTelemetryAssistantTool(tool);
    return fn();
  });
}

describe('the reference app tool top_features', () => {
  it('is not registered by the reference app: the assistant keeps its eight tools until a fork opts in', () => {
    expect(telemetryAssistantToolRegistry.ids()).toEqual([]);
  });

  it('is offered next to the eight built-ins, and the system prompt names it', async () => {
    await withTool(TOP_FEATURES_TOOL, async () => {
      const t = setup({ script: [finalAnswer()] });
      await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

      const first = t.requests()[0]!;
      expect(first.tools?.map((tool) => (tool as { name: string }).name)).toEqual([
        'list_tables',
        'describe_table',
        'run_query',
        'get_app_context',
        'health_overview',
        'get_trace',
        'metrics_overview',
        'compare_nodes',
        'top_features',
      ]);
      expect(first.instructions).toBe(
        buildTelemetryAssistantInstructions(6, { tools: [{ name: 'top_features', description: TOP_FEATURES_TOOL.description }] }),
      );
      expect(first.instructions).toContain("THIS APPLICATION'S OWN TOOLS");
      expect(first.instructions).toContain('- top_features: The most used features');
    });
  });

  it('reads the store only through the guarded facade: one read-only statement, as the user, source assistant', async () => {
    await withTool(TOP_FEATURES_TOOL, async () => {
      const t = setup({ script: [call('c1', 'top_features', { hours: 6, limit: 3 }), finalAnswer()] });
      await t.service.stream(HARNESS_USER, { question: 'what is used most?' }, { emit: t.emit });

      expect(t.run).toHaveBeenCalledTimes(1);
      const [userId, sql, opts] = t.run.mock.calls[0]!;
      expect(userId).toBe(HARNESS_USER);
      expect(opts).toEqual(expect.objectContaining({ source: 'assistant', maxRows: 3 }));
      expect(() => analyzeStatement(sql)).not.toThrow();
      expect(sql).toContain('FROM "opentelemetry_traces"');
      expect(sql).toContain('"span_attributes.http.route"');
      expect(sql).toMatch(/LIMIT 3$/);

      const output = JSON.parse(outputsOf(t.requests()[1])[0]!.output);
      expect(output.windowHours).toBe(6);
      expect(output.features).toEqual([
        { feature: '/api/storage/objects', requests: 120, errors: 6, errorRatePct: 5 },
        { feature: '/api/jobs', requests: 80, errors: 0, errorRatePct: 0 },
      ]);
      expect(output.stepsLeft).toBeDefined();
      expect(t.of('step')[0]).toMatchObject({ tool: 'top_features' });
      expect(t.of('step')[0]!.input).toBeUndefined();
    });
  });

  it('applies the defaults of its schema when the model omits the arguments', async () => {
    await withTool(TOP_FEATURES_TOOL, async () => {
      const t = setup({ script: [call('c1', 'top_features', {}), finalAnswer()] });
      await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

      expect(t.run.mock.calls[0]![2]).toEqual(expect.objectContaining({ maxRows: 5 }));
      expect(JSON.parse(outputsOf(t.requests()[1])[0]!.output).windowHours).toBe(24);
    });
  });

  it.each([
    ['a string for a number', { hours: '24; DROP TABLE t' }],
    ['a window past the maximum', { hours: 100_000 }],
    ['a limit of zero', { limit: 0 }],
    ['an unknown argument (the schema is strict)', { hours: 1, sql: 'DELETE FROM t' }],
  ])('refuses %s before the tool runs', async (_name, args) => {
    await withTool(TOP_FEATURES_TOOL, async () => {
      const t = setup({ script: [call('c1', 'top_features', args), finalAnswer()] });
      await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

      expect(t.run).not.toHaveBeenCalled();
      expect(t.of('step')[0]!.error).toBeDefined();
    });
  });

  it('does not run at all while results are hidden from the model, and says why', async () => {
    await withTool(TOP_FEATURES_TOOL, async () => {
      const t = setup({ policy: policyWith({ shareResults: false }), script: [call('c1', 'top_features', {}), finalAnswer()] });
      await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

      expect(t.run).not.toHaveBeenCalled();
      const output = JSON.parse(outputsOf(t.requests()[1])[0]!.output);
      expect(output.note).toMatch(/hidden from the assistant by policy/);
      expect(output.features).toBeUndefined();
    });
  });

  it('a tool that declares aggregate output still runs while results are hidden', async () => {
    const counter: TelemetryAssistantToolDef = {
      name: 'count_things',
      description: 'A count.',
      output: 'aggregate',
      inputSchema: z.object({}).strict(),
      run: async (_input, ctx) => {
        const result = await ctx.query.query('SELECT count(*) AS n FROM opentelemetry_logs');
        return { n: Number(result.rows[0]![0]) };
      },
    };
    await withTool(counter, async () => {
      const run = jest.fn(async () => ({ columns: [{ name: 'n', type: 'int8' }], rows: [['7']], rowCount: 1, truncated: false, elapsedMs: 1 }));
      const t = setup({ run, policy: policyWith({ shareResults: false }), script: [call('c1', 'count_things', {}), finalAnswer()] });
      await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

      expect(JSON.parse(outputsOf(t.requests()[1])[0]!.output).n).toBe(7);
    });
  });

  it('answers a store failure like the built-ins do: the reason and message go to the model, the turn goes on', async () => {
    await withTool(TOP_FEATURES_TOOL, async () => {
      const run = jest.fn(async () => {
        throw new TelemetryHttpError(TELEMETRY_ERROR_REASONS.QUERY_FAILED, 'Column "span_attributes.http.route" does not exist.');
      });
      const t = setup({ run, script: [call('c1', 'top_features', {}), finalAnswer('fell back')] });
      await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

      const output = JSON.parse(outputsOf(t.requests()[1])[0]!.output);
      expect(output.error).toBe(TELEMETRY_ERROR_REASONS.QUERY_FAILED);
      expect(t.of('answer')[0]!.explanation).toBe('fell back');
    });
  });

  it('ends the turn when the store is unreachable, as for a built-in tool', async () => {
    await withTool(TOP_FEATURES_TOOL, async () => {
      const run = jest.fn(async () => {
        throw new TelemetryHttpError(TELEMETRY_ERROR_REASONS.UNREACHABLE, 'The telemetry store did not answer.');
      });
      const t = setup({ run, script: [call('c1', 'top_features', {}), finalAnswer()] });
      await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

      expect(t.of('error')[0]).toMatchObject({ code: TELEMETRY_ERROR_REASONS.UNREACHABLE });
    });
  });

  it('never lets a tool\'s own error text reach the model or the browser', async () => {
    const leaky: TelemetryAssistantToolDef = {
      name: 'leaky',
      description: 'Throws app internals.',
      output: 'aggregate',
      inputSchema: z.object({}).strict(),
      run: () => {
        throw new Error('ECONNREFUSED 10.0.0.7:5432 password=hunter2');
      },
    };
    await withTool(leaky, async () => {
      const t = setup({ script: [call('c1', 'leaky', {}), finalAnswer()] });
      jest.spyOn((t.service as unknown as { logger: { error: (...a: unknown[]) => void } }).logger, 'error').mockImplementation(() => undefined);
      await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

      const output = outputsOf(t.requests()[1])[0]!.output;
      expect(output).not.toContain('hunter2');
      expect(JSON.parse(output)).toMatchObject({ error: 'TOOL_FAILED' });
      expect(JSON.stringify(t.of('step'))).not.toContain('hunter2');
    });
  });

  it('spends a statement budget: a tool cannot turn one call into a scan loop', async () => {
    const greedy: TelemetryAssistantToolDef = {
      name: 'greedy',
      description: 'Runs many statements.',
      output: 'aggregate',
      inputSchema: z.object({}).strict(),
      run: async (_input, ctx) => {
        let ran = 0;
        for (let i = 0; i < 50; i += 1) {
          await ctx.query.query(`SELECT ${i}`);
          ran += 1;
        }
        return { ran };
      },
    };
    await withTool(greedy, async () => {
      const t = setup({ script: [call('c1', 'greedy', {}), finalAnswer()] });
      await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

      expect(t.run).toHaveBeenCalledTimes(10);
      expect(JSON.parse(outputsOf(t.requests()[1])[0]!.output)).toMatchObject({ error: 'STATEMENT_BUDGET' });
    });
  });

  it('bounds an oversized output to a valid excerpt', async () => {
    const big: TelemetryAssistantToolDef = {
      name: 'big_output',
      description: 'Returns a lot.',
      output: 'aggregate',
      inputSchema: z.object({}).strict(),
      run: () => ({ rows: Array.from({ length: 4000 }, (_, i) => ({ i, text: 'x'.repeat(30) })) }),
    };
    await withTool(big, async () => {
      const t = setup({ script: [call('c1', 'big_output', {}), finalAnswer()] });
      await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

      const output = outputsOf(t.requests()[1])[0]!.output;
      expect(output.length).toBeLessThanOrEqual(24_000 + 200);
      expect(JSON.parse(output)).toMatchObject({ truncated: true });
    });
  });

  it('offers a tool whose name is registered but cannot shadow a built-in: the registry refuses it', async () => {
    await withTemporaryEntries(telemetryAssistantToolRegistry, [], () => {
      expect(() => registerTelemetryAssistantTool({ ...TOP_FEATURES_TOOL, name: 'run_query' })).toThrow(/platform's own assistant tools/);
    });
  });

  it('appends the developers\' notes above the rules, and an app tool cannot be reached by text in them', async () => {
    await withTool(TOP_FEATURES_TOOL, async () => {
      const t = setup({ script: [finalAnswer()], extraInstructions: 'Checkout is the revenue path.' });
      await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

      const prompt = String(t.requests()[0]!.instructions);
      expect(prompt).toContain('APPLICATION NOTES');
      expect(prompt.indexOf('Checkout is the revenue path.')).toBeLessThan(prompt.indexOf('\nYOUR FINAL ANSWER\n'));
      expect(prompt).toBe(
        buildTelemetryAssistantInstructions(6, {
          tools: [{ name: 'top_features', description: TOP_FEATURES_TOOL.description }],
          extraInstructions: 'Checkout is the revenue path.',
        }),
      );
    });
  });
});
