// `@marinoscar/platform-web/email/ui/transport-panels`: the email transport
// panel registry (PP-14.8), alone, so an app registers a panel from its main
// chunk without pulling the email page in. Also exported by `/email/ui`.
// Documented in ../README.md.

export { registerEmailTransportPanel, getEmailTransportPanel } from './emailTransportPanelRegistry.js';
export type {
  EmailTransportPanelComponent,
  EmailTransportPanelOptions,
  EmailTransportPanelProps,
} from './emailTransportPanelRegistry.js';
export { EmailGenericTransportPanel } from './EmailGenericTransportPanel.js';
