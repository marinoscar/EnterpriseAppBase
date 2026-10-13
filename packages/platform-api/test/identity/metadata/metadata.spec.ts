import 'reflect-metadata';

import { z } from 'zod';

import { RegistryError, withTemporaryEntries } from '../../../src/core/index';
import {
  IdentityMetadataService,
  METADATA_MAX_BYTES,
  MetadataError,
  findSecretKeys,
  inspectMetadataSchema,
  isSecretFieldName,
  organizationMetadataRegistry,
  registerOrganizationMetadataSchema,
  registerUserMetadataSchema,
  userMetadataRegistry,
  type MetadataNamespace,
  type MetadataNamespaceDef,
} from '../../../src/identity/index';
import type { IdentityPrisma, IdentityTx } from '../../../src/identity/index';

const USER = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const MISSING = '33333333-3333-4333-8333-333333333333';

/** An in-memory stand-in for the two statements per table the service issues. */
function fakePrisma(initial: Record<string, Record<string, unknown>> = {}): { prisma: IdentityPrisma; docs: Map<string, Record<string, unknown>>; log: string[] } {
  const docs = new Map<string, Record<string, unknown>>([[USER, {}], [ORG, {}], ...Object.entries(initial)]);
  const log: string[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      log.push(sql.replace(/\s+/g, ' ').trim());
      const id = String(values[values.length - 1]);
      const doc = docs.get(id);
      if (!doc) return [];
      if (/FOR UPDATE/.test(sql)) return [{ metadata: structuredClone(doc) }];
      return [{ value: doc[String(values[0])] ?? null }];
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      log.push(strings.join('?').replace(/\s+/g, ' ').trim());
      docs.set(String(values[1]), JSON.parse(String(values[0])) as Record<string, unknown>);
      return 1;
    },
  } as unknown as IdentityTx;
  const prisma = { ...tx, $transaction: async <T>(fn: (t: IdentityTx) => Promise<T>) => fn(tx) } as unknown as IdentityPrisma;
  return { prisma, docs, log };
}

const coach = z.object({ reminderHour: z.number().int().min(0).max(23), weeklyDigest: z.boolean() });
const COACH: MetadataNamespaceDef = { namespace: 'preferences.coach', schema: coach };

describe('metadata secret guard', () => {
  it('reads secret-looking names and leaves ordinary ones alone', () => {
    for (const name of ['password', 'apiKey', 'api_key', 'API-KEY', 'token', 'webhookSecret', 'stripeApiKey', 'refreshToken', 'client_secret', 'Authorization', 'privateKey']) {
      expect(isSecretFieldName(name)).toBe(true);
    }
    for (const name of ['tokenCount', 'keyboard', 'secretary', 'hasKey', 'displayName', 'passwordless', 'reminderHour']) {
      expect(isSecretFieldName(name)).toBe(false);
    }
  });

  it('finds secret keys in a value at any depth, including record keys', () => {
    expect(findSecretKeys({ a: { b: [{ apiKey: 'x' }] }, ok: 1, tags: { password: 'y' } })).toEqual(['a.b[0].apiKey', 'tags.password']);
  });

  it('reports secret properties, open shapes and a non-object root of a schema', () => {
    const findings = inspectMetadataSchema(z.object({ a: z.object({ apiKey: z.string() }), b: z.any(), c: z.array(z.unknown()) }));
    expect(findings.secretFields).toEqual(['a.apiKey']);
    expect(findings.openShapes).toEqual(expect.arrayContaining(['b', 'c[]']));
    expect(inspectMetadataSchema(z.string()).rootNotObject).toBe(true);
    expect(inspectMetadataSchema(z.looseObject({ a: z.string() })).openShapes).toEqual(['(root) (additional properties)']);
  });
});

