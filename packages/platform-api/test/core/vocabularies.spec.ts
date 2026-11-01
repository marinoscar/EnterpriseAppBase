import {
  BUILTIN_ERROR_CODES,
  BUILTIN_SYSTEM_ACCESS_REASONS,
  RegistryError,
  ScopedAccessError,
  SYSTEM_ACCESS_REASONS,
  credentialKindRegistry,
  defaultErrorCodeForStatus,
  errorCodeRegistry,
  forSystem,
  isCredentialKind,
  isErrorCodeForStatus,
  isSystemAccessReason,
  principalKindRegistry,
  registerCredentialKind,
  registerErrorCode,
  registerPrincipalKind,
  registerSystemAccessReason,
  requireCredentialKind,
  runAsSystem,
  systemAccessReasonRegistry,
  systemScopeExtension,
  withTemporaryEntries,
  UnknownCredentialKindError,
} from '../../src/core';
import { describeVocabularyConformance } from '../../src/core/testing';

// =============================================================================
// The open vocabularies of PP-14.14: access reasons, principal and credential
// kinds, error codes. The registries are module-level and freeze at bootstrap,
// so every registration below goes through `withTemporaryEntries`.
// =============================================================================

describeVocabularyConformance({ describe, it, expect });

/** A client that never reaches a database. */
const client = {
  $transaction: async (fn: unknown) => (typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(client) : []),
  $executeRaw: () => Promise.resolve(1),
  $extends: (extension: unknown) => extension,
};

describe('system access reasons', () => {
  it('registers the nine built-ins through the public function; the deprecated array equals them', () => {
    expect([...BUILTIN_SYSTEM_ACCESS_REASONS]).toEqual(systemAccessReasonRegistry.ids().slice(0, 9));
    expect(SYSTEM_ACCESS_REASONS).toBe(BUILTIN_SYSTEM_ACCESS_REASONS);
    expect(systemAccessReasonRegistry.ids()).toHaveLength(9);
  });

  it('refuses a malformed id, an empty description and a duplicate of a built-in', () => {
    const failure = (fn: () => void) => {
      try {
        fn();
      } catch (error) {
        return error;
      }
      throw new Error('expected a throw');
    };
    for (const id of ['x', 'Upper-case', '1abc', 'has space', 'a'.repeat(49), '__proto__', '']) {
      expect(failure(() => registerSystemAccessReason({ id, description: 'd' }))).toBeInstanceOf(RegistryError);
    }
    expect(() => registerSystemAccessReason({ id: 'abc', description: '' })).toThrow(/description/);
    expect(failure(() => registerSystemAccessReason({ id: 'purge', description: 'again' }))).toMatchObject({ code: 'DUPLICATE_ID' });
  });

  it('a registered app reason is accepted by every bypass entry point; before registration it throws', async () => {
    expect(() => forSystem(client as never, 'transcript-reindex')).toThrow(ScopedAccessError);
    expect(isSystemAccessReason('transcript-reindex')).toBe(false);

    await withTemporaryEntries(systemAccessReasonRegistry, [{ id: 'transcript-reindex', description: 'Rebuilds transcript search rows.' }], async () => {
      expect(isSystemAccessReason('transcript-reindex')).toBe(true);
      expect(() => forSystem(client as never, 'transcript-reindex')).not.toThrow();
      expect(() => systemScopeExtension(client as never, 'transcript-reindex')).not.toThrow();
      await expect(runAsSystem(client as never, 'transcript-reindex', async () => 'ran')).resolves.toBe('ran');
    });

    // Rolled back: the reason is unknown again.
    await expect(runAsSystem(client as never, 'transcript-reindex', async () => 'ran')).rejects.toThrow(ScopedAccessError);
  });

  it('the error names the registered reasons and how to add one', () => {
    expect(() => forSystem(client as never, 'because')).toThrow(/backup, restore, purge.*registerSystemAccessReason\(\)/);
  });

  it('a frozen registry refuses a late registration (no reason can be added at request time)', () => {
    systemAccessReasonRegistry.freeze();
    try {
      expect(() => registerSystemAccessReason({ id: 'late-reason', description: 'too late' })).toThrow(/frozen/);
      expect(() => forSystem(client as never, 'late-reason')).toThrow(ScopedAccessError);
    } finally {
      // freeze() is permanent for the process; tests that follow only read.
    }
  });
});

