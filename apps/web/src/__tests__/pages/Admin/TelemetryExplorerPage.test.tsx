/**
 * `/admin/settings/telemetry/explorer` (issue #537, epic #528).
 *
 * Wire-level against MSW (the #535/#536 routes are mocked to their contract).
 * CodeMirror is replaced with a textarea that honours the same props and
 * imperative handle (`insertAtCursor`, `focus`) — jsdom has no layout, and
 * this suite is about the page, not the editor library.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { setViewportWidth } from '../../setup';
import { act } from '@testing-library/react';
import { render, mockAdminUser, type MockUser } from '../../utils/test-utils';
import { mockTelemetryQueryResult } from '../../mocks/fixtures/telemetry';
import { STARTER_QUERIES, traceQuery } from '../../../components/telemetry/starterQueries';
import { QUERY_HISTORY_KEY } from '../../../components/telemetry/queryHistory';
import TelemetryExplorerPage from '../../../pages/Admin/TelemetryExplorerPage';

vi.mock('../../../components/telemetry/SqlEditor', async () => {
  const React = await import('react');
  type Props = {
    value: string;
    onChange: (value: string) => void;
    onRun: () => void;
    ref?: React.Ref<{ insertAtCursor: (text: string) => void; focus: () => void }>;
  };
  function MockSqlEditor({ value, onChange, onRun, ref }: Props) {
    const element = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(
      ref,
      () => ({
        insertAtCursor: (text: string) => {
          const textarea = element.current;
          if (!textarea) return;
          const start = textarea.selectionStart ?? textarea.value.length;
          const end = textarea.selectionEnd ?? start;
          onChange(textarea.value.slice(0, start) + text + textarea.value.slice(end));
        },
        focus: () => element.current?.focus(),
      }),
      [onChange],
    );
    return (
      <textarea
        aria-label="SQL query"
        ref={element}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onRun();
          }
        }}
      />
    );
  }
  return { default: MockSqlEditor };
});

const API_BASE = '*/api';

function captureQueries() {
  const bodies: { sql: string }[] = [];
  server.use(
    http.post(`${API_BASE}/admin/telemetry/query`, async ({ request }) => {
      bodies.push((await request.json()) as { sql: string });
      return HttpResponse.json({ data: mockTelemetryQueryResult });
    }),
  );
  return bodies;
}

function renderPage(options: { aiEnabled?: boolean; user?: MockUser } = {}) {
  return render(<TelemetryExplorerPage />, {
    wrapperOptions: {
      user: options.user ?? mockAdminUser,
      aiEnabled: options.aiEnabled ?? true,
      telemetryEnabled: true,
      route: '/admin/settings/telemetry/explorer',
    },
  });
}

async function editor(): Promise<HTMLTextAreaElement> {
  return (await screen.findByRole('textbox', { name: 'SQL query' })) as HTMLTextAreaElement;
}

