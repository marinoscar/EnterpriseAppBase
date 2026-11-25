import { registerModelArtifact } from '@marinoscar/platform-cli/node';

// =============================================================================
// EXAMPLE, NOT WIRED: a model file the worker needs  (RETRO-G2.4, #1074)
// =============================================================================
//
// A worker that recognises text needs language data on disk. The app declares the
// file; the platform downloads it (`node models pull`, or the `models` step of
// `node install-deps`), verifies its size and sha256, and keeps it in
// `<state dir>/models` (or `<PREFIX>MODELS_DIR`, which a container image that
// bakes the data points at: a valid file already there is simply left alone).
//
//   - `requiredBy`: the job types that cannot run without it. While the file is
//     missing or corrupt the node does NOT advertise them, `node doctor` says
//     which file and which types, and `node models pull` fixes it. A restart
//     picks the fix up.
//   - `targetSubdir`: where under the models directory the library expects it.
//   - `url` is static and declared HERE, in the app: fleet agreement on the
//     model version comes from the app release, not from a server round trip.
//     A signed or versioned URL uses `resolveUrl` instead; either way only the
//     origin and path are ever logged.
//
// Not in `app.ts`, so the worker has no model requirement. To use it:
//
//   declareOcrModel();
// =============================================================================

/** The sha256 and size of the (invented) language data file. */
export const OCR_MODEL = {
  fileName: 'eng.traineddata',
  // A placeholder digest: replace both with the real file's values.
  sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  bytes: 4_113_088,
} as const;

/**
 * Declares the OCR language data. Call it once, at module scope, before the node
 * starts.
 *
 * @param url - where to fetch it (a static URL on a host you control).
 */
export function declareOcrModel(url = 'https://models.example.test/ocr/eng.traineddata'): void {
  registerModelArtifact({
    id: 'ocr-eng',
    fileName: OCR_MODEL.fileName,
    sha256: OCR_MODEL.sha256,
    bytes: OCR_MODEL.bytes,
    url,
    targetSubdir: 'tessdata',
    requiredBy: ['example.ocr'],
  });
}