describe('registerUserMetadataSchema and registerOrganizationMetadataSchema', () => {
  it('returns a typed handle and stores the definition in the subject\'s own registry', async () => {
    await withTemporaryEntries(userMetadataRegistry, [], async () => {
      const handle = registerUserMetadataSchema({ namespace: 'preferences.tmp', schema: coach });
      expect(handle).toMatchObject({ subject: 'user', namespace: 'preferences.tmp' });
      expect(userMetadataRegistry.has('preferences.tmp')).toBe(true);
      expect(organizationMetadataRegistry.has('preferences.tmp')).toBe(false);
      const org = registerOrganizationMetadataSchema({ namespace: 'program.tmp', schema: coach });
      expect(org.subject).toBe('organization');
      expect(() => registerUserMetadataSchema({ namespace: 'preferences.tmp', schema: coach })).toThrow(RegistryError);
    });
    expect(userMetadataRegistry.has('preferences.tmp')).toBe(false);
  });

  it('refuses a secret-named field, an open shape, a non-object schema, a bad namespace and a duplicate', () => {
    const at = (def: MetadataNamespaceDef): (() => void) => () => userMetadataRegistry.register(def);
    expect(at({ namespace: 'x.secret', schema: z.object({ apiKey: z.string() }) })).toThrow(/secret-named field\(s\) apiKey.*not a secret store/);
    expect(at({ namespace: 'x.open', schema: z.object({ blob: z.any() }) })).toThrow(/leaves part of its shape open \(blob\)/);
    expect(at({ namespace: 'x.string', schema: z.string() })).toThrow(/object schema/);
    expect(at({ namespace: 'Bad Name', schema: coach })).toThrow(RegistryError);
    expect(at({ namespace: 'a'.repeat(64), schema: coach })).toThrow(/at most 63/);
    expect(at({ namespace: 'x.nozod', schema: {} as never })).toThrow(/zod schema/);
  });
});

