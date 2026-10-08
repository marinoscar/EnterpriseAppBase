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
      './identity': { types: './dist/identity/index.d.ts', default: './dist/identity/index.js' },
      './identity/testing': { types: './dist/identity/testing/index.d.ts', default: './dist/identity/testing/index.js' },
      './settings': { types: './dist/settings/index.d.ts', default: './dist/settings/index.js' },
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
