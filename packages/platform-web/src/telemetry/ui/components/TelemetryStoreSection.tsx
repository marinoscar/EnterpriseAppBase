// The Store section of the telemetry settings page for a store that is not the
// built-in GreptimeDB (PP-14.11).
//
// The deployment picks its telemetry store in code, with
// `TelemetryModule.forRoot({ store })`. GreptimeDB has a bespoke Connection
// section; any other registered store brings its own settings and secrets, and
// this section draws them as a generated form: the settings slice's
// `PluggableConfigForm` over the descriptor `GET /admin/telemetry/store`
// serves. Nothing about the store is known here.
//
// Secrets are WRITE-ONLY: a stored one shows as saved, never as a value, and a
// secret nobody retyped is not sent. Every save sends `If-Match: <the stored
// settings' version>`; a 409 offers a reload. Controls are disabled without
// `telemetry:write`; the API is the gate.
import { useEffect, type FormEvent } from 'react';
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { PluggableConfigForm, usePluggableConfigForm } from '../../../settings/index.js';
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import { useTelemetryStore } from '../../headless/hooks/useTelemetryStore.js';

/** The element id the page's other alerts link to. */
export const TELEMETRY_STORE_SECTION_ID = 'telemetry-store';

/**
 * The props of {@link TelemetryStoreSection}.
 *
 * @stability experimental
 */
export interface TelemetryStoreSectionProps {
  /** Whether the viewer may save (`telemetry:write`). */
  canWrite: boolean;
  /** Called after a successful save with the message to show; the page reloads its status. */
  onChanged: (message: string) => void;
}

interface FormProps {
  descriptor: PluggableDescriptor;
  settings: Record<string, unknown>;
  canWrite: boolean;
  isSaving: boolean;
  onSave: (input: { settings: Record<string, unknown>; secrets: Record<string, string> }) => Promise<boolean>;
}

function StoreForm({ descriptor, settings, canWrite, isSaving, onSave }: FormProps) {
  const form = usePluggableConfigForm(descriptor, settings);
  const { reset } = form;

  // After a save the API returns the settings in force: start the form from them.
  useEffect(() => {
    reset();
  }, [settings, reset]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canWrite) return;
    await onSave(form.payload());
  };

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      {descriptor.fields.length > 0 ? (
        <PluggableConfigForm
          descriptor={descriptor}
          value={form.value}
          onChange={form.setField}
          secrets={form.secrets}
          onSecretChange={form.setSecret}
          disabled={!canWrite || isSaving}
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          This store has nothing to configure here.
        </Typography>
      )}
      {descriptor.fields.length > 0 && (
        <Button type="submit" variant="contained" sx={{ mt: 3 }} disabled={!canWrite || isSaving || !form.dirty}>
          {isSaving ? 'Saving...' : 'Save store'}
        </Button>
      )}
    </Box>
  );
}

/**
 * The telemetry store's settings and write-only secrets, as a generated form.
 * Shown by the settings page for every store but the built-in `greptime`.
 *
 * @param props - see {@link TelemetryStoreSectionProps}.
 * @returns the section.
 *
 * @stability experimental
 */
export function TelemetryStoreSection({ canWrite, onChanged }: TelemetryStoreSectionProps) {
  const { store, isLoading, loadError, isSaving, saveError, conflict, reload, save } = useTelemetryStore();
  const title = 'Store';

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }} component="section" aria-label={title} id={TELEMETRY_STORE_SECTION_ID}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 1 }}
      >
        <Typography variant="h6" component="h2">
          {title}
        </Typography>
        {store && (
          <Chip
            size="small"
            color={store.ready ? 'success' : 'default'}
            label={store.ready ? 'Configured' : 'Not configured'}
            data-testid="telemetry-store-ready"
            sx={{ alignSelf: { xs: 'flex-start', sm: 'auto' } }}
          />
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {store ? (
          <>
            This deployment stores and queries telemetry in <strong>{store.active.label}</strong>
            {store.active.description ? `: ${store.active.description}` : '.'} The store is chosen in
            the application's code; its settings are saved here and take effect within seconds on
            every instance, with no restart.
          </>
        ) : (
          'The telemetry store this deployment uses.'
        )}
      </Typography>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError}
        </Alert>
      )}
      {store?.error && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="telemetry-store-error">
          {store.error}
        </Alert>
      )}
      {conflict && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          data-testid="telemetry-store-conflict"
          action={
            <Button color="inherit" size="small" onClick={() => void reload()}>
              Reload
            </Button>
          }
        >
          These settings were changed by someone else since you opened this page. Reload to see the
          current values, then re-apply your changes.
        </Alert>
      )}
      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {saveError}
        </Alert>
      )}

      {isLoading && !store && (
        <Typography variant="body2" color="text.secondary">
          Loading the store settings...
        </Typography>
      )}
      {store?.descriptor && (
        <StoreForm
          key={store.descriptor.id}
          descriptor={store.descriptor}
          settings={store.settings}
          canWrite={canWrite}
          isSaving={isSaving}
          onSave={async (input) => {
            const ok = await save(input);
            if (ok) onChanged('Telemetry store saved');
            return ok;
          }}
        />
      )}
    </Paper>
  );
}
