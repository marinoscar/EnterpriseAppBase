// `NotificationsModule.forRoot` options added by PP-14.10.
import { resolveNotificationsModuleOptions } from '../../src/notifications/notifications.options';

class Handles {
  async handleFor(): Promise<null> {
    return null;
  }
}

describe('resolveNotificationsModuleOptions (PP-14.10)', () => {
  it('defaults both new options to absent', () => {
    const resolved = resolveNotificationsModuleOptions({});
    expect(resolved.recipientHandles).toBeUndefined();
    expect(resolved.pushPayload).toBeUndefined();
  });

  it('accepts exactly one binding kind for the handle source', () => {
    expect(resolveNotificationsModuleOptions({ recipientHandles: { useClass: Handles } }).recipientHandles).toEqual({ useClass: Handles });
    expect(resolveNotificationsModuleOptions({ recipientHandles: { useExisting: 'TOKEN' } }).recipientHandles).toEqual({ useExisting: 'TOKEN' });
    expect(
      resolveNotificationsModuleOptions({ recipientHandles: { useFactory: () => new Handles(), inject: [] } }).recipientHandles,
    ).toBeDefined();
    expect(() => resolveNotificationsModuleOptions({ recipientHandles: {} as never })).toThrow(/recipientHandles needs exactly one/);
    expect(() =>
      resolveNotificationsModuleOptions({ recipientHandles: { useClass: Handles, useExisting: 'T' } as never }),
    ).toThrow(/recipientHandles needs exactly one/);
    expect(() => resolveNotificationsModuleOptions({ recipientHandles: null as never })).toThrow(/recipientHandles/);
  });

  it('accepts a push payload hook and refuses anything else', () => {
    const hook = () => ({ tag: 'x' });
    expect(resolveNotificationsModuleOptions({ pushPayload: hook }).pushPayload).toBe(hook);
    expect(() => resolveNotificationsModuleOptions({ pushPayload: 'tag' as never })).toThrow(/pushPayload must be a function/);
  });
});
