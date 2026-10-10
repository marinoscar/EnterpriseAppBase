// =============================================================================
// PluggableConfigForm: the generated configuration form of one pluggable
// implementation (PP-14.5, issue #923)
// =============================================================================
//
// Renders a `PluggableDescriptor` (`@marinoscar/platform-contract/settings`)
// the way `OrgSettingsPage` renders a namespace: a Switch for a boolean, a
// select for an enum, a text or number input, and a note for a field the form
// cannot edit generically (`other`). A `secret` field is a write-only
// `SecretField`: the form is handed whether a value is stored, never the value,
// and what the user types is a replacement.
//
// The form is CONTROLLED and presentational (the UI presents and collects, the
// API decides): it has no save button and no fetch. The page owns those;
// `usePluggableConfigForm` (settings/headless) holds the state.
// =============================================================================

import { Box, FormControl, FormControlLabel, FormHelperText, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import type { TextFieldProps } from '@mui/material';
import type { ConfigField, PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import { useId } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { SecretField } from '../../credentials/index.js';
import type { SecretFieldSlots } from '../../credentials/index.js';

/**
 * What a field renderer in {@link PluggableConfigFormSlots.renderField} receives.
 *
 * @stability experimental
 */
export interface PluggableFieldRenderContext {
  /** The field's descriptor. */
  field: ConfigField;
  /** The field's current value (`undefined` for a secret, which is write-only; see `secret`). */
  value: unknown;
  /** The typed replacement of a secret field; `''` for any other kind. */
  secret: string;
  /** Whether the whole form is disabled. */
  disabled: boolean;
  /** Reports a changed setting. */
  onChange: (next: unknown) => void;
  /** Reports a changed secret. */
  onSecretChange: (next: string) => void;
  /** The control the form would render, to wrap or to return as is. */
  defaultControl: ReactElement;
}

/**
 * The part overrides of {@link PluggableConfigForm}. Everything is optional;
 * with none the rendering is the default.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface PluggableConfigFormSlots {
  /**
   * Replaces the control of one field. Return `undefined` to keep the default
   * (so an app overrides one field, say a `string` named `endpoint`, and
   * leaves the rest alone). The form still owns the layout around it.
   */
  renderField?: (context: PluggableFieldRenderContext) => ReactNode | undefined;
  /** Props spread onto the MUI `TextField` of `string`, `number` and `enum` fields, after the form's own. */
  textField?: Partial<Omit<TextFieldProps, 'value' | 'onChange' | 'type' | 'select'>>;
  /** Overrides for each `SecretField`. */
  secretField?: SecretFieldSlots;
  /** The note shown for an `other` field; default: "<label>: managed elsewhere." */
  otherNote?: (field: ConfigField) => ReactNode;
}

/**
 * The props of {@link PluggableConfigForm}.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface PluggableConfigFormProps {
  /** The implementation, as the API described it. */
  descriptor: PluggableDescriptor;
  /** The current non-secret settings, by field name. */
  value: Readonly<Record<string, unknown>>;
  /** Receives one changed setting; `undefined` means the field was cleared. */
  onChange: (name: string, next: unknown) => void;
  /** The typed replacement of each secret, by name; `''` keeps the stored one. */
  secrets: Readonly<Record<string, string>>;
  /** Receives one typed secret. */
  onSecretChange: (name: string, next: string) => void;
  /** Disables every control (a viewer without the write permission). */
  disabled?: boolean;
  /** Part overrides. */
  slots?: PluggableConfigFormSlots;
}

/** "Signing key" reads as "a signing key" in the saved-secret sentence; "API key" stays. */
function nounOf(label: string): string {
  return label.length > 1 && label[0] === label[0]?.toUpperCase() && label[1] === label[1]?.toLowerCase()
    ? `${label[0]?.toLowerCase()}${label.slice(1)}`
    : label;
}

