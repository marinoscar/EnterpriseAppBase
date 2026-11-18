/**
 * An app's own channel in the notifications pages (PP-14.10).
 *
 * A channel the app registers (`slack` here) needs no edit in this package to be
 * drawn: the broadcast composer, the preferences matrix and the admin
 * Notifications page all read the channel descriptors the API serves. The
 * built-in markup staying identical is `NotificationsUi.builtin-dom.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { mockAdminUser, render } from './test-utils.js';
import { BroadcastComposer } from '../../src/notifications/ui/BroadcastComposer.js';
import { NotificationSettings, type ChannelState } from '../../src/notifications/ui/NotificationSettings.js';
import NotificationSettingsPage from '../../src/notifications/ui/NotificationSettingsPage.js';
import type { NotificationEventDef } from '../../src/notifications/headless/types.js';
import { builtinChannelDescriptors, channelsHookReturn, slackDescriptor } from './channels-fixture.js';

vi.mock('../../src/notifications/headless/useNotificationConfig.js', () => ({ useNotificationConfig: vi.fn() }));
vi.mock('../../src/notifications/headless/useNotificationChannels.js', () => ({ useNotificationChannels: vi.fn() }));
vi.mock('../../src/notifications/headless/useNotificationEvents.js', () => ({ useNotificationEvents: vi.fn() }));
vi.mock('../../src/settings/headless/use-system-settings.js', () => ({ useSystemSettings: vi.fn() }));
vi.mock('../../src/identity/headless/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/identity/headless/index.js')>()),
  usePermissions: vi.fn(),
}));

import { useNotificationConfig } from '../../src/notifications/headless/useNotificationConfig.js';
import { useNotificationChannels } from '../../src/notifications/headless/useNotificationChannels.js';
import { useNotificationEvents } from '../../src/notifications/headless/useNotificationEvents.js';
import { useSystemSettings } from '../../src/settings/headless/use-system-settings.js';
import { usePermissions } from '../../src/identity/headless/index.js';

const mockConfig = vi.mocked(useNotificationConfig);
const mockChannels = vi.mocked(useNotificationChannels);
const mockEvents = vi.mocked(useNotificationEvents);
const mockSettings = vi.mocked(useSystemSettings as unknown as (...args: unknown[]) => any);
const mockPermissions = vi.mocked(usePermissions);

const SLACK = slackDescriptor();

// ---------------------------------------------------------------------------
// The broadcast composer
// ---------------------------------------------------------------------------

describe('the broadcast composer', () => {
  const onSubmit = vi.fn().mockResolvedValue(true);

  function renderComposer() {
    return render(<BroadcastComposer open onClose={vi.fn()} audience={10} isWorking={false} onSubmit={onSubmit} onSendTest={vi.fn()} />);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.mockReturnValue({
      config: { browserEnabled: true, pushEnabled: true, vapidPublicKey: 'key' },
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  async function compose(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/^title/i), 'Planned maintenance');
    await user.type(screen.getByLabelText(/^body/i), 'We will be offline from 01:00.');
  }

  it("offers an app's channel with the label the API gave it, after the platform's, unselected", () => {
    mockChannels.mockReturnValue(channelsHookReturn([...builtinChannelDescriptors(), SLACK]));
    renderComposer();

    const labels = screen.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent);
    expect(labels).toEqual(['In-app', 'Email', 'Push', 'Slack']);
    expect(screen.getByRole('checkbox', { name: 'Slack' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'In-app' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Email' })).toBeChecked();
  });

  it('sends the channel the admin selected, an app channel included', async () => {
    mockChannels.mockReturnValue(channelsHookReturn([...builtinChannelDescriptors(), SLACK]));
    const user = userEvent.setup();
    renderComposer();
    await compose(user);

    await user.click(screen.getByRole('checkbox', { name: 'Slack' }));
    expect(screen.getByText(/over In-app, Email and Slack|over In-app and Email and Slack/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^send…$/i }));
    await user.click(screen.getByRole('button', { name: 'Send broadcast' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ channels: ['browser', 'email', 'slack'], critical: false }));
  });

  it("starts from the API's defaults, not from a list in the bundle", () => {
    mockChannels.mockReturnValue(
      channelsHookReturn([
        { ...builtinChannelDescriptors()[0]!, broadcastDefault: false },
        { ...builtinChannelDescriptors()[1]!, broadcastDefault: false },
        builtinChannelDescriptors()[2]!,
        { ...SLACK, broadcastDefault: true },
      ]),
    );
    renderComposer();

    expect(screen.getByRole('checkbox', { name: 'Slack' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Email' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'In-app' })).not.toBeChecked();
  });

  it('hides a channel the broadcast events do not declare', () => {
    mockChannels.mockReturnValue(channelsHookReturn([...builtinChannelDescriptors(), slackDescriptor({ id: 'android_app', label: 'Android app', broadcastCapable: false })]));
    renderComposer();

    expect(screen.queryByRole('checkbox', { name: 'Android app' })).not.toBeInTheDocument();
  });

  it('locks the last critical-capable channel while Important is on, and unlocks it once another one is selected', async () => {
    mockChannels.mockReturnValue(channelsHookReturn([...builtinChannelDescriptors(), slackDescriptor({ criticalCapable: true })]));
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole('switch'));
    expect(screen.getByRole('checkbox', { name: 'In-app' })).toBeDisabled();

    // A second critical-capable channel beside it: neither is the last one.
    await user.click(screen.getByRole('checkbox', { name: 'Slack' }));
    expect(screen.getByRole('checkbox', { name: 'In-app' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Slack' })).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: 'In-app' }));
    expect(screen.getByRole('checkbox', { name: 'Slack' })).toBeDisabled();
  });

  it('turns the first critical-capable channel on when Important is chosen with none selected', async () => {
    mockChannels.mockReturnValue(channelsHookReturn(builtinChannelDescriptors()));
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole('checkbox', { name: 'In-app' }));
    expect(screen.getByRole('checkbox', { name: 'In-app' })).not.toBeChecked();
    await user.click(screen.getByRole('switch'));
    expect(screen.getByRole('checkbox', { name: 'In-app' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'In-app' })).toBeDisabled();
  });

  it('offers no channel and no "select at least one" message while the channels are loading', () => {
    mockChannels.mockReturnValue(channelsHookReturn(null));
    renderComposer();

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText(/select at least one channel/i)).not.toBeInTheDocument();
  });

  it('says so when the channels could not be read, and sends nothing', async () => {
    mockChannels.mockReturnValue(channelsHookReturn(null, { error: 'Failed to load notification channels' }));
    const user = userEvent.setup();
    renderComposer();
    await compose(user);

    expect(screen.getByText('Failed to load notification channels')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^send…$/i })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// The preferences matrix
// ---------------------------------------------------------------------------

const event = (overrides: Partial<NotificationEventDef>): NotificationEventDef => ({
  key: 'billing.invoice_ready',
  label: 'Invoice ready',
  description: 'An invoice is ready.',
  channels: ['email', 'slack'],
  declaredChannels: ['email', 'slack'],
  defaultEnabled: true,
  mandatory: false,
  ...overrides,
});

describe('the preferences matrix', () => {
  const props = { preferences: undefined, onToggle: vi.fn(), browserCapability: 'granted' as const };

  it("labels an app's channel with the label the API gave it, in the switch and its accessible name", () => {
    render(<NotificationSettings {...props} events={[event({})]} channels={[...builtinChannelDescriptors(), SLACK]} />);

    expect(screen.getByRole('switch', { name: 'Slack notifications for Invoice ready' })).toBeChecked();
    expect(screen.getByText('Slack')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('falls back to the raw id while the descriptors are not known, and never to a blank label', () => {
    render(<NotificationSettings {...props} events={[event({})]} />);

    expect(screen.getByRole('switch', { name: 'slack notifications for Invoice ready' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'email notifications for Invoice ready' })).toBeInTheDocument();
  });

  it("writes the app channel's id when its switch moves", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<NotificationSettings {...props} onToggle={onToggle} events={[event({})]} channels={[...builtinChannelDescriptors(), SLACK]} />);

    await user.click(screen.getByRole('switch', { name: 'Slack notifications for Invoice ready' }));

    expect(onToggle).toHaveBeenCalledWith('slack', expect.objectContaining({ key: 'billing.invoice_ready' }), false);
  });

  it("gates an app's channel column and shows its banner, exactly as the built-in push column", () => {
    const states: Record<string, ChannelState> = {
      slack: {
        disabled: true,
        note: 'Link your Slack account first',
        alert: { severity: 'info', title: 'Slack is not linked', body: 'Link your account to receive these in Slack.' },
      },
    };
    render(<NotificationSettings {...props} events={[event({})]} channels={[...builtinChannelDescriptors(), SLACK]} channelStates={states} />);

    expect(screen.getByRole('switch', { name: 'Slack notifications for Invoice ready' })).toBeDisabled();
    expect(screen.getByText('Link your Slack account first')).toBeInTheDocument();
    expect(screen.getByText('Slack is not linked')).toBeInTheDocument();
    // The email column is untouched.
    expect(screen.getByRole('switch', { name: 'Email notifications for Invoice ready' })).toBeEnabled();
  });

  it('shows no banner for a gated channel no event declares', () => {
    const states: Record<string, ChannelState> = {
      slack: { disabled: true, note: null, alert: { severity: 'info', title: 'Slack is not linked', body: 'x' } },
    };
    render(<NotificationSettings {...props} events={[event({ channels: ['email'], declaredChannels: ['email'] })]} channelStates={states} />);

    expect(screen.queryByText('Slack is not linked')).not.toBeInTheDocument();
  });

  it('shows the push banner from the built-in state, not from a constant of its own', () => {
    render(<NotificationSettings {...props} events={[event({ channels: ['email', 'push'], declaredChannels: ['email', 'push'] })]} pushEnabled={false} />);

    expect(screen.getByText('Push notifications are not available yet')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The admin Notifications page
// ---------------------------------------------------------------------------

describe('the admin Notifications page', () => {
  const updateSettings = vi.fn().mockResolvedValue(undefined);

  function setup(notifications: Record<string, unknown>, permissions = ['system_settings:read', 'system_settings:write']) {
    mockPermissions.mockReturnValue({
      permissions: new Set(permissions),
      roles: new Set(['admin']),
      hasPermission: (permission: string) => permissions.includes(permission),
      hasAnyPermission: vi.fn(),
      hasAllPermissions: vi.fn(),
      hasRole: vi.fn(),
      hasAnyRole: vi.fn(),
      isAdmin: true,
    });
    mockSettings.mockReturnValue({
      settings: { notifications, updatedAt: '2024-01-15T10:30:00Z', updatedBy: null, version: 7 },
      isLoading: false,
      error: null,
      isSaving: false,
      updateSettings,
      replaceSettings: vi.fn(),
      refresh: vi.fn(),
    });
    mockEvents.mockReturnValue({ events: [], isLoading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined) });
    return render(<NotificationSettingsPage />, { wrapperOptions: { user: mockAdminUser } });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockChannels.mockReturnValue(channelsHookReturn([...builtinChannelDescriptors(), SLACK]));
  });

  const slackSwitch = () => screen.getByRole('switch', { name: 'Deliver Slack notifications' });

  it('draws one switch per app channel, labelled from the registry, and none for the platform channels', () => {
    setup({ browserEnabled: true, disabledEvents: [] });

    expect(slackSwitch()).toBeChecked();
    expect(screen.getByText('A message in the user\'s Slack.')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Deliver Email notifications' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Deliver Push notifications' })).not.toBeInTheDocument();
  });

  it('reads a stored switch, and an absent one as on', () => {
    setup({ browserEnabled: true, disabledEvents: [], channels: { slack: { enabled: false } } });

    expect(slackSwitch()).not.toBeChecked();
  });

  it('saves only the switch that moved, beside the original two fields', async () => {
    const user = userEvent.setup();
    setup({ browserEnabled: true, disabledEvents: [] });

    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    await user.click(slackSwitch());
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(updateSettings).toHaveBeenCalledWith({
      notifications: { browserEnabled: true, disabledEvents: [], channels: { slack: { enabled: false } } },
    });
  });

  it('leaves the payload as it was when no channel switch moved', async () => {
    const user = userEvent.setup();
    setup({ browserEnabled: true, disabledEvents: [], channels: { slack: { enabled: false } } });

    await user.click(screen.getByRole('switch', { name: /deliver browser notifications/i }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(updateSettings).toHaveBeenCalledWith({ notifications: { browserEnabled: false, disabledEvents: [] } });
  });

  it('is read-only for a viewer', () => {
    setup({ browserEnabled: true, disabledEvents: [] }, ['system_settings:read']);

    expect(slackSwitch()).toBeDisabled();
  });

  it('draws no channel section for a deployment with only the platform channels', () => {
    mockChannels.mockReturnValue(channelsHookReturn(builtinChannelDescriptors()));
    setup({ browserEnabled: true, disabledEvents: [] });

    expect(screen.queryByText('Delivery channels')).not.toBeInTheDocument();
  });

  it('draws the section once the descriptors arrive, and not while they load', () => {
    mockChannels.mockReturnValue(channelsHookReturn(null));
    setup({ browserEnabled: true, disabledEvents: [] });
    expect(screen.queryByText('Delivery channels')).not.toBeInTheDocument();
  });
});
