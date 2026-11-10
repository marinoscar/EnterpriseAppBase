/**
 * Telemetry services section of `/admin/settings/telemetry` (issue #567).
 *
 * Wire-level: the real `useTelemetryStack` runs against a test platform host
 * with shortened poll intervals, so these cover what the section SENDS as
 * well as renders.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { render, mockAdminUser } from '../harness.js';
import { createTestApiError } from '../../../src/testing/index.js';
import type { TestApiResponse } from '../../../src/testing/index.js';
import {
  mockTelemetryStackAgentDown,
  mockTelemetryStackMissing,
  mockTelemetryStackRunning,
  mockTelemetryStackUnavailable,
} from '../fixtures/telemetry.js';
import type { TelemetryStack, TelemetryStackDeploy } from '../../../src/telemetry/headless/services/telemetry.js';
import {
  AGENT_DOWN_MESSAGE,
  TelemetryServicesSection,
  UNAVAILABLE_MESSAGE,
  serviceChip,
} from '../../../src/telemetry/ui/components/TelemetryServicesSection.js';

/** The host's answers, read at call time; reset before each test. */
let routes: Record<string, TestApiResponse> = {};
beforeEach(() => {
  routes = {
    'GET /admin/telemetry/stack': mockTelemetryStackRunning,
    'POST /admin/telemetry/stack/deploy': { jobId: 'job-deploy-1' },
  };
});

/** Fast enough for a test, slow enough not to flood MSW. */
const FAST_POLL = { activeIntervalMs: 40, idleIntervalMs: 0 };

function renderSection(
  props: { canDeploy?: boolean; onDeployed?: () => void; pollOptions?: typeof FAST_POLL } = {},
) {
  return render(
    <TelemetryServicesSection
      canDeploy={props.canDeploy ?? true}
      onDeployed={props.onDeployed}
      pollOptions={props.pollOptions ?? FAST_POLL}
    />,
    { wrapperOptions: { user: mockAdminUser, route: '/admin/settings/telemetry', responses: routes } },
  );
}

function serveStack(stack: TelemetryStack) {
  routes['GET /admin/telemetry/stack'] = stack;
}

function deployJob(status: string, extra: Partial<TelemetryStackDeploy> = {}): TelemetryStackDeploy {
  return {
    jobId: 'job-deploy-1',
    status,
    createdAt: '2026-09-27T10:00:00.000Z',
    finishedAt: status === 'pending' || status === 'running' ? null : '2026-09-27T10:03:00.000Z',
    error: null,
    output: null,
    ...extra,
  };
}

/**
 * A stack whose GET answers follow `sequence` after the deploy POST; before
 * it, the missing stack. The last entry repeats.
 */
function serveDeploySequence(sequence: TelemetryStack[]) {
  const posts: number[] = [];
  let afterPost = -1;
  routes['POST /admin/telemetry/stack/deploy'] = () => {
    posts.push(Date.now());
    afterPost = 0;
    return { jobId: 'job-deploy-1' };
  };
  routes['GET /admin/telemetry/stack'] = () => {
    if (afterPost < 0) return mockTelemetryStackMissing;
    const stack = sequence[Math.min(afterPost, sequence.length - 1)];
    afterPost += 1;
    return stack;
  };
  return posts;
}

describe('serviceChip', () => {
  it('maps container state and health to a label and colour', () => {
    expect(serviceChip({ name: 'greptimedb', state: 'running', health: 'healthy' }).color).toBe('success');
    expect(serviceChip({ name: 'greptimedb', state: 'running', health: 'starting' }).color).toBe('info');
    expect(serviceChip({ name: 'greptimedb', state: 'missing', health: null }).color).toBe('error');
    expect(serviceChip({ name: 'greptimedb', state: 'exited', health: null }).color).toBe('error');
    expect(serviceChip({ name: 'greptimedb', state: 'dead', health: null }).color).toBe('error');
  });
});

