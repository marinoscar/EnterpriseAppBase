import { afterEach, describe, expect, it } from 'vitest';

import {
  freezeEnvGroupRegistry,
  getEnvGroup,
  listEnvGroups,
  registerEnvGroup,
  resetEnvGroupRegistryForTests,
} from './env-group-registry.js';

afterEach(() => resetEnvGroupRegistryForTests());

const coach = { id: 'coach', label: 'Coach', description: 'The coaching assistant.', defaultEnabled: false };

describe('registerEnvGroup', () => {
  it('lists groups in registration order and finds one by id', () => {
    registerEnvGroup(coach);
    registerEnvGroup({ ...coach, id: 'billing' });
    expect(listEnvGroups().map((group) => group.id)).toEqual(['coach', 'billing']);
    expect(getEnvGroup('coach')).toMatchObject({ label: 'Coach', defaultEnabled: false });
    expect(getEnvGroup('missing')).toBeUndefined();
  });

  it('refuses a duplicate id', () => {
    registerEnvGroup(coach);
    expect(() => registerEnvGroup(coach)).toThrow('The env group "coach" is already registered');
  });

  it.each(['Coach', 'has space', '1abc', '', 'a_b'])('refuses the id %j', (id) => {
    expect(() => registerEnvGroup({ ...coach, id })).toThrow(/invalid|non-empty/);
  });

  it('refuses a group without a label or a defaultEnabled flag', () => {
    expect(() => registerEnvGroup({ ...coach, label: ' ' })).toThrow(/needs a label/);
    expect(() => registerEnvGroup({ ...coach, defaultEnabled: undefined as unknown as boolean })).toThrow(/defaultEnabled/);
  });

  it('refuses a registration after the CLI is built', () => {
    freezeEnvGroupRegistry('createCli built the CLI');
    expect(() => registerEnvGroup(coach)).toThrow(/after createCli built the CLI/);
  });
});
