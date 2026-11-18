import {
  httpServiceCapability,
  moduleCapability,
  registerCapabilityProbe,
  registerJobRequirement,
} from '@marinoscar/platform-cli/node';

// =============================================================================
// EXAMPLE, NOT WIRED: capabilities that are not binaries  (RETRO-G2.4, #1074)
// =============================================================================
//
// `transcode.executor.ts` shows a requirement on an executable (`binary:ffmpeg`).
// A worker can also be unable to work because of something `which` cannot see,
// and the platform probes two more kinds, both declared by the app:
//
//   module:<name>   an npm package, found with `require.resolve` (never
//                   imported, so a native package that would crash on load is
//                   safe to probe). Add an `operational` check to separate
//                   "installed" from "works": the node then reports the
//                   package as installed-but-not-operational, which still
//                   blocks a REQUIRED capability (and only warns a degradable).
//
//   service:<id>    a sidecar that answers HTTP. Its URL comes from an env var
//                   NAME, read at probe time, so the same image points at a
//                   different sidecar per deployment. The probe is bounded (3 s)
//                   and a timeout means "missing".
//
// `registerJobRequirement` then accepts the keys like any other: a node on a
// machine without the OCR sidecar refuses to claim `example.ocr` (the startup
// self-test names the key and says which of installed / missing it is), and
// `node doctor` lists both with their state. The keys and their results ride the
// heartbeat capability summary to the fleet page.
//
// Not in `app.ts`, so the worker claims exactly the platform's types. To use it:
//
//   declareOcrRequirements({ loadImageLibrary: async () => (await import('sharp')).default });
//   nodeExecutors: [new OcrExecutor()],   // your executor for 'example.ocr'
// =============================================================================

/** The environment variable that holds the OCR sidecar's base URL. */
export const OCR_SERVICE_URL_ENV = 'EXAMPLE_OCR_URL';

/** The job type these requirements protect. */
export const OCR_JOB_TYPE = 'example.ocr';

/**
 * Declares what `example.ocr` needs. Call it once, at module scope, before the
 * node starts.
 *
 * @param options - `imageModule` names the npm package (default `sharp`);
 *   `loadImageLibrary` proves the module WORKS (load it, run a
 *   tiny operation); without it a resolvable module counts as available.
 */
export function declareOcrRequirements(options: { imageModule?: string; loadImageLibrary?: () => Promise<unknown> } = {}): void {
  const imageModule = options.imageModule ?? 'sharp';
  registerCapabilityProbe(
    moduleCapability(imageModule, {
      label: 'Image library',
      ...(options.loadImageLibrary !== undefined
        ? {
            operational: async () => {
              await options.loadImageLibrary?.();
            },
          }
        : {}),
    }),
  );
  registerCapabilityProbe(httpServiceCapability({ id: 'ocr', label: 'OCR sidecar', env: OCR_SERVICE_URL_ENV, path: '/status' }));

  registerJobRequirement(OCR_JOB_TYPE, {
    // Without the sidecar nothing can be recognised: do not claim the type.
    required: ['service:ocr'],
    // Without the image library the work still runs, on the original pixels.
    degradable: [`module:${imageModule}`],
  });
}
