/**
 * `/admin/settings/email` — pluggable transports (PP-14.8).
 *
 * The radios are the transports the API describes; the two built-ins draw
 * their registered panel, every other transport is generated from its
 * descriptor; the page saves `{ provider, transports: { id: settings }, secrets }`.
 * `useEmailSettings` is mocked, as in the reference app's page test: this suite
 * is about what the page decides, not the hook's plumbing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

vi.mock('../../src/email/headless/use-email-settings.js', () => ({ useEmailSettings: vi.fn() }));

import { useEmailSettings } from '../../src/email/headless/use-email-settings.js';
import type { EmailSettings } from '../../src/email/headless/index.js';
import EmailSettingsPage from '../../src/email/ui/EmailSettingsPage.js';
import { registerEmailTransportPanel, resetEmailTransportPanelsForTests } from '../../src/email/ui/emailTransportPanelRegistry.js';
import type { EmailTransportPanelProps } from '../../src/email/ui/emailTransportPanelRegistry.js';
import {
  NO_SECRET,
  SAVED_SECRET,
  builtinDescriptors,
  emailSettingsFixture,
  freshSettingsFixture,
  logDescriptor,
  relayDescriptor,
  sesSettingsFixture,
} from './fixtures.js';
import { READ_ONLY_PERMISSIONS, hookReturn, render } from './harness.js';

const mockUseEmailSettings = vi.mocked(useEmailSettings);
const TYPED_SECRET = 'relay-key-TYPED-NEVER-RENDERED-77aa';

/** The fixture with the example `log` transport and the invented `relay-api` registered beside the built-ins. */
function withCustomTransports(overrides: Partial<EmailSettings> = {}): EmailSettings {
  const base = emailSettingsFixture();
  return {
    ...base,
    descriptors: [...builtinDescriptors(), logDescriptor(), relayDescriptor(true)],
    transports: {
      ...base.transports,
      log: { keep: 100 },
      'relay-api': { apiBase: 'https://relay.example.test', region: 'us', sandbox: false, retries: 1 },
    },
    secretStatuses: { ...base.secretStatuses, log: { sinkToken: NO_SECRET }, 'relay-api': { apiKey: SAVED_SECRET } },
    ...overrides,
  };
}

function setHook(settings: EmailSettings, overrides: Partial<ReturnType<typeof useEmailSettings>> = {}) {
  const hook = hookReturn({ settings, ...overrides });
  mockUseEmailSettings.mockReturnValue(hook);
  return { ...hook, save: vi.mocked(hook.save) };
}

const radio = (name: RegExp | string) => screen.getByRole('radio', { name });
const saveButton = () => screen.getByRole('button', { name: /save changes/i });