describe('TelemetryExplorerPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the query and renders the grid, positional columns and the status line', async () => {
    const bodies = captureQueries();
    const user = userEvent.setup();
    renderPage();
    const textarea = await editor();
    expect(textarea.value).toBe(STARTER_QUERIES[0].sql);

    await user.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].sql).toBe(STARTER_QUERIES[0].sql);
    const grid = await screen.findByRole('grid', { name: 'Query results' });
    // Repeated column names each keep their own column.
    expect(within(grid).getAllByText('service_name')).toHaveLength(2);
    expect(within(grid).getByText('api')).toBeInTheDocument();
    expect(within(grid).getByText('api-dup')).toBeInTheDocument();
    expect(within(grid).getByText('NULL')).toBeInTheDocument();
    expect(screen.getByTestId('query-status')).toHaveTextContent('2 rows · 42 ms');
    expect(screen.queryByTestId('truncated-banner')).not.toBeInTheDocument();
  });

  it('runs on Ctrl+Enter from the editor', async () => {
    const bodies = captureQueries();
    const user = userEvent.setup();
    renderPage();
    const textarea = await editor();

    await user.click(textarea);
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(bodies).toHaveLength(1));
  });

  it('shows a truncation banner when the result was capped', async () => {
    server.use(
      http.post(`${API_BASE}/admin/telemetry/query`, () =>
        HttpResponse.json({ data: { ...mockTelemetryQueryResult, rowCount: 2, truncated: true } }),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await editor();
    await user.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByTestId('truncated-banner')).toHaveTextContent(
      'Results truncated at 2 rows',
    );
  });

  it('shows the API message and branches its heading on details.reason', async () => {
    server.use(
      http.post(`${API_BASE}/admin/telemetry/query`, () =>
        HttpResponse.json(
          {
            code: 'BAD_REQUEST',
            message: 'Only a single read-only statement is allowed',
            details: { reason: 'TELEMETRY_QUERY_REJECTED' },
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await editor();
    await user.click(screen.getByRole('button', { name: 'Run' }));

    const alert = await screen.findByTestId('query-error');
    expect(alert).toHaveTextContent('Query not allowed');
    expect(alert).toHaveTextContent('TELEMETRY_QUERY_REJECTED');
    expect(alert).toHaveTextContent('Only a single read-only statement is allowed');
  });

  it('reports a database error with its SQLSTATE', async () => {
    server.use(
      http.post(`${API_BASE}/admin/telemetry/query`, () =>
        HttpResponse.json(
          {
            code: 'BAD_REQUEST',
            message: 'Table not found: nope',
            details: { reason: 'TELEMETRY_QUERY_FAILED', sqlState: '42P01' },
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await editor();
    await user.click(screen.getByRole('button', { name: 'Run' }));

    const alert = await screen.findByTestId('query-error');
    expect(alert).toHaveTextContent('Query failed (SQLSTATE 42P01)');
    expect(alert).toHaveTextContent('Table not found: nope');
  });

  it('reports a timeout with the limit that was hit', async () => {
    server.use(
      http.post(`${API_BASE}/admin/telemetry/query`, () =>
        HttpResponse.json(
          {
            code: 'GATEWAY_TIMEOUT',
            message: 'The query did not finish in time',
            details: { reason: 'TELEMETRY_QUERY_TIMEOUT', timeoutMs: 30000 },
          },
          { status: 504 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await editor();
    await user.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByTestId('query-error')).toHaveTextContent('Query timed out after 30 s');
  });

  it('exports the current SQL in the chosen format and triggers a download', async () => {
    const exports: { sql: string; format: string }[] = [];
    server.use(
      http.post(`${API_BASE}/admin/telemetry/export`, async ({ request }) => {
        exports.push((await request.json()) as { sql: string; format: string });
        return new HttpResponse('PAR1', {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="telemetry-20260927.parquet"',
            'X-Telemetry-Row-Count': '100000',
            'X-Telemetry-Truncated': 'true',
          },
        });
      }),
    );
    const createObjectURL = vi.fn(() => 'blob:telemetry');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    renderPage();
    await editor();

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Parquet' }));

    await waitFor(() => expect(exports).toHaveLength(1));
    expect(exports[0]).toEqual({ sql: STARTER_QUERIES[0].sql, format: 'parquet' });
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(click).toHaveBeenCalledTimes(1);
    // Named by Content-Disposition.
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('telemetry-20260927.parquet');
    // Truncation is announced.
    expect(
      await screen.findByText(/Export truncated at 100,000 rows — telemetry-20260927.parquet/),
    ).toBeInTheDocument();
  });

  it('shows an export refusal', async () => {
    server.use(
      http.post(`${API_BASE}/admin/telemetry/export`, () =>
        HttpResponse.json(
          {
            code: 'SERVICE_UNAVAILABLE',
            message: 'GreptimeDB is not reachable',
            details: { reason: 'TELEMETRY_UNREACHABLE' },
          },
          { status: 503 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await editor();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'CSV' }));

    const alert = await screen.findByTestId('export-error');
    expect(alert).toHaveTextContent('Telemetry store unreachable');
    expect(alert).toHaveTextContent('GreptimeDB is not reachable');
  });

  it('replaces the editor text with a starter query', async () => {
    const user = userEvent.setup();
    renderPage();
    const textarea = await editor();

    await user.click(screen.getByRole('button', { name: 'Starter queries' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Requests per service (24h)' }));

    const starter = STARTER_QUERIES.find((entry) => entry.id === 'requests-per-service');
    expect(textarea.value).toBe(starter?.sql);
  });

  it('records run queries in history, persisted in localStorage', async () => {
    captureQueries();
    const user = userEvent.setup();
    const { unmount } = renderPage();
    await editor();
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await screen.findByTestId('query-status');

    expect(JSON.parse(window.localStorage.getItem(QUERY_HISTORY_KEY) ?? '[]')).toEqual([
      STARTER_QUERIES[0].sql,
    ]);
    unmount();

    // A fresh page reads it back.
    renderPage();
    const textarea = await editor();
    await user.clear(textarea);
    await user.click(screen.getByRole('button', { name: 'History' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getAllByRole('menuitem')[0]);
    expect(textarea.value).toBe(STARTER_QUERIES[0].sql);
  });

  it('opens a trace when a trace_id value is clicked', async () => {
    const bodies = captureQueries();
    const user = userEvent.setup();
    renderPage();
    const textarea = await editor();
    await user.click(screen.getByRole('button', { name: 'Run' }));
    const grid = await screen.findByRole('grid', { name: 'Query results' });

    await user.click(within(grid).getByRole('button', { name: 'abc123' }));

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].sql).toBe(traceQuery('abc123'));
    expect(textarea.value).toBe(traceQuery('abc123'));
  });

  it('inserts a quoted column name from the schema panel at the cursor', async () => {
    const user = userEvent.setup();
    renderPage();
    const textarea = await editor();
    await user.clear(textarea);
    await user.type(textarea, 'SELECT ');

    const schema = await screen.findByRole('list', { name: 'Telemetry schema' });
    await user.click(await within(schema).findByRole('button', { name: 'Expand opentelemetry_traces' }));
    await user.click(await screen.findByText('span_attributes.http.route'));

    expect(textarea.value).toBe('SELECT "span_attributes.http.route"');
  });

  it('hides the assistant while AI is off', async () => {
    renderPage({ aiEnabled: false });
    await editor();
    expect(screen.queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument();
  });

  it('streams assistant steps and the answer, then inserts the SQL and runs it', async () => {
    const answerSql = 'SELECT service_name, count(*) FROM opentelemetry_traces GROUP BY service_name';
    const streamBodies: { question: string; history?: unknown[] }[] = [];
    server.use(
      http.post(`${API_BASE}/admin/telemetry/assistant/stream`, async ({ request }) => {
        streamBodies.push((await request.json()) as { question: string });
        const frames = [
          ['step', { index: 0, tool: 'list_tables', durationMs: 12 }],
          ['step', { index: 1, tool: 'run_query', input: { sql: answerSql }, rowCount: 3, durationMs: 40 }],
          ['answer', { sql: answerSql, explanation: 'Spans per service.' }],
          ['done', {}],
        ]
          .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          .join('');
        return new HttpResponse(frames, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );
    const bodies = captureQueries();
    const user = userEvent.setup();
    renderPage();
    const textarea = await editor();

    await user.click(screen.getByRole('button', { name: 'Assistant' }));
    await user.type(screen.getByRole('textbox', { name: 'Ask the assistant' }), 'Spans per service?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByTestId('assistant-explanation')).toHaveTextContent('Spans per service.');
    const steps = screen.getAllByTestId('assistant-step');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent('Listed tables');
    expect(steps[1]).toHaveTextContent('Ran query');
    expect(steps[1]).toHaveTextContent('3 rows');
    expect(streamBodies[0]).toEqual({ question: 'Spans per service?' });

    // Default action: insert into the editor and run.
    await waitFor(() => expect(textarea.value).toBe(answerSql));
    await waitFor(() => expect(bodies.map((body) => body.sql)).toContain(answerSql));

    // A follow-up carries the previous turn as history.
    await user.type(screen.getByRole('textbox', { name: 'Ask the assistant' }), 'Only errors');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(streamBodies).toHaveLength(2));
    expect(streamBodies[1].history).toEqual([
      { role: 'user', content: 'Spans per service?' },
      { role: 'assistant', content: `Spans per service.\n\nSQL:\n${answerSql}` },
    ]);
  });

  it('shows an assistant refusal that arrives before the stream', async () => {
    server.use(
      http.post(`${API_BASE}/admin/telemetry/assistant/stream`, () =>
        HttpResponse.json(
          {
            code: 'CONFLICT',
            message: 'The telemetry assistant is disabled',
            details: { reason: 'TELEMETRY_ASSISTANT_DISABLED' },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await editor();

    await user.click(screen.getByRole('button', { name: 'Assistant' }));
    await user.type(screen.getByRole('textbox', { name: 'Ask the assistant' }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    const reply = await screen.findByTestId('assistant-reply');
    await waitFor(() => expect(reply).toHaveTextContent('The telemetry assistant is disabled'));
    expect(reply).toHaveTextContent('TELEMETRY_ASSISTANT_DISABLED');
  });

  it('at phone width, puts the schema in a drawer and the assistant in a full-screen dialog', async () => {
    act(() => setViewportWidth(390));
    const user = userEvent.setup();
    renderPage();
    await editor();

    // No docked schema panel below `sm`.
    expect(screen.queryByRole('complementary', { name: 'Schema' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Schema' }));
    expect(await screen.findByRole('list', { name: 'Telemetry schema' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close schema' }));
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Telemetry schema' })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Assistant' }));
    const dialog = await screen.findByRole('dialog', { name: 'Assistant' });
    expect(within(dialog).getByRole('textbox', { name: 'Ask the assistant' })).toBeInTheDocument();
  });
});