describe('IdentityMetadataService', () => {
  const handle: MetadataNamespace<z.infer<typeof coach>> = { namespace: 'preferences.coach', schema: coach, subject: 'user' };

  it('sets, gets, updates and deletes one namespace, leaving the others alone', async () => {
    await withTemporaryEntries(userMetadataRegistry, [COACH], async () => {
      const { prisma, docs } = fakePrisma({ [USER]: { 'other.ns': { keep: true } } });
      const service = new IdentityMetadataService(prisma);

      await expect(service.getUserMetadata(USER, handle)).resolves.toBeUndefined();
      await expect(service.setUserMetadata(USER, 'preferences.coach', { reminderHour: 7, weeklyDigest: true })).resolves.toEqual({ reminderHour: 7, weeklyDigest: true });
      expect(docs.get(USER)).toEqual({ 'other.ns': { keep: true }, 'preferences.coach': { reminderHour: 7, weeklyDigest: true } });

      await expect(service.getUserMetadata(USER, handle)).resolves.toEqual({ reminderHour: 7, weeklyDigest: true });
      await expect(service.updateUserMetadata(USER, handle, (current) => ({ ...current!, reminderHour: 9 }))).resolves.toEqual({ reminderHour: 9, weeklyDigest: true });
      await service.deleteUserMetadata(USER, handle);
      expect(docs.get(USER)).toEqual({ 'other.ns': { keep: true } });
      await expect(service.deleteUserMetadata(USER, handle)).resolves.toBeUndefined();
    });
  });

  it('serves organizations from their own registry and table', async () => {
    await withTemporaryEntries(organizationMetadataRegistry, [{ namespace: 'program.coach', schema: z.object({ seats: z.number().int().positive() }) }], async () => {
      const { prisma, docs, log } = fakePrisma();
      const service = new IdentityMetadataService(prisma);
      await service.setOrganizationMetadata(ORG, 'program.coach', { seats: 5 });
      expect(docs.get(ORG)).toEqual({ 'program.coach': { seats: 5 } });
      await expect(service.getOrganizationMetadata(ORG, 'program.coach')).resolves.toEqual({ seats: 5 });
      expect(log.every((line) => line.includes('"organizations"'))).toBe(true);
      // a user namespace is not an organization namespace
      await expect(service.getOrganizationMetadata(ORG, { ...COACH, subject: 'user' })).rejects.toMatchObject({ code: 'UNKNOWN_NAMESPACE' });
    });
  });

  it('validates on write: unknown namespace, invalid value, secret key, size, missing subject', async () => {
    await withTemporaryEntries(
      userMetadataRegistry,
      [COACH, { namespace: 'tags.coach', schema: z.object({ labels: z.record(z.string(), z.string()) }) }, { namespace: 'blob.coach', schema: z.object({ text: z.string() }) }],
      async () => {
        const { prisma, docs } = fakePrisma();
        const service = new IdentityMetadataService(prisma);
        const code = async (promise: Promise<unknown>): Promise<string> => (await promise.then(() => 'ok', (e: MetadataError) => e.code));

        expect(await code(service.setUserMetadata(USER, 'nope.coach', {}))).toBe('UNKNOWN_NAMESPACE');
        expect(await code(service.setUserMetadata(USER, 'preferences.coach', { reminderHour: 99, weeklyDigest: true }))).toBe('INVALID_VALUE');
        expect(await code(service.setUserMetadata(USER, 'tags.coach', { labels: { apiKey: 'x' } }))).toBe('SECRET_KEY');
        expect(await code(service.setUserMetadata(USER, 'blob.coach', { text: 'x'.repeat(METADATA_MAX_BYTES) }))).toBe('TOO_LARGE');
        expect(await code(service.setUserMetadata(MISSING, 'preferences.coach', { reminderHour: 1, weeklyDigest: true }))).toBe('SUBJECT_NOT_FOUND');
        expect(await code(service.setUserMetadata('not-a-uuid', 'preferences.coach', { reminderHour: 1, weeklyDigest: true }))).toBe('SUBJECT_NOT_FOUND');
        expect(await code(service.getUserMetadata(MISSING, 'preferences.coach'))).toBe('SUBJECT_NOT_FOUND');
        expect(docs.get(USER)).toEqual({});

        // the document limit is the whole document, not one namespace
        await service.setUserMetadata(USER, 'blob.coach', { text: 'x'.repeat(METADATA_MAX_BYTES - 200) });
        expect(await code(service.setUserMetadata(USER, 'tags.coach', { labels: { a: 'y'.repeat(400) } }))).toBe('TOO_LARGE');
      },
    );
  });

  it('refuses a stored value that no longer satisfies the schema, on read and on update', async () => {
    await withTemporaryEntries(userMetadataRegistry, [COACH], async () => {
      const { prisma } = fakePrisma({ [USER]: { 'preferences.coach': { reminderHour: 'noon' } } });
      const service = new IdentityMetadataService(prisma);
      await expect(service.getUserMetadata(USER, 'preferences.coach')).rejects.toMatchObject({ code: 'STORED_VALUE_INVALID' });
      await expect(service.updateUserMetadata(USER, 'preferences.coach', () => ({ reminderHour: 1, weeklyDigest: false }))).rejects.toMatchObject({ code: 'STORED_VALUE_INVALID' });
      // replacing it blind is still possible
      await expect(service.setUserMetadata(USER, 'preferences.coach', { reminderHour: 1, weeklyDigest: false })).rejects.toMatchObject({ code: 'STORED_VALUE_INVALID' });
    });
  });

  it('locks the row before writing', async () => {
    await withTemporaryEntries(userMetadataRegistry, [COACH], async () => {
      const { prisma, log } = fakePrisma();
      await new IdentityMetadataService(prisma).setUserMetadata(USER, 'preferences.coach', { reminderHour: 1, weeklyDigest: true });
      expect(log[0]).toMatch(/SELECT "metadata" FROM "users" WHERE "id" = \?::uuid FOR UPDATE/);
      expect(log[1]).toMatch(/UPDATE "users" SET "metadata" = \?::jsonb/);
    });
  });
});
