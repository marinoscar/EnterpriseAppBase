/**
 * The AI Playground's own six modes, registered through the same function an
 * app uses (`registerAiPlaygroundMode`; PP-14.17, #935) — no private fast path.
 *
 * Imported for its side effect by the playground page. Kept apart from the
 * registry (`aiPlaygroundModes.ts`) because it imports the panels: an app that
 * only registers its own mode must not drag them in.
 *
 * Chat is the one mode whose work area is not a `Panel` of its own: its state
 * (the thread, the stream, the attachments, the hosted tools) lives on the page
 * and the page renders it inline, so its registered `Panel` renders nothing.
 */
import { AiEmbeddingsMode } from './AiEmbeddingsMode.js';
import { AiImageMode } from './AiImageMode.js';
import { AiSpeechMode } from './AiSpeechMode.js';
import { AiTranscribeMode } from './AiTranscribeMode.js';
import { AiVoiceMode } from './AiVoiceMode.js';
import { registerBuiltinAiPlaygroundMode } from './aiPlaygroundModes.js';

/** Chat's panel is drawn by the page itself (see the file header). */
function ChatModeDrawnByThePage(): null {
  return null;
}

registerBuiltinAiPlaygroundMode({
  id: 'chat',
  label: 'Chat',
  operation: 'responses',
  capability: 'responses',
  unavailableReason: 'None of the models available to you can answer text prompts',
  Panel: ChatModeDrawnByThePage,
});
registerBuiltinAiPlaygroundMode({
  id: 'image',
  label: 'Image',
  operation: 'images',
  capability: 'image_generation',
  unavailableReason: 'None of the models available to you can generate images',
  Panel: AiImageMode,
});
registerBuiltinAiPlaygroundMode({
  id: 'transcribe',
  label: 'Transcribe',
  operation: 'audio.transcribe',
  capability: 'audio_transcription',
  unavailableReason: 'None of the models available to you can transcribe audio',
  Panel: AiTranscribeMode,
});
registerBuiltinAiPlaygroundMode({
  id: 'speech',
  label: 'Speech',
  operation: 'audio.speech',
  capability: 'audio_speech',
  unavailableReason: 'None of the models available to you can generate speech',
  Panel: AiSpeechMode,
});
registerBuiltinAiPlaygroundMode({
  id: 'embeddings',
  label: 'Embeddings',
  operation: 'embeddings',
  capability: 'embeddings',
  unavailableReason: 'None of the models available to you can create embeddings',
  Panel: AiEmbeddingsMode,
});
registerBuiltinAiPlaygroundMode({
  // #449. Also HIDDEN (not merely disabled) unless `GET /ai/config`
  // says `allowRealtime: true`: see `hiddenPlaygroundModes`.
  id: 'voice',
  label: 'Voice',
  operation: 'realtime',
  capability: 'realtime',
  unavailableReason: 'None of the models available to you can hold a voice conversation',
  Panel: AiVoiceMode,
});
