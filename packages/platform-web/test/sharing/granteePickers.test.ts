import { describe, expect, it } from 'vitest';

import { GranteePickerRegistry, GranteePickerRegistryError } from '../../src/sharing/headless/index.js';

const Picker = () => null;
const Other = () => null;

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GranteePickerRegistryError);
    return (err as GranteePickerRegistryError).code;
  }
  return undefined;
}

describe('GranteePickerRegistry (PP-14.16)', () => {
  it('registers and looks up a picker per grantee kind, in registration order', () => {
    const registry = new GranteePickerRegistry();
    registry.register('team', Picker);
    registry.register('email-domain', Other);
    expect(registry.get('team')).toBe(Picker);
    expect(registry.get('email-domain')).toBe(Other);
    expect(registry.get('user')).toBeUndefined();
    expect(registry.kinds()).toEqual(['team', 'email-domain']);
  });

  it('refuses a duplicate id with DUPLICATE_ID and keeps the first picker', () => {
    const registry = new GranteePickerRegistry();
    registry.register('team', Picker);
    expect(codeOf(() => registry.register('team', Other))).toBe('DUPLICATE_ID');
    expect(registry.get('team')).toBe(Picker);
  });

  it('refuses an id that is not a grantee kind id with INVALID_ID', () => {
    const registry = new GranteePickerRegistry();
    for (const bad of ['Team', 'team_x', '', '1team', "x'; drop"]) expect(codeOf(() => registry.register(bad, Picker))).toBe('INVALID_ID');
    expect(registry.kinds()).toEqual([]);
  });

  it('refuses every registration once frozen, while reads keep working; freeze is idempotent', () => {
    const registry = new GranteePickerRegistry();
    registry.register('team', Picker);
    registry.freeze();
    registry.freeze();
    expect(registry.isFrozen()).toBe(true);
    expect(codeOf(() => registry.register('email-domain', Other))).toBe('FROZEN');
    expect(registry.get('team')).toBe(Picker);
  });
});
