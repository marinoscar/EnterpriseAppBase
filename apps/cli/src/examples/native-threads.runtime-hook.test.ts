import { describe, expect, it, vi } from 'vitest';

import { createNativeThreadsHook } from './native-threads.runtime-hook.js';

const context = { concurrency: 4, cores: 8, nativeThreads: 3, env: {} };

describe('native threads runtime hook (example)', () => {
  it('disables the cache and applies the resolved thread count', async () => {
    const sharp = { cache: vi.fn(), concurrency: vi.fn() };
    await createNativeThreadsHook(async () => sharp).beforeFirstJob(context);

    expect(sharp.cache).toHaveBeenCalledWith(false);
    expect(sharp.concurrency).toHaveBeenCalledWith(3);
  });

  it('does nothing when the module is not installed', async () => {
    await expect(createNativeThreadsHook(async () => undefined).beforeFirstJob(context)).resolves.toBeUndefined();
  });
});
