// =============================================================================
// TelemetryAssistantService (issue #536) — driven through the REAL AiService
// (createAiRuntimeHarness + FakeAiProvider), with the telemetry side faked.
// =============================================================================

import type { SystemTelemetryValue } from '../../common/schemas/settings.schema';
import { AiError } from '../../ai/core/ai-error';
import type { AiInputItem, AiResponseRequest } from '../../ai/core/types/responses.types';
import {
  createAiRuntimeHarness,
  HARNESS_MODEL,
  HARNESS_PROVIDER,
  HARNESS_USER,
  type AiRuntimeHarnessOptions,
} from '../../ai/testing/ai-runtime-harness';
import type { FakeAiScriptedResponse } from '../../ai/testing/fake-ai-provider';
import type { TelemetryAssistantEventMap, TelemetryAssistantEventName } from '../dto/telemetry-assistant.dto';
import type { TelemetrySchema } from '../dto/telemetry-query.dto';
import { TELEMETRY_ERROR_REASONS, TelemetryHttpError } from '../query/telemetry-query.errors';
import {
  CELL_MAX_CHARS,
  TELEMETRY_ASSISTANT_AUDIT_ACTION,
  TELEMETRY_ASSISTANT_INSTRUCTIONS,
  TelemetryAssistantService,
  TOOL_OUTPUT_MAX_CHARS,
  parseFinalAnswer,
  shapeQueryOutput,
} from './telemetry-assistant.service';

const call = (callId: string, name: string, args: unknown): FakeAiScriptedResponse => ({
  output: [{ type: 'function_call', callId, name, arguments: JSON.stringify(args) }],
});

const answer = (sql: string | null, explanation: string): FakeAiScriptedResponse => ({
  outputText: JSON.stringify({ sql, explanation }),
});

function outputsOf(req: AiResponseRequest | undefined): Extract<AiInputItem, { type: 'function_call_output' }>[] {
  if (!req || typeof req.input === 'string') return [];
  return req.input.filter(
    (item): item is Extract<AiInputItem, { type: 'function_call_output' }> => item.type === 'function_call_output',
  );
}

const SCHEMA: TelemetrySchema = {
  tables: [
    {
      name: 'opentelemetry_logs',
      rows: 10,
      columns: [{ name: 'body', type: 'String', semanticType: 'FIELD' }],
    },
    {
      name: 'opentelemetry_traces',
      rows: 200,
      columns: [
        { name: 'timestamp', type: 'TimestampNanosecond', semanticType: 'TIMESTAMP' },
        { name: 'duration_nano', type: 'UInt64', semanticType: 'FIELD' },
      ],
    },
  ],
};

