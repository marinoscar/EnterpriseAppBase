// The pluggable-kind wire shapes (PP-14.5, issue #923): the field union a
// generated configuration form renders, including the write-only `secret`
// kind, and the descriptor of one implementation.
import { describe, expect, it } from 'vitest';

import {
  CONFIG_FIELD_KINDS,
  ORG_SETTINGS_FIELD_KINDS,
  PLUGGABLE_ID_PATTERN,
  configFieldSchema,
  orgSettingsFieldSchema,
  pluggableDescriptorSchema,
} from '../../src/settings/index.js';

describe('configFieldSchema', () => {
  it('lists the org settings kinds plus the write-only secret kind', () => {
    expect([...CONFIG_FIELD_KINDS]).toEqual([...ORG_SETTINGS_FIELD_KINDS, 'secret']);
  });

  it.each([
    [{ name: 'on', label: 'On', kind: 'boolean' }],
    [{ name: 'mode', label: 'Mode', kind: 'enum', options: ['a', 'b'], help: 'Pick one' }],
    [{ name: 'n', label: 'N', kind: 'number', min: 1, max: 9, integer: true }],
    [{ name: 's', label: 'S', kind: 'string', maxLength: 40 }],
    [{ name: 'o', label: 'O', kind: 'other' }],
    [{ name: 'apiKey', label: 'API key', kind: 'secret', hasValue: false, required: true }],
  ])('accepts a %j field', (field) => {
    expect(configFieldSchema.parse(field)).toEqual(field);
  });

  it('requires a label on every kind', () => {
    expect(configFieldSchema.safeParse({ name: 'on', kind: 'boolean' }).success).toBe(false);
  });

  it('requires the options of an enum and the presence flags of a secret', () => {
    expect(configFieldSchema.safeParse({ name: 'm', label: 'M', kind: 'enum' }).success).toBe(false);
    expect(configFieldSchema.safeParse({ name: 'k', label: 'K', kind: 'secret' }).success).toBe(false);
    expect(configFieldSchema.safeParse({ name: 'k', label: 'K', kind: 'secret', hasValue: true }).success).toBe(false);
  });

  it('refuses an unknown kind', () => {
    expect(configFieldSchema.safeParse({ name: 'x', label: 'X', kind: 'color' }).success).toBe(false);
  });

  it('never carries a secret value: a value on a secret field is stripped', () => {
    const parsed = configFieldSchema.parse({
      name: 'apiKey',
      label: 'API key',
      kind: 'secret',
      hasValue: true,
      required: false,
      value: 'sk-live-123',
    });
    expect(parsed).not.toHaveProperty('value');
    expect(JSON.stringify(parsed)).not.toContain('sk-live-123');
  });

  it('leaves orgSettingsFieldSchema as it was: no label, no secret kind', () => {
    expect(orgSettingsFieldSchema.safeParse({ name: 'x', kind: 'secret' }).success).toBe(false);
    expect(orgSettingsFieldSchema.parse({ name: 'x', kind: 'boolean' })).toEqual({ name: 'x', kind: 'boolean' });
  });
});

describe('pluggableDescriptorSchema', () => {
  const descriptor = {
    kind: 'greeter',
    id: 'signed',
    label: 'Signed greeter',
    description: 'Greets with a signature',
    fields: [
      { name: 'prefix', label: 'Prefix', kind: 'string' },
      { name: 'apiKey', label: 'API key', kind: 'secret', hasValue: true, required: true },
    ],
  };

  it('accepts a descriptor with its fields', () => {
    expect(pluggableDescriptorSchema.parse(descriptor)).toEqual(descriptor);
  });

  it('makes the description optional and the fields mandatory', () => {
    const { description: _description, ...bare } = descriptor;
    expect(pluggableDescriptorSchema.safeParse(bare).success).toBe(true);
    expect(pluggableDescriptorSchema.safeParse({ ...descriptor, fields: undefined }).success).toBe(false);
  });

  it('rejects an invalid field inside', () => {
    expect(pluggableDescriptorSchema.safeParse({ ...descriptor, fields: [{ name: 'x', kind: 'boolean' }] }).success).toBe(false);
  });
});

describe('PLUGGABLE_ID_PATTERN', () => {
  it.each(['openai', 'azure-blob', 'ai', 'a1', 'x'.repeat(48)])('accepts %s', (id) => {
    expect(PLUGGABLE_ID_PATTERN.test(id)).toBe(true);
  });

  it.each(['a', '1abc', 'Upper', 'under_score', '-lead', 'x'.repeat(49), ''])('rejects %j', (id) => {
    expect(PLUGGABLE_ID_PATTERN.test(id)).toBe(false);
  });
});
