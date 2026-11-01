/**
 * Settings → Access Tokens (`/settings/tokens`).
 *
 * Issue #96, epic #90. The Personal Access Tokens card of the stacked
 * `UserSettingsPage`, now an addressable route. THIN BY DESIGN:
 * `PersonalAccessTokens` is not touched — this issue moves where the component
 * is reached from, nothing about what it renders.
 *
 * THE ONE `/settings/*` PAGE THAT DOES NOT USE `UserSettingsSection`, and
 * deliberately. That wrapper exists to share ONE `useUserSettings()` call and
 * its snackbars between the pages that edit the user settings DOCUMENT.
 * Personal access tokens are not part of that document — they are their own
 * resource behind `/api/pat`, and `PersonalAccessTokens` already owns
 * `usePersonalAccessTokens`, its own loading state, and its own inline error
 * `Alert`. Wrapping it anyway would fire a `GET /user-settings` this page never
 * reads, gate the token list behind that unrelated request's spinner, and put a
 * second, empty error surface above a component that already has one.
 *
 * The chrome below is therefore only what the wrapper would have contributed
 * visually: the container, the `h1` and the description, mirroring the
 * `Access Tokens` card in `config/userSettingsSections.tsx` so the hub card,
 * the compact AppBar title (#95) and this `h1` all name the page identically.
 */

import type { ReactElement } from 'react';
import { Box, Container } from '@mui/material';
import type { PageSlotsBase } from '../../../core/index.js';
import { DefaultPageHeader } from '../PageHeader.js';
import { PersonalAccessTokens } from './PersonalAccessTokens.js';

/** The page's title and subtitle, the words of its registry card. */
const PAGE_TITLE = 'Access Tokens';
const PAGE_DESCRIPTION = 'Create and revoke personal access tokens for API and CLI access.';

/**
 * The slots of {@link UserTokensPage}: the packaged-page slot contract. `Sections`
 * is drawn above and below the token list.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export type UserTokensPageSlots = PageSlotsBase;

/**
 * Props of {@link UserTokensPage}.
 *
 * @stability experimental
 */
export interface UserTokensPageProps {
  /** Add to the page without a fork. */
  slots?: UserTokensPageSlots;
}

/**
 * The `Access Tokens` page (`/settings/tokens`): the caller's personal access
 * tokens.
 *
 * @param props - see {@link UserTokensPageProps}.
 * @returns the page.
 *
 * @extensionPoint component
 * @stability stable
 */
export function UserTokensPage({ slots }: UserTokensPageProps = {}): ReactElement {
  const Header = slots?.Header;
  const BeforeContent = slots?.BeforeContent;
  const Sections = slots?.Sections;
  const AfterContent = slots?.AfterContent;
  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        {Header ? (
          <Header title={PAGE_TITLE} description={PAGE_DESCRIPTION} readOnly={false} actions={null} />
        ) : (
          <DefaultPageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        )}
        {BeforeContent && <BeforeContent />}
        {Sections && <Sections position="top" />}

        <PersonalAccessTokens />

        {Sections && <Sections position="bottom" />}
        {AfterContent && <AfterContent />}
      </Box>
    </Container>
  );
}
