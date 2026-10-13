/**
 * Reference example (PP-14.17, issue #935): an app adds a mode to the AI
 * Playground with `registerAiPlaygroundMode`, with no package edit.
 *
 * The API side registered a capability (`speaker_diarization`) and an operation
 * (`audio.diarize`) and the example provider implements them
 * (`apps/api/src/platform-extensions/ai/example-transcribe/`). This mode lists
 * the models that declare the capability and reuses the packaged Transcribe
 * panel with one provider option, `diarize: true`, so the transcript comes back
 * with speaker-labelled segments (`output.extras.segments`), which the packaged
 * transcript view draws.
 *
 * Wire it with one call where the app starts (`main.tsx`):
 * `registerDiarizePlaygroundMode()`. The reference app does not: it ships
 * compiled and tested, like the other web examples, so the template's
 * Playground keeps its six modes until a fork opts in.
 *
 * The panel is loaded lazily, so registering the mode from the main chunk does
 * not pull the playground in.
 */
import { lazy, Suspense } from 'react';
import { registerAiPlaygroundMode } from '@marinoscar/platform-web/ai/ui/playground-modes';
import type { AiPlaygroundPanelProps } from '@marinoscar/platform-web/ai/ui/playground-modes';

const AiTranscribeMode = lazy(() =>
  import('@marinoscar/platform-web/ai/ui/playground-page').then((module) => ({ default: module.AiTranscribeMode })),
);

/** The mode's id (the switch's `data-mode`, the panel's `playground-mode-<id>` test id). */
export const DIARIZE_MODE_ID = 'diarize';

/** The provider option the example provider reads; keyed by provider id, ignored by every other provider. */
const PROVIDER_OPTIONS = { 'example-transcribe': { diarize: true } };

/** The Transcribe panel with speaker labels switched on. */
export function DiarizePanel(props: AiPlaygroundPanelProps) {
  return (
    <Suspense fallback={null}>
      <AiTranscribeMode {...props} providerOptions={PROVIDER_OPTIONS} />
    </Suspense>
  );
}

/** Adds the Diarize mode to the Playground. Call it once, at module scope, before the page renders. */
export function registerDiarizePlaygroundMode(): void {
  registerAiPlaygroundMode({
    id: DIARIZE_MODE_ID,
    label: 'Diarize',
    // The API operation this mode exercises, and the capability a model needs to be listed here.
    operation: 'audio.diarize',
    capability: 'speaker_diarization',
    unavailableReason: 'None of the models available to you can tell speakers apart',
    Panel: DiarizePanel,
  });
}
