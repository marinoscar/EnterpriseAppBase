import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import * as ts from 'typescript';
import { PLATFORM_PACKAGE } from '../src';

const PACKAGE_ROOT = join(__dirname, '..');

/**
 * The compiler options `npm run build` uses, read from tsconfig.build.json
 * exactly as tsc reads them (extends chain included).
 */
function buildCompilerOptions(): ts.CompilerOptions {
  const configPath = join(PACKAGE_ROOT, 'tsconfig.build.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PACKAGE_ROOT, undefined, configPath);
  return parsed.options;
}

/** A decorated provider with a constructor dependency, as every Nest slice has. */
const FIXTURE = `
import { Injectable } from '@nestjs/common';
export class Clock {}
@Injectable()
export class Greeter {
  constructor(public readonly clock: Clock) {}
}
`;

describe('@marinoscar/platform-api', () => {
  it('exports its package name', () => {
    expect(PLATFORM_PACKAGE).toBe('@marinoscar/platform-api');
  });

  it('is a CommonJS package with an explicit exports map', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    expect(manifest.type).toBe('commonjs');
    expect(manifest.exports).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './core': { types: './dist/core/index.d.ts', default: './dist/core/index.js' },
      './testing': { types: './dist/testing/index.d.ts', default: './dist/testing/index.js' },
      './doctor': { types: './dist/doctor/index.d.ts', default: './dist/doctor/index.js' },
      './otel-core': { types: './dist/otel-core/index.d.ts', default: './dist/otel-core/index.js' },
      './otel-core/sdk': { types: './dist/otel-core/sdk/index.d.ts', default: './dist/otel-core/sdk/index.js' },
      './telemetry': { types: './dist/telemetry/index.d.ts', default: './dist/telemetry/index.js' },
      './telemetry/testing': { types: './dist/telemetry/testing/index.d.ts', default: './dist/telemetry/testing/index.js' },
      './sharing': { types: './dist/sharing/index.d.ts', default: './dist/sharing/index.js' },
      './sharing/testing': { types: './dist/sharing/testing/index.d.ts', default: './dist/sharing/testing/index.js' },
      './identity': { types: './dist/identity/index.d.ts', default: './dist/identity/index.js' },
      './identity/testing': { types: './dist/identity/testing/index.d.ts', default: './dist/identity/testing/index.js' },
      './settings': { types: './dist/settings/index.d.ts', default: './dist/settings/index.js' },
      './settings/testing': { types: './dist/settings/testing/index.d.ts', default: './dist/settings/testing/index.js' },
      './credentials': { types: './dist/credentials/index.d.ts', default: './dist/credentials/index.js' },
      './credentials/testing': { types: './dist/credentials/testing/index.d.ts', default: './dist/credentials/testing/index.js' },
      './onboarding': { types: './dist/onboarding/index.d.ts', default: './dist/onboarding/index.js' },
      './onboarding/testing': { types: './dist/onboarding/testing/index.d.ts', default: './dist/onboarding/testing/index.js' },
      './email': { types: './dist/email/index.d.ts', default: './dist/email/index.js' },
      './email/testing': { types: './dist/email/testing/index.d.ts', default: './dist/email/testing/index.js' },
      './jobs': { types: './dist/jobs/index.d.ts', default: './dist/jobs/index.js' },
      './nodes': { types: './dist/nodes/index.d.ts', default: './dist/nodes/index.js' },
      './storage': { types: './dist/storage/index.d.ts', default: './dist/storage/index.js' },
      './storage/testing': { types: './dist/storage/testing/index.d.ts', default: './dist/storage/testing/index.js' },
      './notifications': { types: './dist/notifications/index.d.ts', default: './dist/notifications/index.js' },
      './notifications/testing': { types: './dist/notifications/testing/index.d.ts', default: './dist/notifications/testing/index.js' },
      './exports': { types: './dist/exports/index.d.ts', default: './dist/exports/index.js' },
      './exports/testing': { types: './dist/exports/testing/index.d.ts', default: './dist/exports/testing/index.js' },
      './ai': { types: './dist/ai/index.d.ts', default: './dist/ai/index.js' },
      './ai/testing': { types: './dist/ai/testing/index.d.ts', default: './dist/ai/testing/index.js' },
      './db-backup': { types: './dist/db-backup/index.d.ts', default: './dist/db-backup/index.js' },
      './db-backup/testing': { types: './dist/db-backup/testing/index.d.ts', default: './dist/db-backup/testing/index.js' },
      './android-app': { types: './dist/android-app/index.d.ts', default: './dist/android-app/index.js' },
      './android-app/testing': { types: './dist/android-app/testing/index.d.ts', default: './dist/android-app/testing/index.js' },
      './package.json': './package.json',
    });
  });

  describe('build output', () => {
    const options = buildCompilerOptions();

    it('keeps the decorator settings and the TSDoc comments', () => {
      expect(options.experimentalDecorators).toBe(true);
      expect(options.emitDecoratorMetadata).toBe(true);
      expect(options.removeComments).toBe(false);
    });

    it('emits design:paramtypes metadata as CommonJS, so Nest DI can resolve constructor parameters', () => {
      const { outputText } = ts.transpileModule(FIXTURE, {
        compilerOptions: options,
        fileName: join(PACKAGE_ROOT, 'src', 'greeter.ts'),
      });

      expect(outputText).toContain('__metadata("design:paramtypes"');
      expect(outputText).toContain('require("@nestjs/common")');
      expect(outputText).not.toMatch(/^import /m);

      // Load the emitted module and ask reflect-metadata, as Nest's injector does.
      const module = { exports: {} as Record<string, unknown> };
      const load = new Function('require', 'module', 'exports', outputText);
      load((id: string) => (id === '@nestjs/common' ? { Injectable } : require(id)), module, module.exports);
      const { Greeter, Clock } = module.exports as { Greeter: object; Clock: object };
      expect(Reflect.getMetadata('design:paramtypes', Greeter)).toEqual([Clock]);
    });
  });
});