function policyWith(assistant: Partial<SystemTelemetryValue['assistant']> = {}, enabled = true): SystemTelemetryValue {
  return {
    enabled,
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

interface Setup {
  script?: FakeAiScriptedResponse[] | ((req: AiResponseRequest) => FakeAiScriptedResponse);
  policy?: SystemTelemetryValue;
  configured?: boolean;
  run?: jest.Mock;
  harness?: AiRuntimeHarnessOptions;
}

function setup(opts: Setup = {}) {
  const h = createAiRuntimeHarness({
    ...opts.harness,
    fake: { responses: opts.script as never, ...opts.harness?.fake },
  });
  const policy = opts.policy ?? policyWith();
  const greptime = { isConfigured: jest.fn(() => opts.configured ?? true), database: 'public' };
  const settings = { getPolicy: jest.fn(async () => policy) };
  const run =
    opts.run ??
    jest.fn(async () => ({
      columns: [{ name: 'n', type: 'int8' }],
      rows: [['1']],
      rowCount: 1,
      truncated: false,
      elapsedMs: 3,
    }));
  const schema = {
    getSchema: jest.fn(async () => SCHEMA),
    describeTable: jest.fn(async (name: string) => SCHEMA.tables.find((t) => t.name === name) ?? null),
  };
  const audits: Array<Record<string, any>> = [];
  const prisma = {
    auditEvent: {
      create: jest.fn(async (args: { data: Record<string, any> }) => {
        audits.push(args.data);
        return args.data;
      }),
    },
  };

  const service = new TelemetryAssistantService(
    h.ai,
    greptime as never,
    settings as never,
    { run } as never,
    schema as never,
    prisma as never,
  );

  const events: Array<{ event: TelemetryAssistantEventName; data: unknown }> = [];
  const emit = <E extends TelemetryAssistantEventName>(event: E, data: TelemetryAssistantEventMap[E]) => {
    events.push({ event, data });
  };

  const of = <E extends TelemetryAssistantEventName>(name: E) =>
    events.filter((e) => e.event === name).map((e) => e.data as TelemetryAssistantEventMap[E]);

  const requests = () => h.fake.callsTo('responses.create').map((c) => c.request);

  return { h, service, run, schema, audits, events, emit, of, requests, settings };
}

describe('TelemetryAssistantService', () => {
  describe('preconditions (thrown before any event)', () => {
    it.each([
      ['store not configured', { configured: false }, TELEMETRY_ERROR_REASONS.NOT_CONFIGURED, 503],
      ['telemetry disabled', { policy: policyWith({}, false) }, TELEMETRY_ERROR_REASONS.DISABLED, 409],
      ['assistant disabled', { policy: policyWith({ enabled: false }) }, TELEMETRY_ERROR_REASONS.ASSISTANT_DISABLED, 409],
      ['no provider', { policy: policyWith({ provider: null }) }, TELEMETRY_ERROR_REASONS.ASSISTANT_NOT_CONFIGURED, 409],
      ['no model', { policy: policyWith({ modelId: null }) }, TELEMETRY_ERROR_REASONS.ASSISTANT_NOT_CONFIGURED, 409],
    ] as const)('%s', async (_name, opts, reason, status) => {
      const t = setup(opts as Setup);

      const error = await t.service
        .stream(HARNESS_USER, { question: 'how many spans?' }, { emit: t.emit })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TelemetryHttpError);
      expect((error as TelemetryHttpError).reason).toBe(reason);
      expect((error as TelemetryHttpError).getStatus()).toBe(status);
      expect(t.events).toEqual([]);
      expect(t.h.fake.callsTo('responses.create')).toHaveLength(0);
      expect(t.audits).toEqual([]);
    });
  });

  it('runs list_tables -> run_query -> final JSON, emitting steps, answer and done', async () => {
    const sql = 'SELECT count(*) AS n FROM opentelemetry_traces';
    const t = setup({
      script: [call('c1', 'list_tables', {}), call('c2', 'run_query', { sql }), answer(sql, 'Counts spans.')],
    });

    await t.service.stream(HARNESS_USER, { question: 'how many spans?' }, { emit: t.emit });

    expect(t.events.map((e) => e.event)).toEqual(['step', 'step', 'answer', 'done']);
    expect(t.of('step')[0]).toEqual({ index: 0, tool: 'list_tables', durationMs: expect.any(Number) });
    expect(t.of('step')[1]).toEqual({
      index: 1,
      tool: 'run_query',
      input: { sql },
      rowCount: 1,
      truncated: false,
      durationMs: expect.any(Number),
    });
    expect(t.of('answer')).toEqual([{ sql, explanation: 'Counts spans.' }]);
    expect(t.of('done')).toEqual([{}]);

    expect(t.run).toHaveBeenCalledWith(HARNESS_USER, sql, expect.objectContaining({ source: 'assistant', maxRows: 5 }));

    const first = t.requests()[0]!;
    expect(first.model).toBe(HARNESS_MODEL);
    expect(first.instructions).toBe(TELEMETRY_ASSISTANT_INSTRUCTIONS);
    expect(first.tools?.map((tool) => (tool as { name: string }).name)).toEqual([
      'list_tables',
      'describe_table',
      'run_query',
    ]);

    const listed = JSON.parse(outputsOf(t.requests()[1])[0].output);
    expect(listed.tables).toEqual([
      { name: 'opentelemetry_logs', rows: 10 },
      { name: 'opentelemetry_traces', rows: 200 },
    ]);

    expect(t.audits).toEqual([
      expect.objectContaining({
        actorUserId: HARNESS_USER,
        action: TELEMETRY_ASSISTANT_AUDIT_ACTION,
        meta: expect.objectContaining({
          questionLength: 'how many spans?'.length,
          provider: HARNESS_PROVIDER,
          model: HARNESS_MODEL,
          steps: 3,
          toolCalls: 2,
          stopReason: 'completed',
        }),
      }),
    ]);
    expect(JSON.stringify(t.audits)).not.toContain('Counts spans.');
  });

  it('never sends the model more rows than maxResultRowsToModel, even if the query returned more', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => [String(i)]);
    const run = jest.fn(async () => ({
      columns: [{ name: 'n', type: 'int8' }],
      rows,
      rowCount: 50,
      truncated: false,
      elapsedMs: 1,
    }));
    const t = setup({
      run,
      policy: policyWith({ maxResultRowsToModel: 3 }),
      script: [call('c1', 'run_query', { sql: 'SELECT n FROM t' }), answer('SELECT n FROM t', 'ok')],
    });

    await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

    const output = JSON.parse(outputsOf(t.requests()[1])[0].output);
    expect(output.rows).toHaveLength(3);
    expect(output.truncated).toBe(true);
    expect(run).toHaveBeenCalledWith(HARNESS_USER, 'SELECT n FROM t', expect.objectContaining({ maxRows: 3 }));
  });

  it('with shareResults off sends zero rows and says why', async () => {
    const t = setup({
      policy: policyWith({ shareResults: false }),
      script: [call('c1', 'run_query', { sql: 'SELECT 1' }), answer('SELECT 1', 'ok')],
    });

    await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

    const output = JSON.parse(outputsOf(t.requests()[1])[0].output);
    expect(output.rows).toEqual([]);
    expect(output.rowCount).toBe(1);
    expect(output.columns).toEqual([{ name: 'n', type: 'int8' }]);
    expect(output.note).toMatch(/hidden from the assistant by policy/);
    expect(t.requests()[1]!.input).not.toContain('"1"');
  });

  it('answers describe_table for an unknown table with error text listing the valid tables', async () => {
    const t = setup({
      script: [
        call('c1', 'describe_table', { table: 'nope"; DROP' }),
        call('c2', 'describe_table', { table: 'opentelemetry_traces' }),
        answer(null, 'Not answerable.'),
      ],
    });

    await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

    const missing = JSON.parse(outputsOf(t.requests()[1])[0].output);
    expect(missing.error).toBe('TABLE_NOT_FOUND');
    expect(missing.message).toContain('opentelemetry_logs, opentelemetry_traces');

    const found = JSON.parse(outputsOf(t.requests()[2])[0].output);
    expect(found.columns).toEqual([
      { name: 'timestamp', type: 'TimestampNanosecond', semanticType: 'TIMESTAMP' },
      { name: 'duration_nano', type: 'UInt64', semanticType: 'FIELD' },
    ]);

    const steps = t.of('step');
    expect(steps[0]).toMatchObject({ index: 0, tool: 'describe_table', input: { table: 'nope"; DROP' } });
    expect(steps[0].error).toContain('There is no table named');
    expect(steps[1]).toMatchObject({ index: 1, tool: 'describe_table', input: { table: 'opentelemetry_traces' } });
    expect(steps[1].error).toBeUndefined();
    expect(t.of('answer')).toEqual([{ sql: null, explanation: 'Not answerable.' }]);
  });

  it('returns a rejected or failed query to the model as an error, and lets it retry', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(
        new TelemetryHttpError(TELEMETRY_ERROR_REASONS.QUERY_FAILED, 'No field named "duration".'),
      )
      .mockResolvedValueOnce({ columns: [], rows: [], rowCount: 0, truncated: false, elapsedMs: 1 });
    const t = setup({
      run,
      script: [
        call('c1', 'run_query', { sql: 'SELECT duration FROM opentelemetry_traces' }),
        call('c2', 'run_query', { sql: 'SELECT duration_nano FROM opentelemetry_traces LIMIT 1' }),
        answer('SELECT duration_nano FROM opentelemetry_traces LIMIT 1', 'ok'),
      ],
    });

    await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

    expect(JSON.parse(outputsOf(t.requests()[1])[0].output)).toEqual({
      error: 'TELEMETRY_QUERY_FAILED',
      message: 'No field named "duration".',
    });
    expect(t.of('step')[0].error).toBe('No field named "duration".');
    expect(t.of('step')[1]).toMatchObject({ rowCount: 0, truncated: false });
    expect(t.of('step')[1].error).toBeUndefined();
    expect(t.of('answer')[0].sql).toBe('SELECT duration_nano FROM opentelemetry_traces LIMIT 1');
  });

  it('ends the turn on TELEMETRY_UNREACHABLE instead of handing it to the model', async () => {
    const run = jest
      .fn()
      .mockRejectedValue(new TelemetryHttpError(TELEMETRY_ERROR_REASONS.UNREACHABLE, 'The telemetry store did not answer.'));
    const t = setup({ run, script: [call('c1', 'run_query', { sql: 'SELECT 1' }), answer('SELECT 1', 'x')] });

    await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

    expect(t.events.map((e) => e.event)).toEqual(['error', 'done']);
    expect(t.of('error')).toEqual([{ code: 'TELEMETRY_UNREACHABLE', message: 'The telemetry store did not answer.' }]);
    expect(t.requests()).toHaveLength(1);
    expect(t.audits[0].meta).toMatchObject({ error: 'TELEMETRY_UNREACHABLE' });
  });

  it('withdraws a final SQL the guard refuses', async () => {
    const t = setup({ script: [answer('DROP TABLE opentelemetry_traces', 'Drops it.')] });

    await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

    const [final] = t.of('answer');
    expect(final.sql).toBeNull();
    expect(final.explanation).toMatch(/^Drops it\.\n\nThe suggested query was withdrawn/);
  });

  it('tolerates a code-fenced final answer, and falls back to plain text', async () => {
    const fenced = setup({
      script: [{ outputText: '```json\n{"sql":"SELECT 1","explanation":"One."}\n```' }],
    });
    await fenced.service.stream(HARNESS_USER, { question: 'q' }, { emit: fenced.emit });
    expect(fenced.of('answer')).toEqual([{ sql: 'SELECT 1', explanation: 'One.' }]);

    const prose = setup({ script: [{ outputText: 'I cannot help with that.' }] });
    await prose.service.stream(HARNESS_USER, { question: 'q' }, { emit: prose.emit });
    expect(prose.of('answer')).toEqual([{ sql: null, explanation: 'I cannot help with that.' }]);
  });

  it('on steps_exhausted still answers, with the last good query and a note', async () => {
    const sql = 'SELECT count(*) AS n FROM opentelemetry_traces';
    const t = setup({
      policy: policyWith({ maxSteps: 2 }),
      script: [call('c1', 'run_query', { sql }), call('c2', 'list_tables', {})],
    });

    await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

    expect(t.events.map((e) => e.event)).toEqual(['step', 'answer', 'done']);
    const [final] = t.of('answer');
    expect(final.sql).toBe(sql);
    expect(final.explanation).toMatch(/used all 2 of its steps/);
    expect(t.audits[0].meta).toMatchObject({ stopReason: 'steps_exhausted', steps: 2 });
  });

  it('maps an AiError to an error event, then done', async () => {
    const t = setup({ harness: { userKey: false }, script: [answer('SELECT 1', 'x')] });

    await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

    expect(t.events.map((e) => e.event)).toEqual(['error', 'done']);
    expect(t.of('error')[0].code).toBe('AI_KEY_REQUIRED');
    expect(t.of('error')[0].message).toMatch(/No API key is available for openai for your account/);
    expect(t.audits[0].meta).toMatchObject({ error: 'AI_KEY_REQUIRED' });
  });

  it('maps a rate limit with its retry hint', async () => {
    const t = setup({
      script: () => {
        throw new AiError('AI_RATE_LIMITED', 'slow down', { retryAfterMs: 4_500 });
      },
    });

    await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

    expect(t.of('error')).toEqual([{ code: 'AI_RATE_LIMITED', message: expect.stringMatching(/about 5 seconds/) }]);
  });

  it('passes history before the new question', async () => {
    const t = setup({ script: [answer(null, 'n/a')] });

    await t.service.stream(
      HARNESS_USER,
      {
        question: 'and per service?',
        history: [
          { role: 'user', content: 'how many spans?' },
          { role: 'assistant', content: 'SELECT count(*) FROM opentelemetry_traces' },
          { role: 'assistant', content: '   ' },
        ],
      },
      { emit: t.emit },
    );

    expect(t.requests()[0]!.input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'text', text: 'how many spans?' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'SELECT count(*) FROM opentelemetry_traces' }] },
      { type: 'message', role: 'user', content: [{ type: 'text', text: 'and per service?' }] },
    ]);
  });

  it('a client disconnect aborts the turn without an error frame', async () => {
    const controller = new AbortController();
    const t = setup({
      script: (req) => {
        if (outputsOf(req).length === 0) return call('c1', 'run_query', { sql: 'SELECT 1' });
        return answer('SELECT 1', 'x');
      },
      run: jest.fn(async () => {
        controller.abort(new Error('Client disconnected'));
        throw new Error('The telemetry query was cancelled.');
      }),
    });

    await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit, signal: controller.signal });

    expect(t.of('error')).toEqual([]);
    expect(t.of('answer')).toEqual([]);
    expect(t.events.at(-1)?.event).toBe('done');
    expect(t.audits[0].meta).toMatchObject({ error: 'CANCELLED' });
  });

  it('passes the tool signal to the query service', async () => {
    const t = setup({ script: [call('c1', 'run_query', { sql: 'SELECT 1' }), answer('SELECT 1', 'x')] });

    await t.service.stream(HARNESS_USER, { question: 'q' }, { emit: t.emit });

    expect(t.run.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('shapeQueryOutput', () => {
  const result = (rows: unknown[][]) => ({
    columns: [{ name: 'body', type: 'text' }],
    rows,
    rowCount: rows.length,
    truncated: false,
  });

  it('caps rows at 100 whatever it is asked for', () => {
    const rows = Array.from({ length: 150 }, () => ['x']);

    expect(shapeQueryOutput(result(rows), { shareResults: true, rowsToModel: 500 }).rows).toHaveLength(100);
  });

  it('cuts long cells', () => {
    const out = shapeQueryOutput(result([['a'.repeat(2_000)], [{ big: 'b'.repeat(2_000) }]]), {
      shareResults: true,
      rowsToModel: 10,
    });

    expect(out.rows[0][0]).toBe(`${'a'.repeat(CELL_MAX_CHARS)}…`);
    expect((out.rows[1][0] as string).length).toBe(CELL_MAX_CHARS + 1);
  });

  it('drops rows from the end to stay valid JSON under the size bound', () => {
    const wide = Array.from({ length: 100 }, () => Array.from({ length: 5 }, () => 'z'.repeat(500)));
    const out = shapeQueryOutput(
      { columns: Array.from({ length: 5 }, (_, i) => ({ name: `c${i}`, type: 'text' })), rows: wide, rowCount: 100, truncated: false },
      { shareResults: true, rowsToModel: 100 },
    );

    expect(JSON.stringify(out).length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_CHARS);
    expect(out.rows.length).toBeLessThan(100);
    expect(out.note).toMatch(/left out/);
  });
});

describe('parseFinalAnswer', () => {
  it('reads JSON embedded in prose, and normalises an empty sql to null', () => {
    expect(parseFinalAnswer('Here you go: {"sql":"  ","explanation":"none"} thanks')).toEqual({
      sql: null,
      explanation: 'none',
    });
  });

  it('returns null for text that is not the answer shape', () => {
    expect(parseFinalAnswer('{"query":"SELECT 1"}')).toBeNull();
    expect(parseFinalAnswer('nope')).toBeNull();
  });
});
