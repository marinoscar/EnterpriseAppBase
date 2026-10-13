// =============================================================================
// Open-vocabulary conformance kit (PP-14.14)
// =============================================================================
//
// ONE suite for the three vocabularies PP-14.14 opened (system access reasons,
// principal and credential kinds, error codes), so "a valid registration" means
// the same thing for the platform's built-ins and for an app's own. It checks
// what the enforcement relies on:
//
//   access reasons    every id matches the pattern and has a description; the
//                     nine built-ins are registered and unchanged; an
//                     unregistered, empty, non-string or prototype-named reason
//                     is REFUSED by the bypass entry points (`systemScopeExtension`,
//                     `runAsSystem`); a registered one is accepted
//   credential kinds  every kind's principal kind is registered; the four
//                     built-ins keep their principal kind; an unregistered kind
//                     is denied by `requireCredentialKind`
//   error codes       every code matches the pattern, has a status 400-599 and
//                     a description; the ten built-ins keep their status; the
//                     `ERROR` fallback is never registered; a payload code is
//                     passed through only for its own status
//
// It does NOT check who may reach the system client: that is the injection
// allowlist, a separate tripwire (`system-injection-boundary.spec.ts`).
//
// Runner-agnostic like the other kits: it receives `describe`, `it` and
// `expect`.
//
//   import { describeVocabularyConformance } from '@marinoscar/platform-api/core/testing';
//   import '../../../src/app-registrations/core';
//
//   describeVocabularyConformance({ describe, it, expect });
// =============================================================================

import {
  BUILTIN_ERROR_CODES,
  ERROR_CODE_PATTERN,
  FALLBACK_ERROR_CODE,
  defaultErrorCodeForStatus,
  errorCodeRegistry,
  isErrorCodeForStatus,
} from '../errors/error-codes';
import {
  BUILTIN_SYSTEM_ACCESS_REASONS,
  SYSTEM_ACCESS_REASON_ID_PATTERN,
  systemAccessReasonRegistry,
} from '../data-access/access-reason.registry';
import { runAsSystem, systemScopeExtension } from '../data-access/rls';
import {
  KIND_ID_PATTERN,
  UnknownCredentialKindError,
  credentialKindRegistry,
  principalKindRegistry,
  requireCredentialKind,
} from '../principal/credential-kinds';
import type { PluggableConformanceHarness } from './pluggable-conformance';

/**
 * Options of {@link describeVocabularyConformance}.
 *
 * @stability experimental
 */
export interface VocabularyConformanceOptions {
  /**
   * Reasons the app's registered list is expected to contain beyond the
   * built-ins. When set, the kit asserts exactly that list, so a reason added
   * by accident (or removed) is a reviewed change. Default: not asserted.
   */
  readonly expectedAppReasons?: readonly string[];
}

/** A client that records nothing and never reaches a database: enough to reach the reason check. */
const NO_DATABASE_CLIENT = {
  $transaction: () => Promise.reject(new Error('conformance: no database')),
  $executeRaw: () => Promise.resolve(0),
  $extends: () => ({}),
};

/**
 * Runs the vocabulary conformance kit on everything currently registered in
 * the three vocabularies. Call it at the top level of a spec, after importing
 * the file that registers the app's entries.
 *
 * @param harness - the runner's `describe`, `it` and `expect`.
 * @param options - see {@link VocabularyConformanceOptions}.
 *
 * @extensionPoint conformance
 * @stability experimental
 * @example
 * ```ts
 * import '../../../src/app-registrations/core';
 * import { describeVocabularyConformance } from '@marinoscar/platform-api/core/testing';
 *
 * describeVocabularyConformance({ describe, it, expect });
 * ```
 */