describe('EmailSettingsPage: transports from descriptors', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => resetEmailTransportPanelsForTests());

  it('lists one radio per described transport, labelled by the transport, the active one checked', () => {
    setHook(withCustomTransports());
    render(<EmailSettingsPage />);

    const group = screen.getByRole('radiogroup', { name: 'Provider' });
    expect(within(group).getAllByRole('radio').map((el) => el.closest('label')?.textContent)).toEqual([
      'Amazon SES',
      'SMTP',
      'Log (in memory)',
      'Relay API',
    ]);
    expect(radio('SMTP')).toBeChecked();
    expect(radio('Log (in memory)')).not.toBeChecked();
  });

  it('draws the registered panel for a built-in and no generic panel', () => {
    setHook(withCustomTransports());
    render(<EmailSettingsPage />);

    expect(screen.getByLabelText('Host')).toHaveValue('smtp.example.test');
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('type', 'password');
    expect(screen.queryByTestId('email-transport-panel-smtp')).not.toBeInTheDocument();
  });

  it('draws a generated panel for a transport without a registered panel, and the built-in one is gone, not hidden', async () => {
    setHook(withCustomTransports());
    render(<EmailSettingsPage />);

    await userEvent.setup().click(radio('Log (in memory)'));

    expect(screen.getByTestId('email-transport-panel-log')).toBeInTheDocument();
    expect(screen.getByLabelText('Messages kept')).toHaveValue(100);
    expect(screen.queryByLabelText('Host')).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing leaves this server/)).toBeInTheDocument();
  });

  it('saves only the provider, the shared settings and that transport\'s settings, with the loaded values', async () => {
    const { save } = setHook(withCustomTransports());
    render(<EmailSettingsPage />);
    const user = userEvent.setup();

    await user.click(radio('Log (in memory)'));
    const keep = screen.getByLabelText('Messages kept');
    await user.clear(keep);
    await user.type(keep, '25');
    await user.click(saveButton());

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      provider: 'log',
      enabled: true,
      fromAddress: 'no-reply@example.test',
      fromName: 'Example App',
      transports: { log: { keep: 25 } },
    });
  });

  it('takes a required secret write-only: sent under secrets.<id>.<name> only once typed, never pre-filled, and shown as saved', async () => {
    const { save } = setHook(withCustomTransports({ provider: 'relay-api' }));
    render(<EmailSettingsPage />);
    const user = userEvent.setup();

    // A stored secret is shown as saved, never as a value.
    expect(screen.getByText(/saved/i)).toBeInTheDocument();
    const key = screen.getByLabelText(/API key/);
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveValue('');

    // Dirty the form without touching the secret: it is not sent at all.
    await user.type(screen.getByLabelText('From name'), ' Edited');
    await user.click(saveButton());
    expect(save.mock.calls[0]![0]).not.toHaveProperty('secrets');

    await user.type(key, TYPED_SECRET);
    await user.type(screen.getByLabelText('From name'), '!');
    await user.click(saveButton());

    expect(save.mock.calls[1]![0]).toMatchObject({ provider: 'relay-api', secrets: { 'relay-api': { apiKey: TYPED_SECRET } } });
  });

  it('a typed secret alone makes the form dirty and saveable', async () => {
    const { save } = setHook(withCustomTransports({ provider: 'relay-api' }));
    render(<EmailSettingsPage />);
    const user = userEvent.setup();

    expect(saveButton()).toBeDisabled();
    await user.type(screen.getByLabelText(/API key/), TYPED_SECRET);
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());

    expect(save.mock.calls[0]![0]).toMatchObject({ secrets: { 'relay-api': { apiKey: TYPED_SECRET } } });
  });

  it('sends a text setting nobody filled in as an empty string, so a cleared field clears it', async () => {
    const { save } = setHook(withCustomTransports({ provider: 'relay-api' }));
    render(<EmailSettingsPage />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('API base URL'));
    await user.click(saveButton());

    expect(save.mock.calls[0]![0].transports).toEqual({ 'relay-api': expect.objectContaining({ apiBase: '' }) });
  });

  it('switches transport without losing the edits made to the one left, within the page', async () => {
    setHook(withCustomTransports());
    render(<EmailSettingsPage />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Host'));
    await user.type(screen.getByLabelText('Host'), 'edited.example.test');
    await user.click(radio('Amazon SES'));
    expect(screen.queryByLabelText('Host')).not.toBeInTheDocument();
    await user.click(radio('SMTP'));

    expect(screen.getByLabelText('Host')).toHaveValue('edited.example.test');
  });

  it('lists the transport it names in the test result by its label', () => {
    setHook(withCustomTransports({ provider: 'log' }), {
      testResult: { success: true, sentTo: 'admin@example.test', providerKind: 'log', messageId: 'log-1', error: null },
    });
    render(<EmailSettingsPage />);

    expect(screen.getByText(/via Log \(in memory\)/)).toBeInTheDocument();
  });

  it('names no transport for a test through one the API no longer describes', () => {
    setHook(withCustomTransports(), {
      testResult: { success: true, sentTo: 'admin@example.test', providerKind: 'gone-plugin', messageId: null, error: null },
    });
    render(<EmailSettingsPage />);

    expect(screen.getByText(/Sent to admin@example\.test\. Acceptance is not delivery/)).toBeInTheDocument();
    expect(screen.queryByText(/gone-plugin/)).not.toBeInTheDocument();
  });

  it('refuses to save while a selected transport the API no longer describes is on and offers the others', async () => {
    setHook(withCustomTransports({ provider: 'gone-plugin' }));
    render(<EmailSettingsPage />);

    expect(screen.getByText('The selected transport "gone-plugin" is not available. Choose another.')).toBeInTheDocument();
    // No panel for it, and the user can still pick a described transport.
    expect(screen.queryByTestId('email-transport-panel-gone-plugin')).not.toBeInTheDocument();
    await userEvent.setup().click(radio('SMTP'));
    expect(screen.queryByText(/is not available/)).not.toBeInTheDocument();
  });

  it('a fresh install shows no panel until a transport is picked, then the picked transport\'s', async () => {
    setHook(freshSettingsFixture({ descriptors: [...builtinDescriptors(), logDescriptor()], transports: { ses: { region: '', accessKeyId: '' }, smtp: { host: '', port: 587, useTls: true, username: '' }, log: { keep: 100 } } }));
    render(<EmailSettingsPage />);

    expect(screen.queryByLabelText('Host')).not.toBeInTheDocument();
    expect(screen.queryByTestId('email-transport-panel-log')).not.toBeInTheDocument();

    await userEvent.setup().click(radio('Log (in memory)'));
    expect(screen.getByTestId('email-transport-panel-log')).toBeInTheDocument();
  });

  it('is read-only for a viewer without system_settings:write: every control disabled', () => {
    setHook(withCustomTransports({ provider: 'relay-api' }));
    render(<EmailSettingsPage />, READ_ONLY_PERMISSIONS);

    expect(screen.getByLabelText('API base URL')).toBeDisabled();
    expect(screen.getByLabelText(/API key/)).toBeDisabled();
    expect(radio('Log (in memory)')).toBeDisabled();
  });

  describe('a registered panel', () => {
    const Bespoke = ({ descriptor, value, onChange, errors }: EmailTransportPanelProps) => (
      <div data-testid="bespoke-relay">
        <h3>{descriptor.label} (bespoke)</h3>
        <input aria-label="Endpoint" value={String(value.apiBase ?? '')} onChange={(e) => onChange('apiBase', e.target.value)} />
        {errors.apiBase && <p role="alert">{errors.apiBase}</p>}
      </div>
    );

    it('replaces the generated form, and its validate and toInput apply', async () => {
      registerEmailTransportPanel('relay-api', Bespoke, {
        validate: (value): Record<string, string> => (String(value.apiBase ?? '').trim().startsWith('https://') ? {} : { apiBase: 'Use an https URL.' }),
        toInput: (value) => ({ apiBase: String(value.apiBase).trim(), sandbox: false }),
      });
      const { save } = setHook(withCustomTransports({ provider: 'relay-api' }));
      render(<EmailSettingsPage />);
      const user = userEvent.setup();

      expect(screen.getByTestId('bespoke-relay')).toBeInTheDocument();
      expect(screen.queryByTestId('email-transport-panel-relay-api')).not.toBeInTheDocument();

      const endpoint = screen.getByLabelText('Endpoint');
      await user.clear(endpoint);
      await user.type(endpoint, 'http://insecure.example.test');
      expect(screen.getByRole('alert')).toHaveTextContent('Use an https URL.');
      expect(saveButton()).toBeDisabled();

      await user.clear(endpoint);
      await user.type(endpoint, ' https://relay.example.test ');
      await user.click(saveButton());

      expect(save.mock.calls[0]![0].transports).toEqual({ 'relay-api': { apiBase: 'https://relay.example.test', sandbox: false } });
    });
  });

  describe('built-in panels', () => {
    it('ses saves its settings trimmed and its typed secret under secrets.ses', async () => {
      const { save } = setHook(sesSettingsFixture());
      render(<EmailSettingsPage />);
      const user = userEvent.setup();

      const region = screen.getByLabelText('Region');
      await user.clear(region);
      await user.type(region, '  us-west-2 ');
      await user.type(screen.getByLabelText('Secret Access Key'), 'new-secret-access-key-value');
      await user.click(saveButton());

      expect(save).toHaveBeenCalledWith({
        provider: 'ses',
        enabled: true,
        fromAddress: 'no-reply@example.test',
        fromName: 'Example App',
        transports: { ses: { region: 'us-west-2', accessKeyId: 'AKIAEXAMPLEKEYID0001' } },
        secrets: { ses: { secretAccessKey: 'new-secret-access-key-value' } },
      });
    });

    it('smtp edits the port as text and saves it as a number; a blank port is the default 587', async () => {
      const { save } = setHook(emailSettingsFixture());
      render(<EmailSettingsPage />);
      const user = userEvent.setup();

      const port = screen.getByLabelText('Port');
      expect(port).toHaveValue('587');
      await user.clear(port);
      await user.type(port, '465');
      await user.click(saveButton());
      expect(save.mock.calls[0]![0].transports).toEqual({ smtp: { host: 'smtp.example.test', port: 465, useTls: true, username: 'relay-user' } });

      await user.clear(port);
      expect(screen.getByText('A port is required.')).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it('smtp refuses a malformed port and a missing host while mail is on, but not while it is off', async () => {
      setHook(emailSettingsFixture());
      render(<EmailSettingsPage />);
      const user = userEvent.setup();

      await user.clear(screen.getByLabelText('Host'));
      expect(screen.getByText('A host is required.')).toBeInTheDocument();
      await user.type(screen.getByLabelText('Port'), 'x');
      expect(screen.getByText('Port must be a whole number between 1 and 65535.')).toBeInTheDocument();

      await user.click(screen.getByRole('switch', { name: /send email from this application/i }));
      expect(screen.queryByText('A host is required.')).not.toBeInTheDocument();
      // The format rule runs whether or not mail is on, as the API's does.
      expect(screen.getByText('Port must be a whole number between 1 and 65535.')).toBeInTheDocument();
    });

    it('an older API: the response with only the flat fields still draws the two built-in forms', () => {
      const { transports, descriptors, secretStatuses, ...old } = emailSettingsFixture();
      void transports;
      void descriptors;
      void secretStatuses;
      setHook(old as unknown as EmailSettings);
      render(<EmailSettingsPage />);

      expect(screen.getAllByRole('radio').map((el) => el.closest('label')?.textContent)).toEqual(['Amazon SES', 'SMTP']);
      expect(screen.getByLabelText('Host')).toHaveValue('smtp.example.test');
      expect(screen.getByText(/A password is saved \(••••ab12\)/)).toBeInTheDocument();
    });
  });
});
