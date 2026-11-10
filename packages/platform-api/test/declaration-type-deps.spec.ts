// Every module the PUBLISHED declarations import is one a consumer's npm
// installs, with its types (issue #865, found by the consumer smoke with
// `skipLibCheck` off: `identity/auth/strategies/*.d.ts` import `passport-jwt`
// and `passport-google-oauth20`, whose types live in `@types/*` packages that
// were only dev dependencies here).
//
// The declarations are emitted in memory with the build's own options, every
// bare specifier they import is resolved the way the consumer's compiler
// resolves it, and the package that answered must be declared:
//   - a package with its own types: in `dependencies` or `peerDependencies`;
//   - a `@types/x` package: in `dependencies` (the declarations need it
//     whenever they are read), or in `peerDependencies` next to an OPTIONAL
//     peer `x` (a testing entry an app uses only with that peer installed).
// `node:*` and `@types/node` are the consumer's runtime; the package itself
// and `@marinoscar/platform-contract` are its own.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as ts from 'typescript';

const PACKAGE_ROOT = join(__dirname, '..');

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Manifest;
const deps = manifest.dependencies ?? {};
const peers = manifest.peerDependencies ?? {};
const optionalPeer = (name: string) => peers[name] !== undefined && manifest.peerDependenciesMeta?.[name]?.optional === true;

const OWN = new Set([manifest.name, '@marinoscar/platform-contract', '@types/node']);

/** `@types/foo__bar` -> `@foo/bar`, `@types/pg` -> `pg`. */
const runtimeOf = (typesPackage: string) => {
  const bare = typesPackage.slice('@types/'.length);
  return bare.includes('__') ? `@${bare.replace('__', '/')}` : bare;
};

function emittedDeclarations(): Map<string, string> {
  const configPath = join(PACKAGE_ROOT, 'tsconfig.build.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PACKAGE_ROOT, undefined, configPath);
  const options = { ...parsed.options, declaration: true, emitDeclarationOnly: true, declarationMap: false, noEmit: false };
  const program = ts.createProgram({ rootNames: parsed.fileNames, options });
  const out = new Map<string, string>();
  const result = program.emit(undefined, (fileName, text) => out.set(fileName, text), undefined, true);
  expect(result.emitSkipped).toBe(false);
  return out;
}

/** The package (name) that provides each bare specifier the declarations import. */
function providers(declarations: Map<string, string>): Map<string, Set<string>> {
  const options: ts.CompilerOptions = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const from = join(PACKAGE_ROOT, 'dist', 'index.d.ts');
  const found = new Map<string, Set<string>>();
  for (const [file, text] of declarations) {
    const info = ts.preProcessFile(text, true, true);
    for (const { fileName: specifier } of info.importedFiles) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      const resolved = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule;
      const provider = resolved?.packageId?.name ?? `UNRESOLVED ${specifier}`;
      if (OWN.has(provider)) continue;
      const users = found.get(provider) ?? new Set<string>();
      users.add(`${file.slice(PACKAGE_ROOT.length + 1)} (${specifier})`);
      found.set(provider, users);
    }
  }
  return found;
}

describe('the published declarations\' type dependencies (#865)', () => {
  let found: Map<string, Set<string>>;

  beforeAll(() => {
    found = providers(emittedDeclarations());
  }, 240_000);

  it('finds the imports it checks (the scan is not vacuous)', () => {
    expect([...found.keys()]).toEqual(expect.arrayContaining(['zod', '@nestjs/common', '@types/passport-jwt']));
  });

  it('resolves every imported module, and declares the package that provides it', () => {
    const problems: string[] = [];
    for (const [provider, users] of found) {
      const where = [...users].slice(0, 2).join(', ');
      if (provider.startsWith('UNRESOLVED')) {
        problems.push(`${provider}: no types resolve (${where})`);
      } else if (provider.startsWith('@types/')) {
        const declared = deps[provider] !== undefined || (peers[provider] !== undefined && optionalPeer(runtimeOf(provider)));
        if (!declared) problems.push(`${provider}: needed by ${where}; add it to dependencies (or to peerDependencies beside an optional peer ${runtimeOf(provider)})`);
      } else if (deps[provider] === undefined && peers[provider] === undefined) {
        problems.push(`${provider}: needed by ${where}; add it to dependencies or peerDependencies`);
      }
    }
    expect(problems).toEqual([]);
  });

  // `@nestjs/passport`'s own declarations import `passport`, a peer that ships
  // no types: every consumer of the identity slice's declarations needs them.
  it('declares @types/passport for the passport peer', () => {
    expect(peers.passport).toBeDefined();
    expect(deps['@types/passport']).toBeDefined();
  });
});
