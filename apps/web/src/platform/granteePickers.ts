/**
 * The app's grantee pickers: how the share dialog collects the grantee of a
 * grantee kind beyond user and group (PP-14.16).
 *
 * The API serves its registered kinds (`GET /sharing/grantee-kinds`) and
 * `@marinoscar/platform-web/sharing`'s `ShareDialog` offers each one a grant
 * can be stored for. A kind with `input: 'text'` gets a text field; a kind
 * with `input: 'custom'` renders the component registered here with
 * `registerGranteePicker(kind, Component)`, inside `registerAppGranteePickers`,
 * BEFORE the freeze; the component receives `{ descriptor, value, onChange,
 * disabled, error }` and reports the grantee's reference.
 *
 * The template registers none (it registers no grantee kind). A worked picker
 * is `src/platform-extensions/sharing/TeamGranteePicker.example.tsx`.
 *
 * Called once, from `main.tsx`, before the first render: a picker registered
 * later throws `FROZEN` instead of quietly replacing a control of the dialog.
 */

import { freezeGranteePickers } from '@marinoscar/platform-web/sharing/headless';

/** Registers this app's grantee pickers, then freezes the registry. */
export function registerAppGranteePickers(): void {
  freezeGranteePickers();
}
