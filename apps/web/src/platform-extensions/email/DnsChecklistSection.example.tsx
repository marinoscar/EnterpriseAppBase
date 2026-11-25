/**
 * Reference example (PP-14.24): an app adds its own section to the packaged
 * admin email page through `slots.Sections`, with no package edit.
 *
 * The checklist names the DNS records the sending domain needs before mail is
 * delivered reliably (SPF, DKIM, DMARC), under the page's own content
 * (`position === 'bottom'`). The transport panels, the save and the test send
 * are untouched.
 *
 * Wire it where the route renders the page:
 * `<EmailSettingsPage slots={{ Sections: DnsChecklistSection }} />`.
 */
import type { ReactElement } from 'react';
import { List, ListItem, ListItemText, Paper, Typography } from '@mui/material';
import type { PageSectionsSlotProps } from '@marinoscar/platform-web/core';

const RECORDS = [
  ['SPF', 'Authorise the transport to send for the domain'],
  ['DKIM', 'Publish the transport’s signing key'],
  ['DMARC', 'Say what receivers do with mail that fails both'],
] as const;

export function DnsChecklistSection({ position }: PageSectionsSlotProps): ReactElement | null {
  if (position !== 'bottom') return null;
  return (
    <Paper variant="outlined" component="section" aria-labelledby="dns-records-title" sx={{ p: 2, mt: 3 }}>
      <Typography id="dns-records-title" variant="h6" component="h2">
        Sending domain DNS records
      </Typography>
      <List dense>
        {RECORDS.map(([name, why]) => (
          <ListItem key={name} disableGutters>
            <ListItemText primary={name} secondary={why} />
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
