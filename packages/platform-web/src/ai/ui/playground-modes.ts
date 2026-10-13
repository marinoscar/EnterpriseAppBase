// `@marinoscar/platform-web/ai/ui/playground-modes`: the AI Playground's mode
// registry (PP-14.17, issue #935), alone, so an app registers a mode from its
// main chunk without pulling the playground page in. Also exported by `/ai/ui`.
// Documented in ../README.md.

export { registerAiPlaygroundMode, getAiPlaygroundMode, listAiPlaygroundModes } from './playground/aiPlaygroundModes.js';
export type {
  AiPlaygroundMode,
  AiPlaygroundModeDefinition,
  AiPlaygroundModeId,
  AiPlaygroundPanelProps,
} from './playground/aiPlaygroundModes.js';
