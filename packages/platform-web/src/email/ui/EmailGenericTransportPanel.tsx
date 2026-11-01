/**
 * The generic email transport panel (PP-14.8).
 *
 * Draws any transport no bespoke panel is registered for, in practice a
 * transport an app or package added with `registerEmailTransport`
 * (`@marinoscar/platform-api/email`). Nothing about the transport is known here:
 * the form is generated from the descriptor the API serves in
 * `GET /api/email-settings` (`descriptors`) through the settings slice's
 * `PluggableConfigForm`: a control per setting (a switch, a select, a text or
 * number input) and a WRITE-ONLY field per declared secret.
 *
 * It is controlled and presentational, like the form it wraps. The page owns
 * the state and the save: the settings go out as `transports.<id>`, the typed
 * secrets as `secrets.<id>`, and a secret nobody retyped is not sent at all
 * (blank keeps the stored one). A stored secret is only ever shown as saved,
 * never as a value.
 */

import { Box, Divider, Typography } from '@mui/material';

import { PluggableConfigForm } from '../../settings/index.js';
import type { EmailTransportPanelProps } from './emailTransportPanelRegistry.js';

/**
 * The form the admin email page draws for a transport that has no registered
 * panel: its label and description, then its settings and write-only secrets,
 * all generated from `props.descriptor`. Also usable inside a bespoke panel
 * that only wants to add to it.
 *
 * @param props - see {@link EmailTransportPanelProps}.
 * @returns the panel.
 *
 * @example
 * ```tsx
 * registerEmailTransportPanel('sendgrid', (props) => (
 *   <>
 *     <Alert severity="info">Verify your sender in the SendGrid console first.</Alert>
 *     <EmailGenericTransportPanel {...props} />
 *   </>
 * ));
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function EmailGenericTransportPanel({
  transport,
  descriptor,
  value,
  onChange,
  secrets,
  onSecretChange,
  errors,
  canWrite,
}: EmailTransportPanelProps) {
  const messages = Object.values(errors);

  return (
    <Box data-testid={`email-transport-panel-${transport}`}>
      <Divider sx={{ my: 3 }} />
      <Typography variant="h6" gutterBottom>
        {descriptor.label}
      </Typography>
      {descriptor.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {descriptor.description}
        </Typography>
      )}
      {descriptor.fields.length > 0 ? (
        <PluggableConfigForm
          descriptor={descriptor}
          value={value}
          onChange={onChange}
          secrets={secrets}
          onSecretChange={onSecretChange}
          disabled={!canWrite}
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          This transport has nothing to configure.
        </Typography>
      )}
      {messages.length > 0 && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }} role="alert">
          {messages.join(' ')}
        </Typography>
      )}
    </Box>
  );
}
