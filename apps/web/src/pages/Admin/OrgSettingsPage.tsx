/**
 * Organization settings (#733, PP-8.1): the CURRENT organization's overrides
 * of the system settings namespaces that let an organization change them.
 * Reached through the `Organization settings` card
 * (`/admin/settings/organization-settings`, `org_settings:read`,
 * `feature: 'orgs'`).
 *
 * THE FORM IS GENERATED from the namespace descriptors `GET /api/org-settings`
 * returns (each field's kind: boolean, enum, number, string, or `other`, which
 * the slice's own page manages). The page decides nothing: the API resolves
 * the effective values, validates every write against the namespace's org
 * schema and filters namespaces by their own permissions.
 *
 * WRITES ARE GATED INSIDE THE PAGE (Settings UI Pattern rule 3): without
 * `org_settings:write` every control is disabled, never hidden; a namespace
 * whose own write permission the caller lacks is read-only too
 * (`writable: false`).
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useOrgSettings } from '@marinoscar/platform-web/settings/headless';
import type { OrgSettingsField, OrgSettingsNamespace } from '@marinoscar/platform-contract/settings';

import { useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';

type Draft = Record<string, unknown>;

function FieldControl({
  field,
  value,
  inherited,
  disabled,
  onChange,
}: {
  field: OrgSettingsField;
  value: unknown;
  inherited: unknown;
  disabled: boolean;
  onChange: (next: unknown) => void;
}) {
  // A draft `null` is a cleared control (the override will be removed), not "no draft".
  const shown = value !== undefined ? value : inherited;
  const label = field.name;
  switch (field.kind) {
    case 'boolean':
      return (
        <FormControlLabel
          control={<Switch checked={shown === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />}
          label={label}
        />
      );
    case 'enum':
      return (
        <TextField
          select
          size="small"
          label={label}
          value={typeof shown === 'string' ? shown : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          sx={{ minWidth: 220 }}
        >
          {(field.options ?? []).map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
      );
    case 'number':
      return (
        <TextField
          type="number"
          size="small"
          label={label}
          value={typeof shown === 'number' ? shown : ''}
          disabled={disabled}
          slotProps={{ htmlInput: { min: field.min, max: field.max, step: field.integer ? 1 : 'any' } }}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          sx={{ minWidth: 220 }}
        />
      );
    case 'string':
      return (
        <TextField
          size="small"
          label={label}
          value={typeof shown === 'string' ? shown : ''}
          disabled={disabled}
          slotProps={{ htmlInput: { maxLength: field.maxLength } }}
          onChange={(e) => onChange(e.target.value)}
          sx={{ minWidth: 280 }}
        />
      );
    default:
      return (
        <Typography variant="body2" color="text.secondary">
          {label}: managed by the {"slice's"} own settings page.
        </Typography>
      );
  }
}

function NamespaceCard({
  namespace,
  stored,
  effective,
  canWrite,
  isSaving,
  onSave,
}: {
  namespace: OrgSettingsNamespace;
  stored: Draft | undefined;
  effective: Draft | undefined;
  canWrite: boolean;
  isSaving: boolean;
  onSave: (patch: Draft | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>({});
  const disabled = !canWrite || !namespace.writable || isSaving;
  const dirty = Object.keys(draft).length > 0;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          <Typography variant="h6" component="h2">
            {namespace.key}
          </Typography>
          <Chip size="small" label={namespace.merge === 'override' ? 'Overrides' : 'Can only restrict'} />
          {stored && <Chip size="small" color="primary" variant="outlined" label="Customised" />}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {namespace.description}
        </Typography>
        <Stack spacing={2}>
          {namespace.fields.map((field) => (
            <Box key={field.name}>
              <FieldControl
                field={field}
                value={field.name in draft ? draft[field.name] : stored?.[field.name]}
                inherited={effective?.[field.name]}
                disabled={disabled}
                onChange={(next) => setDraft((current) => ({ ...current, [field.name]: next }))}
              />
            </Box>
          ))}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button
            variant="contained"
            disabled={disabled || !dirty}
            onClick={async () => {
              await onSave(draft);
              setDraft({});
            }}
          >
            Save
          </Button>
          <Button
            disabled={disabled || !stored}
            onClick={async () => {
              await onSave(null);
              setDraft({});
            }}
          >
            Use the deployment values
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function OrgSettingsPage() {
  const { activeOrg } = useAuth();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('org_settings:write');
  const { settings, isLoading, error, isSaving, patch } = useOrgSettings();
  const [saveError, setSaveError] = useState<string | null>(null);

  const namespaces = useMemo(() => settings?.namespaces ?? [], [settings]);

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Organization settings
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {activeOrg
            ? `Override, for ${activeOrg.name}, the settings the deployment lets an organization change.`
            : 'Override, for your current organization, the settings the deployment lets an organization change.'}
        </Typography>

        {!canWrite && (
          <Alert severity="info" sx={{ mb: 2 }}>
            You can view these settings. Changing them requires org_settings:write.
          </Alert>
        )}
        {(error || saveError) && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {saveError ?? error}
          </Alert>
        )}

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress aria-label="Loading organization settings" />
          </Box>
        ) : namespaces.length === 0 ? (
          <Typography color="text.secondary">No setting of this deployment can be changed per organization.</Typography>
        ) : (
          <Stack spacing={2}>
            {namespaces.map((namespace) => (
              <NamespaceCard
                key={namespace.key}
                namespace={namespace}
                stored={settings?.value[namespace.key]}
                effective={settings?.effective[namespace.key] as Draft | undefined}
                canWrite={canWrite}
                isSaving={isSaving}
                onSave={async (body) => {
                  setSaveError(null);
                  try {
                    await patch({ [namespace.key]: body });
                  } catch (err) {
                    setSaveError(err instanceof Error ? err.message : 'Failed to save the organization settings');
                  }
                }}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Container>
  );
}
