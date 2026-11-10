import type { WorkerRuntimeHook } from '@marinoscar/platform-cli/node';

// =============================================================================
// EXAMPLE, NOT WIRED: capping libvips threads with a worker runtime hook
// (#1072)
// =============================================================================
//
// libvips (behind `sharp`) starts one thread per core for every pipeline, so N
// concurrent image jobs grow RSS off the V8 heap, where the memory watchdog
// cannot see it. The platform has no `sharp` dependency; the app that has one
// registers this hook, and the platform runs it once, after the heap re-exec
// and before the first claim, with the resolved `<PREFIX>NATIVE_THREADS`.
//
// The module is loaded through a callback so this file (and the platform) never
// import it, and a lean install without it simply skips the tuning:
//
//   registerWorkerRuntimeHook(
//     createNativeThreadsHook(async () => (await import('sharp')).default),
//   );
//
// A fleet that already sets a legacy name keeps it working with an alias:
//
//   createCli({ ..., node: { envAliases: { nativeThreads: ['APP_SHARP_CONCURRENCY'] } } });
// =============================================================================

/** The slice of `sharp` the hook uses. */
export interface SharpLike {
  /** `false` disables the operation cache, which only pins native memory for a stream of distinct images. */
  cache(options: boolean): unknown;
  concurrency(threads: number): unknown;
}

/**
 * Builds the hook. It sets both the cache and the thread cap.
 *
 * @param loadSharp - Resolves the module, or `undefined` when it is not installed.
 */
export function createNativeThreadsHook(loadSharp: () => Promise<SharpLike | undefined>): WorkerRuntimeHook {
  return {
    id: 'example.native-threads',
    async beforeFirstJob({ nativeThreads }) {
      const sharp = await loadSharp();
      if (sharp === undefined) return;
      sharp.cache(false);
      sharp.concurrency(nativeThreads);
    },
  };
}
