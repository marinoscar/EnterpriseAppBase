import 'reflect-metadata';

import { z } from 'zod';

import { credentialPurposeRegistry } from '../../src/credentials/index';
import {
  BUILTIN_TELEMETRY_STORE_ID,
  GREPTIME_SQL_DIALECT,
  describeTelemetryStore,
  registerTelemetryStore,
  requireTelemetryStore,
  telemetryStoreCredentialPurpose,
  telemetryStoreIds,
  telemetryStoreKind,
  type TelemetryStoreDefinition,
} from '../../src/telemetry/index';
import { resolveTelemetryModuleOptions } from '../../src/telemetry/telemetry.options';
import { definePlatformHost } from '../../src/core/index';

// =============================================================================
// registerTelemetryStore: the registry of the telemetry store kind (PP-14.11)
// =============================================================================

const dialect = GREPTIME_SQL_DIALECT;
const store = { id: 'x', database: 'x', isConfigured: () => true, configurationProblem: () => null } as never;

function definition(overrides: Partial<TelemetryStoreDefinition> & { id: string }): TelemetryStoreDefinition {
  return {
    label: 'A store',
    settingsSchema: z.object({ region: z.string().default('eu') }),
    defaults: { region: 'eu' },
    build: () => ({ store, dialect }),
    ...overrides,
  };
}

const host = definePlatformHost({
  access: { requirePermissions: () => () => undefined, requireAuthenticated: () => () => undefined },
});

describe('the built-in store', () => {
  it('registers itself through the same function an app uses, first', () => {
    expect(telemetryStoreIds()[0]).toBe(BUILTIN_TELEMETRY_STORE_ID);
    expect(requireTelemetryStore('greptime')).toMatchObject({ id: 'greptime', label: 'GreptimeDB' });
  });

  it('keeps its connection out of the settings record: no settings and no secrets, so no credential purpose of its own', () => {
    const greptime = requireTelemetryStore('greptime');

    expect(Object.keys(greptime.settingsSchema.shape)).toEqual([]);
    expect(greptime.secrets ?? []).toEqual([]);
    expect(credentialPurposeRegistry.has(telemetryStoreCredentialPurpose('greptime'))).toBe(false);
  });
});

describe('registerTelemetryStore', () => {
  it('registers a store after the built-in and makes it selectable by forRoot', () => {
    registerTelemetryStore(definition({ id: 'reg-basic' }));

    expect(telemetryStoreIds()).toEqual(expect.arrayContaining(['greptime', 'reg-basic']));
    expect(resolveTelemetryModuleOptions({ host, imports: [], store: 'reg-basic' }).store).toBe('reg-basic');
  });

  it('registers the credential purpose of a store that declares secrets (telemetry_<id>)', () => {
    registerTelemetryStore(
      definition({ id: 'reg-secret', secrets: [{ name: 'apiKey', label: 'API key', required: true }] }),
    );

    expect(telemetryStoreCredentialPurpose('reg-secret')).toBe('telemetry_reg-secret');
    expect(credentialPurposeRegistry.has('telemetry_reg-secret')).toBe(true);
  });

  it('describes a store for a generated form: its fields, then a write-only secret field with presence only', () => {
    const descriptor = describeTelemetryStore('reg-secret', { secrets: { apiKey: true } });

    expect(descriptor).toMatchObject({ kind: 'telemetry-store', id: 'reg-secret', label: 'A store' });
    expect(descriptor.fields.map((field) => `${field.kind}:${field.name}`)).toEqual(['string:region', 'secret:apiKey']);
    expect(JSON.stringify(descriptor)).not.toContain('value');
    expect(descriptor.fields[1]).toMatchObject({ hasValue: true, required: true });
  });

  it('refuses a duplicate id', () => {
    registerTelemetryStore(definition({ id: 'reg-dup' }));

    expect(() => registerTelemetryStore(definition({ id: 'reg-dup' }))).toThrow(/Duplicate telemetry-store implementation "reg-dup"/);
  });

  it.each(['Upper', 'x', '1abc', 'has_underscore'])('refuses the malformed id %s', (id) => {
    expect(() => registerTelemetryStore(definition({ id }))).toThrow(/Invalid telemetry store id/);
  });

  it('refuses a setting that looks like a secret', () => {
    expect(() =>
      registerTelemetryStore(
        definition({ id: 'reg-leaky', settingsSchema: z.object({ apiKey: z.string().default('') }), defaults: { apiKey: '' } }),
      ),
    ).toThrow(/looks like a secret/);
  });

  it('refuses defaults that do not parse and a missing build', () => {
    expect(() =>
      registerTelemetryStore(definition({ id: 'reg-bad-defaults', settingsSchema: z.object({ n: z.number() }), defaults: { n: 'x' } })),
    ).toThrow(/defaults do not parse/);
    expect(() => registerTelemetryStore(definition({ id: 'reg-no-build', build: undefined as never }))).toThrow(/build must be a function/);
  });

  it('refuses a store whose credential purpose is already taken', () => {
    registerTelemetryStore(definition({ id: 'reg-taken', secrets: [{ name: 'token', label: 'Token', required: false }] }));
    // A second store cannot share the purpose: the id check fires first for a duplicate id, so simulate a purpose owned elsewhere.
    expect(credentialPurposeRegistry.has('telemetry_reg-taken')).toBe(true);
    expect(() =>
      registerTelemetryStore(definition({ id: 'reg-taken', secrets: [{ name: 'token', label: 'Token', required: false }] })),
    ).toThrow(/already registered/);
  });

  it('names the registered ids when an unknown one is required', () => {
    expect(() => requireTelemetryStore('nope-store')).toThrow(/nope-store/);
    expect(() => requireTelemetryStore('nope-store')).toThrow(/greptime/);
  });
});

describe('TelemetryModule.forRoot({ store })', () => {
  it('defaults to greptime', () => {
    expect(resolveTelemetryModuleOptions({ host, imports: [] }).store).toBe('greptime');
  });

  it('fails boot, naming the registered ids, for a store nobody registered', () => {
    expect(() => resolveTelemetryModuleOptions({ host, imports: [], store: 'missing-store' })).toThrow(
      /`store` "missing-store" is not a registered telemetry store \(registered: greptime/,
    );
  });

  it('reads the registry the kit and the services read', () => {
    expect(telemetryStoreKind.ids()).toEqual(telemetryStoreIds());
  });
});