describe('principal and credential kinds', () => {
  it('registers the built-ins: node maps to the node principal, the others to user', () => {
    expect(principalKindRegistry.ids()).toEqual(['user', 'node']);
    expect(credentialKindRegistry.ids()).toEqual(['session', 'device', 'pat', 'node']);
    expect(requireCredentialKind('node').principalKind).toBe('node');
    expect(isCredentialKind('pat')).toBe(true);
  });

  it('denies an unregistered kind with UnknownCredentialKindError naming the registered ones', () => {
    expect(() => requireCredentialKind('api-key')).toThrow(UnknownCredentialKindError);
    expect(() => requireCredentialKind('api-key')).toThrow(/Registered kinds: session, device, pat, node/);
    expect(isCredentialKind('api-key')).toBe(false);
  });

  it('a credential kind needs an already-registered principal kind', async () => {
    await withTemporaryEntries(credentialKindRegistry, [], async () => {
      expect(() => registerCredentialKind({ id: 'api-key', principalKind: 'service', description: 'd' })).toThrow(/not a registered principal kind/);
    });
    await withTemporaryEntries(principalKindRegistry, [{ id: 'service', description: 'An integration.' }], async () => {
      await withTemporaryEntries(credentialKindRegistry, [{ id: 'api-key', principalKind: 'service', description: 'An `ak_` key.' }], async () => {
        expect(requireCredentialKind('api-key')).toMatchObject({ principalKind: 'service' });
        expect(isCredentialKind('api-key')).toBe(true);
      });
      expect(isCredentialKind('api-key')).toBe(false);
    });
  });

  it('refuses a duplicate or malformed id', async () => {
    expect(() => registerPrincipalKind({ id: 'user', description: 'again' })).toThrow(/already|DUPLICATE|duplicate/i);
    expect(() => registerCredentialKind({ id: 'Bad_Id', principalKind: 'user', description: 'd' })).toThrow(RegistryError);
    expect(() => registerCredentialKind({ id: 'good-id', principalKind: 'user', description: ' ' })).toThrow(/description/);
  });
});

describe('error codes', () => {
  it('registers the ten status-derived codes; an unmapped status falls back to ERROR', () => {
    expect(BUILTIN_ERROR_CODES.map((def) => `${def.status} ${def.code}`)).toEqual([
      '400 BAD_REQUEST',
      '401 UNAUTHORIZED',
      '403 FORBIDDEN',
      '404 NOT_FOUND',
      '409 CONFLICT',
      '412 PRECONDITION_FAILED',
      '413 PAYLOAD_TOO_LARGE',
      '422 UNPROCESSABLE_ENTITY',
      '429 TOO_MANY_REQUESTS',
      '500 INTERNAL_ERROR',
    ]);
    expect(errorCodeRegistry.ids()).toHaveLength(10);
    expect(defaultErrorCodeForStatus(409)).toBe('CONFLICT');
    expect(defaultErrorCodeForStatus(418)).toBe('ERROR');
    expect(defaultErrorCodeForStatus(503)).toBe('ERROR');
  });

  it('validates the code, the status and the description; ERROR and built-ins cannot be registered', () => {
    expect(() => registerErrorCode({ code: 'lower_case', status: 409, description: 'd' })).toThrow(RegistryError);
    expect(() => registerErrorCode({ code: 'AB', status: 409, description: 'd' })).toThrow(RegistryError);
    expect(() => registerErrorCode({ code: 'NEEDS_STATUS', status: 200, description: 'd' })).toThrow(/status must be an integer from 400 to 599/);
    expect(() => registerErrorCode({ code: 'NEEDS_STATUS', status: 409.5, description: 'd' })).toThrow(/status/);
    expect(() => registerErrorCode({ code: 'NEEDS_TEXT', status: 409, description: '' })).toThrow(/description/);
    expect(() => registerErrorCode({ code: 'ERROR', status: 500, description: 'fallback' })).toThrow(/fallback/);
    expect(() => registerErrorCode({ code: 'CONFLICT', status: 409, description: 'again' })).toThrow(RegistryError);
  });

  it('a registered code is for ONE status', async () => {
    await withTemporaryEntries(errorCodeRegistry, [{ code: 'NOTE_TITLE_TAKEN', status: 409, description: 'd' }], async () => {
      expect(isErrorCodeForStatus('NOTE_TITLE_TAKEN', 409)).toBe(true);
      expect(isErrorCodeForStatus('NOTE_TITLE_TAKEN', 400)).toBe(false);
      expect(isErrorCodeForStatus('NOTE_TITLE_TAKEN', 500)).toBe(false);
    });
    expect(isErrorCodeForStatus('NOTE_TITLE_TAKEN', 409)).toBe(false);
  });
});