describe('TelemetryServicesSection', () => {
  it('lists the running services with friendly names and offers a secondary Redeploy', async () => {
    renderSection();
    const section = screen.getByRole('region', { name: 'Telemetry services' });

    expect(await within(section).findByText('GreptimeDB (telemetry store)')).toBeInTheDocument();
    expect(within(section).getByText('OpenTelemetry collector')).toBeInTheDocument();
    expect(within(section).getByText('Running · healthy')).toBeInTheDocument();
    expect(within(section).getByText('Running')).toBeInTheDocument();

    const button = within(section).getByRole('button', { name: 'Redeploy' });
    expect(button).toBeEnabled();
    expect(button.className).toMatch(/outlined/i);
    // A settled job from before this visit is not news.
    expect(screen.queryByTestId('telemetry-services-succeeded')).not.toBeInTheDocument();
  });

  it('offers "Deploy GreptimeDB" when a service is not running', async () => {
    serveStack(mockTelemetryStackMissing);
    renderSection();

    const button = await screen.findByRole('button', { name: 'Deploy GreptimeDB' });
    expect(button.className).toMatch(/contained/i);
    expect(screen.getAllByText('Not deployed')).toHaveLength(2);
  });

  it('explains an unavailable agent without naming operator tooling', async () => {
    serveStack(mockTelemetryStackUnavailable);
    renderSection();

    const alert = await screen.findByTestId('telemetry-services-unavailable');
    expect(alert).toHaveTextContent(UNAVAILABLE_MESSAGE);
    expect(alert.textContent).not.toMatch(/appctl|compose/i);
    expect(screen.queryByRole('button', { name: /deploy/i })).not.toBeInTheDocument();
  });

  it('explains an unresponsive agent on a server deployment, with its reason', async () => {
    serveStack(mockTelemetryStackAgentDown);
    renderSection();

    const alert = await screen.findByTestId('telemetry-services-agent-down');
    expect(alert).toHaveTextContent(AGENT_DOWN_MESSAGE);
    expect(alert).toHaveTextContent(/Telemetry collection is unaffected\./);
    expect(within(alert).getByTestId('telemetry-services-agent-error')).toHaveTextContent(
      'connect ECONNREFUSED 172.18.0.5:8080',
    );
    // Not the development-stack message.
    expect(screen.queryByTestId('telemetry-services-unavailable')).not.toBeInTheDocument();
    expect(alert.textContent).not.toMatch(/server deployments|in development/i);
    expect(screen.queryByRole('button', { name: /deploy/i })).not.toBeInTheDocument();
  });

  it('omits the reason line when an unresponsive agent reports no error', async () => {
    serveStack({ ...mockTelemetryStackAgentDown, agentError: null });
    renderSection();

    const alert = await screen.findByTestId('telemetry-services-agent-down');
    expect(alert).toHaveTextContent(AGENT_DOWN_MESSAGE);
    expect(screen.queryByTestId('telemetry-services-agent-error')).not.toBeInTheDocument();
  });

  it('keeps the development message for "not_configured", without the agent-down alert', async () => {
    serveStack(mockTelemetryStackUnavailable);
    renderSection();

    const alert = await screen.findByTestId('telemetry-services-unavailable');
    expect(alert).toHaveTextContent(UNAVAILABLE_MESSAGE);
    expect(screen.queryByTestId('telemetry-services-agent-down')).not.toBeInTheDocument();
    expect(screen.queryByTestId('telemetry-services-agent-error')).not.toBeInTheDocument();
  });

  it('reports mismatched internal credentials as an error', async () => {
    serveStack({ ...mockTelemetryStackUnavailable, agent: 'unauthorized' });
    renderSection();

    const alert = await screen.findByTestId('telemetry-services-unauthorized');
    expect(alert).toHaveTextContent(/internal service credentials don.t match/);
    expect(alert).toHaveTextContent(/update the application/i);
  });

  it('shows the agent\'s reason under a refused deployment', async () => {
    serveStack({ ...mockTelemetryStackUnavailable, agent: 'unauthorized', agentError: 'HTTP 401' });
    renderSection();

    const alert = await screen.findByTestId('telemetry-services-unauthorized');
    expect(within(alert).getByTestId('telemetry-services-agent-error')).toHaveTextContent('HTTP 401');
  });

  it('disables the button without system_settings:write', async () => {
    renderSection({ canDeploy: false });

    expect(await screen.findByRole('button', { name: 'Redeploy' })).toBeDisabled();
    expect(screen.getByText('system_settings:write')).toBeInTheDocument();
  });

  it('POSTs the deploy, shows progress, polls to success and calls onDeployed once', async () => {
    const onDeployed = vi.fn();
    const posts = serveDeploySequence([
      { ...mockTelemetryStackMissing, deploy: deployJob('pending') },
      { ...mockTelemetryStackMissing, deploy: deployJob('running') },
      {
        ...mockTelemetryStackRunning,
        services: [
          { name: 'greptimedb', state: 'running', health: 'starting' },
          { name: 'otel-collector', state: 'running', health: null },
        ],
        deploy: deployJob('running'),
      },
      { ...mockTelemetryStackRunning, deploy: deployJob('succeeded') },
    ]);
    const user = userEvent.setup();
    renderSection({ onDeployed });

    await user.click(await screen.findByRole('button', { name: 'Deploy GreptimeDB' }));
    expect(posts).toHaveLength(1);

    const progress = await screen.findByTestId('telemetry-services-deploying');
    expect(progress).toHaveTextContent(
      /Deploying… this can take a few minutes the first time while the image downloads/,
    );
    expect(screen.getByRole('button', { name: 'Deploy GreptimeDB' })).toBeDisabled();
    expect(screen.getByTestId('telemetry-services-live')).toHaveTextContent(
      'Deploying the telemetry services.',
    );

    expect(await screen.findByTestId('telemetry-services-succeeded')).toBeInTheDocument();
    expect(screen.queryByTestId('telemetry-services-deploying')).not.toBeInTheDocument();
    expect(onDeployed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Redeploy' })).toBeEnabled();
    expect(screen.getByTestId('telemetry-services-live')).toHaveTextContent(
      'The telemetry services were deployed.',
    );
  });

  it('shows the failure and its output behind a Details toggle', async () => {
    const onDeployed = vi.fn();
    serveDeploySequence([
      { ...mockTelemetryStackMissing, deploy: deployJob('running') },
      {
        ...mockTelemetryStackMissing,
        deploy: deployJob('failed', {
          error: 'Pulling the GreptimeDB image failed',
          output: 'step 1\nstep 2: pull failed',
        }),
      },
    ]);
    const user = userEvent.setup();
    renderSection({ onDeployed });

    await user.click(await screen.findByRole('button', { name: 'Deploy GreptimeDB' }));

    const failure = await screen.findByTestId('telemetry-services-failed');
    expect(failure).toHaveTextContent('Pulling the GreptimeDB image failed');
    expect(onDeployed).not.toHaveBeenCalled();

    const details = within(failure).getByRole('button', { name: 'Details' });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    await user.click(details);
    const output = await within(failure).findByText(/step 2: pull failed/);
    expect(output.tagName).toBe('PRE');
    expect(within(failure).getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId('telemetry-services-live')).toHaveTextContent(
      'The telemetry services deployment failed.',
    );
    // A failed deploy can be retried.
    expect(screen.getByRole('button', { name: 'Deploy GreptimeDB' })).toBeEnabled();
  });

  it('shows the API message when the deploy is refused', async () => {
    serveStack(mockTelemetryStackMissing);
    routes['POST /admin/telemetry/stack/deploy'] = () => {
      throw createTestApiError(409, 'No deployment agent is configured', 'CONFLICT');
    };
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Deploy GreptimeDB' }));
    expect(await screen.findByText('No deployment agent is configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deploy GreptimeDB' })).toBeEnabled();
  });

  it('stops polling on unmount', async () => {
    let gets = 0;
    routes['GET /admin/telemetry/stack'] = () => {
      gets += 1;
      return { ...mockTelemetryStackMissing, deploy: deployJob('running') };
    };
    const { unmount } = renderSection();

    await screen.findByTestId('telemetry-services-deploying');
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(3));
    unmount();
    const atUnmount = gets;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(gets).toBeLessThanOrEqual(atUnmount + 1);
  });
});
