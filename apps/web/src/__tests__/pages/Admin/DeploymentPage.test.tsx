/**
 * Admin → Operations → Deployment (`/admin/settings/deployment`), issue #392,
 * epic #388.
 *
 * `useDeployment` is mocked, the pattern `WorkersPage.test.tsx` and
 * `PushConfigPage.test.tsx` both use: the fetch layer has its own contract and
 * driving it through the real client here would test the transport twice while
 * making every assertion wait on it. What this suite covers is what could be
 * wrong while the hook is perfectly fine:
 *
 *   * a POPULATED v2 record renders all five sections;
 *   * a **v1** record — no `host`, no `proxy`, no `history` — renders the
 *     sections it has and OMITS the three it does not, rather than drawing
 *     three headings over three em dashes;
 *   * `configured: false` is a CALM panel that names the reason, is not styled
 *     as a failure, and still shows what is known about the running container;
 *   * a genuine request failure looks nothing like `configured: false`;
 *   * no value from the state file reaches an `href` unvalidated — an
 *     `ssh://`/`git@` remote renders as text, never as a link;
 *   * the certificate warning is carried by WORDS, not by colour alone.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render, mockAdminUser, type MockUser } from '../../utils/test-utils';
import {
  installLayoutStubs,
  resetContainerWidth,
  setInitialContainerWidth,
} from '../../../components/datatable/__tests__/testUtils/layoutStubs';
import { api } from '../../../services/api';
import type {
  DeploymentProxy,
  DeploymentRecord,
  DeploymentResponse,
} from '../../../services/deployment';

vi.mock('../../../hooks/useDeployment', () => ({
  useDeployment: vi.fn(),
}));

import { useDeployment } from '../../../hooks/useDeployment';
import DeploymentPage from '../../../pages/Admin/DeploymentPage';

const mockUseDeployment = vi.mocked(useDeployment);

// ---------------------------------------------------------------------------
// Fixtures
//
// EVERY TIMESTAMP IS COMPUTED ONCE, at module scope, rather than inside a
// factory. A factory called twice returns two different instants, and a test
// asserting the absolute timestamp the page rendered would be comparing it
// against a string built milliseconds later.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * Relative to the real clock, so the page's own `new Date()` judges them.
 *
 * Every fixture timestamp is computed ONCE, at module scope, rather than inside
 * a factory: a factory called twice returns two different instants, and a test
 * that asserts the absolute timestamp it rendered would be comparing against a
 * string built milliseconds later.
 */
function inDays(days: number): string {
  // The extra hour keeps `Math.floor` off the boundary: a value exactly N days
  // out lands on N or N-1 depending on sub-millisecond timing.
  return new Date(Date.now() + days * DAY_MS + 3_600_000).toISOString();
}

const LAST_DEPLOYED_AT = new Date(Date.now() - 3 * 3_600_000).toISOString();
const INSTALLED_AT = new Date(Date.now() - 90 * DAY_MS).toISOString();
const PREVIOUS_DEPLOY_AT = new Date(Date.now() - 6 * DAY_MS).toISOString();

const RUNTIME = {
  apiVersion: '2.4.1',
  startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  nodeVersion: 'v22.11.0',
  nodeEnv: 'production',
  hostname: 'a1f2e3d4c5b6',
};

const HOST = {
  hostname: 'prod-app-01',
  os: 'Ubuntu 24.04.1 LTS',
  kernel: '6.8.0-45-generic',
  arch: 'x64',
  cpus: 4,
  memoryBytes: 8 * 1024 * 1024 * 1024,
  dockerVersion: '27.3.1',
  composeVersion: 'v2.29.7',
  publicIp: '203.0.113.42',
};

const PROXY: DeploymentProxy = {
  domain: 'app.example.com',
  bindPort: 8080,
  container: 'shared-proxy',
  mode: 'container',
  certNotAfter: inDays(120),
};

