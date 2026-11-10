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
import type { PageSlotsBase } from '../../../core/index.js';
import { useAuth, usePermissions, useRoles } from '../../headless/index.js';
import { RequirePermission } from '../../headless/index.js';
import { DefaultPageHeader } from '../PageHeader.js';
import { OrgMembersPanel } from './OrgMembersPanel.js';
import type { OrgMembersPanelSlots } from './OrgMembersPanel.js';
import { OrgInvitesPanel } from './OrgInvitesPanel.js';

/** The page's title, the word of its registry card. */
const PAGE_TITLE = 'Organization';

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
 * The slots of {@link OrganizationPage}: the page-slot contract and the member
 * list's slots (`RowActions`, `DetailPanel`, `Toolbar`, passed to the Members
 * tab). `Sections` is drawn at both ends of the page body, outside the tab strip.
 *
 * @example
 * ```tsx
 * <OrganizationPage slots={{ BeforeContent: SeatsNotice, RowActions: ({ row }) => <SeatMenu userId={row.userId} /> }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface OrganizationPageSlots extends PageSlotsBase, OrgMembersPanelSlots {}

/**
 * Props of {@link OrganizationPage}.
 *
 * @stability experimental
 */
export interface OrganizationPageProps {
  /** Add to the page without a fork. */
  slots?: OrganizationPageSlots;
}

/**
 * The `Organization` page (`/admin/settings/organization`): the current
 * organization's Members tab and, gated on `org_invites:read`, its Invites tab.
 *
 * @param props - see {@link OrganizationPageProps}.
 * @returns the page.
 *
 * @extensionPoint component
 * @stability stable
 */
export function OrganizationPage({ slots }: OrganizationPageProps = {}): ReactElement {
  const { activeOrg } = useAuth();
  const { hasPermission } = usePermissions();
  const Header = slots?.Header;
  const BeforeContent = slots?.BeforeContent;
  const Sections = slots?.Sections;
  const AfterContent = slots?.AfterContent;
  const memberSlots: OrgMembersPanelSlots = {
    ...(slots?.RowActions ? { RowActions: slots.RowActions } : {}),
    ...(slots?.DetailPanel ? { DetailPanel: slots.DetailPanel } : {}),
    ...(slots?.Toolbar ? { Toolbar: slots.Toolbar } : {}),
  };
  const hasMemberSlots = Object.keys(memberSlots).length > 0;
  // Read once for both tabs: the choices in the dialogs and the labels in the lists.
  const roles = useRoles('org');
  const [tabIndex, setTabIndex] = useState(0);
  const description = activeOrg
    ? `The members of ${activeOrg.name}, and who is invited to join.`
    : 'The members of your current organization, and who is invited to join.';

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        {Header ? (
          <Header title={PAGE_TITLE} description={description} readOnly={!hasPermission('org_members:write')} actions={null} />
        ) : (
          <DefaultPageHeader title={PAGE_TITLE} description={description} />
        )}
        {BeforeContent && <BeforeContent />}
        {Sections && <Sections position="top" />}

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
              <OrgMembersPanel roles={roles} {...(hasMemberSlots ? { slots: memberSlots } : {})} />
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
                <OrgInvitesPanel roles={roles} />
              </RequirePermission>
            </TabPanel>
          </Box>
        </Paper>

        {Sections && <Sections position="bottom" />}
        {AfterContent && <AfterContent />}
      </Box>
    </Container>
  );
}
