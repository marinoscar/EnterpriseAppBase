// =============================================================================
// The OAuth consent page, `/oauth/consent?request=<id>` (PP-15.7, #1185;
// docs/specs/oauth-server.md §2.19)
// =============================================================================
//
// Where a person decides to hand part of their authority to software they do
// not control, so the page is built to be unambiguous on a phone:
//
// - The client's HOST leads, in bold: the server derived it, while the name and
//   logo are self-asserted and shown as secondary. The logo only when `https:`
//   on the client's own host, never sending a referrer.
// - The host the person returns to is named; a loopback redirect is a warning.
// - Scopes are grouped by risk, in words (not colour alone). `elevated` scopes
//   are unticked unless an active grant already holds them; `high` scopes are
//   always unticked and carry a warning; required scopes cannot be unticked; a
//   scope the account cannot use is disabled with the reason.
// - `Allow` is disabled for the first second and while a decision is in flight;
//   focus starts on the heading, never on `Allow`.
// - The only thing taken from the URL is the opaque request id.
// - The page refuses to work inside a frame (defence in depth beside the CSP).
//
// The route sits OUTSIDE the shell and inside `RequireAuth`, like `/activate`:
// a signed-out person logs in and comes back to the same URL.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { OAuthConsentRequest } from '@marinoscar/platform-contract/identity';

import type { PageSlotsBase } from '../../../core/index.js';
import { useAuth, useIdentityWebAdapters, useOAuthRequest } from '../../headless/index.js';
import type { OAuthServerApi } from '../../headless/index.js';
import { displayableClientLogo, isNewClient } from './oauth-display.js';

type ConsentScope = OAuthConsentRequest['scopes'][number];
type ScopeRisk = ConsentScope['risk'];

/** How long `Allow` stays disabled after the request renders. */
export const CONSENT_ALLOW_DELAY_MS = 1000;

/**
 * The slots of {@link OAuthConsentPage}: the packaged-page slot contract
 * (`Header` replaces the heading block; `BeforeContent`, `Sections` and
 * `AfterContent` sit inside the card) plus the consent page's own.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface OAuthConsentPageSlots extends PageSlotsBase {
  /** Rendered under the actions, inside the card (nothing by default). */
  Footer?: ComponentType;
  /** An icon for one scope, drawn before its title (nothing by default). */
  scopeIcon?: (scopeId: string) => ReactNode;
}

/**
 * Props of {@link OAuthConsentPage}.
 *
 * @stability experimental
 */
export interface OAuthConsentPageProps {
  /** Brand or extend the page without a fork. */
  slots?: OAuthConsentPageSlots;
  /**
   * The product name the page uses ("wants to connect to {appName}").
   * Default the identity adapters' `appName`, else `'this app'`.
   */
  appName?: string;
  /** The OAuth client. Default `useOAuthServerApi()`'s (the adapters' `oauthApi`, else the platform host). */
  api?: OAuthServerApi;
  /** The sign-in route "Switch account" returns through. Default `'/login'`. */
  loginPath?: string;
  /**
   * Leaves the page for the client's redirect URI. Default
   * `window.location.assign`. A test or a native shell passes its own.
   */
  navigateTo?: (url: string) => void;
}

const RISK_ORDER: readonly ScopeRisk[] = ['low', 'elevated', 'high'];

const RISK_HEADINGS: Record<ScopeRisk, { title: string; hint: string }> = {
  low: { title: 'Basic access', hint: 'Low risk.' },
  elevated: { title: 'Extra access', hint: 'Medium risk. Off unless you tick it.' },
  high: { title: 'Sensitive access', hint: 'High risk. Off unless you tick it.' },
};

const UNGRANTABLE_TEXT = 'Your account cannot do this, so the app will not be able to either.';

/** The scopes ticked when the request loads (docs/specs/oauth-server.md §2.19). */
export function defaultConsentSelection(scopes: readonly ConsentScope[]): Set<string> {
  const selected = new Set<string>();
  for (const scope of scopes) {
    if (!scope.grantable) continue;
    if (scope.required) selected.add(scope.id);
    else if (scope.risk === 'low') selected.add(scope.id);
    else if (scope.risk === 'elevated' && scope.alreadyGranted) selected.add(scope.id);
    // `high`: always unticked.
  }
  return selected;
}

