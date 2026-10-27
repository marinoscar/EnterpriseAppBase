import { z } from 'zod';

import { EmailTransportResolver } from '../../../src/email/transports/email-transport.resolver';
import { registerEmailTransport, type EmailTransport } from '../../../src/email/transports/email-transport';
import type { EmailMessage } from '../../../src/email/email.types';
import '../../../src/email/transports/builtin-email-transports';

const MESSAGE: EmailMessage = { to: 'a@example.test', from: 'b@example.test', subject: 's', html: '<p>h</p>', text: 'h' };

const built: Array<{ settings: Record<string, unknown>; transport: EmailTransport & { destroyed: boolean } }> = [];
let failBuild = false;

registerEmailTransport({
  id: 'resolver-spec',
  label: 'Resolver spec',
  settingsSchema: z.object({ host: z.string(), retries: z.number().int().min(0) }),
  defaults: { host: 'h.example.test', retries: 1 },
  secrets: [{ name: 'apiKey', label: 'API key', required: true }],
  build: async ({ settings, secret }) => {
    if (failBuild) throw new Error('build blew up');
    const transport = {
      destroyed: false,
      send: async () => ({ success: true, messageId: `${settings.host as string}:${(await secret('apiKey')) ?? 'none'}` }),
      destroy() {
        transport.destroyed = true;
      },
    };
    built.push({ settings, transport });
    return transport;
  },
});

function resolver(getSecret = jest.fn().mockResolvedValue('stored-key')) {
  return { instance: new EmailTransportResolver({ getSecret } as never, { classifyRateLimit: undefined, sesRegionFallback: () => undefined }), getSecret };
}

beforeEach(() => {
  built.length = 0;
  failBuild = false;
});

describe('EmailTransportResolver', () => {
  it('builds the transport the settings select, with its settings parsed and defaults filled', async () => {
    const { instance } = resolver();

    const resolved = await instance.resolve({ provider: 'resolver-spec', transports: { 'resolver-spec': { host: 'custom.example.test' } } });

    expect(resolved).toMatchObject({ ok: true, id: 'resolver-spec', label: 'Resolver spec' });
    expect(built[0]!.settings).toEqual({ host: 'custom.example.test', retries: 1 });
  });

  it('reads a secret at send time, from the transport credential address', async () => {
    const { instance, getSecret } = resolver();

    const result = await instance.send({ provider: 'resolver-spec' }, MESSAGE);

    expect(result).toEqual({ success: true, messageId: 'h.example.test:stored-key' });
    expect(getSecret).toHaveBeenCalledWith('email_resolver-spec', 'apiKey');
  });

  it('asks again on the next send, so a rotated secret takes effect without a rebuild', async () => {
    const getSecret = jest.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    const { instance } = resolver(getSecret);

    const one = await instance.send({ provider: 'resolver-spec' }, MESSAGE);
    const two = await instance.send({ provider: 'resolver-spec' }, MESSAGE);

    expect([one.messageId, two.messageId]).toEqual(['h.example.test:first', 'h.example.test:second']);
    expect(built).toHaveLength(1);
  });

  it('reuses the transport while the settings are unchanged, and replaces (and destroys) it when they change', async () => {
    const { instance } = resolver();

    await instance.resolve({ provider: 'resolver-spec', transports: { 'resolver-spec': { host: 'one.example.test' } } });
    await instance.resolve({ provider: 'resolver-spec', transports: { 'resolver-spec': { host: 'one.example.test' } } });
    expect(built).toHaveLength(1);

    await instance.resolve({ provider: 'resolver-spec', transports: { 'resolver-spec': { host: 'two.example.test' } } });
    expect(built).toHaveLength(2);
    expect(built[0]!.transport.destroyed).toBe(true);
    expect(built[1]!.transport.destroyed).toBe(false);
  });

  it('releases the transport actually superseded when two resolves race', async () => {
    const { instance } = resolver();

    const [first, second] = await Promise.all([
      instance.resolve({ provider: 'resolver-spec', transports: { 'resolver-spec': { host: 'a.example.test' } } }),
      instance.resolve({ provider: 'resolver-spec', transports: { 'resolver-spec': { host: 'b.example.test' } } }),
    ]);

    expect([first.ok, second.ok]).toEqual([true, true]);
    expect(built).toHaveLength(2);
    // Exactly one stays live (the later write wins) and the other was released, none twice.
    expect(built.filter((entry) => entry.transport.destroyed)).toHaveLength(1);
  });

  it('releases every cached transport on shutdown', async () => {
    const { instance } = resolver();
    await instance.resolve({ provider: 'resolver-spec' });

    await instance.onModuleDestroy();

    expect(built[0]!.transport.destroyed).toBe(true);
  });

  it('reads the legacy flat fields of settings an older caller built', async () => {
    const { instance } = resolver();

    const resolved = await instance.resolve({ provider: 'smtp', smtpHost: 'legacy.example.test' } as never);

    expect(resolved.ok).toBe(true);
  });

  describe('never throws for a configuration problem', () => {
    it('no provider chosen', async () => {
      expect(await resolver().instance.resolve({ provider: null })).toEqual({ ok: false, error: 'No email provider is configured.' });
    });

    it('a transport nobody registered: names it, the registered ids and how to fix it', async () => {
      const resolved = await resolver().instance.resolve({ provider: 'gone-plugin' });

      expect(resolved).toMatchObject({ ok: false });
      expect((resolved as { error: string }).error).toMatch(/"gone-plugin" is not registered \(registered: ses, smtp, resolver-spec\).*registerEmailTransport/s);
    });

    it('stored settings the transport refuses: field names only, never values', async () => {
      const resolved = await resolver().instance.resolve({ provider: 'resolver-spec', transports: { 'resolver-spec': { retries: 'many-secret-looking-value' } } });

      expect(resolved).toMatchObject({ ok: false });
      const error = (resolved as { error: string }).error;
      expect(error).toContain('retries');
      expect(error).not.toContain('many-secret-looking-value');
    });

    it('a build that throws', async () => {
      failBuild = true;

      expect(await resolver().instance.resolve({ provider: 'resolver-spec' })).toEqual({ ok: false, error: 'Email transport "resolver-spec" could not be built: build blew up' });
    });

    it('send turns every one of them into a failed result', async () => {
      const result = await resolver().instance.send({ provider: 'gone-plugin' }, MESSAGE);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not registered');
    });
  });
});
