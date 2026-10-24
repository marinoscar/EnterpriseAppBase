// Test doubles for the settings slice's unit specs (issue #733). Not a spec.
//
// Three sample system namespaces (no org block, an `override` org block and a
// `tighten` org block), an in-memory client for `system_settings`,
// `user_settings` and `audit_events`, and an in-memory `SETTINGS_DATA` port
// whose `runInOrg` shows a transaction only its own organization's row (the
// row-level-security contract, which the app's real-database spec proves).

import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import type { SettingsDataPort, SettingsOrgTx, SettingsPrisma, SystemSettingsNamespace } from '../../src/settings/index';
import { OrgSettingsService, SettingsResolver, SystemSettingsService } from '../../src/settings/index';
import { resolveSettingsModuleOptions, type SettingsModuleOptions } from '../../src/settings/settings.options';

export const ORG_A = '11111111-1111-4111-8111-aaaaaaaaaaaa';
export const ORG_B = '22222222-2222-4222-8222-bbbbbbbbbbbb';
export const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const plainStored = z.object({ retentionDays: z.number().int().min(1).max(365) });
export const PLAIN_NS: SystemSettingsNamespace = {
  key: 'plainSample',
  description: 'A deployment-wide sample namespace (no org layer).',
  storedSchema: plainStored,
  patchSchema: plainStored.partial(),
  putSchema: plainStored,
  wirePatchSchema: plainStored.partial(),
  responseSchema: plainStored,
  defaults: { retentionDays: 30 },
  requiredOnPut: false,
  merge: (current, patch) => ({ ...(current as object), ...((patch as object) ?? {}) }),
};

const brandingStored = z.object({
  label: z.string().max(40),
  accent: z.enum(['blue', 'green', 'red']),
  pageSize: z.number().int().min(10).max(100),
  showBanner: z.boolean(),
  tags: z.array(z.string()),
});
export const OVERRIDE_NS: SystemSettingsNamespace = {
  key: 'brandingSample',
  description: 'A sample namespace an organization may override field by field.',
  storedSchema: brandingStored,
  patchSchema: brandingStored.partial(),
  putSchema: brandingStored,
  wirePatchSchema: brandingStored.partial(),
  responseSchema: brandingStored,
  defaults: { label: 'Acme', accent: 'blue', pageSize: 20, showBanner: false, tags: [] },
  requiredOnPut: false,
  merge: (current, patch) => ({ ...(current as object), ...((patch as object) ?? {}) }),
  org: {
    schema: brandingStored.partial(),
    merge: 'override',
    readPermission: 'org_settings:read',
    writePermission: 'org_settings:write',
  },
};

const exportsStored = z.object({ enabled: z.boolean(), maxRows: z.number().int().min(0).max(1_000_000) });
type ExportsValue = z.infer<typeof exportsStored>;
export const TIGHTEN_NS: SystemSettingsNamespace<string, ExportsValue> = {
  key: 'exportsSample',
  description: 'A sample namespace an organization may only restrict.',
  storedSchema: exportsStored,
  patchSchema: exportsStored.partial(),
  putSchema: exportsStored,
  wirePatchSchema: exportsStored.partial(),
  responseSchema: exportsStored,
  defaults: { enabled: true, maxRows: 10_000 },
  requiredOnPut: false,
  merge: (current, patch) => ({ ...current, ...(patch as Partial<ExportsValue> | undefined) }),
  org: {
    schema: exportsStored.partial(),
    // An organization can turn exports off and lower the cap, never the reverse.
    merge: (system, org) => ({
      enabled: system.enabled && (org.enabled ?? true),
      maxRows: Math.min(system.maxRows, org.maxRows ?? system.maxRows),
    }),
    readPermission: 'org_settings:read',
    writePermission: 'exports_admin:write',
  },
};

export const SAMPLES = [PLAIN_NS, OVERRIDE_NS, TIGHTEN_NS as SystemSettingsNamespace];

interface Row {
  id: string;
  key?: string;
  userId?: string;
  orgId?: string;
  value: unknown;
  version: number;
  updatedByUserId?: string | null;
  updatedAt: Date;
}

let ids = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

