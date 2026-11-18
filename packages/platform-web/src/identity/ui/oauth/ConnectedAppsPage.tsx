// =============================================================================
// Settings → Connected apps, `/settings/connected-apps` (PP-15.7, #1185)
// =============================================================================
//
// The apps the caller connected with OAuth: what each may do, where, since
// when, when it was last used, and Disconnect. Every signed-in user manages
// their own grants (`GET` / `DELETE /api/oauth/grants` are `@Auth()` only), so
// the card has no permission; it carries `feature: 'oauthServer'` and the page
// itself says so when the API answers `404` (the server was switched off).
//
// The list is UNPAGINATED and unsorted, like `GET /api/pat`: the endpoint
// returns the caller's whole list, so no column declares sortable,
// filterable or searchable.
// =============================================================================

import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Alert, Box, Card, CardContent, Chip, Container, Stack, Typography } from '@mui/material';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import type { OAuthGrantView } from '@marinoscar/platform-contract/identity';

import type { PageSlotsBase } from '../../../core/index.js';
import { NUMERIC_DATE, formatDate, useDisplayTimeZone, useOptionalPlatformHost } from '../../../core/index.js';
import { useOAuthGrants } from '../../headless/index.js';
import type { IdentityTableColumn, IdentityTableRowAction, OAuthServerApi } from '../../headless/index.js';
import { DefaultPageHeader } from '../PageHeader.js';
import { IdentityTable } from '../table.js';
import { relativeTime } from './oauth-display.js';

const PAGE_TITLE = 'Connected apps';
const PAGE_DESCRIPTION = 'See the apps you connected to your account with OAuth, what each may do, and disconnect them.';

/** Persistence key for `user_settings.dataTables`. */
export const CONNECTED_APPS_TABLE_ID = 'settings-connected-apps';

/**
 * The slots of {@link ConnectedAppsPage}: the packaged-page slot contract.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export type ConnectedAppsPageSlots = PageSlotsBase;

/**
 * Props of {@link ConnectedAppsPage}.
 *
 * @stability experimental
 */
export interface ConnectedAppsPageProps {
  /** Add to the page without a fork. */
  slots?: ConnectedAppsPageSlots;
  /** The OAuth client. Default `useOAuthServerApi()`'s. */
  api?: OAuthServerApi;
}

/**
 * The `Connected apps` page (`/settings/connected-apps`).
 *
 * @param props - see {@link ConnectedAppsPageProps}.
 * @returns the page.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function ConnectedAppsPage({ slots, api }: ConnectedAppsPageProps = {}): ReactElement {
  const { grants, isLoading, error, unavailable, revoke } = useOAuthGrants(api);
  const [revoking, setRevoking] = useState<string | null>(null);
  const timeZone = useDisplayTimeZone();
  const hostRelative = useOptionalPlatformHost()?.formatRelativeTime;

  const columns = useMemo<IdentityTableColumn<OAuthGrantView>[]>(() => {
    const ago = (iso: string) => (hostRelative ? hostRelative(iso) : relativeTime(iso));
    return [
      {
        id: 'app',
        label: 'App',
        priority: 'primary',
        hideable: false,
        minWidth: 180,
        flex: 1,
        // The accessible name of the row's controls: the name and the host the server derived.
        value: (grant) => `${grant.client.name} (${grant.client.host})`,
        render: (grant) => (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {grant.client.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {grant.client.host}
            </Typography>
          </Box>
        ),
      },
      {
        id: 'resource',
        label: 'Connected to',
        priority: 'secondary',
        minWidth: 140,
        value: (grant) => grant.resource.name,
      },
      {
        id: 'scopes',
        label: 'May',
        priority: 'secondary',
        minWidth: 200,
        flex: 1,
        value: (grant) => grant.scopes.map((scope) => scope.title).join(', '),
        render: (grant) => (
          <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.5}>
            {grant.scopes.map((scope) => (
              <Chip key={scope.id} label={scope.title} size="small" variant="outlined" />
            ))}
          </Stack>
        ),
      },
      {
        id: 'organization',
        label: 'Organization',
        priority: 'detail',
        value: (grant) => grant.organization?.name ?? '',
      },
      {
        id: 'createdAt',
        label: 'Connected',
        priority: 'detail',
        value: (grant) => formatDate(grant.createdAt, NUMERIC_DATE),
      },
      {
        id: 'lastUsedAt',
        label: 'Last used',
        priority: 'secondary',
        value: (grant) => (grant.lastUsedAt ? ago(grant.lastUsedAt) : 'Never'),
      },
    ];
    // The dates render in the display zone: rebuild on a zone change.
  }, [timeZone, hostRelative]);

  const rowActions = useMemo<IdentityTableRowAction<OAuthGrantView>[]>(
    () => [
      {
        id: 'disconnect',
        label: 'Disconnect',
        icon: <LinkOffIcon fontSize="small" />,
        destructive: true,
        disabled: (grant) => revoking === grant.id,
        confirm: {
          title: 'Disconnect this app?',
          description: (grant) => `${grant.client.name} (${grant.client.host}) will stop working at once. You can connect it again later.`,
          confirmLabel: 'Disconnect',
        },
        onClick: (grant) => {
          setRevoking(grant.id);
          void revoke(grant.id)
            .catch(() => undefined)
            .finally(() => setRevoking(null));
        },
      },
    ],
    [revoking, revoke],
  );

  const Header = slots?.Header;
  const BeforeContent = slots?.BeforeContent;
  const Sections = slots?.Sections;
  const AfterContent = slots?.AfterContent;

  return (
    <Container maxWidth="md">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        {Header ? (
          <Header title={PAGE_TITLE} description={PAGE_DESCRIPTION} readOnly={false} actions={null} />
        ) : (
          <DefaultPageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        )}
        {BeforeContent && <BeforeContent />}
        {Sections && <Sections position="top" />}

        {unavailable ? (
          <Alert severity="info">Connecting other apps is switched off on this deployment.</Alert>
        ) : (
          <Card>
            <CardContent>
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}
              <IdentityTable<OAuthGrantView>
                tableId={CONNECTED_APPS_TABLE_ID}
                data-testid="settings-connected-apps-table"
                ariaLabel="Connected apps"
                density="standard"
                columns={columns}
                rows={grants}
                rowId={(grant) => grant.id}
                loading={isLoading}
                emptyState={
                  <Typography variant="body2" color="text.secondary">
                    No apps are connected.
                  </Typography>
                }
                rowActions={rowActions}
              />
            </CardContent>
          </Card>
        )}

        {Sections && <Sections position="bottom" />}
        {AfterContent && <AfterContent />}
      </Box>
    </Container>
  );
}