export function describeVocabularyConformance(
  harness: PluggableConformanceHarness,
  options: VocabularyConformanceOptions = {},
): void {
  const { describe, it, expect } = harness;

  describe('system access reasons', () => {
    it('registers the nine built-in reasons first, in order', () => {
      expect(systemAccessReasonRegistry.ids().slice(0, BUILTIN_SYSTEM_ACCESS_REASONS.length)).toEqual([...BUILTIN_SYSTEM_ACCESS_REASONS]);
    });

    it('gives every reason a well-formed id and a description', () => {
      for (const reason of systemAccessReasonRegistry.list()) {
        expect(SYSTEM_ACCESS_REASON_ID_PATTERN.test(reason.id)).toBe(true);
        expect(reason.description.trim().length).toBeGreaterThan(0);
      }
    });

    if (options.expectedAppReasons !== undefined) {
      it('holds exactly the expected app reasons beyond the built-ins', () => {
        expect(systemAccessReasonRegistry.ids().slice(BUILTIN_SYSTEM_ACCESS_REASONS.length)).toEqual([...options.expectedAppReasons!]);
      });
    }

    it('accepts every registered reason at the bypass entry points', () => {
      for (const id of systemAccessReasonRegistry.ids()) {
        expect(() => systemScopeExtension(NO_DATABASE_CLIENT as never, id)).not.toThrow();
      }
    });

    it('refuses an unregistered, empty, non-string or prototype-named reason (fail closed)', async () => {
      for (const bad of ['not-a-reason', '', 'constructor', '__proto__', 'toString', undefined, null, 42, {}]) {
        expect(() => systemScopeExtension(NO_DATABASE_CLIENT as never, bad as never)).toThrow(/registered reason/);
        await expect(runAsSystem(NO_DATABASE_CLIENT as never, bad as never, async () => 1)).rejects.toThrow(/registered reason/);
      }
    });
  });

  describe('principal and credential kinds', () => {
    it('gives every kind a well-formed id and a description', () => {
      for (const kind of [...principalKindRegistry.list(), ...credentialKindRegistry.list()]) {
        expect(KIND_ID_PATTERN.test(kind.id)).toBe(true);
        expect(kind.description.trim().length).toBeGreaterThan(0);
      }
    });

    it('keeps the built-in kinds and their principal kinds', () => {
      expect(principalKindRegistry.ids().slice(0, 2)).toEqual(['user', 'node']);
      expect(credentialKindRegistry.ids().slice(0, 4)).toEqual(['session', 'device', 'pat', 'node']);
      expect(['session', 'device', 'pat', 'node'].map((id) => credentialKindRegistry.require(id).principalKind)).toEqual([
        'user',
        'user',
        'user',
        'node',
      ]);
    });

    it('maps every credential kind onto a registered principal kind', () => {
      for (const kind of credentialKindRegistry.list()) expect(principalKindRegistry.has(kind.principalKind)).toBe(true);
    });

    it('denies an unregistered credential kind by default', () => {
      for (const bad of ['unregistered-kind', '', 'constructor', '__proto__', undefined, null, 7]) {
        expect(() => requireCredentialKind(bad)).toThrow(UnknownCredentialKindError);
      }
    });
  });

  describe('error codes', () => {
    it('keeps the ten built-in codes first, each on its status', () => {
      expect(errorCodeRegistry.ids().slice(0, BUILTIN_ERROR_CODES.length)).toEqual(BUILTIN_ERROR_CODES.map((def) => def.code));
      for (const def of BUILTIN_ERROR_CODES) expect(defaultErrorCodeForStatus(def.status)).toBe(def.code);
      expect(defaultErrorCodeForStatus(503)).toBe(FALLBACK_ERROR_CODE);
    });

    it('gives every code a well-formed UPPER_SNAKE id, a 4xx/5xx status and a description', () => {
      for (const def of errorCodeRegistry.list()) {
        expect(ERROR_CODE_PATTERN.test(def.code)).toBe(true);
        expect(Number.isInteger(def.status) && def.status >= 400 && def.status <= 599).toBe(true);
        expect(def.description.trim().length).toBeGreaterThan(0);
      }
    });

    it('never registers the ERROR fallback', () => {
      expect(errorCodeRegistry.has(FALLBACK_ERROR_CODE)).toBe(false);
    });

    it('passes a payload code through only for its own status', () => {
      for (const def of errorCodeRegistry.list()) {
        expect(isErrorCodeForStatus(def.code, def.status)).toBe(true);
        expect(isErrorCodeForStatus(def.code, def.status === 400 ? 409 : 400)).toBe(false);
      }
      for (const bad of ['NOT_REGISTERED', '', 'constructor', undefined, null, 409]) {
        expect(isErrorCodeForStatus(bad, 409)).toBe(false);
      }
    });
  });
}
