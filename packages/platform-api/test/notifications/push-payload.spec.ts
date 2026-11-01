// The push payload allowlist (PP-14.10): whatever the app's hook returns, only
// `actions`, `icon`, `badge`, `urgency` and `tag` survive, each bounded.
import {
  PUSH_EXTRA_TEXT_MAX,
  PUSH_EXTRA_URL_MAX,
  PUSH_MAX_ACTIONS,
  sanitizePushExtras,
} from '../../src/notifications/channels/push-payload';

describe('sanitizePushExtras', () => {
  it('keeps the five allowlisted extras and drops everything else', () => {
    const result = sanitizePushExtras({
      actions: [{ action: 'open', title: 'Open', icon: '/i/open.png' }],
      icon: '/icons/app.png',
      badge: 'https://cdn.example.test/badge.png',
      urgency: 'high',
      tag: 'invoice',
      data: { secret: 1 },
      title: 'hijacked',
      body: 'hijacked',
      link: 'https://evil.example',
    });
    expect(result).toEqual({
      payload: {
        actions: [{ action: 'open', title: 'Open', icon: '/i/open.png' }],
        icon: '/icons/app.png',
        badge: 'https://cdn.example.test/badge.png',
        tag: 'invoice',
      },
      urgency: 'high',
    });
  });

  it('returns nothing for anything that is not an object', () => {
    for (const value of [undefined, null, 'x', 7, [], () => ({})]) {
      expect(sanitizePushExtras(value)).toEqual({ payload: {} });
    }
  });

  it('drops an invalid value on its own and keeps the rest', () => {
    expect(
      sanitizePushExtras({
        icon: 'javascript:alert(1)',
        badge: '//evil.example/x.png',
        tag: 'x'.repeat(PUSH_EXTRA_TEXT_MAX + 1),
        urgency: 'urgent',
      }),
    ).toEqual({ payload: {} });
    expect(sanitizePushExtras({ icon: 'http://insecure.example/i.png', tag: 'ok' })).toEqual({ payload: { tag: 'ok' } });
    expect(sanitizePushExtras({ icon: `/${'a'.repeat(PUSH_EXTRA_URL_MAX)}`, tag: 'ok' })).toEqual({ payload: { tag: 'ok' } });
    expect(sanitizePushExtras({ icon: '/has space.png', tag: 'ok' })).toEqual({ payload: { tag: 'ok' } });
  });

  it('keeps at most two well-formed actions', () => {
    const result = sanitizePushExtras({
      actions: [
        { action: 'a', title: 'A' },
        { title: 'no action id' },
        'nope',
        { action: 'b', title: 'B' },
        { action: 'c', title: 'C' },
      ],
    });
    expect(result.payload.actions).toEqual([
      { action: 'a', title: 'A' },
      { action: 'b', title: 'B' },
    ]);
    expect(result.payload.actions).toHaveLength(PUSH_MAX_ACTIONS);
    expect(sanitizePushExtras({ actions: [{ action: '', title: 'x' }] })).toEqual({ payload: {} });
  });
});
