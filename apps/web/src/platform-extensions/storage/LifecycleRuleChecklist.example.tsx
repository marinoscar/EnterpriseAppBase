/**
 * Reference example (PP-14.24): an app adds its own section to the packaged
 * admin storage page through `slots.Sections`, with no package edit.
 *
 * The checklist lists the bucket rules the app's operations runbook expects
 * (the app's policy, not the platform's), under the page's own content
 * (`position === 'bottom'`). The page's connection test, bucket provisioning and
 * `SWITCH` confirmation are untouched.
 *
 * Wire it where the route renders the page:
 * `<StorageConfigPage slots={{ Sections: LifecycleRuleChecklist }} />`.
 */
import type { ReactElement } from 'react';
import { List, ListItem, ListItemText, Paper, Typography } from '@mui/material';
import type { PageSectionsSlotProps } from '@marinoscar/platform-web/core';

const RULES = [
  'Abort incomplete multipart uploads after 7 days',
  'Expire noncurrent object versions after 30 days',
  'Transition database backups to cold storage after 90 days',
] as const;

export function LifecycleRuleChecklist({ position }: PageSectionsSlotProps): ReactElement | null {
  if (position !== 'bottom') return null;
  return (
    <Paper variant="outlined" component="section" aria-labelledby="lifecycle-rules-title" sx={{ p: 2, mt: 3 }}>
      <Typography id="lifecycle-rules-title" variant="h6" component="h2">
        Bucket lifecycle rules
      </Typography>
      <List dense>
        {RULES.map((rule) => (
          <ListItem key={rule} disableGutters>
            <ListItemText primary={rule} />
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
