import { describe, expect, it, vi } from 'vitest';

import { NdjsonParser, frame, parseCommand } from './ipc-protocol.js';

// =============================================================================
// NDJSON framing  (issue #275, epic #254)
// =============================================================================
//
// A socket delivers BYTES, not messages. One `write` can arrive as three
// `data` events and three writes can arrive as one, and every bug in an
// ad-hoc line protocol lives in that gap. These tests drive the parser with
// exactly the chunk boundaries a real socket produces.
// =============================================================================

describe('NdjsonParser', () => {
  it('parses whole lines', () => {
    const seen: unknown[] = [];
    const parser = new NdjsonParser((value) => seen.push(value));
    parser.push('{"type":"status"}\n{"type":"drain"}\n');
    expect(seen).toEqual([{ type: 'status' }, { type: 'drain' }]);
  });

  it('reassembles a message split across chunks', () => {
    const seen: unknown[] = [];
    const parser = new NdjsonParser((value) => seen.push(value));
    parser.push('{"type":"set-con');
    expect(seen).toEqual([]);
    parser.push('currency","value":4}');
    expect(seen).toEqual([]);
    parser.push('\n');
    expect(seen).toEqual([{ type: 'set-concurrency', value: 4 }]);
  });

  it('handles several messages arriving in one chunk with a partial tail', () => {
    const seen: unknown[] = [];
    const parser = new NdjsonParser((value) => seen.push(value));
    parser.push('{"a":1}\n{"b":2}\n{"c":');
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
    parser.push('3}\n');
    expect(seen).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('accepts Buffer chunks and skips blank lines', () => {
    const seen: unknown[] = [];
    const parser = new NdjsonParser((value) => seen.push(value));
    parser.push(Buffer.from('{"a":1}\n\n\n{"b":2}\n'));
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('reports a malformed line without throwing, and keeps parsing', () => {
    const seen: unknown[] = [];
    const errors: string[] = [];
    const parser = new NdjsonParser(
      (value) => seen.push(value),
      (line) => errors.push(line),
    );
    parser.push('not json\n{"ok":true}\n');
    expect(errors).toEqual(['not json']);
    expect(seen).toEqual([{ ok: true }]);
  });

  it('flushes a final line the peer sent without a newline', () => {
    const onMessage = vi.fn();
    const parser = new NdjsonParser(onMessage);
    parser.push('{"a":1}');
    expect(onMessage).not.toHaveBeenCalled();
    parser.flush();
    expect(onMessage).toHaveBeenCalledWith({ a: 1 });
  });
});

describe('frame', () => {
  it('appends exactly one newline — the only place framing happens', () => {
    const line = frame({ type: 'status' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.split('\n')).toHaveLength(2);
  });
});

describe('parseCommand', () => {
  it('accepts the known commands', () => {
    expect(parseCommand({ type: 'status' })).toEqual({ type: 'status' });
    expect(parseCommand({ type: 'drain' })).toEqual({ type: 'drain' });
    expect(parseCommand({ type: 'stop' })).toEqual({ type: 'stop' });
    expect(parseCommand({ type: 'heap-snapshot' })).toEqual({ type: 'heap-snapshot' });
    expect(parseCommand({ type: 'set-concurrency', value: 4 })).toEqual({ type: 'set-concurrency', value: 4 });
  });

  it('returns undefined rather than throwing for anything else', () => {
    // The daemon answers with an `error` message and keeps the connection —
    // a buggy client must not be able to tear down the control channel.
    expect(parseCommand({ type: 'rm -rf' })).toBeUndefined();
    expect(parseCommand({ type: 'set-concurrency', value: 'four' })).toBeUndefined();
    expect(parseCommand({ type: 'set-concurrency', value: 1.5 })).toBeUndefined();
    expect(parseCommand(null)).toBeUndefined();
    expect(parseCommand('status')).toBeUndefined();
  });
});

describe('channels (RETRO-G1.3)', () => {
  it('reads a frame with no channel field as the node channel', async () => {
    const { messageChannel, isNodeSnapshotMessage, NODE_CHANNEL } = await import('./ipc-protocol.js');
    // The wire shape an old daemon has always written.
    const old = JSON.parse('{"type":"event","event":{"kind":"idle","at":"t"}}') as { channel?: string };
    expect(messageChannel(old)).toBe(NODE_CHANNEL);
    expect(messageChannel({ channel: 'backup' })).toBe('backup');
    expect(messageChannel({ channel: '' })).toBe(NODE_CHANNEL);
    expect(isNodeSnapshotMessage({ type: 'snapshot', snapshot: {} as never })).toBe(true);
    expect(isNodeSnapshotMessage({ type: 'snapshot', snapshot: {}, channel: 'backup' })).toBe(false);
    expect(isNodeSnapshotMessage({ type: 'event', event: {} as never })).toBe(false);
  });

  it('round-trips a channel frame through the framer', async () => {
    const { frame, NdjsonParser } = await import('./ipc-protocol.js');
    const out: unknown[] = [];
    new NdjsonParser((v) => out.push(v)).push(frame({ type: 'event', event: { n: 1 }, channel: 'backup' }));
    expect(out).toEqual([{ type: 'event', event: { n: 1 }, channel: 'backup' }]);
  });
});
