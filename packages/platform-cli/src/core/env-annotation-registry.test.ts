import { afterEach, describe, expect, it } from 'vitest';

import {
  annotateEnvKey,
  freezeEnvAnnotationRegistry,
  getEnvAnnotation,
  listEnvAnnotations,
  resetEnvAnnotationRegistryForTests,
} from './env-annotation-registry.js';

afterEach(() => resetEnvAnnotationRegistryForTests());

describe('annotateEnvKey', () => {
  it('stores fixed and help for a key, in registration order', () => {
    annotateEnvKey('OTEL_SERVICE_NAME', { fixed: 'coach-api' });
    annotateEnvKey('EMAIL_FROM', { help: 'Where reminders come from.' });
    expect(getEnvAnnotation('OTEL_SERVICE_NAME')).toEqual({ fixed: 'coach-api' });
    expect(listEnvAnnotations().map((entry) => entry.key)).toEqual(['OTEL_SERVICE_NAME', 'EMAIL_FROM']);
    expect(getEnvAnnotation('OTHER')).toBeUndefined();
  });

  it('refuses a second annotation of the same key', () => {
    annotateEnvKey('A', { help: 'x' });
    expect(() => annotateEnvKey('A', { help: 'y' })).toThrow(/already registered/);
  });

  it.each([
    ['a bad key', 'A B', { help: 'x' }],
    ['an empty annotation', 'A', {}],
    ['a multi-line fixed value', 'A', { fixed: 'a\nB=2' }],
    ['a NUL in fixed', 'A', { fixed: 'a\u0000' }],
    ['an escape sequence in help', 'A', { help: '\u001b[31mred' }],
    ['an over-long help', 'A', { help: 'x'.repeat(2001) }],
  ])('refuses %s', (_label, key, annotation) => {
    expect(() => annotateEnvKey(key, annotation)).toThrow();
  });

  it('refuses a late registration', () => {
    freezeEnvAnnotationRegistry('createCli built the CLI');
    expect(() => annotateEnvKey('A', { help: 'x' })).toThrow(/after createCli built the CLI/);
  });
});
