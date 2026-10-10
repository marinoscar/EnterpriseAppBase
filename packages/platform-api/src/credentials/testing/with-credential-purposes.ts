import { withTemporaryEntries } from '../../core/index';
import {
  credentialPurposeRegistry,
  userCredentialPurposeRegistry,
  type CredentialPurposeDef,
  type UserCredentialPurposeDef,
} from '../registry';

/**
 * The purposes {@link withCredentialPurposes} declares for one test.
 *
 * @stability experimental
 */
export interface TemporaryCredentialPurposes {
  /** System and org purposes. */
  readonly purposes?: readonly CredentialPurposeDef[];
  /** User credential purposes. */
  readonly userPurposes?: readonly UserCredentialPurposeDef[];
}

/**
 * Declares credential purposes for the duration of `fn`, then restores both
 * registries exactly (frozen ones included). Test runners only: it refuses to
 * run outside Jest or Vitest.
 *
 * @param temporary - the purposes to declare.
 * @param fn - the code that writes or resolves them.
 * @returns whatever `fn` returns.
 * @throws Error outside a test runner; RegistryError for a refused entry.
 *
 * @example
 * ```ts
 * await withCredentialPurposes({ purposes: [{ purpose: 'acme', owner: 'app', label: 'Acme key', tiers: ['org'] }] }, async () => {
 *   await orgCredentials.setSecret(orgId, 'acme', 'default', 'k-123');
 * });
 * ```
 *
 * @stability experimental
 */
export function withCredentialPurposes<R>(temporary: TemporaryCredentialPurposes, fn: () => R | Promise<R>): Promise<R> {
  return withTemporaryEntries(credentialPurposeRegistry, temporary.purposes ?? [], () =>
    withTemporaryEntries(userCredentialPurposeRegistry, temporary.userPurposes ?? [], fn),
  );
}