function applyData(row: Row, data: Record<string, unknown>): Row {
  const next = { ...row };
  for (const [k, v] of Object.entries(data)) {
    if (k === 'version' && v && typeof v === 'object' && 'increment' in v) next.version += (v as { increment: number }).increment;
    else (next as unknown as Record<string, unknown>)[k] = v;
  }
  next.updatedAt = new Date();
  return next;
}

/** One in-memory table keyed by a unique column. */
function table(unique: 'key' | 'userId' | 'orgId') {
  const rows = new Map<string, Row>();
  const keyOf = (where: Record<string, unknown>) => String(where[unique]);
  const delegate = {
    rows,
    findUnique: jest.fn(async (args: { where: Record<string, unknown> }) => {
      const row = rows.get(keyOf(args.where));
      return row ? { ...row, updatedByUser: null } : null;
    }),
    findFirst: jest.fn(async () => null),
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      const row = applyData({ id: nextId(), value: null, version: 1, updatedAt: new Date() }, args.data);
      rows.set(String(args.data[unique]), row);
      return { ...row, updatedByUser: null };
    }),
    update: jest.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = applyData(rows.get(keyOf(args.where))!, args.data);
      rows.set(keyOf(args.where), row);
      return { ...row, updatedByUser: null };
    }),
    upsert: jest.fn(async (args: { where: Record<string, unknown>; update: Record<string, unknown>; create: Record<string, unknown> }) => {
      const existing = rows.get(keyOf(args.where));
      const row = existing ? applyData(existing, args.update) : applyData({ id: nextId(), value: null, version: 1, updatedAt: new Date() }, args.create);
      rows.set(keyOf(args.where), row);
      return { ...row, updatedByUser: null };
    }),
    updateMany: jest.fn(async () => ({ count: 0 })),
    deleteMany: jest.fn(async () => ({ count: 0 })),
  };
  return delegate;
}

export function fakePrisma() {
  const audit: Array<Record<string, unknown>> = [];
  const auditEvent = {
    ...table('key'),
    create: jest.fn(async (args: { data: Record<string, unknown> }) => {
      audit.push(args.data);
      return { id: nextId() };
    }),
  };
  const prisma = {
    systemSettings: table('key'),
    userSettings: table('userId'),
    user: table('key'),
    auditEvent,
  };
  return { prisma, audit, client: prisma as unknown as SettingsPrisma };
}

/** `runInOrg` over one shared org table: each transaction sees only its organization's row. */
export function fakeOrgData(audit: Array<Record<string, unknown>>) {
  const orgTable = table('orgId');
  const scopes: Array<{ orgId: string; userId?: string }> = [];
  const port: SettingsDataPort = {
    async runInOrg(scope, fn) {
      scopes.push(scope);
      const confined = {
        ...orgTable,
        findUnique: async (args: { where: { orgId: string } }) =>
          args.where.orgId === scope.orgId ? orgTable.findUnique(args) : null,
        create: async (args: { data: { orgId: string } }) => {
          if (args.data.orgId !== scope.orgId) throw new Error('new row violates row-level security policy');
          return orgTable.create(args as never);
        },
        update: async (args: { where: { orgId: string } }) => {
          if (args.where.orgId !== scope.orgId) throw new Error('row not visible');
          return orgTable.update(args as never);
        },
      };
      const tx = {
        orgSettings: confined,
        auditEvent: { create: async (args: { data: Record<string, unknown> }) => (audit.push(args.data), { id: nextId() }) },
      } as unknown as SettingsOrgTx;
      return fn(tx);
    },
  };
  return { port, orgTable, scopes };
}

export function configService(): ConfigService {
  return { get: (_key: string, fallback?: unknown) => fallback } as unknown as ConfigService;
}

/** The three services over the fakes. */
export function services(options: SettingsModuleOptions = {}) {
  const { prisma, audit, client } = fakePrisma();
  const data = fakeOrgData(audit);
  const resolved = resolveSettingsModuleOptions(options);
  const system = new SystemSettingsService(client, configService(), resolved);
  const org = new OrgSettingsService(data.port, system, resolved);
  const resolver = new SettingsResolver(system, org, client);
  return { prisma, audit, data, system, org, resolver, client, resolved };
}
