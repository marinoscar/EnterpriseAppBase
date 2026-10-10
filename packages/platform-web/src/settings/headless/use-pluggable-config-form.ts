// =============================================================================
// usePluggableConfigForm: the state of a generated pluggable-kind form
// (PP-14.5, issue #923)
// =============================================================================
//
// Headless. It holds the two halves a pluggable implementation's form has: the
// non-secret settings (`value`, seeded from what the API returned) and the
// WRITE-ONLY secrets (`secrets`, always seeded blank, because a stored secret
// never reaches the browser). `payload()` is what to send: the settings, and
// only the secrets the user actually typed (a blank field means "keep the
// stored one", `secretForSubmit`).
// =============================================================================

import type { ConfigField, PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import { useCallback, useMemo, useRef, useState } from 'react';

import { secretForSubmit } from '../../credentials/index.js';

/**
 * The non-secret settings of one implementation, keyed by field name.
 *
 * @stability experimental
 */
export type PluggableSettingsValue = Readonly<Record<string, unknown>>;

/**
 * What `payload()` of {@link usePluggableConfigForm} returns.
 *
 * @stability experimental
 */
export interface PluggableConfigPayload {
  /** The non-secret settings: the descriptor's non-secret fields that have a value. */
  settings: Record<string, unknown>;
  /** The secrets the user typed, by name. An untouched (blank) secret is absent. */
  secrets: Record<string, string>;
}

/**
 * What {@link usePluggableConfigForm} returns.
 *
 * @stability experimental
 */
export interface UsePluggableConfigFormResult {
  /** The current non-secret settings. */
  value: PluggableSettingsValue;
  /** The typed secrets by name; `''` while untouched. Never seeded from the server. */
  secrets: Readonly<Record<string, string>>;
  /** Whether any setting differs from the initial one or any secret has been typed. */
  dirty: boolean;
  /** Sets one setting; `undefined` removes it. Matches `PluggableConfigForm`'s `onChange`. */
  setField: (name: string, next: unknown) => void;
  /** Sets one secret's typed replacement. Matches `PluggableConfigForm`'s `onSecretChange`. */
  setSecret: (name: string, next: string) => void;
  /** Returns to the initial settings and clears every typed secret. */
  reset: () => void;
  /** What to send: the settings and only the secrets that were typed. */
  payload: () => PluggableConfigPayload;
}

function isSecret(field: ConfigField): field is Extract<ConfigField, { kind: 'secret' }> {
  return field.kind === 'secret';
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The setting names of a descriptor: every field that is not a secret. */
function settingNames(descriptor: PluggableDescriptor): string[] {
  return descriptor.fields.filter((field) => !isSecret(field)).map((field) => field.name);
}

/**
 * The state of a generated `PluggableConfigForm`: non-secret settings,
 * write-only secrets, dirtiness, reset and the submit payload.
 *
 * `initial` is what the API returned for the implementation (its settings,
 * defaults filled). The hook reads it once per mount and per `reset()`: after a
 * save, call `reset()` once the new `initial` is in hand, or `key` the
 * component by the implementation id so each implementation gets its own
 * state. Secrets are never part of `initial`: the API reports only whether one
 * is stored (`hasValue` on the descriptor's field).
 *
 * @param descriptor - the implementation's descriptor, as the API served it.
 * @param initial - the implementation's stored non-secret settings.
 * @returns the form state and its actions.
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
 * />;
 * await api.patch(path, { [descriptor.id]: form.payload().settings });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function usePluggableConfigForm(
  descriptor: PluggableDescriptor,
  initial: PluggableSettingsValue = {},
): UsePluggableConfigFormResult {
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const descriptorRef = useRef(descriptor);
  descriptorRef.current = descriptor;

  const [value, setValue] = useState<PluggableSettingsValue>(initial);
  const [secrets, setSecrets] = useState<Readonly<Record<string, string>>>({});

  const setField = useCallback((name: string, next: unknown) => {
    setValue((current) => {
      const copy = { ...current };
      if (next === undefined) delete copy[name];
      else copy[name] = next;
      return copy;
    });
  }, []);

  const setSecret = useCallback((name: string, next: string) => {
    setSecrets((current) => ({ ...current, [name]: next }));
  }, []);

  const reset = useCallback(() => {
    setValue(initialRef.current);
    setSecrets({});
  }, []);

  const dirty = useMemo(() => {
    const names = settingNames(descriptor);
    const changed = names.some((name) => !sameValue(value[name], initial[name]));
    const typed = Object.values(secrets).some((typedValue) => secretForSubmit(typedValue) !== undefined);
    return changed || typed;
  }, [descriptor, value, initial, secrets]);

  const payload = useCallback((): PluggableConfigPayload => {
    const out: PluggableConfigPayload = { settings: {}, secrets: {} };
    for (const field of descriptorRef.current.fields) {
      if (isSecret(field)) {
        const typed = secretForSubmit(secrets[field.name] ?? '');
        if (typed !== undefined) out.secrets[field.name] = typed;
      } else if (value[field.name] !== undefined) {
        out.settings[field.name] = value[field.name];
      }
    }
    return out;
  }, [value, secrets]);

  return { value, secrets, dirty, setField, setSecret, reset, payload };
}
