import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { infraFile, PLATFORM_PACKAGE } from './index.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

describe('@marinoscar/platform-infra', () => {
  it('exports its package name', () => {
    expect(PLATFORM_PACKAGE).toBe('@marinoscar/platform-infra');
  });

  describe('infraFile()', () => {
    it('returns an absolute path inside the package', () => {
      const file = infraFile('compose/base.compose.yml');
      expect(isAbsolute(file)).toBe(true);
      expect(file).toBe(join(packageRoot, 'compose', 'base.compose.yml'));
      expect(existsSync(file)).toBe(true);
    });

    it('normalises a path that stays inside the package', () => {
      expect(infraFile('nginx/../otel/.gitkeep')).toBe(join(packageRoot, 'otel', '.gitkeep'));
    });

    it.each([
      '../escape.yml',
      'compose/../../escape.yml',
      '..',
      '../platform-api/package.json',
      'compose\\..\\..\\escape.yml',
    ])('rejects %s, which escapes the package root', (path) => {
      expect(() => infraFile(path)).toThrow(/outside @marinoscar\/platform-infra/);
    });

    it.each(['', '   ', '/etc/passwd', 'C:\\Windows\\win.ini', '.'])(
      'rejects %j, which is not a file path relative to the package',
      (path) => {
        expect(() => infraFile(path)).toThrow(/infraFile/);
      },
    );
  });
});
