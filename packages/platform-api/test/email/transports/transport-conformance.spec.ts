import { z } from 'zod';

import type { EmailMessage, EmailSendResult } from '../../../src/email/email.types';
import { describeEmailTransportConformance } from '../../../src/email/testing/transport-conformance';
import type { ReceivedEmail } from '../../../src/email/testing/transport-conformance';
import type { EmailTransport, EmailTransportDefinition } from '../../../src/email/transports/email-transport';

// =============================================================================
// The email transport kit proves itself (PP-14.8)
// =============================================================================
//
// A kit that only ever passes proves nothing. These cases run it with a tiny
// runner of their own (so a failing case is data, not a red test) against one
// correct in-memory transport and against transports that each break exactly
// one rule of the contract.
// =============================================================================

type Case = { name: string; run: () => void | Promise<void> };

const SECRET = 'sg-key-0123456789abcdef';

/** A fake backend shared by the transports below. */
function fakeBackend() {
  const state: { mode: 'accept' | 'fail'; error: unknown; received: ReceivedEmail[] } = { mode: 'accept', error: undefined, received: [] };
  return {
    state,
    backend: {
      accept: () => {
        state.mode = 'accept';
        state.received = [];
        return () => state.received;
      },
      failWith: (error: unknown) => {
        state.mode = 'fail';
        state.error = error;
      },
    },
  };
}

type Behaviour = (msg: EmailMessage, state: ReturnType<typeof fakeBackend>['state'], secret: string) => Promise<EmailSendResult>;

function definition(behaviour: Behaviour, shared: ReturnType<typeof fakeBackend>, overrides: Partial<EmailTransportDefinition<any>> = {}): EmailTransportDefinition<any> {
  return {
    id: 'kit-subject',
    label: 'Kit subject',
    settingsSchema: z.object({ base: z.string() }),
    defaults: { base: 'https://example.test' },
    secrets: [{ name: 'apiKey', label: 'API key', required: true }],
    build: ({ secret }) => ({
      send: async (msg) => behaviour(msg, shared.state, (await secret('apiKey')) ?? ''),
    }),
    ...overrides,
  };
}

/** The correct behaviour: the way `BaseEmailProvider` behaves. */
const correct: Behaviour = async (msg, state, secret) => {
  if (state.mode === 'fail') {
    const raw = state.error instanceof Error ? state.error : new Error(typeof state.error === 'string' ? state.error : 'non-error thrown');
    const status = (raw as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    return {
      success: false,
      error: `Kit: ${raw.message.split(secret).join('[redacted]')}`,
      ...(status === 429 ? { rateLimited: true } : {}),
    };
  }
  state.received.push({
    to: msg.to,
    subject: msg.subject,
    headers: msg.headers,
    attachments: msg.attachments?.map((part) => ({ ...part })),
  });
  return { success: true, messageId: 'kit-1' };
};

async function runKit(def: EmailTransportDefinition<any>, shared: ReturnType<typeof fakeBackend>): Promise<Record<string, string | null>> {
  const cases: Case[] = [];

  describeEmailTransportConformance(def, {
    describe: (_name, fn) => fn(),
    it: (name, run) => void cases.push({ name, run }),
    expect,
    settings: {},
    secrets: { apiKey: SECRET },
    backend: shared.backend,
  });

  const outcome: Record<string, string | null> = {};
  for (const entry of cases) {
    try {
      await entry.run();
      outcome[entry.name] = null;
    } catch (error) {
      outcome[entry.name] = error instanceof Error ? error.message : String(error);
    }
  }
  return outcome;
}

const failed = (outcome: Record<string, string | null>): string[] => Object.entries(outcome).filter(([, v]) => v !== null).map(([k]) => k);

describe('describeEmailTransportConformance', () => {
  it('passes a transport that keeps the contract', async () => {
    const shared = fakeBackend();
    const outcome = await runKit(definition(correct, shared), shared);

    expect(Object.keys(outcome).length).toBeGreaterThanOrEqual(10);
    expect(failed(outcome)).toEqual([]);
  });

  it('catches a transport whose send throws', async () => {
    const shared = fakeBackend();
    const throwing: Behaviour = async (msg, state, secret) => {
      if (state.mode === 'fail') throw state.error instanceof Error ? state.error : new Error('boom');
      return correct(msg, state, secret);
    };

    expect(failed(await runKit(definition(throwing, shared), shared))).toEqual(
      expect.arrayContaining([
        'turns a network error into { success: false, error }',
        'turns a thrown string into { success: false, error }',
        'turns a thrown object into { success: false, error }',
      ]),
    );
  });

  it('catches an error text that carries the secret', async () => {
    const shared = fakeBackend();
    const leaking: Behaviour = async (msg, state) => {
      if (state.mode === 'fail') return { success: false, error: `Kit: ${state.error instanceof Error ? state.error.message : 'failed'}` };
      return correct(msg, state, SECRET);
    };

    const outcome = await runKit(definition(leaking, shared), shared);
    expect(failed(outcome).join('\n')).toMatch(/no secret material/);
  });

  it('catches an error text that names the recipient', async () => {
    const shared = fakeBackend();
    const nosy: Behaviour = async (msg, state, secret) => {
      if (state.mode === 'fail') return { success: false, error: `could not send to ${msg.to}` };
      return correct(msg, state, secret);
    };

    expect(failed(await runKit(definition(nosy, shared), shared)).join('\n')).toMatch(/no message content/);
  });

  it('catches a transport that drops attachments', async () => {
    const shared = fakeBackend();
    const dropping: Behaviour = async (msg, state, secret) => correct({ ...msg, attachments: undefined }, state, secret);

    expect(failed(await runKit(definition(dropping, shared), shared)).join('\n')).toMatch(/are passed through, to exactly the one recipient/);
  });

  it('catches a transport that does not classify a throttle', async () => {
    const shared = fakeBackend();
    const blind: Behaviour = async (msg, state, secret) => {
      const result = await correct(msg, state, secret);
      return result.success ? result : { success: false, error: result.error };
    };

    expect(failed(await runKit(definition(blind, shared), shared)).join('\n')).toMatch(/is classified/);
  });

  it('runs verify only when the transport defines it, and catches one that throws', async () => {
    const shared = fakeBackend();
    const withVerify = definition(correct, shared, {
      build: ({ secret }): EmailTransport => ({
        send: async (msg) => correct(msg, shared.state, (await secret('apiKey')) ?? ''),
        verify: async () => {
          throw new Error('verify exploded');
        },
      }),
    });

    expect(failed(await runKit(withVerify, shared)).join('\n')).toMatch(/never throws and returns \{ ok, message \}/);
  });

  it('names an unregistered transport id and how to register it', async () => {
    const cases: Case[] = [];
    describeEmailTransportConformance('not-registered-anywhere', {
      describe: (_name, fn) => fn(),
      it: (name, run) => void cases.push({ name, run }),
      expect,
      settings: {},
      secrets: {},
      backend: fakeBackend().backend,
    });

    await expect(cases[0]?.run()).rejects.toThrow(/not registered.*registerEmailTransport/s);
  });
});
