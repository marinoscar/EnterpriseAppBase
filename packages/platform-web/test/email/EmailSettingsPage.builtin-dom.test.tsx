/**
 * The built-in transports' markup did not move (PP-14.8).
 *
 * The SES and SMTP forms moved out of `EmailSettingsPage` into
 * `SesTransportPanel` and `SmtpTransportPanel`, registered through
 * `registerEmailTransportPanel`. The snapshot beside this file (`__snapshots__/`)
 * was RECORDED FROM THE PAGE AS IT WAS BEFORE THAT CHANGE (the same fixtures,
 * rendered by the old `EmailSettingsPage`), so passing means the form an
 * administrator sees is, element for element and class for class, the one they
 * had: the Provider radios, the two blocks, the buttons and the alerts.
 *
 * Nothing is normalised: the radio labels ("Amazon SES", "SMTP") now come from
 * the transports' own labels, and the API serves exactly the strings the old
 * page hard-coded. Re-record the snapshot only for a deliberate change of the
 * built-in forms.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/email/headless/use-email-settings.js', () => ({ useEmailSettings: vi.fn() }));

import { useEmailSettings } from '../../src/email/headless/use-email-settings.js';
import type { UseEmailSettingsReturn } from '../../src/email/headless/index.js';
import EmailSettingsPage from '../../src/email/ui/EmailSettingsPage.js';
import { emailSettingsFixture, freshSettingsFixture, sesSettingsFixture } from './fixtures.js';
import { READ_ONLY_PERMISSIONS, hookReturn, render } from './harness.js';

const mockUseEmailSettings = vi.mocked(useEmailSettings);

function mount(overrides: Partial<UseEmailSettingsReturn>, permissions?: readonly string[]): string {
  mockUseEmailSettings.mockReturnValue(hookReturn(overrides));
  const { container, unmount } = render(<EmailSettingsPage />, permissions);
  const html = container.innerHTML;
  unmount();
  return html;
}

describe("the built-in transports' forms are unchanged", () => {
  beforeEach(() => vi.clearAllMocks());

  it('smtp, with a saved password', () => {
    expect(mount({ settings: emailSettingsFixture() })).toMatchSnapshot();
  });

  it('smtp, switched off, implicit TLS and no username', () => {
    expect(
      mount({
        settings: emailSettingsFixture({
          enabled: false,
          smtpPort: 465,
          smtpUseTls: false,
          smtpUsername: undefined,
          transports: {
            ses: { region: '', accessKeyId: '' },
            smtp: { host: 'smtp.example.test', port: 465, useTls: false, username: '' },
          },
        }),
      }),
    ).toMatchSnapshot();
  });

  it('ses, with a saved secret access key', () => {
    expect(mount({ settings: sesSettingsFixture() })).toMatchSnapshot();
  });

  it('ses, with no secret saved yet', () => {
    expect(mount({ settings: sesSettingsFixture({ sesSecretAccessKeyStatus: { configured: false, hint: null, updatedAt: null, updatedByUserId: null } }) })).toMatchSnapshot();
  });

  it('a fresh install: no transport chosen, switched off', () => {
    expect(mount({ settings: freshSettingsFixture() })).toMatchSnapshot();
  });

  it('read-only viewer', () => {
    expect(mount({ settings: emailSettingsFixture() }, READ_ONLY_PERMISSIONS)).toMatchSnapshot();
  });

  it('a stored row that could not be read', () => {
    expect(
      mount({ settings: freshSettingsFixture({ settingsError: 'The stored email configuration is invalid at: provider. Correct those fields and save to repair it.' }) }),
    ).toMatchSnapshot();
  });

  it('a test accepted by the provider, and one refused', () => {
    expect(
      mount({ settings: emailSettingsFixture(), testResult: { success: true, sentTo: 'admin@example.test', providerKind: 'smtp', messageId: 'msg-123', error: null } }),
    ).toMatchSnapshot();
    expect(
      mount({ settings: sesSettingsFixture(), testResult: { success: false, sentTo: 'admin@example.test', providerKind: 'ses', messageId: null, error: 'SES: MessageRejected: Email address is not verified.' } }),
    ).toMatchSnapshot();
  });

  it('a save that failed', () => {
    expect(mount({ settings: emailSettingsFixture(), saveError: 'Version conflict' })).toMatchSnapshot();
  });

  it('while saving and while testing', () => {
    expect(mount({ settings: emailSettingsFixture(), isSaving: true })).toMatchSnapshot();
    expect(mount({ settings: emailSettingsFixture(), isTesting: true })).toMatchSnapshot();
  });
});
