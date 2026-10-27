// What the reference API serves from `GET /api/notifications/channels`
// (PP-14.10): the platform's channels, the Android app's, and the app's own
// `webhook` example (apps/api/src/platform-extensions/notifications/).

export interface ChannelDescriptorFixture {
  id: string;
  label: string;
  description: string;
  userConfigurable: boolean;
  criticalCapable: boolean;
  broadcastCapable: boolean;
  broadcastDefault: boolean;
  order: number;
}

/** The reference app's channel registry, in registration order. */
export const referenceChannels: ChannelDescriptorFixture[] = [
  {
    id: 'email',
    label: 'Email',
    description: 'A message sent to the address on the account, through the configured email provider.',
    userConfigurable: true,
    criticalCapable: false,
    broadcastCapable: true,
    broadcastDefault: true,
    order: 0,
  },
  {
    id: 'browser',
    label: 'Browser',
    description: "A row in the user's in-app notification centre, streamed to any open tab, which may show it as a toast.",
    userConfigurable: true,
    criticalCapable: true,
    broadcastCapable: true,
    broadcastDefault: true,
    order: 1,
  },
  {
    id: 'push',
    label: 'Push',
    description: 'An operating-system notification delivered through Web Push to every browser the user subscribed.',
    userConfigurable: true,
    criticalCapable: false,
    broadcastCapable: true,
    broadcastDefault: false,
    order: 2,
  },
  {
    id: 'android_app',
    label: 'Android app',
    description: 'An operating-system notification on the phones where the user enabled notifications inside the Android app.',
    userConfigurable: true,
    criticalCapable: false,
    broadcastCapable: false,
    broadcastDefault: false,
    order: 3,
  },
  {
    id: 'webhook',
    label: 'Webhook',
    description: "A JSON POST to the webhook endpoint this application is configured with, addressed to the user's handle.",
    userConfigurable: true,
    criticalCapable: false,
    broadcastCapable: true,
    broadcastDefault: false,
    order: 4,
  },
];
