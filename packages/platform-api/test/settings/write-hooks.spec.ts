import { pendingWriteHooks } from '../../src/settings/write-hooks';
import type { SettingsTx } from '../../src/settings/data/settings-db';

// pendingWriteHooks (issues #1090, #1105): which namespace hooks a write runs.

const tx = {} as SettingsTx;

describe('pendingWriteHooks', () => {
  it('returns one step per hooked namespace whose value changed, in registration order', async () => {
    const calls: string[] = [];
    const a = { key: 'alpha', onWrite: jest.fn(async () => void calls.push('alpha')) };
    const b = { key: 'beta', onWrite: jest.fn(async () => void calls.push('beta')) };
    const plain = { key: 'plain' };

    const steps = pendingWriteHooks([a, plain, b], { alpha: 1, beta: 1, plain: 1 }, { alpha: 2, beta: 2, plain: 2 }, 'user', 'u1');
    for (const step of steps) await step(tx);

    expect(calls).toEqual(['alpha', 'beta']);
  });

  it('skips a namespace whose value is deeply equal before and after', () => {
    const hook = jest.fn();
    const steps = pendingWriteHooks([{ key: 'ns', onWrite: hook }], { ns: { a: [1, { b: 2 }] } }, { ns: { a: [1, { b: 2 }] } }, 'system', 'admin');

    expect(steps).toHaveLength(0);
    expect(hook).not.toHaveBeenCalled();
  });

  it('hands the hook the scope, the user and the namespace before and after', async () => {
    const hook = jest.fn(async () => undefined);
    const [step] = pendingWriteHooks([{ key: 'ns', onWrite: hook }], {}, { ns: { x: 1 } }, 'user', 'u1');

    await step!(tx);

    expect(hook).toHaveBeenCalledWith(tx, { userId: 'u1', scope: 'user', before: undefined, after: { x: 1 } });
  });

  it('a hook that throws rejects its step, so the caller’s transaction rolls back', async () => {
    const [step] = pendingWriteHooks(
      [{ key: 'ns', onWrite: async () => Promise.reject(new Error('boom')) }],
      { ns: 1 },
      { ns: 2 },
      'user',
      'u1',
    );

    await expect(step!(tx)).rejects.toThrow('boom');
  });

  it('tolerates a missing document on either side', () => {
    expect(pendingWriteHooks([{ key: 'ns', onWrite: jest.fn() }], undefined, null, 'user', 'u')).toHaveLength(0);
  });
});
