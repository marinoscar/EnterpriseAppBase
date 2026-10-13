import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { RegistryError } from '../../../src/core/index';
import { withTemporaryEntries } from '../../../src/core/registry/testing';
import {
  RESPONSE_META_MAX_KEYS,
  RESPONSE_META_MAX_KEYS_PER_CONTRIBUTOR,
  RESPONSE_META_MAX_VALUE_LENGTH,
  TransformInterceptor,
  buildResponseMeta,
  registerResponseMetaContributor,
  responseMetaContributorRegistry,
  type ResponseMetaContributorDef,
} from '../../../src/host/index';

const entry = (id: string, contribute: ResponseMetaContributorDef['contribute']): ResponseMetaContributorDef => ({ id, contribute });

const run = async (request: unknown, data: unknown) => {
  const context = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => function handler() {} } as unknown as ExecutionContext;
  const handler = { handle: () => of(data) } as CallHandler;
  return firstValueFrom(new TransformInterceptor<unknown>().intercept(context, handler)) as Promise<{ data: unknown; meta: Record<string, unknown> }>;
};

describe('response meta contributors (PP-14.13)', () => {
  it('leaves meta as { timestamp } when nothing is registered', async () => {
    expect(responseMetaContributorRegistry.list()).toEqual([]);
    const body = await run({}, { ok: true });
    expect(Object.keys(body.meta)).toEqual(['timestamp']);
    expect(body.data).toEqual({ ok: true });
  });

  it('merges what contributors return, in order, and hands each the request', async () => {
    await withTemporaryEntries(
      responseMetaContributorRegistry,
      [
        entry('region', () => ({ region: 'eu-1' })),
        entry('revision', (request) => ({ apiRevision: 4, via: (request as { url: string }).url, flags: { beta: true } })),
      ],
      async () => {
        const body = await run({ url: '/api/x' }, { ok: true });
        expect(body.meta).toMatchObject({ region: 'eu-1', apiRevision: 4, via: '/api/x', flags: { beta: true } });
        expect(typeof body.meta.timestamp).toBe('string');
      },
    );
  });

  it('does not touch a body that already carries data', async () => {
    await withTemporaryEntries(responseMetaContributorRegistry, [entry('region', () => ({ region: 'eu' }))], async () => {
      const body = await run({}, { data: [1], meta: { page: 1 } });
      expect(body).toEqual({ data: [1], meta: { page: 1 } });
    });
  });

  describe('is bounded', () => {
    const meta = async (contribute: ResponseMetaContributorDef['contribute']) =>
      withTemporaryEntries(responseMetaContributorRegistry, [entry('one', contribute)], async () => buildResponseMeta({}));

    it('never lets a contributor replace the timestamp', async () => {
      const built = await meta(() => ({ timestamp: 'forged' }));
      expect(built.timestamp).not.toBe('forged');
      expect(new Date(built.timestamp).toISOString()).toBe(built.timestamp);
    });

    it('drops credential-looking and malformed keys', async () => {
      const built = await meta(() => ({ apiKey: 'k', token: 't', password: 'p', 'bad key': 1, '': 1, ok: 1 }));
      expect(Object.keys(built).sort()).toEqual(['ok', 'timestamp']);
    });

    it('drops values that are not JSON or are too long, and keeps small structures', async () => {
      const built = await meta(() => ({
        fn: () => 1,
        undef: undefined,
        big: 'x'.repeat(RESPONSE_META_MAX_VALUE_LENGTH),
        cyclic: (() => {
          const a: Record<string, unknown> = {};
          a.self = a;
          return a;
        })(),
        small: { a: [1, 2] },
        n: null,
      }));
      expect(Object.keys(built).sort()).toEqual(['n', 'small', 'timestamp']);
      expect(built.small).toEqual({ a: [1, 2] });
    });

    it('caps keys per contributor and in total', async () => {
      const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
      const built = await meta(() => many);
      expect(Object.keys(built).length).toBe(1 + RESPONSE_META_MAX_KEYS_PER_CONTRIBUTOR);

      await withTemporaryEntries(
        responseMetaContributorRegistry,
        [entry('aa', () => Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`a${i}`, i]))), entry('bb', () => Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`b${i}`, i]))), entry('cc', () => ({ c0: 1 }))],
        async () => {
          expect(Object.keys(buildResponseMeta({})).length).toBe(1 + RESPONSE_META_MAX_KEYS);
        },
      );
    });

    it('skips a contributor that throws or returns a non-object, and keeps the others', async () => {
      await withTemporaryEntries(
        responseMetaContributorRegistry,
        [
          entry('throws', () => {
            throw new Error('boom');
          }),
          entry('array', () => [1] as never),
          entry('null', () => null as never),
          entry('fine', () => ({ ok: 1 })),
        ],
        async () => {
          expect(buildResponseMeta({})).toMatchObject({ ok: 1 });
        },
      );
    });

    it('lets the first contributor keep a key two of them contribute', async () => {
      await withTemporaryEntries(responseMetaContributorRegistry, [entry('aa', () => ({ k: 'first' })), entry('bb', () => ({ k: 'second' }))], async () => {
        expect(buildResponseMeta({}).k).toBe('first');
      });
    });
  });

  describe('registerResponseMetaContributor', () => {
    it('refuses a bad id, a duplicate and a missing contribute', async () => {
      await withTemporaryEntries(responseMetaContributorRegistry, [], () => {
        expect(() => registerResponseMetaContributor(entry('Bad', () => ({})))).toThrow(RegistryError);
        registerResponseMetaContributor(entry('once', () => ({})));
        expect(() => registerResponseMetaContributor(entry('once', () => ({})))).toThrow(RegistryError);
        expect(() => registerResponseMetaContributor({ id: 'none' } as never)).toThrow(/contribute/);
      });
    });

    it('accepts a bare named function, with a camelCase name becoming the hyphenated id', async () => {
      await withTemporaryEntries(responseMetaContributorRegistry, [], () => {
        function apiRevision() {
          return { apiRevision: 4 };
        }
        registerResponseMetaContributor(apiRevision);
        expect(responseMetaContributorRegistry.ids()).toEqual(['api-revision']);
        expect(() => registerResponseMetaContributor(() => ({}))).toThrow();
      });
    });
  });
});
