// The `android doctor --fix` plan (#746; ported from MemoriaHub's
// fix-plan.spec.ts onto the merged doctor): printed first, manual steps for
// the JDK and the keystore, the SDK steps only for what is missing.
import { describe, expect, it } from 'vitest';

import type { AndroidCheck, AndroidCheckId, AndroidDoctorReport } from './doctor.js';
import { buildFixPlan, executableSteps, formatFixPlan } from './fix-plan.js';

function report(failing: AndroidCheckId[]): AndroidDoctorReport {
  const ids: AndroidCheckId[] = ['repo', 'gradlew', 'version', 'jdk', 'sdk', 'cmdline-tools', 'platform', 'build-tools', 'licenses', 'keystore'];
  const checks: AndroidCheck[] = ids.map((id) => ({ id, label: id, status: failing.includes(id) ? 'fail' : 'pass', detail: '' }));
  return { checks, ok: failing.length === 0, sdk: { root: '/sdk', source: 'managed' } as AndroidDoctorReport['sdk'], repoRoot: '/repo' };
}

describe('doctor --fix plan', () => {
  it('only prints instructions for the JDK (never executed: the CLI runs no sudo)', () => {
    const plan = buildFixPlan(report(['jdk']), 'linux');
    expect(plan.steps).toEqual([expect.objectContaining({ kind: 'jdk-manual', manual: true })]);
    expect(executableSteps(plan)).toEqual([]);
    expect(formatFixPlan(plan)).toContain('[manual]');
  });

  it('downloads cmdline-tools, accepts licences and installs the packages when there is no SDK', () => {
    const plan = buildFixPlan(report(['sdk']), 'linux');
    expect(plan.steps.map((step) => step.kind)).toEqual(['cmdline-tools', 'licenses', 'sdk-packages']);
    expect(plan.steps[0]?.commands[0]).toMatch(/^https:\/\/dl\.google\.com\/android\/repository\/commandlinetools-linux-\d+_latest\.zip$/);
    expect(plan.steps[2]?.commands[0]).toContain('platform-tools');
  });

  it('plans only the missing packages when the SDK exists', () => {
    expect(buildFixPlan(report(['build-tools']), 'linux').steps.map((step) => step.kind)).toEqual(['sdk-packages']);
    expect(buildFixPlan(report(['licenses']), 'linux').steps.map((step) => step.kind)).toEqual(['licenses']);
  });

  it('never plans a keystore: it points to `keystore init` as a manual step', () => {
    const plan = buildFixPlan(report(['keystore']), 'linux');
    expect(plan.steps).toEqual([expect.objectContaining({ kind: 'keystore-manual', manual: true })]);
    expect(formatFixPlan(plan)).toContain('[manual]');
    expect(formatFixPlan(plan)).toContain('appctl android keystore init');
    expect(executableSteps(plan)).toEqual([]);
  });

  it('plans nothing on a healthy machine', () => {
    const plan = buildFixPlan(report([]), 'linux');
    expect(plan.steps).toEqual([]);
    expect(formatFixPlan(plan)).toBe('Nothing to fix.\n');
  });
});
