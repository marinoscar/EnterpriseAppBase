// =============================================================================
// SecretField: a write-only secret input (issue #735, PP-8.8)
// =============================================================================
//
// An MUI `TextField` with `type="password"` that says whether a secret is
// stored (its non-secret hint and last change) and that leaving it blank keeps
// it. There is NO reveal toggle: the stored secret is never sent to the
// browser, and what the user is typing is a replacement, so showing it serves
// nobody. The helper text is linked to the input through `aria-describedby`
// (MUI does this when the field has an id and helper text).
// =============================================================================

import { TextField } from '@mui/material';
import type { SxProps, TextFieldProps, Theme } from '@mui/material';
import { useId } from 'react';
import type { ReactElement } from 'react';

import { savedSecretHelperText } from '../headless/index.js';
import type { SavedSecretHelperTextOptions, SavedSecretInfo } from '../headless/index.js';

/**
 * The props of {@link SecretField}.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface SecretFieldProps {
  /** The field's label. */
  label: string;
  /** The typed replacement; `''` keeps the stored secret. */
  value: string;
  /** Receives the new value on every keystroke. */
  onChange: (value: string) => void;
  /** The stored secret's presentation fields, or `null`/absent when nothing is stored. */
  saved?: SavedSecretInfo | null;
  /** The helper text when nothing is stored. */
  emptyHelp?: string;
  /** What the secret is called in the helper text; default `'key'`. */
  noun?: string;
  /** Formats the last-change date; default `toLocaleDateString()`. */
  formatDate?: SavedSecretHelperTextOptions['formatDate'];
  /** Disables the input (a viewer without the write permission). */
  disabled?: boolean;
  /** An error message, shown instead of the helper text. */
  error?: string | null;
  /** The input's `name`. */
  name?: string;
  /** The element id; generated when absent. */
  id?: string;
  /** Styles for the field's root. */
  sx?: SxProps<Theme>;
  /**
   * Overrides for the underlying parts. `textField` props are spread last,
   * except `type`, `value` and `onChange`, which stay the field's own.
   */
  slots?: { textField?: Partial<Omit<TextFieldProps, 'type' | 'value' | 'onChange'>> };
}

/**
 * A write-only secret input with the unified "saved secret" helper text.
 *
 * @param props - see {@link SecretFieldProps}.
 * @returns the field.
 *
 * @example
 * ```tsx
 * <SecretField
 *   label="Signing secret"
 *   value={secret}
 *   onChange={setSecret}
 *   saved={info ? { hint: info.hint, updatedAt: info.updatedAt } : null}
 *   emptyHelp="No signing secret is saved yet."
 * />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function SecretField(props: SecretFieldProps): ReactElement {
  const generatedId = useId();
  const id = props.id ?? `secret-field-${generatedId.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const helper =
    props.error ??
    savedSecretHelperText(props.saved, {
      ...(props.noun !== undefined ? { noun: props.noun } : {}),
      ...(props.emptyHelp !== undefined ? { emptyHelp: props.emptyHelp } : {}),
      ...(props.formatDate !== undefined ? { formatDate: props.formatDate } : {}),
    });

  return (
    <TextField
      id={id}
      name={props.name}
      label={props.label}
      disabled={props.disabled}
      error={Boolean(props.error)}
      helperText={helper}
      autoComplete="new-password"
      fullWidth
      sx={props.sx}
      {...props.slots?.textField}
      type="password"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}
