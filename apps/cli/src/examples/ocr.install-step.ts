import { ensureAptPackages, registerInstallStep } from '@marinoscar/platform-cli/node';

// =============================================================================
// EXAMPLE, NOT WIRED: a step for `node install-deps`  (RETRO-G2.4, #1074)
// =============================================================================
//
// `node install-deps` runs the platform's two steps (state directory, Node
// version) and then whatever the app registers. A step says whether it can run
// here (`supported`), whether it is already satisfied (`detect`, which also runs
// in `--dry-run`), and how to do it (`install`, which never runs in `--dry-run`).
//
//   - `requiresSudo: true` makes the plan announce the escalation before any
//     step runs; `ensureAptPackages` and `runWithSudoAnnounced` announce each
//     command again as it runs.
//   - `after` places the step right after another (here: the platform's own
//     state-directory step); `order` sorts among the app's steps.
//   - `node install-deps --only ocr-tools` runs just this step.
//
// The helpers take everything from the step: no package, image or URL is
// built into the platform. `ensureDockerContainer` follows the same shape for a
// sidecar container (create or start it, then poll a `verify` function).
//
// Not in `app.ts`, so `node install-deps` runs the platform's steps only. To use it:
//
//   registerOcrInstallStep();
// =============================================================================

/** The Debian packages the (invented) OCR tooling needs. */
export const OCR_PACKAGES = ['tesseract-ocr'] as const;

/** Registers the step. Call it once, at module scope, before the node command runs. */
export function registerOcrInstallStep(): void {
  registerInstallStep({
    id: 'ocr-tools',
    label: 'OCR tooling',
    requiresSudo: true,
    after: 'state-dir',
    supported: (context) => context.distro.family === 'debian',
    detect: async (context) => {
      try {
        await context.capture('tesseract', ['--version']);
        return true;
      } catch {
        return false;
      }
    },
    install: async (context) => {
      await ensureAptPackages(OCR_PACKAGES, context);
    },
  });
}
