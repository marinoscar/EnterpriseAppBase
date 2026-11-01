/**
 * Reference example (PP-14.24): an app adds a key that is not an AI provider's to
 * the packaged "AI Keys" page through `slots.Sections`, with no package edit.
 *
 * `Sections` is drawn at both ends of the page body; this one returns its card
 * only for `position === 'bottom'`, so it sits after the AI keys and the user's
 * usage. The card keeps the same rule the page keeps for every key: nothing
 * typed here is ever shown back (a real app would save through its own
 * credentials route).
 *
 * Wire it where the route renders the page:
 * `<UserAiKeysPage slots={{ Sections: SearchApiKeySection }} />`.
 */
import type { ReactElement } from 'react';
import { Paper, TextField, Typography } from '@mui/material';
import type { PageSectionsSlotProps } from '@marinoscar/platform-web/core';

export function SearchApiKeySection({ position }: PageSectionsSlotProps): ReactElement | null {
  if (position !== 'bottom') return null;
  return (
    <Paper variant="outlined" component="section" aria-labelledby="search-api-key-title" sx={{ p: 2, mt: 3 }}>
      <Typography id="search-api-key-title" variant="h6" component="h2">
        Search API key
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Used by the search tool in this app. Stored encrypted and never shown again.
      </Typography>
      <TextField label="Search API key" type="password" autoComplete="off" size="small" fullWidth />
    </Paper>
  );
}
