// The unified "saved secret" sentence and the blank-keeps submit rule (#735).
import { describe, expect, it } from 'vitest';

import { savedSecretHelperText, secretForSubmit } from '../../src/credentials/headless/index.js';

const fixedDate = (d: Date) => d.toISOString().slice(0, 10);

describe('savedSecretHelperText', () => {
  it('names the hint and the date when a secret is saved, and says blank keeps it', () => {
    expect(savedSecretHelperText({ hint: '••••abcd', updatedAt: '2026-10-08T12:00:00Z' }, { formatDate: fixedDate })).toBe(
      'A key is saved (••••abcd), updated 2026-10-08. Leave this blank to keep it, or type a new one to replace it.',
    );
  });

  it('still reads without a hint or a date, and takes a Date', () => {
    expect(savedSecretHelperText({ hint: null })).toBe('A key is saved. Leave this blank to keep it, or type a new one to replace it.');
    expect(savedSecretHelperText({ hint: '••••', updatedAt: new Date('2026-01-02T00:00:00Z') }, { formatDate: fixedDate })).toBe(
      'A key is saved (••••), updated 2026-01-02. Leave this blank to keep it, or type a new one to replace it.',
    );
    expect(savedSecretHelperText({ hint: '••••abcd', updatedAt: 'not a date' })).toBe(
      'A key is saved (••••abcd). Leave this blank to keep it, or type a new one to replace it.',
    );
  });

  it('uses the noun, with the right article', () => {
    expect(savedSecretHelperText({ hint: null }, { noun: 'secret access key' })).toMatch(/^A secret access key is saved\./);
    expect(savedSecretHelperText({ hint: null }, { noun: 'access key' })).toMatch(/^An access key is saved\./);
  });

  it('says nothing is saved when there is no secret, or uses emptyHelp', () => {
    expect(savedSecretHelperText(null)).toBe('No key is saved yet.');
    expect(savedSecretHelperText(undefined, { noun: 'password' })).toBe('No password is saved yet.');
    expect(savedSecretHelperText(null, { emptyHelp: 'Storage cannot work without one.' })).toBe('Storage cannot work without one.');
  });
});

describe('secretForSubmit', () => {
  it('sends nothing for a blank field (the API keeps the stored secret) and the exact bytes otherwise', () => {
    expect(secretForSubmit('')).toBeUndefined();
    expect(secretForSubmit('  spaced  ')).toBe('  spaced  ');
    expect(secretForSubmit('new-secret')).toBe('new-secret');
  });
});
