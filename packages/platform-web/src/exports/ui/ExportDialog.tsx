// =============================================================================
// ExportDialog (issue #744): request an export
// =============================================================================
//
// The source, the format and the source's own request fields, drawn from
// `GET /api/exports/sources` (a date picker, a checkbox, a select or a text
// box per field the source's request schema declares), so the web app never
// carries a second copy of what a source accepts. A source with a richer form
// supplies its own through `slots.form[<sourceId>]`. An `org` source the
// caller may export across organizations also asks for the organization id.
// =============================================================================

import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
} from '@mui/material';
import { useEffect, useId, useMemo, useState, type ComponentType, type ReactElement } from 'react';

import type { ExportRequestField, ExportSourceDescriptor, ExportView } from '@marinoscar/platform-contract/exports';

import { useCreateExport } from '../headless/hooks.js';

/**
 * What a source's own form receives (`slots.form`).
 *
 * @stability experimental
 */
export interface ExportFormSlotProps {
  /** The source the form is for. */
  source: ExportSourceDescriptor;
  /** The request so far. */
  value: Record<string, unknown>;
  /** Replaces the request. */
  onChange: (value: Record<string, unknown>) => void;
}

/**
 * Props of {@link ExportDialog}.
 *
 * @stability experimental
 */
export interface ExportDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called on cancel, and after a successful request. */
  onClose: () => void;
  /** The sources to offer (`useExportSources().sources`). */
  sources: readonly ExportSourceDescriptor[];
  /** Preselects a source. */
  initialSourceId?: string;
  /** Called with the queued export. */
  onCreated?: (view: ExportView) => void;
  /** Replacements: `form[<sourceId>]` draws that source's request fields. */
  slots?: {
    /** A source's own request form, by source id. */
    form?: Readonly<Record<string, ComponentType<ExportFormSlotProps>>>;
  };
}

function initialRequest(source: ExportSourceDescriptor | undefined): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  for (const field of source?.fields ?? []) {
    if (field.default !== undefined) request[field.key] = field.default;
  }
  return request;
}

function FieldControl(props: { field: ExportRequestField; value: unknown; onChange: (value: unknown) => void }): ReactElement {
  const { field, value, onChange } = props;
  const helper = field.description;
  if (field.kind === 'boolean') {
    return (
      <FormControlLabel
        control={<Checkbox checked={value === true} onChange={(event) => onChange(event.target.checked)} />}
        label={field.label}
      />
    );
  }
  if (field.kind === 'select') {
    return (
      <TextField
        select
        label={field.label}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
        required={field.required}
        helperText={helper}
        fullWidth
      >
        {!field.required ? <MenuItem value="">Any</MenuItem> : null}
        {(field.options ?? []).map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  return (
    <TextField
      type={field.kind === 'date' ? 'date' : 'text'}
      label={field.label}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      required={field.required}
      helperText={helper}
      slotProps={field.kind === 'date' ? { inputLabel: { shrink: true } } : undefined}
      fullWidth
    />
  );
}

/**
 * The export request dialog. See the file header.
 *
 * @param props - see {@link ExportDialogProps}.
 * @returns the dialog.
 *
 * @example
 * ```tsx
 * const { sources } = useExportSources();
 * <ExportDialog open={open} onClose={() => setOpen(false)} sources={sources} onCreated={() => void refresh()} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function ExportDialog(props: ExportDialogProps): ReactElement {
  const { open, onClose, sources, initialSourceId, onCreated, slots } = props;
  const titleId = useId();
  const { create, creating, error, reset } = useCreateExport();
  const [sourceId, setSourceId] = useState<string>(initialSourceId ?? sources[0]?.id ?? '');
  const source = useMemo(() => sources.find((candidate) => candidate.id === sourceId) ?? sources[0], [sources, sourceId]);
  const [format, setFormat] = useState<string>(source?.formats[0]?.id ?? '');
  const [request, setRequest] = useState<Record<string, unknown>>(() => initialRequest(source));
  const [orgId, setOrgId] = useState('');

  useEffect(() => {
    if (!open) return;
    reset();
    setSourceId(initialSourceId ?? sources[0]?.id ?? '');
  }, [open, initialSourceId, sources, reset]);

  useEffect(() => {
    setFormat(source?.formats[0]?.id ?? '');
    setRequest(initialRequest(source));
    setOrgId('');
  }, [source]);

  const Form = source ? slots?.form?.[source.id] : undefined;

  async function submit(): Promise<void> {
    if (!source || !format) return;
    const clean = Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined));
    const view = await create({
      source: source.id,
      format,
      request: clean,
      ...(source.scope === 'org' && source.crossOrg && orgId.trim() !== '' ? { orgId: orgId.trim() } : {}),
    });
    if (view) {
      onCreated?.(view);
      onClose();
    }
  }

  return (
    <Dialog open={open} onClose={creating ? undefined : onClose} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>Export data</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {sources.length === 0 ? (
            <DialogContentText>There is nothing you can export right now.</DialogContentText>
          ) : null}
          {sources.length > 1 ? (
            <TextField select label="What to export" value={source?.id ?? ''} onChange={(event) => setSourceId(event.target.value)} fullWidth>
              {sources.map((candidate) => (
                <MenuItem key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {source?.description ? <DialogContentText>{source.description}</DialogContentText> : null}
          {source ? (
            <FormControl>
              <FormLabel id={`${titleId}-format`}>Format</FormLabel>
              <RadioGroup aria-labelledby={`${titleId}-format`} value={format} onChange={(event) => setFormat(event.target.value)}>
                {source.formats.map((candidate) => (
                  <FormControlLabel key={candidate.id} value={candidate.id} control={<Radio />} label={candidate.label} />
                ))}
              </RadioGroup>
            </FormControl>
          ) : null}
          {source && Form ? (
            <Form source={source} value={request} onChange={setRequest} />
          ) : (
            (source?.fields ?? []).map((field) => (
              <FieldControl
                key={field.key}
                field={field}
                value={request[field.key]}
                onChange={(value) => setRequest((current) => ({ ...current, [field.key]: value }))}
              />
            ))
          )}
          {source?.scope === 'org' && source.crossOrg ? (
            <TextField
              label="Organization id"
              value={orgId}
              onChange={(event) => setOrgId(event.target.value)}
              helperText="Leave empty to export your active organization."
              fullWidth
            />
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={creating} sx={{ minHeight: 44 }}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={creating || !source || !format} sx={{ minHeight: 44 }}>
          {creating ? 'Requesting…' : 'Start export'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
