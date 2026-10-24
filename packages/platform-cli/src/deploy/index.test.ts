import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  detectComposeProject as detectFromEngine,
  isPathUnder as isPathUnderFromEngine,
  runCommand,
} from '../engine/index.js';
import {
  detectComposeProject,
  isPathUnder,
  type ComposeProjectCommandRunner,
  type ComposeProjectDetection,
} from './index.js';

// =============================================================================
// The `@marinoscar/platform-cli/deploy` surface for the compose project  (#1015)
// =============================================================================
//
// Apps used to carry their own copy of "which compose project do these
// containers belong to?"; the package now exports it. These pin what an app can
// import and that it is the engine's own function, not a second copy.
// =============================================================================

describe('@marinoscar/platform-cli/deploy: the compose project helpers', () => {
  it('exports detectComposeProject and isPathUnder as functions', () => {
    expect(typeof detectComposeProject).toBe('function');
    expect(typeof isPathUnder).toBe('function');
  });

  it('exports the engine functions themselves, not copies', () => {
    expect(detectComposeProject).toBe(detectFromEngine);
    expect(isPathUnder).toBe(isPathUnderFromEngine);
  });

  it('works through the subpath export as an app would call it', async () => {
    const run: ComposeProjectCommandRunner = async (argv) => ({
      stdout: argv[1] === 'ps' ? 'id0\n' : 'myapp|/opt/infra/apps/myapp/repo/infra/compose\n',
    });

    const detection: ComposeProjectDetection = await detectComposeProject('/opt/infra/apps/myapp', run);

    expect(detection).toEqual({ kind: 'found', project: 'myapp' });
    expect(isPathUnder('/opt/infra/apps/myapp/repo', '/opt/infra/apps/myapp')).toBe(true);
    expect(isPathUnder('/opt/infra/apps/myapp-2', '/opt/infra/apps/myapp')).toBe(false);
  });

  it('types ComposeProjectDetection as the four outcomes, discriminated by kind', () => {
    expectTypeOf<ComposeProjectDetection['kind']>().toEqualTypeOf<'found' | 'none' | 'ambiguous' | 'unavailable'>();
    expectTypeOf<Extract<ComposeProjectDetection, { kind: 'found' }>>().toEqualTypeOf<{ kind: 'found'; project: string }>();
    expectTypeOf<Extract<ComposeProjectDetection, { kind: 'ambiguous' }>>().toEqualTypeOf<{
      kind: 'ambiguous';
      projects: string[];
    }>();
  });

  it("types ComposeProjectCommandRunner so the engine's runCommand is assignable to it", () => {
    expectTypeOf(runCommand).toExtend<ComposeProjectCommandRunner>();
    expectTypeOf<ComposeProjectCommandRunner>().parameters.toEqualTypeOf<
      [argv: readonly string[], options: { cwd: string; timeoutMs?: number | undefined }]
    >();
  });
});
