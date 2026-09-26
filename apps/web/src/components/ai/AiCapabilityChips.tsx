/**
 * A model's capabilities as a row of small chips — issue #434, epic #419.
 *
 * Shared by every AI surface that lists models. Capability strings are the
 * permanent `AI_CAPABILITIES` values from the API (`responses`, `reasoning`,
 * `structured_output`, …); unknown ones render as themselves so a capability
 * added server-side shows up instead of vanishing.
 */
import { Box, Chip } from '@mui/material';

const LABELS: Record<string, string> = {
  responses: 'Text',
  text: 'Text',
  reasoning: 'Reasoning',
  tools: 'Tools',
  function_tools: 'Tools',
  hosted_tools: 'Hosted tools',
  structured_output: 'Structured output',
  streaming: 'Streaming',
  vision_input: 'Vision',
  vision: 'Vision',
  file_input: 'Files',
  image_generation: 'Image generation',
  image_edit: 'Image editing',
  audio_transcription: 'Transcription',
  audio_speech: 'Speech',
  embeddings: 'Embeddings',
  realtime: 'Realtime',
};

export function aiCapabilityLabel(capability: string): string {
  return LABELS[capability] ?? capability;
}

export interface AiCapabilityChipsProps {
  capabilities: string[];
  size?: 'small' | 'medium';
}

export function AiCapabilityChips({ capabilities, size = 'small' }: AiCapabilityChipsProps) {
  // `responses` and the legacy `text` both read "Text" — don't show it twice.
  const labels = Array.from(new Set(capabilities.map(aiCapabilityLabel)));
  if (labels.length === 0) return null;
  return (
    <Box
      component="ul"
      aria-label="Capabilities"
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, listStyle: 'none', p: 0, m: 0 }}
    >
      {labels.map((label) => (
        <Box component="li" key={label}>
          <Chip label={label} size={size} variant="outlined" />
        </Box>
      ))}
    </Box>
  );
}

export default AiCapabilityChips;
