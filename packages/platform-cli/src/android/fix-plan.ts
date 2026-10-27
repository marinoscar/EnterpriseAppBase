// =============================================================================
// What `android doctor --fix` would do (#746; MemoriaHub's fix-plan.ts, merged)
// =============================================================================
//
// MemoriaHub printed the plan before running it, and offered a `--dry-run`
// that executes nothing at all; EvoPath ran the SDK install directly. The
// merge keeps the plan (always printed, `--dry-run` stops there) over
// EvoPath's installer. Stricter than both: the JDK is NEVER installed by the
// CLI (no `sudo apt-get`); the plan prints the hint instead. The keystore is
// never created by `--fix` either: it is the app's identity forever.
// =============================================================================

import { cliName } from '../engine/index.js';
import { sdkFixesNeeded, type AndroidDoctorReport } from './doctor.js';
import { REQUIRED_SDK_PACKAGES } from './installer.js';
import { jdkInstallHint } from './java.js';
import { cmdlineToolsUrl, sdkLayout } from './sdk.js';

/** One kind of fix step. */
export type FixStepKind = 'jdk-manual' | 'cmdline-tools' | 'licenses' | 'sdk-packages' | 'keystore-manual';

/** One step of the plan. */
export interface FixStep {
  /** What it is. */
  kind: FixStepKind;
  /** One line for the printed plan. */
  title: string;
  /** What would run (or, for a manual step, what to do). */
  commands: string[];
  /** Printed advice only; never executed. */
  manual: boolean;
}

/** The whole plan. */
export interface FixPlan {
  /** Where the SDK is (or would be installed). */
  sdkRoot: string;
  /** The steps, in order. */
  steps: FixStep[];
}

function failedCheck(report: AndroidDoctorReport, id: string): boolean {
  return report.checks.some((check) => check.id === id && check.status === 'fail');
}

/**
 * The plan for a doctor report.
 *
 * @param report - the doctor's report.
 * @param platform - the OS (default this process's).
 * @returns the plan; empty when nothing is fixable.
 */
export function buildFixPlan(report: AndroidDoctorReport, platform: NodeJS.Platform = process.platform): FixPlan {
  const steps: FixStep[] = [];
  if (failedCheck(report, 'jdk')) {
    steps.push({ kind: 'jdk-manual', title: 'Install a JDK 17 or newer yourself (never automated)', commands: [jdkInstallHint(platform)], manual: true });
  }
  const sdkRoot = report.sdk.root;
  const layout = sdkLayout(sdkRoot, platform);
  const needs = sdkFixesNeeded(report);
  if (needs.cmdlineTools) {
    steps.push({ kind: 'cmdline-tools', title: `Download the Android command-line tools into ${layout.cmdlineToolsDir}`, commands: [cmdlineToolsUrl(platform)], manual: false });
  }
  if (needs.licenses) {
    steps.push({ kind: 'licenses', title: 'Accept the Android SDK licences', commands: [`${layout.sdkmanager} --licenses`], manual: false });
  }
  if (needs.packages) {
    steps.push({
      kind: 'sdk-packages',
      title: `Install ${REQUIRED_SDK_PACKAGES.join(', ')}`,
      commands: [`${layout.sdkmanager} --sdk_root=${sdkRoot} ${REQUIRED_SDK_PACKAGES.join(' ')}`],
      manual: false,
    });
  }
  const keystore = report.checks.find((check) => check.id === 'keystore');
  if (keystore !== undefined && keystore.status !== 'pass') {
    steps.push({
      kind: 'keystore-manual',
      title: 'Create or import the release keystore yourself (never automatic)',
      commands: [`${cliName()} android keystore init`, `${cliName()} android keystore import <file>`],
      manual: true,
    });
  }
  return { sdkRoot, steps };
}

/**
 * The steps `--fix` actually executes.
 *
 * @param plan - the plan.
 * @returns the non-manual steps.
 */
export function executableSteps(plan: FixPlan): FixStep[] {
  return plan.steps.filter((step) => !step.manual);
}

/**
 * The plan as text (stderr).
 *
 * @param plan - the plan.
 * @returns the printed plan.
 */
export function formatFixPlan(plan: FixPlan): string {
  if (plan.steps.length === 0) return 'Nothing to fix.\n';
  const lines = ['Plan:'];
  plan.steps.forEach((step, index) => {
    lines.push(`  ${index + 1}. ${step.manual ? '[manual] ' : ''}${step.title}`);
    for (const command of step.commands) lines.push(`       ${step.manual ? '→' : '$'} ${command}`);
  });
  return `${lines.join('\n')}\n`;
}
