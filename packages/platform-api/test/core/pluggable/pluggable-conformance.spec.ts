import { z } from 'zod';

import {
  definePluggableKind,
  type PluggableImplementation,
  type PluggableKind,
} from '../../../src/core';
import { SECRET_LIKE_FIELD_PATTERN, describePluggableKindConformance, type PluggableConformanceHarness } from '../../../src/core/testing';

let counter = 0;
const uniqueKind = (): string => `spec-kit-${++counter}`;

const good: PluggableImplementation<object, object, { region: string }> = {
  id: 'good',
  label: 'Good',
  settingsSchema: z.object({ region: z.string() }),
  defaults: { region: 'eu' },
  secrets: [{ name: 'apiKey', label: 'API key', required: true }],
  build: () => ({}),
};

interface CaseResult {
  path: string;
  error?: unknown;
}

/**
 * Runs the kit with a collecting harness so a failing case can be asserted on
 * instead of failing this spec.
 */
function runKit(
  kind: PluggableKind<any, any>,
  options?: Parameters<typeof describePluggableKindConformance>[2],
): CaseResult[] {
  const cases: Array<{ path: string; fn: () => void }> = [];
  const stack: string[] = [];
  const harness: PluggableConformanceHarness = {
    describe: (name, fn) => {
      stack.push(name);
      fn();
      stack.pop();
    },
    it: (name, fn) => {
      cases.push({ path: [...stack, name].join(' > '), fn });
    },
    expect: (actual) => expect(actual),
  };
  describePluggableKindConformance(kind, harness, options);
  return cases.map(({ path, fn }) => {
    try {
      fn();
      return { path };
    } catch (error) {
      return { path, error };
    }
  });
}

const failures = (results: CaseResult[]): string[] => results.filter((r) => r.error !== undefined).map((r) => r.path);

/** A kind whose only implementation skips registration checks, to feed the kit something invalid. */
function stubKind(impl: Partial<PluggableImplementation<object, object, any>>): PluggableKind<any, any> {
  const real = definePluggableKind<object>({ kind: uniqueKind(), label: 'Stub' });
  const merged = { ...good, ...impl } as PluggableImplementation<object, object, any>;
  return { ...real, list: () => [merged], ids: () => [merged.id], describe: (id, presence) => real.describe(id, presence) };
}

describe('describePluggableKindConformance', () => {
  it('passes for a well-formed implementation', () => {
    const kind = definePluggableKind<object>({ kind: uniqueKind(), label: 'Good kind' });
    kind.register(good);

    const results = runKit(kind);

    expect(failures(results)).toEqual([]);
    expect(results.map((r) => r.path.split(' > ').pop())).toEqual(
      expect.arrayContaining([
        'has at least one registered implementation',
        'has a valid id and a label',
        'has defaults that parse with its own settingsSchema',
        'keeps secrets out of settingsSchema (declare them in `secrets`)',
        'describes itself with the wire shape, secrets as presence flags only',
        'has a build function',
      ]),
    );
  });

  it('fails a kind with no implementation', () => {
    const kind = definePluggableKind<object>({ kind: uniqueKind(), label: 'Empty' });

    expect(failures(runKit(kind))).toEqual([expect.stringContaining('has at least one registered implementation')]);
  });

  it('fails an implementation whose defaults do not parse with its own settingsSchema', () => {
    const kind = definePluggableKind<object>({ kind: uniqueKind(), label: 'Bad defaults' });
    kind.register({ ...good, id: 'bad-defaults', defaults: { region: 42 } as never });

    expect(failures(runKit(kind))).toEqual([expect.stringContaining('has defaults that parse')]);
  });

  it.each(['apiKey', 'clientSecret', 'authToken', 'password', 'API_KEY'])('fails a settings field named %s', (field) => {
    const kind = definePluggableKind<object>({ kind: uniqueKind(), label: 'Leaky' });
    kind.register({ ...good, id: 'leaky', secrets: [], settingsSchema: z.object({ [field]: z.string() }), defaults: { [field]: 'x' } });

    expect(failures(runKit(kind))).toEqual([expect.stringContaining('keeps secrets out of settingsSchema')]);
  });

  it('lets a field the author vouches for through allowSecretLikeFields', () => {
    const kind = definePluggableKind<object>({ kind: uniqueKind(), label: 'Prefix' });
    kind.register({ ...good, id: 'prefixed', secrets: [], settingsSchema: z.object({ keyPrefix: z.string() }), defaults: { keyPrefix: 'a/' } });

    expect(failures(runKit(kind))).toHaveLength(1);
    expect(failures(runKit(kind, { allowSecretLikeFields: ['keyPrefix'] }))).toEqual([]);
  });

  it('fails an implementation whose build is not a function', () => {
    const kind = definePluggableKind<object>({ kind: uniqueKind(), label: 'No build' });
    kind.register({ ...good, id: 'no-build', build: undefined as never });

    expect(failures(runKit(kind))).toEqual([expect.stringContaining('has a build function')]);
  });

  it('fails a secret that shares its name with a settings field', () => {
    const kind = definePluggableKind<object>({ kind: uniqueKind(), label: 'Clash' });
    kind.register({
      ...good,
      id: 'clash',
      settingsSchema: z.object({ region: z.string() }),
      secrets: [{ name: 'region', label: 'Region', required: false }],
    });

    expect(failures(runKit(kind))).toEqual([expect.stringContaining('declares each secret once')]);
  });

  it('fails an invalid id (fed to the kit through a kind that skipped registration)', () => {
    expect(failures(runKit(stubKind({ id: 'Bad_ID' })))).toEqual(
      expect.arrayContaining([expect.stringContaining('has a valid id and a label')]),
    );
  });

  it('fails an implementation whose descriptor does not satisfy the wire schema', () => {
    const base = stubKind({});
    const broken: PluggableKind<any, any> = {
      ...base,
      describe: () => ({ kind: base.kind, id: 'good', label: 'Good', fields: [{ name: 'x', kind: 'secret' }] }) as never,
    };

    expect(failures(runKit(broken))).toEqual([expect.stringContaining('describes itself with the wire shape')]);
  });

  it('fails a descriptor that leaks a secret as present when none was reported', () => {
    const base = stubKind({});
    const leaky: PluggableKind<any, any> = {
      ...base,
      describe: (id, presence) => {
        const d = base.describe(id, presence);
        return { ...d, fields: d.fields.map((f) => (f.kind === 'secret' ? { ...f, hasValue: true } : f)) };
      },
    };

    expect(failures(runKit(leaky))).toEqual([expect.stringContaining('describes itself with the wire shape')]);
  });
});

describe('SECRET_LIKE_FIELD_PATTERN', () => {
  it('matches key, secret, token and password in any case', () => {
    for (const name of ['apiKey', 'SECRET', 'refresh_token', 'Password1']) expect(SECRET_LIKE_FIELD_PATTERN.test(name)).toBe(true);
    for (const name of ['region', 'host', 'timeoutMs']) expect(SECRET_LIKE_FIELD_PATTERN.test(name)).toBe(false);
  });
});
