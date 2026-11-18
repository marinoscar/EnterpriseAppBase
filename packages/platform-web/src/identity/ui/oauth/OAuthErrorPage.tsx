// =============================================================================
// The OAuth error page, `/oauth/error?code=<code>` (PP-15.7, #1185;
// docs/specs/oauth-server.md §2.10, epic #1178 Amendment 1)
// =============================================================================
//
// Where `/api/oauth/authorize` sends a PERSON when it cannot (or must not)
// send them back to the client: a disabled server, an unknown client, a client
// host the deployment does not allow, client metadata it could not read, a
// redirect URI that is not registered. The page maps the CLOSED list of codes
// (`OAUTH_ERROR_PAGE_CODES`) to plain sentences; any other code gets one
// generic sentence. It never echoes query text: the only other parameter it
// reads, `host` (with `client_not_allowed`), is shown only when it is an exact
// host name, and always as plain text.
//
// Public: the person may not be signed in, and the page calls no API.
// =============================================================================

import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Box, Button, Card, CardContent, Typography, useTheme } from '@mui/material';
import { OAUTH_ERROR_PAGE_CODES } from '@marinoscar/platform-contract/identity';
import type { OAuthErrorPageCode } from '@marinoscar/platform-contract/identity';

import type { PageSlotsBase } from '../../../core/index.js';
import { useIdentityWebAdapters } from '../../headless/index.js';
import { isValidClientHost } from './oauth-display.js';

/**
 * The slots of {@link OAuthErrorPage}: the packaged-page slot contract.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export type OAuthErrorPageSlots = PageSlotsBase;

/**
 * Props of {@link OAuthErrorPage}.
 *
 * @stability experimental
 */
export interface OAuthErrorPageProps {
  /** Add to the page without a fork. */
  slots?: OAuthErrorPageSlots;
  /** The product name. Default the identity adapters' `appName`, else `'this app'`. */
  appName?: string;
  /** Where "Go to {appName}" leads. Default `'/'`. */
  homePath?: string;
}

/**
 * The sentence for one error-page code (`host` only for `client_not_allowed`,
 * already checked to be a host name).
 *
 * @param code - a known code, or `null` for any other.
 * @param appName - the product name.
 * @param host - the refused client host, or `null`.
 * @returns the title and the sentence.
 */
export function oauthErrorPageContent(
  code: OAuthErrorPageCode | null,
  appName: string,
  host: string | null,
): { title: string; message: string } {
  switch (code) {
    case 'server_disabled':
      return {
        title: 'Connecting apps is switched off',
        message: `${appName} does not accept connections from other apps right now. Ask an administrator to switch it on.`,
      };
    case 'unknown_client':
      return {
        title: 'Unknown app',
        message: `The app that sent you here is not known to ${appName}. Go back to it and connect again.`,
      };
    case 'client_not_allowed':
      return {
        title: 'This app is not allowed',
        message: `${host ? `${host} is` : 'The app that sent you here is'} not allowed to connect to ${appName}. Ask an administrator to allow this app.`,
      };
    case 'client_metadata_unavailable':
      return {
        title: 'Could not read the app’s details',
        message: `${appName} could not read the details of the app that sent you here. Try again in a few minutes.`,
      };
    case 'invalid_redirect_uri':
      return {
        title: 'The app gave a wrong return address',
        message:
          'The app that sent you here asked to return to an address it did not register, so you were not sent back. Tell the app’s developer.',
      };
    default:
      return {
        title: 'Could not connect the app',
        message: `Something went wrong while connecting an app to ${appName}. Go back to the app and try again.`,
      };
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set(OAUTH_ERROR_PAGE_CODES);

/**
 * The `/oauth/error` route.
 *
 * @param props - see {@link OAuthErrorPageProps}.
 * @returns the page.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function OAuthErrorPage({ slots, appName: appNameProp, homePath = '/' }: OAuthErrorPageProps = {}): ReactElement {
  const theme = useTheme();
  const adapters = useIdentityWebAdapters();
  const appName = appNameProp ?? adapters.appName ?? 'this app';
  const [searchParams] = useSearchParams();
  const rawCode = searchParams.get('code');
  const code = rawCode !== null && KNOWN_CODES.has(rawCode) ? (rawCode as OAuthErrorPageCode) : null;
  const rawHost = searchParams.get('host');
  const host = code === 'client_not_allowed' && rawHost && (rawHost === 'loopback' || isValidClientHost(rawHost)) ? rawHost : null;
  const { title, message } = oauthErrorPageContent(code, appName, host);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const Header = slots?.Header;
  const BeforeContent = slots?.BeforeContent;
  const Sections = slots?.Sections;
  const AfterContent = slots?.AfterContent;

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.palette.background.default,
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: theme.breakpoints.values.sm, width: '100%', boxShadow: theme.shadows[10], overflowWrap: 'anywhere' }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          {Header ? (
            <Header title={title} description={message} actions={null} />
          ) : (
            <>
              <Typography ref={heading} tabIndex={-1} variant="h5" component="h1" sx={{ fontWeight: 'bold', mb: 1, outline: 'none' }}>
                {title}
              </Typography>
              <Typography color="text.secondary">{message}</Typography>
            </>
          )}
          {BeforeContent && <BeforeContent />}
          {Sections && <Sections position="top" />}
          <Box sx={{ mt: 3 }}>
            <Button component={RouterLink} to={homePath} variant="contained" sx={{ minHeight: 44 }}>
              Go to {appName}
            </Button>
          </Box>
          {Sections && <Sections position="bottom" />}
          {AfterContent && <AfterContent />}
        </CardContent>
      </Card>
    </Box>
  );
}
