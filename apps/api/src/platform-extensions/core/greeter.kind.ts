import { createHmac } from 'node:crypto';

import { definePluggableKind, type PluggableImplementation } from '@marinoscar/platform-api/core';
import { z } from 'zod';

// =============================================================================
// EXAMPLE: a pluggable kind and two implementations (PP-14.5)
// =============================================================================
//
// A "pluggable kind" is the one shape every slice with a swappable part shares
// (AI providers, storage drivers, email transports, sign-in providers...). This
// toy kind, `greeter`, shows all of it without any consumer slice:
//
//   1. `definePluggableKind` creates the kind: a registry named
//      `pluggable.greeter` (duplicates throw, it freezes at bootstrap).
//   2. Each implementation brings its own `settingsSchema` (non-secret fields
//      only), `defaults`, optional declared `secrets` and a `build` that makes
//      the instance. `plain` has no secrets; `signed` declares one (`apiKey`).
//   3. `app-registrations/core.ts` registers both at import time.
//
// What a consuming slice does with a kind (and what the test in
// `test/examples/core/pluggable-kind.spec.ts` plays out):
//   - stores settings as `{ <id>: <that implementation's settings> }` and
//     merges writes with `kind.mergeSettingsRecord` / reads with
//     `kind.readSettingsRecord`;
//   - serves `kind.describeAll(presence)` so a generated form can render every
//     implementation, the secret as a write-only field;
//   - keeps secret values in the encrypted credential store and hands `build`
//     a `secret(name)` resolver. Settings and env vars never hold a secret.
//
// Recipe: packages/platform-api/src/core/README.md, "Pluggable kinds".
// =============================================================================

/** What the kind builds: something that greets by name. */
export interface Greeter {
  greet(name: string): Promise<string>;
}

/** The id of the kind. */
export const GREETER_KIND_ID = 'greeter';

/**
 * The `greeter` kind. Nothing in the platform consumes it: it exists so the
 * primitive is proven end to end from the app, without a consumer slice.
 */
export const greeterKind = definePluggableKind<Greeter>({ kind: GREETER_KIND_ID, label: 'Greeter' });

/** Settings of the `plain` greeter. */
const plainSettings = z.object({
  greeting: z.string().min(1).max(40).meta({ label: 'Greeting' }).describe('The word said before the name'),
  shout: z.boolean().describe('Upper-case the whole greeting'),
  repeat: z.number().int().min(1).max(3).describe('How many times to say it'),
});

/** A greeter with no secrets. */
export const plainGreeter: PluggableImplementation<Greeter, object, z.infer<typeof plainSettings>> = {
  id: 'plain',
  label: 'Plain greeter',
  description: 'Says the greeting, optionally shouted and repeated.',
  settingsSchema: plainSettings,
  defaults: { greeting: 'Hello', shout: false, repeat: 1 },
  build: ({ settings }) => ({
    async greet(name) {
      const line = `${settings.greeting}, ${name}!`;
      return Array.from({ length: settings.repeat }, () => (settings.shout ? line.toUpperCase() : line)).join(' ');
    },
  }),
};

/** Settings of the `signed` greeter. The signing key is NOT here: it is a declared secret. */
const signedSettings = z.object({
  greeting: z.string().min(1).max(40),
  style: z.enum(['formal', 'casual']).describe('How the signature is worded'),
  endpoint: z.url().optional().describe('Where a real implementation would call'),
});

/** A greeter that signs what it says with a secret it must be given. */
export const signedGreeter: PluggableImplementation<Greeter, object, z.infer<typeof signedSettings>> = {
  id: 'signed',
  label: 'Signed greeter',
  description: 'Signs every greeting with its API key.',
  settingsSchema: signedSettings,
  defaults: { greeting: 'Greetings', style: 'formal' },
  secrets: [{ name: 'apiKey', label: 'Signing key', required: true, help: 'Stored encrypted; never shown again after saving.' }],
  async build({ settings, secret }) {
    const apiKey = await secret('apiKey');
    if (apiKey === null) throw new Error('The signed greeter needs its apiKey secret before it can be built.');
    return {
      async greet(name) {
        const line = `${settings.greeting}, ${name}.`;
        const signature = createHmac('sha256', apiKey).update(line).digest('hex').slice(0, 8);
        return `${line} ${settings.style === 'formal' ? 'Signed' : 'sig'}: ${signature}`;
      },
    };
  },
  egressHosts: (settings) => (settings.endpoint === undefined ? [] : [new URL(settings.endpoint).hostname]),
};