function defaultLeave(url: string): void {
  window.location.assign(url);
}

function isFramed(): boolean {
  try {
    return typeof window !== 'undefined' && window.top !== window.self;
  } catch {
    return true;
  }
}

/**
 * The `/oauth/consent` route: who is asking, where the person goes next, what
 * the app will be able to do, and `Allow` or `Cancel`.
 *
 * @param props - see {@link OAuthConsentPageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route element={<RequireAuth />}>
 *   <Route path="/oauth/consent" element={<OAuthConsentPage />} />
 * </Route>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function OAuthConsentPage({
  slots,
  appName: appNameProp,
  api,
  loginPath = '/login',
  navigateTo = defaultLeave,
}: OAuthConsentPageProps = {}): ReactElement {
  const theme = useTheme();
  const adapters = useIdentityWebAdapters();
  const appName = appNameProp ?? adapters.appName ?? 'this app';
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('request');
  const { status, request, error, isSubmitting, approve, deny } = useOAuthRequest(requestId || null, api);
  const framed = useMemo(isFramed, []);

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: { xs: 'stretch', sm: 'center' },
        justifyContent: 'center',
        backgroundColor: theme.palette.background.default,
        p: { xs: 0, sm: 2 },
      }}
    >
      <Card
        sx={{
          maxWidth: theme.breakpoints.values.sm,
          width: '100%',
          boxShadow: { xs: 'none', sm: theme.shadows[10] },
          borderRadius: { xs: 0, sm: 1 },
          overflowWrap: 'anywhere',
        }}
      >
        <CardContent sx={{ p: { xs: 2, sm: 4 }, '&:last-child': { pb: { xs: 2, sm: 4 } } }}>
          {framed ? (
            <ConsentMessage title="This page cannot be shown here">
              For your safety, this page only works when you open it directly in your browser.
            </ConsentMessage>
          ) : status === 'loading' ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }} role="status" aria-live="polite">
              <CircularProgress aria-label="Loading the request" />
            </Box>
          ) : status === 'expired' ? (
            <ConsentMessage title="This request has expired">
              Go back to the app that sent you here and connect again.
            </ConsentMessage>
          ) : status === 'error' || !request ? (
            <ConsentMessage title="Something went wrong">
              {error ?? 'Could not load this request.'} Go back to the app that sent you here and try again.
            </ConsentMessage>
          ) : (
            <ConsentForm
              request={request}
              appName={appName}
              slots={slots}
              loginPath={loginPath}
              error={error}
              isSubmitting={isSubmitting}
              onApprove={async (scopes, orgId) => {
                const target = await approve(scopes, orgId);
                if (target) navigateTo(target);
              }}
              onDeny={async () => {
                const target = await deny();
                if (target) navigateTo(target);
              }}
            />
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

/** The expired, error and framed states: a focused heading and one sentence. */
function ConsentMessage({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <Box sx={{ py: 2 }}>
      <Typography ref={heading} tabIndex={-1} variant="h5" component="h1" sx={{ fontWeight: 'bold', mb: 1, outline: 'none' }}>
        {title}
      </Typography>
      <Typography color="text.secondary">{children}</Typography>
    </Box>
  );
}

interface ConsentFormProps {
  request: OAuthConsentRequest;
  appName: string;
  slots: OAuthConsentPageSlots | undefined;
  loginPath: string;
  error: string | null;
  isSubmitting: boolean;
  onApprove: (scopes: string[], orgId?: string) => Promise<void>;
  onDeny: () => Promise<void>;
}

