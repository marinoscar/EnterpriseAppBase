/**
 * Reference example (PP-14.24): an app adds a line under each provider's card on
 * the packaged admin AI page through `slots.ProviderCardExtra`, with no package
 * edit.
 *
 * The slot is called once per listed provider with the provider as the API
 * describes it (data, never an API client). This one links a built-in provider
 * to the console where its usage and billing live and says nothing for a
 * provider it does not know (the page's own cards are untouched either way).
 *
 * Wire it where the route renders the page (`App.tsx`):
 * `<AiConfigPage slots={{ ProviderCardExtra: ProviderConsoleLink }} />`. The
 * reference app does not wire it: it ships compiled and tested, like the other
 * web examples.
 */
import type { ReactElement } from 'react';
import { Link, Typography } from '@mui/material';
import type { AiProviderCardExtraProps } from '@marinoscar/platform-web/ai/ui';

/** Where each provider's usage and billing page lives. */
const CONSOLES: Readonly<Record<string, string>> = {
  openai: 'https://platform.openai.com/usage',
  anthropic: 'https://console.anthropic.com/settings/usage',
};

export function ProviderConsoleLink({ provider }: AiProviderCardExtraProps): ReactElement | null {
  const href = CONSOLES[provider.id];
  if (!href) return null;
  return (
    <Typography variant="body2" color="text.secondary" data-testid={`console-link-${provider.id}`}>
      Usage and billing for {provider.displayName}:{' '}
      <Link href={href} target="_blank" rel="noopener noreferrer">
        provider console
      </Link>
    </Typography>
  );
}
