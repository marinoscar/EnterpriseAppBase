// SystemSettingsRowStore (issue #733): a slice's own system_settings row,
// with its own version (0 while missing), validation in, field-by-field
// degradation out, an audit row per write, and the main row refused.
import { z } from 'zod';

import { SystemSettingsRowStore } from '../../src/settings/index';
import { resolveSettingsModuleOptions } from '../../src/settings/settings.options';
import { ALICE, fakePrisma } from './support';

const schema = z.object({ host: z.string().min(1), port: z.number().int().min(1).max(65535), secure: z.boolean() });
const DEFAULTS = { host: 'localhost', port: 25, secure: false };

function store() {
  const fake = fakePrisma();
  return { ...fake, rows: new SystemSettingsRowStore(fake.client, resolveSettingsModuleOptions()) };
}

describe('SystemSettingsRowStore', () => {
  it('reads a missing row as the defaults at version 0, without creating it', async () => {
    const s = store();
    expect(await s.rows.read('mail', schema, DEFAULTS)).toEqual({ value: DEFAULTS, version: 0, updatedAt: null, updatedByUserId: null });
    expect(s.prisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('writes with If-Match, increments the version, and audits', async () => {
    const s = store();
    const first = await s.rows.write('mail', { host: 'smtp.example.test', port: 587, secure: true }, { actorId: ALICE, ifMatch: 0, schema });
    expect(first.version).toBe(1);
    await expect(s.rows.write('mail', DEFAULTS, { actorId: ALICE, ifMatch: 0, schema })).rejects.toMatchObject({ status: 409 });
    const second = await s.rows.write('mail', { ...first.value, port: 2525 }, { actorId: ALICE, ifMatch: 1, schema });
    expect(second).toMatchObject({ version: 2, value: { port: 2525 } });
    expect(s.audit).toEqual([
      expect.objectContaining({ action: 'system_settings:mail:write', actorUserId: ALICE, targetType: 'system_settings', meta: { key: 'mail', version: 1 } }),
      expect.objectContaining({ meta: { key: 'mail', version: 2 } }),
    ]);
  });

  it('merges a custom audit action and non-secret meta under its own key and version (#737)', async () => {
    const s = store();
    await s.rows.write('mail', DEFAULTS, {
      actorId: ALICE,
      schema,
      auditAction: 'mail_settings:replace',
      auditMeta: { passwordChanged: true, key: 'not-the-key', version: 99 },
    });
    expect(s.audit).toEqual([
      expect.objectContaining({
        action: 'mail_settings:replace',
        meta: { passwordChanged: true, key: 'mail', version: 1 },
      }),
    ]);
  });

  it('refuses an invalid value with a 400 and writes nothing', async () => {
    const s = store();
    await expect(s.rows.write('mail', { host: '', port: 0, secure: true }, { actorId: ALICE, schema })).rejects.toMatchObject({ status: 400 });
    expect(s.prisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('refuses a row schema that names a secret field', async () => {
    const s = store();
    const leaky = z.object({ host: z.string(), password: z.string() });
    await expect(s.rows.write('mail', { host: 'h', password: 'p' }, { actorId: ALICE, schema: leaky })).rejects.toThrow(/CredentialsService/);
  });

  it('degrades a damaged stored value field by field', async () => {
    const s = store();
    s.prisma.systemSettings.rows.set('mail', { id: 'r', key: 'mail', value: { host: 'kept.example.test', port: 'nope' }, version: 4, updatedAt: new Date() });
    expect(await s.rows.read('mail', schema, DEFAULTS)).toMatchObject({ value: { host: 'kept.example.test', port: 25, secure: false }, version: 4 });
  });

  it('refuses the main settings row and a malformed key', async () => {
    const s = store();
    await expect(s.rows.read('global', schema, DEFAULTS)).rejects.toThrow(/main settings row/);
    await expect(s.rows.read('Bad Key', schema, DEFAULTS)).rejects.toThrow(/not a row key/);
    await expect(s.rows.read('WebPush', schema, DEFAULTS)).rejects.toThrow(/not a row key/);
  });

  it('accepts a lower camelCase key (the persisted `webPush` row, #738)', async () => {
    const s = store();
    await expect(s.rows.read('webPush', schema, DEFAULTS)).resolves.toMatchObject({ version: 0 });
  });
});
