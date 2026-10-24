// The settings namespace registries refuse, at registration (import time,
// before bootstrap), a namespace that could leak a secret into a settings
// document, a duplicate key, and a malformed org block (issue #733).
import { z } from 'zod';

import { withTemporaryEntries } from '../../src/core/index';
import {
  SETTINGS_SECRET_FIELD_NAMES,
  registerSystemSettingsNamespaces,
  registerUserSettingsNamespaces,
  systemSettingsNamespaceRegistry,
  userSettingsNamespaceRegistry,
  type SystemSettingsNamespace,
  type UserSettingsNamespace,
} from '../../src/settings/index';
import { OVERRIDE_NS, PLAIN_NS } from './support';

function systemNamespace(key: string, shape: z.ZodRawShape, extra: Partial<SystemSettingsNamespace> = {}): SystemSettingsNamespace {
  const stored = z.object(shape);
  const defaults = Object.fromEntries(Object.keys(shape).map((k) => [k, 'x']));
  return {
    key,
    description: 'A test namespace.',
    storedSchema: stored,
    patchSchema: stored.partial(),
    putSchema: stored,
    wirePatchSchema: stored.partial(),
    responseSchema: stored,
    defaults,
    requiredOnPut: false,
    merge: (current) => current,
    ...extra,
  };
}

function inRegistry(fn: () => void) {
  return withTemporaryEntries(systemSettingsNamespaceRegistry, [], fn);
}

describe('system settings namespace registry', () => {
  it.each(['secretAccessKey', 'password', 'apiKey', 'token', 'privateKey'])(
    'refuses a namespace whose schema declares %s, naming the key and pointing to CredentialsService',
    (field) => {
      inRegistry(() => {
        const ns = systemNamespace('leaky', { host: z.string(), nested: z.object({ [field]: z.string() }) });
        expect(() => registerSystemSettingsNamespaces([ns])).toThrow(
          new RegExp(`"leaky".*secret-named field\\(s\\) nested\\.${field}.*CredentialsService`, 's'),
        );
        expect(systemSettingsNamespaceRegistry.has('leaky')).toBe(false);
      });
    },
  );

  it('matches the deny-list case-insensitively and lists every name of it', () => {
    expect([...SETTINGS_SECRET_FIELD_NAMES]).toEqual(
      expect.arrayContaining(['secret', 'secretAccessKey', 'password', 'apiKey', 'token', 'privateKey', 'sessionToken']),
    );
    inRegistry(() => {
      expect(() => registerSystemSettingsNamespaces([systemNamespace('upper', { PRIVATEKEY: z.string() })])).toThrow(/PRIVATEKEY/);
    });
  });

  it("refuses a namespace's own forbiddenKeys", () => {
    inRegistry(() => {
      const ns = systemNamespace('own', { webhookUrl: z.string() }, { forbiddenKeys: ['webhookUrl'] });
      expect(() => registerSystemSettingsNamespaces([ns])).toThrow(/webhookUrl/);
    });
  });

  it('refuses a duplicate key, naming the extension seam', () => {
    inRegistry(() => {
      registerSystemSettingsNamespaces([PLAIN_NS]);
      expect(() => registerSystemSettingsNamespaces([PLAIN_NS])).toThrow(/already registered.*extendSystemSettingsNamespace/s);
    });
  });

  it('accepts a namespace with a valid org block', () => {
    inRegistry(() => {
      registerSystemSettingsNamespaces([OVERRIDE_NS]);
      expect(systemSettingsNamespaceRegistry.get('brandingSample')?.org?.merge).toBe('override');
    });
  });

  it.each<[string, Partial<NonNullable<SystemSettingsNamespace['org']>>, RegExp]>([
    ['a required org field', { schema: z.object({ label: z.string() }) }, /must be optional/],
    ['a field the namespace does not store', { schema: z.object({ other: z.string().optional() }) }, /does not store/],
    ['a secret-named org field', { schema: z.object({ label: z.string().optional(), token: z.string().optional() }) }, /secret-named.*token/],
    ['a bad permission id', { readPermission: 'read everything' }, /org\.readPermission/],
    ['a bad merge', { merge: 'replace' as never }, /org\.merge/],
  ])('refuses an org block with %s', (_name, org, message) => {
    inRegistry(() => {
      const ns = systemNamespace('orgBad', { label: z.string() }, {
        org: {
          schema: z.object({ label: z.string().optional() }),
          merge: 'override',
          readPermission: 'org_settings:read',
          writePermission: 'org_settings:write',
          ...org,
        },
      });
      expect(() => registerSystemSettingsNamespaces([ns])).toThrow(message);
    });
  });
});

describe('user settings namespace registry', () => {
  const userNamespace = (key: string, schema: z.ZodType): UserSettingsNamespace => ({
    key,
    description: 'A test user namespace.',
    schema,
    patchSchema: schema,
    merge: (current) => current,
  });

  it('refuses a secret-named field, pointing to the user key tables and CredentialsService', () => {
    withTemporaryEntries(userSettingsNamespaceRegistry, [], () => {
      expect(() => registerUserSettingsNamespaces([userNamespace('mine', z.object({ apiKey: z.string().optional() }))])).toThrow(
        /secret-named field\(s\) apiKey.*CredentialsService/s,
      );
    });
  });

  it('refuses a .default(): an optional namespace stays absent until the user chooses', () => {
    withTemporaryEntries(userSettingsNamespaceRegistry, [], () => {
      expect(() =>
        registerUserSettingsNamespaces([userNamespace('defaults', z.object({ size: z.number().default(3) }))]),
      ).toThrow(/\.default\(\)/);
    });
  });

  it('refuses a duplicate key', () => {
    withTemporaryEntries(userSettingsNamespaceRegistry, [], () => {
      const ns = userNamespace('twice', z.object({ a: z.boolean().optional() }));
      registerUserSettingsNamespaces([ns]);
      expect(() => registerUserSettingsNamespaces([ns])).toThrow(/already registered/);
    });
  });
});