function ConsentForm({
  request,
  appName,
  slots,
  loginPath,
  error,
  isSubmitting,
  onApprove,
  onDeny,
}: ConsentFormProps): ReactElement {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const headingRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string>>(() => defaultConsentSelection(request.scopes));
  const defaultOrg = request.organizations.find((org) => org.isCurrent)?.id ?? request.organizations[0]?.id ?? '';
  const [orgId, setOrgId] = useState(defaultOrg);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
    const timer = setTimeout(() => setArmed(true), CONSENT_ALLOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const logo = displayableClientLogo(request.client.logoUri, request.client.host);
  const [logoFailed, setLogoFailed] = useState(false);
  const isNew = isNewClient(request.client.firstSeenAt);
  const grouped = RISK_ORDER.map((risk) => ({ risk, scopes: request.scopes.filter((scope) => scope.risk === risk) })).filter(
    (group) => group.scopes.length > 0,
  );
  const chosen = request.scopes.filter((scope) => scope.grantable && selected.has(scope.id)).map((scope) => scope.id);
  const nothingChosen = request.scopes.length > 0 && chosen.length === 0;

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const switchAccount = async () => {
    const here = { pathname: location.pathname, search: location.search };
    await logout();
    navigate(loginPath, { replace: true, state: { from: here } });
  };

  const Header = slots?.Header;
  const BeforeContent = slots?.BeforeContent;
  const Sections = slots?.Sections;
  const AfterContent = slots?.AfterContent;
  const Footer = slots?.Footer;
  const titleNode = (
    <>
      <Box component="strong" sx={{ fontWeight: 'bold' }}>
        {request.client.host}
      </Box>{' '}
      wants to connect to {appName}
    </>
  );

  return (
    <Stack spacing={2}>
      {/* 1. Who is asking. */}
      <Box ref={headingRef} tabIndex={-1} sx={{ outline: 'none' }} data-testid="oauth-consent-heading">
        {Header ? (
          <Header title={titleNode} description={`It calls itself: ${request.client.name}`} actions={null} />
        ) : (
          <Stack direction="row" spacing={2} alignItems="center">
            {logo && !logoFailed && (
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  flexShrink: 0,
                  borderRadius: 1,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <img
                  src={logo}
                  alt=""
                  width={48}
                  height={48}
                  referrerPolicy="no-referrer"
                  style={{ objectFit: 'contain', width: 48, height: 48 }}
                  onError={() => setLogoFailed(true)}
                />
              </Box>
            )}
            <Box sx={{ minWidth: 0 }}>
              <Typography id="oauth-consent-title" variant="h5" component="h1" sx={{ fontWeight: 'normal' }}>
                {titleNode}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                It calls itself: {request.client.name}
              </Typography>
            </Box>
          </Stack>
        )}
      </Box>
      {BeforeContent && <BeforeContent />}
      {Sections && <Sections position="top" />}

      {/* 2. Where you will be sent. */}
      <Typography variant="body2">
        After you decide, you go back to{' '}
        <Box component="strong" sx={{ fontWeight: 'bold' }}>
          {request.redirectHost}
        </Box>
        .
      </Typography>
      {request.isLoopbackRedirect && (
        <Alert severity="warning">
          This app runs on your own computer. Only continue if you started this yourself, just now.
        </Alert>
      )}

      {/* 3. First-time notice. */}
      {isNew && (
        <Alert severity="info">New here: nobody on this {appName} has connected this app before.</Alert>
      )}

      {/* 4. Signed in as. */}
      <Box>
        <Typography variant="body2">
          Signed in as{' '}
          <Box component="strong" sx={{ fontWeight: 'bold' }}>
            {user?.email}
          </Box>
          .{' '}
          <Button
            variant="text"
            size="small"
            onClick={() => void switchAccount()}
            disabled={isSubmitting}
            sx={{ minHeight: 44, verticalAlign: 'baseline', px: 1 }}
          >
            Not you? Switch account
          </Button>
        </Typography>
      </Box>
      {request.organizations.length > 0 && (
        <TextField
          select
          label="Organization"
          helperText="The app acts in this organization."
          value={orgId}
          onChange={(event) => setOrgId(event.target.value)}
          disabled={isSubmitting}
          fullWidth
        >
          {request.organizations.map((org) => (
            <MenuItem key={org.id} value={org.id} sx={{ minHeight: 44 }}>
              {org.name}
            </MenuItem>
          ))}
        </TextField>
      )}

      <Divider />

      {/* 5. What it will be able to do. */}
      <Box component="section" aria-labelledby="oauth-consent-scopes">
        <Typography id="oauth-consent-scopes" variant="h6" component="h2" gutterBottom>
          What it will be able to do in {request.resource.name}
        </Typography>
        <Stack spacing={1.5}>
          {grouped.map((group) => (
            <Box key={group.risk} role="group" aria-labelledby={`oauth-consent-risk-${group.risk}`}>
              <Typography id={`oauth-consent-risk-${group.risk}`} variant="subtitle2" component="h3">
                {RISK_HEADINGS[group.risk].title}{' '}
                <Typography component="span" variant="caption" color="text.secondary">
                  {RISK_HEADINGS[group.risk].hint}
                </Typography>
              </Typography>
              <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                {group.scopes.map((scope) => (
                  <ScopeRow
                    key={scope.id}
                    scope={scope}
                    checked={scope.grantable && selected.has(scope.id)}
                    disabled={isSubmitting}
                    icon={slots?.scopeIcon?.(scope.id)}
                    onChange={(on) => toggle(scope.id, on)}
                  />
                ))}
              </Stack>
            </Box>
          ))}
          {request.offlineAccess && (
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <CheckCircleOutlineIcon fontSize="small" color="success" sx={{ mt: 0.25 }} aria-hidden />
              <Typography variant="body2">Stay connected without asking again.</Typography>
            </Stack>
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          It never sees your password or your sign-in to {appName}. You can disconnect it at any time in Settings →
          Connected apps.
        </Typography>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      {Sections && <Sections position="bottom" />}
      {AfterContent && <AfterContent />}

      {/* 6. Actions: sticky on a phone so they stay in reach. */}
      <Box
        sx={{
          position: { xs: 'sticky', sm: 'static' },
          bottom: 0,
          bgcolor: 'background.paper',
          pt: 1,
          pb: { xs: 1, sm: 0 },
          zIndex: 1,
        }}
      >
        {nothingChosen && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
            Tick at least one thing the app may do, or cancel.
          </Typography>
        )}
        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1} justifyContent="flex-end">
          <Button
            variant="outlined"
            size="large"
            disabled={isSubmitting}
            onClick={() => void onDeny()}
            sx={{ minHeight: 44 }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            size="large"
            disabled={!armed || isSubmitting || nothingChosen}
            onClick={() => void onApprove(chosen, request.organizations.length > 0 && orgId ? orgId : undefined)}
            sx={{ minHeight: 44 }}
          >
            {isSubmitting ? 'Sending…' : 'Allow'}
          </Button>
        </Stack>
      </Box>
      {Footer && <Footer />}
    </Stack>
  );
}

interface ScopeRowProps {
  scope: ConsentScope;
  checked: boolean;
  disabled: boolean;
  icon: ReactNode;
  onChange: (on: boolean) => void;
}

function ScopeRow({ scope, checked, disabled, icon, onChange }: ScopeRowProps): ReactElement {
  const descriptionId = `oauth-scope-${scope.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-description`;
  const label = (
    <Box sx={{ py: 0.75 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        {icon}
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {scope.title}
        </Typography>
        {scope.required && scope.grantable && (
          <Typography variant="caption" color="text.secondary">
            (always included)
          </Typography>
        )}
        {scope.alreadyGranted && !scope.required && (
          <Typography variant="caption" color="text.secondary">
            (already allowed)
          </Typography>
        )}
      </Stack>
      <Box id={descriptionId}>
        {!scope.grantable ? (
          <Typography variant="caption" color="text.secondary" component="p">
            {UNGRANTABLE_TEXT}
          </Typography>
        ) : scope.risk === 'high' ? (
          <Stack direction="row" spacing={0.5} alignItems="flex-start">
            <WarningAmberIcon fontSize="small" color="warning" sx={{ mt: 0.25 }} aria-hidden />
            <Typography variant="caption" component="p" sx={{ color: 'warning.main' }}>
              Warning: {scope.description}
            </Typography>
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary" component="p">
            {scope.description}
          </Typography>
        )}
      </Box>
    </Box>
  );

  // A required scope the account can use: listed with a check, not a checkbox.
  if (scope.required && scope.grantable) {
    return (
      <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ pl: 1.25 }}>
        <CheckCircleOutlineIcon color="success" sx={{ mt: 1 }} aria-hidden />
        {label}
      </Stack>
    );
  }

  return (
    <FormControlLabel
      sx={{ alignItems: 'flex-start', mx: 0 }}
      control={
        <Checkbox
          checked={checked}
          disabled={disabled || !scope.grantable}
          onChange={(event) => onChange(event.target.checked)}
          slotProps={{ input: { 'aria-describedby': descriptionId } }}
          sx={{ p: 1.25 }}
        />
      }
      label={label}
    />
  );
}