const CURRENT_SHA = 'aaaaaaa1111111111111111111111111111111bb';
const PREVIOUS_SHA = 'ccccccc2222222222222222222222222222222dd';
const OLDER_SHA = 'eeeeeee3333333333333333333333333333333ff';

/** A full v2 record: host, proxy and history all present. */
const V2_RECORD: DeploymentRecord = {
  version: 2,
  repoUrl: 'https://github.com/acme/widget.git',
  ref: 'main',
  commitSha: CURRENT_SHA,
  previousSha: PREVIOUS_SHA,
  domain: 'app.example.com',
  bindPort: 8080,
  deployRoot: '/opt/acme-widget',
  installedAt: INSTALLED_AT,
  lastDeployedAt: LAST_DEPLOYED_AT,
  lastCommand: 'update',
  appctlVersion: '1.9.2',
  host: HOST,
  proxy: PROXY,
  history: [
    {
      at: LAST_DEPLOYED_AT,
      command: 'update',
      commitSha: CURRENT_SHA,
      previousSha: PREVIOUS_SHA,
      ref: 'main',
      durationMs: 94_000,
      appctlVersion: '1.9.2',
      outcome: 'success',
    },
    {
      at: PREVIOUS_DEPLOY_AT,
      command: 'update',
      commitSha: OLDER_SHA,
      ref: 'main',
      durationMs: 61_000,
      appctlVersion: '1.9.0',
      outcome: 'failed',
    },
  ],
};

/** A v1 record: the three optional groups are absent, not empty. */
const V1_RECORD: DeploymentRecord = {
  version: 1,
  repoUrl: 'https://github.com/acme/widget.git',
  ref: 'v1.4.0',
  commitSha: CURRENT_SHA,
  domain: 'app.example.com',
  bindPort: 8080,
  deployRoot: '/opt/acme-widget',
  installedAt: INSTALLED_AT,
  lastDeployedAt: INSTALLED_AT,
  lastCommand: 'install',
  appctlVersion: '0.9.0',
};

const STATE_PATH = '/opt/app/state/deploy-state.json';

/** A successful response carrying `record`. */
function configured(record: DeploymentRecord): DeploymentResponse {
  return {
    configured: true,
    source: { path: STATE_PATH },
    runtime: RUNTIME,
    deployment: record,
  };
}

/** The v2 response with one part of the record replaced. */
function v2With(patch: Partial<DeploymentRecord>): DeploymentResponse {
  return configured({ ...V2_RECORD, ...patch });
}

function unconfigured(
  reason: DeploymentResponse['source']['reason'] = 'not-found',
): DeploymentResponse {
  return {
    configured: false,
    source: { path: STATE_PATH, reason },
    runtime: RUNTIME,
  };
}

function setHook(overrides: Partial<ReturnType<typeof useDeployment>> = {}) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  mockUseDeployment.mockReturnValue({
    deployment: configured(V2_RECORD),
    isLoading: false,
    loadError: null,
    refresh,
    ...overrides,
  });
  return { refresh };
}

/** An admin holding exactly the permissions named. */
function userWith(permissions: string[]): MockUser {
  return { ...mockAdminUser, permissions };
}

function renderPage(permissions: string[] = ['deployment:read'], width = 1400) {
  setInitialContainerWidth(width);
  return render(<DeploymentPage />, { wrapperOptions: { user: userWith(permissions) } });
}

/** The panel with this test id, or `null` when the page omitted it. */
function section(testId: string): HTMLElement | null {
  return screen.queryByTestId(testId);
}

// ---------------------------------------------------------------------------

