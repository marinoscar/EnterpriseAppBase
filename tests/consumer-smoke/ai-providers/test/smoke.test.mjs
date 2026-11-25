// Consumer smoke for @marinoscar/platform-ai-providers (issue #991): plain Node,
// installed from a packed tarball outside the repository, no workspace link.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PKG = '@marinoscar/platform-ai-providers';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('the package root loads with no side effects and lets the process exit', () => {
  const started = Date.now();
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./root-load.child.cjs', import.meta.url))], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15_000,
  });
  const elapsed = Date.now() - started;

  assert.equal(run.error, undefined, `child did not exit by itself: ${run.error?.message}`);
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);

  assert.ok(report.exports > 0, 'the root exports something');
  assert.deepEqual(report.forbiddenModules, [], 'root loads no SDK, Nest, OpenTelemetry or reflect-metadata module');
  assert.deepEqual(report.addedGlobals, [], 'root adds no global');
  assert.deepEqual(report.extraResources, [], 'root leaves no timer, socket or other handle');
  assert.ok(elapsed < 10_000, `the process exited promptly (took ${elapsed} ms)`);
});

test('the adapter factories construct with only their SDK and zod installed', () => {
  const { createOpenAiAdapter, createOpenAiCompatibleAdapter } = require(`${PKG}/openai`);
  const { createAnthropicAdapter } = require(`${PKG}/anthropic`);

  for (const [name, adapter] of [
    ['openai', createOpenAiAdapter()],
    ['openai-compatible', createOpenAiCompatibleAdapter()],
    ['anthropic', createAnthropicAdapter()],
  ]) {
    assert.ok(adapter, `${name} adapter constructed`);
    assert.equal(typeof adapter.responses?.stream, 'function', `${name} carries a responses port`);
  }
});

const sse = (type, payload) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;

function responsesStream() {
  const base = {
    id: 'resp_smoke_1',
    object: 'response',
    created_at: 1_760_000_000,
    model: 'gpt-4o-2024-08-06',
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    parallel_tool_calls: true,
    temperature: 1,
    tool_choice: 'auto',
    tools: [],
    top_p: 1,
  };
  const message = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'Hello!', annotations: [] }],
  };
  let seq = 0;
  const n = () => ({ sequence_number: seq++ });
  const inProgress = { ...base, status: 'in_progress', output: [], usage: null };

  return [
    sse('response.created', { response: inProgress, ...n() }),
    sse('response.in_progress', { response: inProgress, ...n() }),
    sse('response.output_item.added', { output_index: 0, item: { ...message, status: 'in_progress', content: [] }, ...n() }),
    sse('response.output_text.delta', { item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Hel', logprobs: [], ...n() }),
    sse('response.output_text.delta', { item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'lo!', logprobs: [], ...n() }),
    sse('response.output_text.done', { item_id: 'msg_1', output_index: 0, content_index: 0, text: 'Hello!', logprobs: [], ...n() }),
    sse('response.output_item.done', { output_index: 0, item: message, ...n() }),
    sse('response.completed', {
      response: {
        ...base,
        status: 'completed',
        output: [message],
        usage: {
          input_tokens: 12,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          output_tokens: 7,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 19,
        },
      },
      ...n(),
    }),
  ].join('');
}

test('responses.stream works end to end against a local OpenAI-shaped server', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      if (req.method === 'POST' && req.url === '/v1/responses') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.end(responsesStream());
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'not found', type: 'invalid_request_error', code: 'not_found' } }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { createOpenAiAdapter } = require(`${PKG}/openai`);
    const adapter = createOpenAiAdapter();
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const events = [];

    for await (const event of adapter.responses.stream(
      { model: 'gpt-4o', input: 'Say hello' },
      { apiKey: 'sk-test', requestId: 'r1', baseUrl },
    )) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    assert.equal(types[0], 'response.created');
    assert.equal(types.filter((t) => t === 'response.completed' || t === 'error').length, 1);
    assert.equal(types.at(-1), 'response.completed', `stream ended with ${types.at(-1)}`);
    assert.equal(events.filter((e) => e.type === 'output_text.delta').map((e) => e.delta).join(''), 'Hello!');
    assert.equal(events.at(-1).response.outputText, 'Hello!');

    const call = seen.find((s) => s.url === '/v1/responses');
    assert.ok(call, 'the request reached the local server only');
    assert.equal(call.auth, 'Bearer sk-test');
    assert.equal(JSON.parse(call.body).stream, true);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the installed tree carries none of the platform-api runtime stack', () => {
  const run = spawnSync('npm', ['ls', '--all', '--json'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  const tree = JSON.parse(run.stdout);
  const banned = /^(passport($|-.*)|@aws-sdk\/.*|@opentelemetry\/.*|nodemailer|web-push|exceljs|@nestjs\/.*|@prisma\/.*)$/;
  const found = new Set();
  const walk = (deps) => {
    for (const [name, node] of Object.entries(deps ?? {})) {
      // An unmet OPTIONAL peer (openai lists an @aws-sdk one) is listed without a version: it is not installed.
      if (!node.version) continue;
      if (banned.test(name)) found.add(name);
      walk(node.dependencies);
    }
  };
  walk(tree.dependencies);

  assert.ok(tree.dependencies?.[PKG], 'the package is installed');
  assert.ok(tree.dependencies?.openai && tree.dependencies?.zod, 'openai and zod are installed');
  assert.deepEqual([...found], [], `banned packages in the dependency tree: ${[...found].join(', ')}`);
});
