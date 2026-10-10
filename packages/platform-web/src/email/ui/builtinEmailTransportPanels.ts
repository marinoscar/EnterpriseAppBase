// The two built-in transports' bespoke panels, registered through the same
// registry an app uses (PP-14.8). The admin email page calls this at module
// scope; the components are the ones that have always drawn them, so their
// markup is unchanged. A call, not a bare side-effect import: the package is
// `sideEffects: false`.

import { SesTransportPanel, sesSettingsToInput, validateSesSettings } from './SesTransportPanel.js';
import { SmtpTransportPanel, smtpSettingsToForm, smtpSettingsToInput, validateSmtpSettings } from './SmtpTransportPanel.js';
import { registerBuiltinEmailTransportPanel } from './emailTransportPanelRegistry.js';

/** The ids of the transports whose bespoke panel ships with the slice. */
export const BUILTIN_EMAIL_TRANSPORT_PANEL_IDS = ['ses', 'smtp'] as const;

/** Registers the bespoke panel of each built-in transport. Idempotent. */
export function registerBuiltinEmailTransportPanels(): void {
  registerBuiltinEmailTransportPanel('ses', SesTransportPanel, { validate: validateSesSettings, toInput: sesSettingsToInput });
  registerBuiltinEmailTransportPanel('smtp', SmtpTransportPanel, {
    validate: validateSmtpSettings,
    toForm: smtpSettingsToForm,
    toInput: smtpSettingsToInput,
  });
}
