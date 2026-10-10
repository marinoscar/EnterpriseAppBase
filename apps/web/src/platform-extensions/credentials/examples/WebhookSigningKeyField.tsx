// =============================================================================
// EXAMPLE, NOT WIRED: a user's own key field on `SecretField` (PP-8.8, #735)
// =============================================================================
//
// The web half of the API example
// `apps/api/src/platform-extensions/credentials/examples/webhook-signing-key.purpose.ts`:
// a settings card that lets a user store their own webhook signing secret.
// `SecretField` (`@marinoscar/platform-web/credentials/ui`) renders the
// write-only input with the unified "saved secret" sentence; `secretForSubmit`
// (`/credentials/headless`) turns a blank field into "keep what is stored".
//
// The five existing secret fields of this app (storage, e-mail, the AI
// provider card, the telemetry connection, a user's own AI key) move onto
// `SecretField` when their slices are extracted (#736-#739). This file is
// compiled with the app and rendered by
// `src/__tests__/platform-extensions/credentialsExamples.test.tsx`.
// =============================================================================

import { useState } from 'react';
import type { ReactElement } from 'react';
import { Button, Stack } from '@mui/material';
import { secretForSubmit } from '@marinoscar/platform-web/credentials/headless';
import { SecretField } from '@marinoscar/platform-web/credentials/ui';
import type { UserCredentialInfoDto } from '@marinoscar/platform-contract/credentials';

export interface WebhookSigningKeyFieldProps {
  /** What the API says is stored (`UserCredentialInfo`), or `null`. */
  saved: UserCredentialInfoDto | null;
  /** Sends the replacement; `undefined` keeps the stored secret. */
  onSave: (secret: string | undefined) => void;
}

export function WebhookSigningKeyField({ saved, onSave }: WebhookSigningKeyFieldProps): ReactElement {
  const [value, setValue] = useState('');
  return (
    <Stack spacing={2}>
      <SecretField
        label="Webhook signing secret"
        noun="signing secret"
        value={value}
        onChange={setValue}
        saved={saved ? { hint: saved.hint, updatedAt: saved.updatedAt } : null}
        emptyHelp="No signing secret is saved yet. Webhooks are sent unsigned until you add one."
      />
      <Button variant="contained" onClick={() => onSave(secretForSubmit(value))}>
        Save
      </Button>
    </Stack>
  );
}
