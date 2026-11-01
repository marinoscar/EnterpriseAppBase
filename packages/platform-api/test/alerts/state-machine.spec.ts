import { labelsKeyOf, nextTransition, shouldNotify } from '../../src/alerts/state/alert-state-machine';

const T0 = new Date('2026-01-01T00:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const pending = (since: Date) => ({ id: 'i1', state: 'pending' as const, pendingSince: since });
const firing = { id: 'i1', state: 'firing' as const, pendingSince: T0 };

describe('nextTransition', () => {
  it('opens firing at once when forSeconds is 0', () => {
    expect(nextTransition({ now: T0, open: null, observation: { breached: true }, forSeconds: 0 })).toEqual({ type: 'open', state: 'firing', notify: true });
  });

  it('opens pending when forSeconds > 0, without a notification', () => {
    expect(nextTransition({ now: T0, open: null, observation: { breached: true }, forSeconds: 60 })).toEqual({ type: 'open', state: 'pending', notify: false });
  });

  it('keeps a pending incident pending until forSeconds has held, then promotes it', () => {
    const input = { open: pending(T0), observation: { breached: true }, forSeconds: 60 };
    expect(nextTransition({ ...input, now: at(59) })).toEqual({ type: 'touch' });
    expect(nextTransition({ ...input, now: at(60) })).toEqual({ type: 'promote', notify: true });
  });

  it('only touches a firing incident that stays breached (no second notification)', () => {
    expect(nextTransition({ now: at(500), open: firing, observation: { breached: true }, forSeconds: 0 })).toEqual({ type: 'touch' });
  });

  it('resolves a firing incident on the first clean evaluation, or when its labels are absent', () => {
    expect(nextTransition({ now: at(1), open: firing, observation: { breached: false }, forSeconds: 0 })).toEqual({ type: 'resolve', notify: true });
    expect(nextTransition({ now: at(1), open: firing, observation: null, forSeconds: 0 })).toEqual({ type: 'resolve', notify: true });
  });

  it('discards a pending incident that cleared before it ever fired', () => {
    expect(nextTransition({ now: at(1), open: pending(T0), observation: { breached: false }, forSeconds: 60 })).toEqual({ type: 'discard' });
  });

  it('does nothing when nothing is breached and nothing is open', () => {
    expect(nextTransition({ now: T0, open: null, observation: { breached: false }, forSeconds: 0 })).toEqual({ type: 'none' });
    expect(nextTransition({ now: T0, open: null, observation: null, forSeconds: 0 })).toEqual({ type: 'none' });
  });

  it('is idempotent: re-applying the answer to the state it produces changes nothing', () => {
    const first = nextTransition({ now: T0, open: null, observation: { breached: true }, forSeconds: 0 });
    expect(first.type).toBe('open');
    expect(nextTransition({ now: at(60), open: firing, observation: { breached: true }, forSeconds: 0 }).type).toBe('touch');
  });
});

describe('shouldNotify (cooldown)', () => {
  it('notifies with no earlier resolution or a zero cooldown', () => {
    expect(shouldNotify(T0, null, 900)).toBe(true);
    expect(shouldNotify(T0, at(-1), 0)).toBe(true);
  });

  it('suppresses a re-fire inside the cooldown and allows it at the boundary', () => {
    expect(shouldNotify(at(899), T0, 900)).toBe(false);
    expect(shouldNotify(at(900), T0, 900)).toBe(true);
  });
});

describe('labelsKeyOf', () => {
  it('is empty for no labels, sorted, and unambiguous', () => {
    expect(labelsKeyOf({})).toBe('');
    expect(labelsKeyOf({ b: '2', a: '1' })).toBe('a=1,b=2');
    expect(labelsKeyOf({ a: 'x,b=y' })).not.toBe(labelsKeyOf({ a: 'x', b: 'y' }));
  });

  it('bounds a very long key and keeps distinct sets distinct', () => {
    const a = labelsKeyOf({ k: 'x'.repeat(600) + 'a' });
    const b = labelsKeyOf({ k: 'x'.repeat(600) + 'b' });
    expect(a.length).toBeLessThanOrEqual(512);
    expect(a).not.toBe(b);
  });
});
