// `@marinoscar/platform-web/webhooks/ui`: the webhooks page of one scope, its
// dialogs, the delivery drawer and the settings cards as data, built on
// `/webhooks/headless` (issue #1046). Documented in ../README.md.

export { WEBHOOK_ROTATION_OVERLAP_HOURS, WEBHOOKS_PAGE_COPY } from './copy.js';
export { webhooksAdminSections, webhooksUserSettingsSections } from './settings.js';
export type { WebhooksSettingsCard } from './settings.js';
export { WebhookDeliveryDrawer } from './WebhookDeliveryDrawer.js';
export type { WebhookDeliveryDrawerProps } from './WebhookDeliveryDrawer.js';
export { WebhookEndpointDialog } from './WebhookEndpointDialog.js';
export type { WebhookEndpointDialogProps } from './WebhookEndpointDialog.js';
export { WebhookEventPicker } from './WebhookEventPicker.js';
export type { WebhookEventPickerProps } from './WebhookEventPicker.js';
export { WebhookSecretDialog } from './WebhookSecretDialog.js';
export type { WebhookSecretDialogProps } from './WebhookSecretDialog.js';
export { WEBHOOK_VERIFY_SNIPPET, WebhookSignatureHelp } from './WebhookSignatureHelp.js';
export { WebhooksPage } from './WebhooksPage.js';
export type { WebhooksPageProps, WebhooksPageSlots } from './WebhooksPage.js';
