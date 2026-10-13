/**
 * Admin → Settings → Users & Allowlist (`/admin/settings/users`).
 *
 * Issue #92, epic #90. This is the former `pages/UserManagementPage.tsx`, moved
 * under the Console's route tree so the hub card, the rail row and the route
 * all address the same path. `/admin/users` still resolves — `App.tsx` keeps it
 * as a real `<Navigate replace>` route so a bookmark lands here rather than
 * falling through the `*` catch-all to `/`.
 *
 * IT KEEPS ITS TWO TABS, unlike `SystemSettingsPage`, whose three became three
 * routes. That is not an inconsistency: Users and Allowlist are two views of
 * the same question — who may use this application — and they are PARALLEL
 * content, which is what a tab strip is for. The three system-settings tabs
 * were hierarchical content wearing a tab strip, which is the mistake epic #90
 * is fixing. Two tabs also sit nowhere near the ~5 where a strip degrades.
 *
 * The nested gate below is unchanged and load-bearing; see its own comment.
 *
 * PP-14.25: the page takes the packaged-page slot contract (`PageSlotsBase`,
 * the user table's slots, and `Tabs`). `Tabs` only APPENDS tabs after the two
 * above and is for content that is parallel to them (another answer to "who may
 * use this application"); a new settings page is a card in the registry, never
 * a tab here (CLAUDE.md, Settings UI Pattern, rule 2).
 */

import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { Container, Typography, Box, Tabs, Tab, Paper } from '@mui/material';
import { Navigate } from 'react-router-dom';
import type { PageSlot, PageSlotsBase } from '../../../core/index.js';
import { usePermissions } from '../../headless/index.js';
import { RequirePermission } from '../../headless/index.js';
import { DefaultPageHeader } from '../PageHeader.js';
import { UserList } from './UserList.js';
import type { UserListSlots } from './UserList.js';
import { AllowlistTable } from './AllowlistTable.js';

/** The title and subtitle of the page, the words of its registry card. */
const PAGE_TITLE = 'Users & Allowlist';
const PAGE_DESCRIPTION = 'Manage user accounts and roles, and control who may sign in at all.';

/** The two tabs the page always has. */
const BUILTIN_TABS = 2;

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

/**
 * A tab an app appends to {@link UsersPage} after Users and Allowlist.
 *
 * Only for content PARALLEL to those two (another view of "who may use this
 * application"): the Settings UI rule is that a tab strip holds parallel
 * content and a new settings page is a registry card.
 *
 * @stability experimental
 */
export interface UsersPageTab {
  /** A stable id (the tab's key). */
  id: string;
  /** The tab's label. */
  label: ReactNode;
  /** The tab's content. Rendered only while the tab is selected, inside the page's tab panel. */
  Panel: PageSlot<object>;
  /**
   * Show the tab only to a viewer holding this permission. This hides a control;
   * the API behind the panel enforces the permission.
   */
  permission?: string;
}

/**
 * The slots of {@link UsersPage}: the page-slot contract, the user table's
 * slots (passed to the Users tab's list) and `Tabs`.
 *
 * `Sections` is drawn at both ends of the page body, outside the tab strip.
 * `Tabs` is a list of tabs appended after Users and Allowlist; it cannot remove
 * or reorder those two. Keep it a module constant.
 *
 * @example
 * ```tsx
 * <UsersPage slots={{ Columns: (base) => [...base, planColumn], Tabs: [{ id: 'domains', label: 'Domains', Panel: DomainsPanel }] }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface UsersPageSlots extends PageSlotsBase, UserListSlots {
  /** Tabs appended after Users and Allowlist, for content parallel to them. */
  Tabs?: readonly UsersPageTab[];
}

/**
 * Props of {@link UsersPage}.
 *
 * @stability experimental
 */
export interface UsersPageProps {
  /** Add to the page without a fork. */
  slots?: UsersPageSlots;
}

/**
 * The admin `Users & Allowlist` page (`/admin/settings/users`): the Users tab
 * and, gated on `allowlist:read` inside the page, the Allowlist tab.
 *
 * @param props - see {@link UsersPageProps}.
 * @returns the page.
 *
 * @extensionPoint component
 * @stability stable
 */
export function UsersPage({ slots }: UsersPageProps = {}): ReactElement {
  const { hasPermission } = usePermissions();
  const [tabIndex, setTabIndex] = useState(0);
  const Header = slots?.Header;
  const BeforeContent = slots?.BeforeContent;
  const Sections = slots?.Sections;
  const AfterContent = slots?.AfterContent;
  const appTabs = (slots?.Tabs ?? []).filter((tab) => !tab.permission || hasPermission(tab.permission));
  // The table slots go to the Users tab's list; the page slots and `Tabs` do not.
  const listSlots: UserListSlots = {
    ...(slots?.Columns ? { Columns: slots.Columns } : {}),
    ...(slots?.RowActions ? { RowActions: slots.RowActions } : {}),
    ...(slots?.DetailPanel ? { DetailPanel: slots.DetailPanel } : {}),
    ...(slots?.Toolbar ? { Toolbar: slots.Toolbar } : {}),
  };
  const hasListSlots = Object.keys(listSlots).length > 0;
  // A permission change can remove the tab that was selected.
  const selected = tabIndex < BUILTIN_TABS + appTabs.length ? tabIndex : 0;

  // Defence for a page mounted from anywhere else. The real gate is the
  // `RequirePermission` around this route in `App.tsx`, carrying the same
  // `users:read` the `Users & Allowlist` card declares and
  // `users.controller.ts` enforces.
  if (!hasPermission('users:read')) {
    return <Navigate to="/" replace />;
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        {Header ? (
          <Header title={PAGE_TITLE} description={PAGE_DESCRIPTION} readOnly={!hasPermission('users:write')} actions={null} />
        ) : (
          <DefaultPageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        )}
        {BeforeContent && <BeforeContent />}
        {Sections && <Sections position="top" />}

        <Paper sx={{ mt: 2 }}>
          <Tabs
            value={selected}
            onChange={(_, newValue) => setTabIndex(newValue)}
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab label="Users" />
            <Tab label="Allowlist" />
            {appTabs.map((tab) => (
              <Tab key={tab.id} label={tab.label} />
            ))}
          </Tabs>

          <Box sx={{ p: 3 }}>
            <TabPanel value={selected} index={0}>
              <UserList {...(hasListSlots ? { slots: listSlots } : {})} />
            </TabPanel>

            <TabPanel value={selected} index={1}>
              {/* The DESTINATION and the ROUTE both gate on `users:read` (see
                  `config/destinations.ts` and `config/adminSections.tsx`)
                  because that is what makes this page worth reaching. This TAB
                  gates separately on `allowlist:read`, because its data comes
                  from a different controller (`allowlist.controller.ts`) that
                  enforces exactly that. A destination gate is about
                  reachability; a tab gate is about content — collapsing the two
                  would either hide the whole page from someone entitled to the
                  Users tab, or render a table that can only 403. */}
              <RequirePermission
                permission="allowlist:read"
                fallback={
                  <Typography color="text.secondary">
                    You do not have permission to view the email allowlist.
                  </Typography>
                }
              >
                <AllowlistTable />
              </RequirePermission>
            </TabPanel>

            {appTabs.map((tab, offset) => (
              <TabPanel key={tab.id} value={selected} index={BUILTIN_TABS + offset}>
                <tab.Panel />
              </TabPanel>
            ))}
          </Box>
        </Paper>

        {Sections && <Sections position="bottom" />}
        {AfterContent && <AfterContent />}
      </Box>
    </Container>
  );
}
