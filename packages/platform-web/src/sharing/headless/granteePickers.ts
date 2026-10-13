// =============================================================================
// The grantee-picker registry (PP-14.16): rung 2 of the Extension Contract for
// the share dialog
// =============================================================================
//
// The API serves the grantee kinds it knows (`GET /api/sharing/grantee-kinds`:
// `user`, `group`, `link` and any the app registered with `registerGranteeKind`)
// with a label and an `input` type. `ShareDialog` collects the grantee of a kind
// whose `input` is `text` with a plain text field. A kind whose grantee needs
// more (a team search, a calendar, a map) has `input: 'custom'` and the app
// registers ONE component for it here, at startup; `ShareDialog` renders it in
// place of the field and sends what it reports as the grantee's `ref`.
//
// The core registry semantics, like the link renderers: string ids checked
// against a pattern, a duplicate id is an error, and after `freeze()` a
// registration is an error while reads keep working. Errors carry a `code` to
// switch on, never the message.
// =============================================================================

import { GRANTEE_KIND_ID_PATTERN } from '@marinoscar/platform-contract/sharing';
import type { GranteeKindDescriptor } from '@marinoscar/platform-contract/sharing';
import type { ComponentType } from 'react';

/**
 * What a registered grantee picker receives.
 *
 * @stability experimental
 */
export interface GranteePickerProps {
  /** The kind being collected (its label and input type). */
  descriptor: GranteeKindDescriptor;
  /** The grantee reference chosen so far (`''` before a choice). */
  value: string;
  /** Report the chosen grantee reference (`''` clears it). The API's kind validates it. */
  onChange: (ref: string) => void;
  /** The dialog is saving: disable the controls. */
  disabled?: boolean;
  /** An error to show next to the control, or `undefined`. */
  error?: string | undefined;
}

/**
 * A component that collects the grantee of one kind.
 *
 * @stability experimental
 */
export type GranteePicker = ComponentType<GranteePickerProps>;

/**
 * Why a grantee-picker registration was refused.
 *
 * @stability experimental
 */
export type GranteePickerRegistryErrorCode = 'INVALID_ID' | 'DUPLICATE_ID' | 'FROZEN';

/**
 * A refused registration. Switch on `code`, never on the message.
 *
 * @stability experimental
 */
export class GranteePickerRegistryError extends Error {
  /** Why. */
  readonly code: GranteePickerRegistryErrorCode;
  /** The grantee kind id the registration named. */
  readonly id: string;

  /**
   * @param code - why the registration was refused.
   * @param id - the grantee kind id.
   * @param message - the human-readable reason.
   */
  constructor(code: GranteePickerRegistryErrorCode, id: string, message: string) {
    super(message);
    this.name = 'GranteePickerRegistryError';
    this.code = code;
    this.id = id;
  }
}

/**
 * The grantee kind to component map behind {@link registerGranteePicker}. The
 * app uses the default instance through the module functions; a test may build
 * its own and pass it to `ShareDialog`'s `granteePickers` prop.
 *
 * @stability experimental
 */
export class GranteePickerRegistry {
  private readonly entries = new Map<string, GranteePicker>();
  private frozen = false;

  /**
   * Registers the picker of one grantee kind.
   *
   * @param kind - a grantee kind id (`GRANTEE_KIND_ID_PATTERN`).
   * @param component - the picker.
   * @throws GranteePickerRegistryError `INVALID_ID`, `DUPLICATE_ID` or `FROZEN`.
   */
  register(kind: string, component: GranteePicker): void {
    if (this.frozen) {
      throw new GranteePickerRegistryError('FROZEN', kind, `Grantee pickers are frozen: register "${kind}" at startup, before freezeGranteePickers().`);
    }
    if (typeof kind !== 'string' || !GRANTEE_KIND_ID_PATTERN.test(kind)) {
      throw new GranteePickerRegistryError('INVALID_ID', String(kind), `"${String(kind)}" is not a grantee kind id (lower-case letters, digits and hyphens).`);
    }
    if (this.entries.has(kind)) {
      throw new GranteePickerRegistryError('DUPLICATE_ID', kind, `A grantee picker for "${kind}" is already registered.`);
    }
    this.entries.set(kind, component);
  }

  /**
   * The picker of a grantee kind.
   *
   * @param kind - the grantee kind id.
   * @returns the picker, or `undefined` when none is registered.
   */
  get(kind: string): GranteePicker | undefined {
    return this.entries.get(kind);
  }

  /**
   * The grantee kinds with a picker, in registration order.
   *
   * @returns a fresh array.
   */
  kinds(): string[] {
    return [...this.entries.keys()];
  }

  /** Refuses every later registration. Idempotent; reads keep working. */
  freeze(): void {
    this.frozen = true;
  }

  /**
   * Whether {@link GranteePickerRegistry.freeze} ran.
   *
   * @returns `true` once frozen.
   */
  isFrozen(): boolean {
    return this.frozen;
  }
}

/**
 * The app's grantee pickers: the instance the module functions and
 * `ShareDialog` use by default.
 *
 * @stability experimental
 */
export const granteePickers: GranteePickerRegistry = new GranteePickerRegistry();

/**
 * Registers how the share dialog collects the grantee of one kind. Call it at
 * startup, before {@link freezeGranteePickers}.
 *
 * @param kind - the grantee kind id, as registered on the API (`team`).
 * @param component - receives `{ descriptor, value, onChange, disabled, error }`.
 * @throws GranteePickerRegistryError `INVALID_ID`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```tsx
 * registerGranteePicker('team', TeamPicker);
 * freezeGranteePickers();
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerGranteePicker(kind: string, component: GranteePicker): void {
  granteePickers.register(kind, component);
}

/**
 * Freezes the app's grantee pickers: call it once the app has bootstrapped.
 *
 * @example
 * ```ts
 * // apps/web/src/main.tsx, after every registration
 * freezeGranteePickers();
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function freezeGranteePickers(): void {
  granteePickers.freeze();
}
