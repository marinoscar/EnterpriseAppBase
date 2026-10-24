/**
 * The generic storage driver panel (PP-14.7, issue #925, epic #918).
 *
 * Draws any driver no bespoke panel is registered for — in practice a driver an
 * app or package added with `registerStorageDriver`
 * (`@marinoscar/platform-api/storage`). Nothing about the driver is known here:
 * the form is generated from the descriptor the API serves in
 * `GET /admin/storage-config` (`descriptors`) through the settings slice's
 * `PluggableConfigForm`: a control per setting (a switch, a select, a text or
 * number input) and a WRITE-ONLY field per declared secret.
 *
 * It is controlled and presentational, like the form it wraps. The page owns
 * the state and the save: the settings go out as `drivers.<id>`, the typed
 * secrets as `secrets.<id>`, and a secret nobody retyped is not sent at all
 * (blank keeps the stored one). A stored secret is only ever shown as saved,
 * never as a value.
 */

import { Box, Divider, Typography } from '@mui/material';

import { PluggableConfigForm } from '../../settings/index.js';
import type { StorageDriverPanelProps } from './storageDriverPanelRegistry.js';

/**
 * The form the admin storage page draws for a storage driver that has no
 * registered panel: its label and description, then its settings and write-only
 * secrets, all generated from `props.descriptor`. Also usable inside a bespoke
 * panel that only wants to add to it.
 *
 * @param props - see {@link StorageDriverPanelProps}.
 * @returns the panel.
 *
 * @example
 * ```tsx
 * registerStorageDriverPanel('local-fs', (props) => (
 *   <>
 *     <Alert severity="warning">Objects are lost when the host is rebuilt.</Alert>
 *     <StorageGenericDriverPanel {...props} />
 *   </>
 * ));
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function StorageGenericDriverPanel({
  provider,
  descriptor,
  value,
  onChange,
  secrets,
  onSecretChange,
  errors,
  canWrite,
}: StorageDriverPanelProps) {
  const messages = Object.values(errors);

  return (
    <Box data-testid={`storage-driver-panel-${provider}`}>
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
          This driver has nothing to configure.
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