describe('DeploymentPage', () => {
  beforeAll(() => {
    installLayoutStubs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetContainerWidth(1400);
    // The history table persists its layout under `user_settings.dataTables`.
    vi.spyOn(api, 'get').mockResolvedValue({ dataTables: {} } as never);
    vi.spyOn(api, 'patch').mockResolvedValue({} as never);
    setHook();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Reachability
  // =========================================================================

  it('redirects a user without deployment:read away, rather than rendering an empty page', () => {
    renderPage(['jobs:read']);

    expect(
      screen.queryByRole('heading', { level: 1, name: 'Deployment' }),
    ).not.toBeInTheDocument();
  });

  it('renders for a deployment:read holder', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Deployment' })).toBeInTheDocument();
  });

  it('offers no control that claims to change the deployment', () => {
    // The page is read-only for EVERYBODY — not as a permission decision but
    // because a deployment is changed by running `appctl deploy` on the server.
    // `Refresh` re-reads; nothing else may appear here.
    renderPage();

    const buttonNames = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.trim())
      .filter((name): name is string => Boolean(name));

    expect(buttonNames).toContain('Refresh');
    expect(buttonNames).not.toContain('Save');
    expect(buttonNames).not.toContain('Deploy');
  });

  // =========================================================================
  // A populated v2 record
  // =========================================================================

  describe('a populated v2 record', () => {
    it('renders all five sections', () => {
      renderPage();

      expect(section('deployment-last')).toBeInTheDocument();
      expect(section('deployment-serving')).toBeInTheDocument();
      expect(section('deployment-host')).toBeInTheDocument();
      expect(section('deployment-runtime')).toBeInTheDocument();
      expect(section('deployment-history')).toBeInTheDocument();
    });

    it('says when the last deploy happened, both relatively and absolutely', () => {
      renderPage();

      const last = within(section('deployment-last')!);
      expect(last.getByText('Last deployed')).toBeInTheDocument();
      // The relative reading is what somebody actually asks for...
      expect(last.getAllByText(/hours ago/).length).toBeGreaterThan(0);
      // ...and the absolute one is what goes in the incident timeline.
      expect(
        last.getAllByText(new Date(LAST_DEPLOYED_AT).toLocaleString()).length,
      ).toBeGreaterThan(0);
    });

    it('says whether it was an install or an update', () => {
      renderPage();

      expect(within(section('deployment-last')!).getByText('Update')).toBeInTheDocument();
    });

    it('shows the short commit AND keeps the full sha selectable', () => {
      renderPage();

      const last = within(section('deployment-last')!);
      expect(last.getAllByText('aaaaaaa').length).toBeGreaterThan(0);
      // Not behind a tooltip: the thing an administrator does with a full sha
      // is paste it, and tooltip text cannot be selected.
      expect(last.getByText(CURRENT_SHA)).toBeInTheDocument();
    });

    it('links the commit to the forge for an https repository URL', () => {
      renderPage();

      const link = within(section('deployment-last')!).getAllByRole('link', {
        name: /aaaaaaa/,
      })[0];
      expect(link).toHaveAttribute(
        'href',
        `https://github.com/acme/widget/commit/${CURRENT_SHA}`,
      );
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });

    it('reports the ref and the appctl version', () => {
      renderPage();

      const last = within(section('deployment-last')!);
      expect(last.getByText('main')).toBeInTheDocument();
      expect(last.getByText('1.9.2')).toBeInTheDocument();
    });

    it('links the domain and reports the port, the proxy container and its mode', () => {
      renderPage();

      const serving = within(section('deployment-serving')!);
      expect(serving.getByRole('link', { name: /app\.example\.com/ })).toHaveAttribute(
        'href',
        'https://app.example.com',
      );
      expect(serving.getByText('8080')).toBeInTheDocument();
      expect(serving.getByText('shared-proxy')).toBeInTheDocument();
      expect(serving.getByText('Container')).toBeInTheDocument();
    });

    it('describes the host in human units', () => {
      renderPage();

      const host = within(section('deployment-host')!);
      expect(host.getByText('prod-app-01')).toBeInTheDocument();
      expect(host.getByText('Ubuntu 24.04.1 LTS')).toBeInTheDocument();
      expect(host.getByText('6.8.0-45-generic')).toBeInTheDocument();
      expect(host.getByText('x64')).toBeInTheDocument();
      expect(host.getByText('4')).toBeInTheDocument();
      // Not "8589934592".
      expect(host.getByText('8.0 GB')).toBeInTheDocument();
      expect(host.getByText('27.3.1')).toBeInTheDocument();
      expect(host.getByText('203.0.113.42')).toBeInTheDocument();
    });

    it('lists the history with its outcomes', async () => {
      renderPage();

      const history = within(section('deployment-history')!);
      expect(await history.findByText('eeeeeee')).toBeInTheDocument();
      // The failed row says "Failed" in words, not only in red.
      expect(history.getByText('Failed')).toBeInTheDocument();
      expect(history.getAllByText('Succeeded').length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // The untrusted-value rule
  // =========================================================================

  describe('values that came out of a file on a server’s disk', () => {
    it('renders an ssh remote as text and builds no commit link from it', () => {
      setHook({ deployment: v2With({ repoUrl: 'git@github.com:acme/widget.git' }) });
      renderPage();

      const last = within(section('deployment-last')!);
      expect(last.getByText('git@github.com:acme/widget.git')).toBeInTheDocument();
      expect(last.queryByRole('link', { name: /aaaaaaa/ })).not.toBeInTheDocument();
    });

    it('never turns a javascript: repository URL into a link', () => {
      setHook({ deployment: v2With({ repoUrl: 'javascript:alert(1)' }) });
      renderPage();

      for (const link of screen.queryAllByRole('link')) {
        expect(link.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
      }
    });

    it('renders a domain that is not a hostname as text rather than a link', () => {
      setHook({
        deployment: v2With({
          domain: 'not a domain',
          proxy: { ...PROXY, domain: 'not a domain' },
        }),
      });
      renderPage();

      const serving = within(section('deployment-serving')!);
      expect(serving.getByText('not a domain')).toBeInTheDocument();
      expect(serving.queryByRole('link')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // The certificate warning — never colour alone
  // =========================================================================

  describe('certificate expiry', () => {
    it('warns in WORDS when the certificate is inside the 30-day window', () => {
      setHook({ deployment: v2With({ proxy: { ...PROXY, certNotAfter: inDays(9) } }) });
      renderPage();

      expect(
        within(section('deployment-serving')!).getByText('Expires in 9 days'),
      ).toBeInTheDocument();
    });

    it('says so in WORDS when the certificate has already expired', () => {
      setHook({ deployment: v2With({ proxy: { ...PROXY, certNotAfter: inDays(-4) } }) });
      renderPage();

      expect(
        within(section('deployment-serving')!).getByText(/^Expired \d+ days? ago$/),
      ).toBeInTheDocument();
    });

    it('does not shout about a certificate with months left', () => {
      renderPage();

      const serving = within(section('deployment-serving')!);
      expect(serving.queryByText(/^Expired/)).not.toBeInTheDocument();
      expect(serving.queryByText(/^Expires in/)).not.toBeInTheDocument();
    });

    it('says the certificate was not reported rather than inventing a date', () => {
      const proxyWithoutCert: DeploymentProxy = {
        domain: PROXY.domain,
        bindPort: PROXY.bindPort,
        container: PROXY.container,
        mode: PROXY.mode,
      };
      setHook({ deployment: v2With({ proxy: proxyWithoutCert }) });
      renderPage();

      expect(
        within(section('deployment-serving')!).getByText('Not reported'),
      ).toBeInTheDocument();
    });
  });

  // =========================================================================
  // A v1 state file
  // =========================================================================

  describe('a v1 state file', () => {
    it('omits Host and History entirely rather than rendering them empty', () => {
      setHook({ deployment: configured(V1_RECORD) });
      renderPage();

      expect(section('deployment-host')).not.toBeInTheDocument();
      expect(section('deployment-history')).not.toBeInTheDocument();
      // Serving still renders — a v1 file records the domain and the port —
      // but carries no proxy rows.
      const serving = within(section('deployment-serving')!);
      expect(serving.queryByText('Proxy container')).not.toBeInTheDocument();
      expect(serving.queryByText('Certificate expires')).not.toBeInTheDocument();
    });

    it('still answers the headline question, and says which schema it is reading', () => {
      setHook({ deployment: configured(V1_RECORD) });
      renderPage();

      const last = within(section('deployment-last')!);
      expect(last.getByText('Install')).toBeInTheDocument();
      expect(last.getByText('v1.4.0')).toBeInTheDocument();
      // The version is what explains the missing sections.
      expect(last.getByText('v1')).toBeInTheDocument();
      // A first install has no predecessor, and that is said in words rather
      // than left as an em dash.
      expect(last.getAllByText(/first install/i).length).toBeGreaterThan(0);
    });

    it('says a deployment with no domain is reached by IP, rather than showing a dash', () => {
      setHook({ deployment: configured({ ...V1_RECORD, domain: undefined }) });
      renderPage();

      expect(
        within(section('deployment-serving')!).getByText(/reached by IP address/i),
      ).toBeInTheDocument();
    });

    it('still renders the running container’s own facts', () => {
      setHook({ deployment: configured(V1_RECORD) });
      renderPage();

      expect(section('deployment-runtime')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // configured: false — the calm case, and the one most often seen
  // =========================================================================

  describe('when there is no deployment record', () => {
    it('explains itself without looking like a failure', () => {
      setHook({ deployment: unconfigured('not-found') });
      renderPage();

      const panel = screen.getByTestId('deployment-not-configured');
      expect(panel).toBeInTheDocument();
      // `info`, never `error` and never `warning`: the endpoint answered 200
      // and the application is working. The severity is asserted through the
      // class MUI derives from it, because that is what a reader actually sees.
      expect(panel.className).toMatch(/Info/);
      expect(panel.className).not.toMatch(/Error/);
      expect(panel.className).not.toMatch(/Warning/);
      expect(within(panel).getByText(/not installed by/i)).toBeInTheDocument();
      expect(within(panel).getByText(/Nothing is wrong/i)).toBeInTheDocument();
    });

    it('names the reason the API gave, and they are three different sentences', () => {
      setHook({ deployment: unconfigured('unreadable') });
      const { unmount } = renderPage();
      expect(screen.getByText(/could not read it/i)).toBeInTheDocument();
      unmount();

      setHook({ deployment: unconfigured('invalid') });
      renderPage();
      expect(screen.getByText(/could not be understood/i)).toBeInTheDocument();
    });

    it('says where it looked', () => {
      setHook({ deployment: unconfigured('not-found') });
      renderPage();

      expect(screen.getByText(STATE_PATH)).toBeInTheDocument();
    });

    it('still shows what IS known — the running container', () => {
      setHook({ deployment: unconfigured('not-found') });
      renderPage();

      const runtime = within(section('deployment-runtime')!);
      expect(runtime.getByText('2.4.1')).toBeInTheDocument();
      expect(runtime.getByText('a1f2e3d4c5b6')).toBeInTheDocument();
      expect(runtime.getByText('v22.11.0')).toBeInTheDocument();
      expect(runtime.getByText('production')).toBeInTheDocument();
    });

    it('draws none of the four sections that need a record', () => {
      setHook({ deployment: unconfigured('not-found') });
      renderPage();

      expect(section('deployment-last')).not.toBeInTheDocument();
      expect(section('deployment-serving')).not.toBeInTheDocument();
      expect(section('deployment-host')).not.toBeInTheDocument();
      expect(section('deployment-history')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // A genuine failure, which must look nothing like the case above
  // =========================================================================

  describe('when the request actually fails', () => {
    it('shows an error alert and no explanatory panel', () => {
      setHook({
        deployment: null,
        loadError: 'You do not have permission to view this deployment’s record',
      });
      renderPage();

      expect(screen.getByRole('alert')).toHaveTextContent(/do not have permission/i);
      expect(screen.queryByTestId('deployment-not-configured')).not.toBeInTheDocument();
      expect(section('deployment-runtime')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Loading
  // =========================================================================

  it('shows a spinner before the first answer, and no sections', () => {
    setHook({ deployment: null, isLoading: true });
    renderPage();

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(section('deployment-last')).not.toBeInTheDocument();
  });
});
