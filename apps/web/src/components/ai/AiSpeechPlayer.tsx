/**
 * A speech run's audio — issue #445 (API #439, docs/specs/ai-platform.md §5.6).
 *
 * The audio is a storage object the caller owns; it plays from a short-lived
 * signed URL (`GET /storage/objects/:id/download`, held in state only) in a
 * native, labelled `<audio controls>` player, with a download link.
 *
 * DISCLOSURE. Provider usage policies require telling listeners that a voice
 * is AI-generated, and every speech output carries `aiGenerated: true`. The
 * "AI-generated audio" label is therefore always visible beside the player
 * and part of the player's accessible name — not a tooltip, not optional.
 */
import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Skeleton, Typography } from '@mui/material';
import { Download as DownloadIcon, SmartToy as AiIcon } from '@mui/icons-material';
import type { AiSpeechRunOutput } from '../../services/ai';
import { getStorageObjectDownloadUrl } from '../../services/storage';
import { ApiError } from '../../services/api';
import { useIsMounted } from '../../hooks/useIsMounted';

export const AI_GENERATED_AUDIO_LABEL = 'AI-generated audio';

export interface AiSpeechPlayerProps {
  output: AiSpeechRunOutput;
}

export function AiSpeechPlayer({ output }: AiSpeechPlayerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  useEffect(() => {
    setUrl(null);
    setError(null);
    void (async () => {
      try {
        const signed = await getStorageObjectDownloadUrl(output.storageObjectId);
        if (isMounted()) setUrl(signed.url);
      } catch (err) {
        if (isMounted()) setError(err instanceof ApiError ? err.message : 'Could not load the audio');
      }
    })();
  }, [output.storageObjectId, isMounted]);

  const accessibleName = `${AI_GENERATED_AUDIO_LABEL}, voice ${output.voice}`;

  return (
    <Paper
      variant="outlined"
      component="figure"
      aria-label="Generated speech"
      sx={{ m: 0, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}
    >
      <Box component="figcaption" sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip icon={<AiIcon />} color="secondary" size="small" label={AI_GENERATED_AUDIO_LABEL} />
        <Typography variant="caption" color="text.secondary">
          Voice {output.voice} · {output.format.toUpperCase()} · {output.characters.toLocaleString()} characters
        </Typography>
      </Box>
      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : url ? (
        <Box component="audio" controls src={url} aria-label={accessibleName} preload="metadata" sx={{ width: '100%' }}>
          Your browser cannot play this audio; use the download link.
        </Box>
      ) : (
        <Skeleton variant="rounded" height={40} aria-label="Loading audio" />
      )}
      <Box>
        <Button
          size="small"
          startIcon={<DownloadIcon />}
          component="a"
          href={url ?? undefined}
          download={`ai-speech.${output.format}`}
          target="_blank"
          rel="noopener noreferrer"
          disabled={!url}
        >
          Download audio
        </Button>
      </Box>
    </Paper>
  );
}

export default AiSpeechPlayer;
