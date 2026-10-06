import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLATFORM_PACKAGE } from './index.js';

describe('@marinoscar/platform-db', () => {
  it('exports its package name', () => {
    expect(PLATFORM_PACKAGE).toBe('@marinoscar/platform-db');
  });

  it('ships the schema/ and migrations/ asset directories', () => {
    for (const dir of ['schema', 'migrations']) {
      expect(existsSync(join(__dirname, '..', dir))).toBe(true);
    }
  });
});
