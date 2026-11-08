import { registerPlatformNotificationChannels } from './platform-channels';
import { assertValidNotificationEvent, type NotificationEventDef } from './event.registry';

// The `kind` of an event (issue #1077) is validated with the rest of its shape.

const base: NotificationEventDef = {
  key: 'kind.spec_event',
  label: 'Kind spec',
  description: 'An event used to test the kind field.',
  channels: ['browser'],
  defaultEnabled: true,
};

describe('NotificationEventDef.kind', () => {
  beforeAll(() => registerPlatformNotificationChannels());

  it.each([undefined, 'event', 'state', 'counted'] as const)('accepts %s', (kind) => {
    expect(() => assertValidNotificationEvent({ ...base, ...(kind ? { kind } : {}) })).not.toThrow();
  });

  it('refuses any other value', () => {
    expect(() => assertValidNotificationEvent({ ...base, kind: 'rolling' as never })).toThrow(/kind must be/);
  });
});
