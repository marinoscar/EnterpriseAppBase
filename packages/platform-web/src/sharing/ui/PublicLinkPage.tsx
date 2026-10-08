// =============================================================================
// PublicLinkPage: the public `/s` route (issue #731, PP-7.4)
// =============================================================================
//
// Mounted OUTSIDE the app's authenticated shell: anyone holding a share URL
// (`/s#lnk_…`) may open it, signed in or not. `usePublicLink()` takes the token
// from the fragment, removes it from the address bar at once, keeps it in
// memory only and resolves it with the `x-link-token` header. The page then
// renders the component the app registered for the resolved resource type
// (`registerLinkRenderer`), or the neutral "This link is not available" for
// EVERY failure, unknown, expired, revoked, throttled or unrenderable alike
// (the API's 404 uniformity: nothing tells a guesser which one it was).
//
// It imports no app layout: `slots.Frame` lets the app add its branding.
// =============================================================================

import { Box, CircularProgress, Container, Paper, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { useEffect } from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom';

import { useOptionalPlatformHost } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';
import type { SharingClient } from '../headless/client.js';
import { linkRenderers } from '../headless/linkRenderers.js';
import type { LinkRendererRegistry } from '../headless/linkRenderers.js';
import { usePublicLink } from '../headless/usePublicLink.js';
import { LINK_NOT_AVAILABLE, LINK_NOT_AVAILABLE_HINT } from './copy.js';

/**
 * The parts of {@link PublicLinkPage} an app may replace.
 *
 * @stability experimental
 */
export interface PublicLinkPageSlots {
  /** Wraps every state of the page: the app's branding. Default a centred container. */
  Frame?: ComponentType<{ children: ReactNode }>;
  /** The neutral message for every failure. Default "This link is not available." */
  NotAvailable?: ComponentType;
  /** While the token resolves. Default a spinner. */
  Loading?: ComponentType;
}

/**
 * The props of {@link PublicLinkPage}.
 *
 * @stability experimental
 */
export interface PublicLinkPageProps {
  /** The app's transport. Required outside a `PlatformHostProvider` (the public route usually is). */
  apiClient?: PlatformApiClient;
  /** A sharing client instead (moved routes, tests). */
  client?: SharingClient;
  /** The renderers to use. Default the app's (`registerLinkRenderer`). */
  registry?: LinkRendererRegistry;
  /** Parts to replace. */
  slots?: PublicLinkPageSlots;
  /** Styles for the default frame. */
  sx?: SxProps<Theme>;
  /** A class for the default frame. */
  className?: string;
}

function DefaultNotAvailable(): ReactElement {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, textAlign: 'center' }} data-testid="public-link-unavailable">
      <Typography variant="h5" component="h1" gutterBottom>
        {LINK_NOT_AVAILABLE}
      </Typography>
      <Typography variant="body1" color="text.secondary">
        {LINK_NOT_AVAILABLE_HINT}
      </Typography>
    </Paper>
  );
}

function DefaultLoading(): ReactElement {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress aria-label="Opening the link" />
    </Box>
  );
}

/**
 * Keeps the router's own location free of the fragment too: the hook already
 * cleared the address bar with `history.replaceState`, which a router does not
 * observe, so a component reading `useLocation().hash` would still see the
 * token. One `replace` navigation to the same path drops it.
 */
function RouterHashSync(): null {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.hash !== '') {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: location.state });
    }
  }, [location.hash, location.pathname, location.search, location.state, navigate]);
  return null;
}

/**
 * The public link page: resolves the fragment token and renders the app's
 * renderer for its resource type, or the neutral message.
 *
 * @param props - see {@link PublicLinkPageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * // OUTSIDE the authenticated routes, next to /login
 * <Route path="/s" element={<PublicLinkPage apiClient={appPlatformApi} />} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function PublicLinkPage(props: PublicLinkPageProps): ReactElement {
  const link = usePublicLink({
    ...(props.apiClient ? { apiClient: props.apiClient } : {}),
    ...(props.client ? { client: props.client } : {}),
  });
  const hostApi = useOptionalPlatformHost()?.api;
  const inRouter = useInRouterContext();
  const registry = props.registry ?? linkRenderers;
  const Loading = props.slots?.Loading ?? DefaultLoading;
  const NotAvailable = props.slots?.NotAvailable ?? DefaultNotAvailable;
  const apiClient = props.apiClient ?? hostApi;

  let content: ReactElement;
  const Renderer = link.resolution ? registry.get(link.resolution.resourceType) : undefined;
  if (link.status === 'loading') {
    content = <Loading />;
  } else if (link.status === 'ready' && link.resolution && link.token && Renderer && apiClient) {
    content = <Renderer resolution={link.resolution} token={link.token} apiClient={apiClient} />;
  } else {
    content = <NotAvailable />;
  }

  const Frame = props.slots?.Frame;
  return (
    <>
      {inRouter && <RouterHashSync />}
      {Frame ? (
        <Frame>{content}</Frame>
      ) : (
        <Container maxWidth="md" sx={[{ py: { xs: 3, sm: 6 } }, ...(Array.isArray(props.sx) ? props.sx : [props.sx])]} className={props.className}>
          {content}
        </Container>
      )}
    </>
  );
}
