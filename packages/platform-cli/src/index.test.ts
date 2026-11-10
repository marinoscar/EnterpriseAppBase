import { describe, expect, it } from 'vitest';
import { PLATFORM_PACKAGE } from './index.js';

describe('@marinoscar/platform-cli', () => {
  it('exports its package name', () => {
    expect(PLATFORM_PACKAGE).toBe('@marinoscar/platform-cli');
  });
});
