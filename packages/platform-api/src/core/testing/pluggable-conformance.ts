// =============================================================================
// Pluggable-kind conformance kit (PP-14.5, issue #923)
// =============================================================================
//
// ONE suite every pluggable kind runs, so "a valid implementation" means the
// same thing for the platform's built-ins and for an app's own. For each
// registered implementation it checks what a generated form and the settings
// merge rely on:
//
//   - the id matches `^[a-z][a-z0-9-]{1,47}$` and the label is not empty;
//   - `defaults` parse with the implementation's own `settingsSchema`;
//   - `describe()` validates against `pluggableDescriptorSchema`, lists one
//     `secret` field per declared secret and carries only presence flags;
//   - no secret-looking field (`/key|secret|token|password/i`) is in
//     `settingsSchema`: secrets are declared in `secrets`, never stored as
//     settings;
//   - `build` is a function.
//
// It is runner-agnostic: it receives `describe`, `it` and `expect`, so Jest
// and Vitest both work and the package needs no test-framework import.
//
//   import { describePluggableKindConformance } from '@marinoscar/platform-api/core/testing';
//
//   describePluggableKindConformance(greeterKind, { describe, it, expect });
// =============================================================================

import { PLUGGABLE_ID_PATTERN, pluggableDescriptorSchema } from '@marinoscar/platform-contract/settings';

import type { PluggableKind } from '../pluggable/pluggable-kind';

/**
 * The test runner's own globals, passed in.
 *
 * @stability experimental
 */
export interface PluggableConformanceHarness {
  /** The runner's `describe`. */
  describe: (name: string, fn: () => void) => unknown;
  /** The runner's `it`. Every case body the kit passes is a synchronous function. */
  it: (name: string, fn: () => void) => unknown;
  /** The runner's `expect`. */
  expect: (actual: unknown) => any;
}

/**
 * Options of {@link describePluggableKindConformance}.
 *
 * @stability experimental
 */
export interface PluggableConformanceOptions {
  /**
   * Settings field names that look like a secret but are not (an S3 `keyPrefix`,
   * a `tokenLimit`). Matched exactly. Use sparingly: a real secret belongs in
   * the implementation's `secrets`.
   */
  allowSecretLikeFields?: readonly string[];
}

/**
 * The names the kit treats as secrets when they appear in a `settingsSchema`.
 *
 * @stability experimental
 */
export const SECRET_LIKE_FIELD_PATTERN = /key|secret|token|password/i;

/**
 * Runs the conformance kit on every implementation currently registered in
 * `kind`. Call it at the top level of a spec, after importing the file that
 * registers the implementations, so they are registered when the cases are
 * declared.
 *
 * @param kind - the kind under test.
 * @param harness - the runner's `describe`, `it` and `expect`.
 * @param options - see {@link PluggableConformanceOptions}.
 *
 * @example
 * ```ts
 * import '../../../src/app-registrations/core';
 * import { describePluggableKindConformance } from '@marinoscar/platform-api/core/testing';
 *
 * describePluggableKindConformance(greeterKind, { describe, it, expect });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function describePluggableKindConformance(
  kind: PluggableKind<any, any>,
  harness: PluggableConformanceHarness,
  options: PluggableConformanceOptions = {},
): void {
  const { describe, it, expect } = harness;
  const allowed = new Set(options.allowSecretLikeFields ?? []);

  describe(`pluggable kind "${kind.kind}" conformance`, () => {
    it('has at least one registered implementation', () => {
      expect(kind.list().length).toBeGreaterThan(0);
    });

    for (const impl of kind.list()) {
      describe(`implementation "${impl.id}"`, () => {
        it('has a valid id and a label', () => {
          expect(typeof impl.id).toBe('string');
          expect(PLUGGABLE_ID_PATTERN.test(impl.id)).toBe(true);
          expect(typeof impl.label).toBe('string');
          expect(String(impl.label).trim()).not.toBe('');
        });

        it('has defaults that parse with its own settingsSchema', () => {
          const result = impl.settingsSchema.safeParse(impl.defaults);
          expect(result.success).toBe(true);
        });

        it('keeps secrets out of settingsSchema (declare them in `secrets`)', () => {
          const offending = Object.keys(impl.settingsSchema.shape).filter(
            (name) => SECRET_LIKE_FIELD_PATTERN.test(name) && !allowed.has(name),
          );
          expect(offending).toEqual([]);
        });

        it('declares each secret once, apart from the settings fields', () => {
          const names = (impl.secrets ?? []).map((secret) => secret.name);
          expect(new Set(names).size).toBe(names.length);
          const settingsFields = new Set(Object.keys(impl.settingsSchema.shape));
          expect(names.filter((name) => settingsFields.has(name))).toEqual([]);
          for (const secret of impl.secrets ?? []) {
            expect(String(secret.label ?? '').trim()).not.toBe('');
            expect(typeof secret.required).toBe('boolean');
          }
        });

        it('describes itself with the wire shape, secrets as presence flags only', () => {
          const names = (impl.secrets ?? []).map((secret) => secret.name);
          const absent = pluggableDescriptorSchema.parse(kind.describe(impl.id, { secrets: {} }));
          const present = pluggableDescriptorSchema.parse(
            kind.describe(impl.id, { secrets: Object.fromEntries(names.map((name) => [name, true])) }),
          );
          expect(absent.kind).toBe(kind.kind);
          expect(absent.id).toBe(impl.id);
          const secretFields = (descriptor: typeof absent) =>
            descriptor.fields.flatMap((field) => (field.kind === 'secret' ? [field] : []));
          expect(secretFields(absent).map((field) => field.name)).toEqual(names);
          expect(secretFields(absent).every((field) => field.hasValue === false)).toBe(true);
          expect(secretFields(present).every((field) => field.hasValue === true)).toBe(true);
          expect(absent.fields.length).toBe(Object.keys(impl.settingsSchema.shape).length + names.length);
        });

        it('has a build function', () => {
          expect(typeof impl.build).toBe('function');
        });
      });
    }
  });
}
