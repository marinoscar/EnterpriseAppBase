// Channel descriptors for the notifications web tests (PP-14.10): what
// `GET /api/notifications/channels` serves, and the return value of a mocked
// `useNotificationChannels`.

import { vi } from 'vitest';

import type { NotificationChannelDescriptor } from '../../src/notifications/headless/types.js';

/** The platform's three channels as the API serves them, in registration order. */
export function builtinChannelDescriptors(): NotificationChannelDescriptor[] {
  return [
    {
      id: 'email',
      label: 'Email',
      description: 'A message sent to the address on the account.',
      userConfigurable: true,
      criticalCapable: false,
      broadcastCapable: true,
      broadcastDefault: true,
      order: 0,
    },
    {
      id: 'browser',
      label: 'Browser',
      description: 'A row in the notification centre.',
      userConfigurable: true,
      criticalCapable: true,
      broadcastCapable: true,
      broadcastDefault: true,
      order: 1,
    },
    {
      id: 'push',
      label: 'Push',
      description: 'An operating-system notification through Web Push.',
      userConfigurable: true,
      criticalCapable: false,
      broadcastCapable: true,
      broadcastDefault: false,
      order: 2,
    },
  ];
}

/** An app's channel: on the broadcast events, not critical-capable, not a default. */
export function slackDescriptor(overrides: Partial<NotificationChannelDescriptor> = {}): NotificationChannelDescriptor {
  return {
    id: 'slack',
    label: 'Slack',
    description: 'A message in the user\'s Slack.',
    userConfigurable: true,
    criticalCapable: false,
    broadcastCapable: true,
    broadcastDefault: false,
    order: 3,
    ...overrides,
  };
}

/** What a mocked `useNotificationChannels` returns: the descriptors loaded (or, with `null`, still loading). */
export function channelsHookReturn(
  channels: NotificationChannelDescriptor[] | null = builtinChannelDescriptors(),
  overrides: { error?: string | null } = {},
) {
  return {
    channels,
    isLoading: channels === null && !overrides.error,
    error: overrides.error ?? null,
    refresh: vi.fn().mockResolvedValue(undefined),
  };
}
