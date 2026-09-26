/**
 * A model's capabilities as a handful of GROUPED chips — issue #429.
 *
 * The API's vocabulary (`AI_CAPABILITIES` in
 * `apps/api/src/ai/core/capabilities.ts`) has fourteen fine-grained entries;
 * fourteen chips per row would make the catalogue unreadable. They are folded
 * into nine families (Text / Reasoning / Tools / Structured / Vision / Image /
 * Audio / Embeddings / Realtime), one chip per family the model has, with a
 * tooltip naming the exact members. Anything the table does not know is shown
 * as its raw string rather than dropped — an unknown capability is still a
 * fact about the model.
 *
 * Chips carry TEXT, never colour alone.
 */

import { Chip, Stack, Tooltip, Typography } from '@mui/material';
import type { AiModelCapabilities } from '../../../services/ai';

/** Mirrors `AI_CAPABILITIES` (#424). What an admin override may set. */
export const AI_CAPABILITY_VALUES = [
  'responses',
  'reasoning',
  'tools',
  'hosted_tools',
  'structured_output',
  'streaming',
  'vision_input',
  'file_input',
  'image_generation',
  'image_edit',
  'audio_transcription',
  'audio_speech',
  'embeddings',
  'realtime',
] as const;

/** Mirrors `AI_INPUT_MODALITIES` / `AI_OUTPUT_MODALITIES` / `AI_REASONING_EFFORTS`. */
export const AI_INPUT_MODALITY_VALUES = ['text', 'image', 'audio', 'file'] as const;
export const AI_OUTPUT_MODALITY_VALUES = ['text', 'image', 'audio', 'embedding'] as const;
export const AI_REASONING_EFFORT_VALUES = ['minimal', 'low', 'medium', 'high'] as const;

export const AI_CAPABILITY_LABELS: Record<string, string> = {
  responses: 'Text responses',
  reasoning: 'Reasoning',
  tools: 'Function tools',
  hosted_tools: 'Hosted tools',
  structured_output: 'Structured output',
  streaming: 'Streaming',
  vision_input: 'Image input',
  file_input: 'File input',
  image_generation: 'Image generation',
  image_edit: 'Image editing',
  audio_transcription: 'Transcription',
  audio_speech: 'Speech',
  embeddings: 'Embeddings',
  realtime: 'Realtime',
};

export interface AiCapabilityGroup {
  id: string;
  label: string;
  /**
   * Capability strings that fold into this family. Besides the API's own
   * vocabulary, a few legacy aliases (`text`, `vision`, `function_tools`) are
   * recognised so an older catalogue row still groups sensibly.
   */
  members: readonly string[];
}

export const AI_CAPABILITY_GROUPS: readonly AiCapabilityGroup[] = [
  { id: 'text', label: 'Text', members: ['responses', 'streaming', 'file_input', 'text'] },
  { id: 'reasoning', label: 'Reasoning', members: ['reasoning'] },
  { id: 'tools', label: 'Tools', members: ['tools', 'hosted_tools', 'function_tools'] },
  { id: 'structured', label: 'Structured', members: ['structured_output'] },
  { id: 'vision', label: 'Vision', members: ['vision_input', 'vision'] },
  { id: 'image', label: 'Image', members: ['image_generation', 'image_edit'] },
  { id: 'audio', label: 'Audio', members: ['audio_transcription', 'audio_speech'] },
  { id: 'embeddings', label: 'Embeddings', members: ['embeddings'] },
  { id: 'realtime', label: 'Realtime', members: ['realtime'] },
];

const KNOWN = new Set(AI_CAPABILITY_GROUPS.flatMap((group) => group.members));

/** The families a capability list covers, in display order, plus any unknown strings. */
export function groupCapabilities(capabilities: readonly string[]): {
  groups: { group: AiCapabilityGroup; present: string[] }[];
  unknown: string[];
} {
  const groups = AI_CAPABILITY_GROUPS.map((group) => ({
    group,
    present: group.members.filter((member) => capabilities.includes(member)),
  })).filter((entry) => entry.present.length > 0);
  const unknown = capabilities.filter((capability) => !KNOWN.has(capability));
  return { groups, unknown };
}

/** Plain-text summary of the groups — the table's CSV value and search text. */
export function capabilitySummary(capabilities: AiModelCapabilities): string {
  const { groups, unknown } = groupCapabilities(capabilities.capabilities);
  return [...groups.map((entry) => entry.group.label), ...unknown].join(', ');
}

export function AiModelCapabilityChips({ capabilities }: { capabilities: AiModelCapabilities }) {
  const { groups, unknown } = groupCapabilities(capabilities.capabilities);

  if (groups.length === 0 && unknown.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        None
      </Typography>
    );
  }

  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      {groups.map(({ group, present }) => (
        <Tooltip
          key={group.id}
          title={present.map((member) => AI_CAPABILITY_LABELS[member] ?? member).join(', ')}
        >
          <Chip size="small" variant="outlined" label={group.label} />
        </Tooltip>
      ))}
      {unknown.map((capability) => (
        <Chip key={capability} size="small" variant="outlined" label={capability} />
      ))}
    </Stack>
  );
}
