// =============================================================================
// Registry test helper (issue #675, PP-1.3)
// =============================================================================
//
// Static registries are frozen once a Nest application has bootstrapped, and
// a Jest worker shares one module graph across every `it`. A test that needs an
// extra entry (a fake permission, a throwaway settings namespace) therefore
// cannot just call `register()`: it would hit `FROZEN`, or leak the entry into
// the next test. `withTemporaryEntries` adds the entries, runs the callback and
// puts the registry back exactly as it found it.
//
// Framework-free like registry.ts, and refused outside a test runner so no
// production path can unfreeze a registry.
// =============================================================================

import { Registry } from './registry';

/** Whether this process is a Jest worker or a Vitest run. */
function insideTestRunner(): boolean {
  return Boolean(process.env.JEST_WORKER_ID || process.env.VITEST);
}

/**
 * Adds `entries` to `registry` for the duration of `fn`, then restores the
 * registry's previous entries and frozen state, even if `fn` throws.
 *
 * A frozen registry is unfrozen for the duration and frozen again afterwards.
 * Restoring is a full rollback: an entry `fn` itself registers is removed too,
 * and an entry a temporary one replaced (under `onDuplicate: 'replace'`) comes
 * back at its old position. Nested calls restore in LIFO order, so they compose.
 *
 * @param registry - the registry to extend.
 * @param entries - the temporary entries; registered with `registerAll`, so the
 *   registry's usual id, validation and duplicate rules apply.
 * @param fn - the code that needs the entries. May be async.
 * @returns whatever `fn` returns.
 * @throws Error when called outside Jest or Vitest (`JEST_WORKER_ID` / `VITEST` unset).
 * @throws RegistryError when an entry is refused; the registry is unchanged.
 *
 * @example
 * ```ts
 * await withTemporaryEntries(permissionRegistry, [{ id: 'test:read' }], async () => {
 *   expect(permissionRegistry.has('test:read')).toBe(true);
 * });
 * ```
 *
 * @stability stable
 */
export async function withTemporaryEntries<T, R>(
  registry: Registry<T>,
  entries: readonly T[],
  fn: () => R | Promise<R>,
): Promise<R> {
  if (!insideTestRunner()) {
    throw new Error(
      `withTemporaryEntries(${registry.name}) is a test helper: it runs only under Jest or Vitest ` +
        '(JEST_WORKER_ID or VITEST must be set).',
    );
  }

  const saved = registry._captureState();
  registry._unfreeze();

  try {
    registry.registerAll(entries);
    return await fn();
  } finally {
    registry._restoreState(saved);
  }
}
