import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';

import { isBlankSecret } from './blank-secret';
import { csvField, FORMULA_TRIGGER, neutralizeFormula, UTF8_BOM } from './csv';
import { AI_SSE_HEADERS, AI_SSE_HEARTBEAT_MS, abortOnDisconnect } from './sse';

// The slice's private copies of three small app helpers (issue #703). Each
// value below is the literal the app's original holds
// (credentials/credential-internals.ts, common/export/csv.ts,
// ai/http/ai-sse.ts), so a drift on either side fails a test.

describe('telemetry internal helpers', () => {
  it('isBlankSecret: undefined, null and "" are blank; anything else is a value', () => {
    expect([undefined, null, ''].map((v) => isBlankSecret(v))).toEqual([true, true, true]);
    expect([' ', '0', 'x'].map((v) => isBlankSecret(v))).toEqual([false, false, false]);
  });

  it('csv: the UTF-8 BOM, RFC 4180 quoting and formula neutralisation', () => {
    expect(UTF8_BOM).toBe('﻿');
    expect(FORMULA_TRIGGER.source).toBe('^[=+\\-@\\t\\r]');
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,"b"\n')).toBe('"a,""b""\n"');
    expect(['=1', '+1', '-1', '@x', '\tx', '\rx', 'ok'].map(neutralizeFormula)).toEqual([
      "'=1",
      "'+1",
      "'-1",
      "'@x",
      "'\tx",
      "'\rx",
      'ok',
    ]);
  });

  it('sse: the same headers and heartbeat as the AI routes', () => {
    expect(AI_SSE_HEARTBEAT_MS).toBe(15_000);
    expect(AI_SSE_HEADERS).toEqual({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  });

  it('abortOnDisconnect aborts on an early close, not after a finished response, and disposes', () => {
    const early = Object.assign(new EventEmitter(), { writableFinished: false }) as unknown as ServerResponse;
    const a = abortOnDisconnect(early);
    early.emit('close');
    expect(a.signal.aborted).toBe(true);

    const done = Object.assign(new EventEmitter(), { writableFinished: true }) as unknown as ServerResponse;
    const b = abortOnDisconnect(done);
    done.emit('close');
    expect(b.signal.aborted).toBe(false);

    const later = Object.assign(new EventEmitter(), { writableFinished: false }) as unknown as ServerResponse;
    const c = abortOnDisconnect(later);
    c.dispose();
    later.emit('close');
    expect(c.signal.aborted).toBe(false);
  });
});
