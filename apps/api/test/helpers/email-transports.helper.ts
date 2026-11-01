import { EmailTransportResolver } from '@marinoscar/platform-api/email';

// =============================================================================
// A stand-in for the email transport resolver (PP-14.8)
// =============================================================================
//
// The notification channel and the admin test send no longer inject the `ses`
// and `smtp` classes: they ask `EmailTransportResolver` for the transport the
// settings' `provider` names. A suite that wants to drive the outcome of a send
// (or assert what was handed to the transport) hands it `{ send: jest.fn() }`
// per transport id; this resolves by `provider` the way the real one does.
// =============================================================================

/** The part of a transport a suite stubs. */
export interface StubEmailTransport {
  send: jest.Mock;
}

/** The resolver, resolving by the settings' `provider` to a stub; an id with no stub is a failed resolution. */
export function emailTransportResolverStub(transports: Record<string, StubEmailTransport>) {
  const resolve = async (settings: { provider: string | null }) => {
    const transport = settings.provider ? transports[settings.provider] : undefined;
    return transport
      ? { ok: true as const, id: settings.provider as string, label: settings.provider as string, transport }
      : { ok: false as const, error: `No stubbed email transport for "${settings.provider ?? ''}".` };
  };

  return {
    resolve,
    send: async (settings: { provider: string | null }, message: unknown) => {
      const resolved = await resolve(settings);
      return resolved.ok ? resolved.transport.send(message) : { success: false, error: resolved.error };
    },
  };
}

/** A provider entry for `Test.createTestingModule` / `createTestApp({ overrideProviders })`. */
export function emailTransportResolverProvider(transports: Record<string, StubEmailTransport>) {
  return { provide: EmailTransportResolver, useValue: emailTransportResolverStub(transports) };
}
