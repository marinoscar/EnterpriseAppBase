import { z } from 'zod';

import { describeConfigField, describeConfigFields } from '../../../src/core';
import { describeOrgFields } from '../../../src/settings/org-settings/describe-fields';

describe('describeConfigFields', () => {
  it('describes the five kinds with their bounds, in declaration order', () => {
    const fields = describeConfigFields(
      z.object({
        enabled: z.boolean(),
        mode: z.enum(['fast', 'safe']),
        retries: z.number().int().min(0).max(5),
        region: z.string().max(32),
        extra: z.array(z.string()),
      }),
    );

    expect(fields).toEqual([
      { name: 'enabled', kind: 'boolean', label: 'Enabled' },
      { name: 'mode', kind: 'enum', options: ['fast', 'safe'], label: 'Mode' },
      { name: 'retries', kind: 'number', min: 0, max: 5, integer: true, label: 'Retries' },
      { name: 'region', kind: 'string', maxLength: 32, label: 'Region' },
      { name: 'extra', kind: 'other', label: 'Extra' },
    ]);
    expect(fields.map((f) => f.name)).toEqual(['enabled', 'mode', 'retries', 'region', 'extra']);
  });

  it('unwraps optional, nullable and readonly, and omits unbounded limits', () => {
    expect(describeConfigField('a', z.string().optional())).toEqual({ name: 'a', kind: 'string', label: 'A' });
    expect(describeConfigField('b', z.number().nullable().optional())).toEqual({ name: 'b', kind: 'number', label: 'B' });
    expect(describeConfigField('c', z.boolean().readonly())).toEqual({ name: 'c', kind: 'boolean', label: 'C' });
  });

  it('humanises the field name when there is no label', () => {
    expect(describeConfigField('apiBaseUrl', z.string()).label).toBe('Api base url');
    expect(describeConfigField('max_retries', z.number()).label).toBe('Max retries');
    expect(describeConfigField('region-id', z.string()).label).toBe('Region id');
    expect(describeConfigField('x', z.string()).label).toBe('X');
  });

  it('takes the label from .meta({ label }) and the help from .describe(), on the field or any wrapper', () => {
    expect(describeConfigField('apiBaseUrl', z.string().meta({ label: 'API base URL' }))).toEqual({
      name: 'apiBaseUrl',
      kind: 'string',
      label: 'API base URL',
    });
    expect(describeConfigField('r', z.string().describe('Cloud region').optional())).toEqual({
      name: 'r',
      kind: 'string',
      label: 'R',
      help: 'Cloud region',
    });
    expect(describeConfigField('r', z.string().optional().describe('Outer help'))).toMatchObject({ help: 'Outer help' });
    expect(describeConfigField('r', z.string().meta({ label: 'Inner' }).optional())).toMatchObject({ label: 'Inner' });
  });

  it('never produces a secret field', () => {
    expect(describeConfigFields(z.object({ apiKey: z.string() })).map((f) => f.kind)).toEqual(['string']);
  });
});

describe('describeOrgFields (the org settings wire shape, unchanged by the generalisation)', () => {
  it('carries neither label nor help, and keeps the key order of the original description', () => {
    const fields = describeOrgFields(
      z.object({
        enabled: z.boolean().describe('Turns it on'),
        mode: z.enum(['a', 'b']),
        retries: z.number().int().min(1).max(9),
        name: z.string().max(10),
        nested: z.object({ x: z.string() }).optional(),
      }),
    );

    expect(fields).toEqual([
      { name: 'enabled', kind: 'boolean' },
      { name: 'mode', kind: 'enum', options: ['a', 'b'] },
      { name: 'retries', kind: 'number', min: 1, max: 9, integer: true },
      { name: 'name', kind: 'string', maxLength: 10 },
      { name: 'nested', kind: 'other' },
    ]);
    expect(JSON.stringify(fields)).toBe(
      '[{"name":"enabled","kind":"boolean"},{"name":"mode","kind":"enum","options":["a","b"]},' +
        '{"name":"retries","kind":"number","min":1,"max":9,"integer":true},{"name":"name","kind":"string","maxLength":10},' +
        '{"name":"nested","kind":"other"}]',
    );
  });
});
