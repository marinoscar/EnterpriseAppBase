/**
 * The secrets of the drivers this deployment is NOT writing to (#1124).
 *
 * Each storage driver keeps its own credential address (the built-in S3
 * family: `storage/<driverId>`, falling back to the shared `storage/default`),
 * so a deployment whose rows live on several providers (S3 for old objects, R2
 * for new ones) needs a key per driver. The page's main form edits the
 * SELECTED driver and saving it switches the active one; this panel stores the
 * key of every other configured driver WITHOUT switching: it sends
 * `{ provider: <active>, secrets: { <driverId>: { <name>: value } } }`, which
 * the API writes to that driver's own address and leaves the active driver
 * and every setting alone.
 *
 * Write-only like every secret on the page: a stored value is shown only as
 * its mask, and a blank field is not sent.
 */

import { useState } from 'react';
import { Box, Button, Divider, Paper, Stack, TextField, Typography } from '@mui/material';
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import { storageSecretStatusOf } from '../headless/index.js';
import type { StorageConfigInput, StorageConfigView } from '../headless/index.js';

/**
 * The props of {@link StorageDriverCredentialsPanel}.
 *
 * @stability experimental
 */
export interface StorageDriverCredentialsPanelProps {
  /** The loaded configuration. */
  config: StorageConfigView;
  /** One per registered driver (the API's `descriptors`). */
  descriptors: readonly PluggableDescriptor[];
  /** Whether the viewer holds `storage_config:write`. */
  canWrite: boolean;
  /** Whether a save is in flight. */
  isSaving: boolean;
  /** The page's `save` (a `PUT` of the configuration). */
  save: (input: StorageConfigInput) => Promise<boolean>;
  /** Called after a save landed. */
  onSaved?: (driverLabel: string) => void;
  /** Driver ids not to list besides the active one (the page passes the driver its main form is editing). */
  exclude?: readonly string[];
}

/** A driver other than the active one that has settings stored, and declares a secret. */
function otherConfiguredDrivers(
  config: StorageConfigView,
  descriptors: readonly PluggableDescriptor[],
  exclude: readonly string[],
): PluggableDescriptor[] {
  return descriptors.filter((descriptor) => {
    if (descriptor.id === config.provider || exclude.includes(descriptor.id)) return false;
    if (!descriptor.fields.some((field) => field.kind === 'secret')) return false;
    const settings = config.drivers?.[descriptor.id];
    return !!settings && Object.values(settings).some((value) => value !== '' && value !== null && value !== undefined);
  });
}

/**
 * One write-only secret field per declared secret of every configured driver
 * other than the active one, each driver with its own save (#1124).
 *
 * @param props - see {@link StorageDriverCredentialsPanelProps}.
 * @returns the panel, or `null` when no other driver is configured.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function StorageDriverCredentialsPanel({
  config,
  descriptors,
  canWrite,
  isSaving,
  save,
  onSaved,
  exclude = [],
}: StorageDriverCredentialsPanelProps) {
  const [typed, setTyped] = useState<Record<string, Record<string, string>>>({});
  const drivers = otherConfiguredDrivers(config, descriptors, exclude);

  if (drivers.length === 0) return null;

  const saveDriver = async (descriptor: PluggableDescriptor) => {
    const values = Object.fromEntries(Object.entries(typed[descriptor.id] ?? {}).filter(([, value]) => value !== ''));
    if (Object.keys(values).length === 0) return;
    const ok = await save({ provider: config.provider, secrets: { [descriptor.id]: values } });
    if (ok) {
      setTyped((prev) => ({ ...prev, [descriptor.id]: {} }));
      onSaved?.(descriptor.label);
    }
  };

  return (
    <Paper sx={{ mt: 3, p: { xs: 2, sm: 3 } }} data-testid="storage-driver-credentials">
      <Typography variant="h6" gutterBottom>
        Credentials of the other configured providers
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Objects stay on the provider they were written to. Each provider keeps its own key, so a
        provider still holding objects keeps serving them after you switch away from it. Saving a
        key here does not change which provider new uploads go to.
      </Typography>
      <Stack divider={<Divider flexItem />} spacing={2}>
        {drivers.map((descriptor) => {
          const values = typed[descriptor.id] ?? {};
          const dirty = Object.values(values).some((value) => value !== '');
          return (
            <Box key={descriptor.id} data-testid={`storage-driver-credentials-${descriptor.id}`}>
              <Typography variant="subtitle1" gutterBottom>
                {descriptor.label}
              </Typography>
              <Stack spacing={2}>
                {descriptor.fields
                  .filter((field) => field.kind === 'secret')
                  .map((field) => {
                    const status = storageSecretStatusOf(config, descriptor.id, field.name);
                    return (
                      <TextField
                        key={field.name}
                        fullWidth
                        type="password"
                        autoComplete="new-password"
                        label={field.label}
                        value={values[field.name] ?? ''}
                        onChange={(e) =>
                          setTyped((prev) => ({ ...prev, [descriptor.id]: { ...(prev[descriptor.id] ?? {}), [field.name]: e.target.value } }))
                        }
                        disabled={!canWrite}
                        placeholder={status.configured ? (status.hint ?? '••••••••') : ''}
                        helperText={
                          status.configured
                            ? 'A value is saved. Leave this blank to keep it, or type a new one to replace it.'
                            : 'Nothing is saved for this provider yet.'
                        }
                        slotProps={{ htmlInput: { 'data-testid': `storage-driver-secret-${descriptor.id}-${field.name}` } }}
                      />
                    );
                  })}
                <Box>
                  <Button
                    variant="outlined"
                    disabled={!canWrite || !dirty || isSaving}
                    onClick={() => void saveDriver(descriptor)}
                    data-testid={`storage-driver-credentials-save-${descriptor.id}`}
                  >
                    Save {descriptor.label} credentials
                  </Button>
                </Box>
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}