/**
 * The form of one pluggable implementation, generated from its descriptor.
 *
 * Controlled and presentational: it renders the fields, the page saves.
 * Secrets are write-only: a stored one is shown as saved, never as a value,
 * and an untouched secret is left out of the payload by
 * `usePluggableConfigForm`.
 *
 * @param props - see {@link PluggableConfigFormProps}.
 * @returns the form fields.
 *
 * @example
 * ```tsx
 * const form = usePluggableConfigForm(descriptor, stored);
 * <PluggableConfigForm
 *   descriptor={descriptor}
 *   value={form.value}
 *   onChange={form.setField}
 *   secrets={form.secrets}
 *   onSecretChange={form.setSecret}
 *   disabled={!canWrite}
 * />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function PluggableConfigForm(props: PluggableConfigFormProps): ReactElement {
  const { descriptor, value, onChange, secrets, onSecretChange, disabled = false, slots } = props;
  const baseId = useId().replace(/[^A-Za-z0-9_-]/g, '');

  return (
    <Stack role="group" aria-label={descriptor.label} spacing={2}>
      {descriptor.fields.map((field) => {
        const id = `pluggable-${baseId}-${field.name}`;
        const typed = secrets[field.name] ?? '';
        const control = defaultControl({ field, id, value: value[field.name], typed, disabled, slots, onChange, onSecretChange });
        const custom = slots?.renderField?.({
          field,
          value: field.kind === 'secret' ? undefined : value[field.name],
          secret: field.kind === 'secret' ? typed : '',
          disabled,
          onChange: (next) => onChange(field.name, next),
          onSecretChange: (next) => onSecretChange(field.name, next),
          defaultControl: control,
        });
        return <Box key={field.name}>{custom !== undefined ? custom : control}</Box>;
      })}
    </Stack>
  );
}

interface ControlArgs {
  field: ConfigField;
  id: string;
  value: unknown;
  typed: string;
  disabled: boolean;
  slots: PluggableConfigFormSlots | undefined;
  onChange: (name: string, next: unknown) => void;
  onSecretChange: (name: string, next: string) => void;
}

function defaultControl({ field, id, value, typed, disabled, slots, onChange, onSecretChange }: ControlArgs): ReactElement {
  const textProps = { size: 'small' as const, id, disabled, helperText: field.help, ...slots?.textField };

  switch (field.kind) {
    case 'boolean':
      return (
        <FormControl disabled={disabled}>
          <FormControlLabel
            control={
              <Switch
                id={id}
                checked={value === true}
                disabled={disabled}
                onChange={(event) => onChange(field.name, event.target.checked)}
                slotProps={field.help ? { input: { 'aria-describedby': `${id}-help` } } : undefined}
              />
            }
            label={field.label}
          />
          {field.help && <FormHelperText id={`${id}-help`}>{field.help}</FormHelperText>}
        </FormControl>
      );
    case 'enum':
      return (
        <TextField
          {...textProps}
          select
          label={field.label}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(field.name, event.target.value)}
          sx={{ minWidth: 220, maxWidth: '100%' }}
        >
          {field.options.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
      );
    case 'number':
      return (
        <TextField
          {...textProps}
          type="number"
          label={field.label}
          value={typeof value === 'number' ? value : ''}
          slotProps={{ htmlInput: { min: field.min, max: field.max, step: field.integer ? 1 : 'any' } }}
          onChange={(event) => onChange(field.name, event.target.value === '' ? undefined : Number(event.target.value))}
          sx={{ minWidth: 220, maxWidth: '100%' }}
        />
      );
    case 'string':
      return (
        <TextField
          {...textProps}
          label={field.label}
          value={typeof value === 'string' ? value : ''}
          slotProps={{ htmlInput: { maxLength: field.maxLength } }}
          onChange={(event) => onChange(field.name, event.target.value === '' ? undefined : event.target.value)}
          sx={{ minWidth: 280, maxWidth: '100%' }}
        />
      );
    case 'secret':
      return (
        <SecretField
          id={id}
          name={field.name}
          label={field.label}
          value={typed}
          onChange={(next) => onSecretChange(field.name, next)}
          // The descriptor carries presence only: no hint, no date. An empty hint reads as "is saved."
          saved={field.hasValue ? { hint: '' } : null}
          noun={nounOf(field.label)}
          emptyHelp={field.help ?? `No ${nounOf(field.label)} is saved yet.`}
          disabled={disabled}
          slots={{
            ...slots?.secretField,
            textField: { required: field.required && !field.hasValue, ...slots?.secretField?.textField },
          }}
        />
      );
    default:
      return (
        <Typography variant="body2" color="text.secondary">
          {slots?.otherNote ? slots.otherNote(field) : `${field.label}: managed elsewhere.`}
        </Typography>
      );
  }
}
