/**
 * Organization (#726, PP-6.7): the people of the CURRENT organization, for
 * its administrator. Reached through the `Organization` card
 * (`/admin/settings/organization`, `org_members:read`, `feature: 'orgs'`).
 *
 * TWO TABS, ONE DESTINATION, the `UsersPage` precedent: Members and Invites
 * are parallel answers to one question ("who belongs to this org"), not two
 * settings pages. The Invites tab gates its own content on `org_invites:read`
 * because its data comes from a different controller
 * (`org-invites.controller.ts`); a destination gate is about reachability, a
 * tab gate about content.
 *
 * "Current" is the org the session's token is bound to (the AppBar switcher
 * changes it); no org id is ever sent from here.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Box, Container, Paper, Tab, Tabs, Typography } from '@mui/material';
import { useAuth } from '../../headless/index.js';
import { RequirePermission } from '../../headless/index.js';
import { OrgMembersPanel } from './OrgMembersPanel.js';
import { OrgInvitesPanel } from './OrgInvitesPanel.js';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ py: { xs: 2, sm: 3 } }}>{children}</Box>}
    </div>
  );
}

/**
 * The `Organization` page (`/admin/settings/organization`): the current
 * organization's Members tab and, gated on `org_invites:read`, its Invites tab.
 *
 * @returns the page.
 *
 * @extensionPoint component
 * @stability stable
 */
export function OrganizationPage(): ReactElement {
  const { activeOrg } = useAuth();
  const [tabIndex, setTabIndex] = useState(0);

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Organization
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {activeOrg
            ? `The members of ${activeOrg.name}, and who is invited to join.`
            : 'The members of your current organization, and who is invited to join.'}
        </Typography>

        <Paper sx={{ mt: 2 }}>
          <Tabs
            value={tabIndex}
            onChange={(_, value: number) => setTabIndex(value)}
            sx={{ borderBottom: 1, borderColor: 'divider' }}
            variant="fullWidth"
          >
            <Tab label="Members" />
            <Tab label="Invites" />
          </Tabs>

          <Box sx={{ px: { xs: 2, sm: 3 } }}>
            <TabPanel value={tabIndex} index={0}>
              <OrgMembersPanel />
            </TabPanel>
            <TabPanel value={tabIndex} index={1}>
              <RequirePermission
                permission="org_invites:read"
                fallback={
                  <Typography color="text.secondary">
                    You do not have permission to view this organization&apos;s invitations.
                  </Typography>
                }
              >
                <OrgInvitesPanel />
              </RequirePermission>
            </TabPanel>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
}
