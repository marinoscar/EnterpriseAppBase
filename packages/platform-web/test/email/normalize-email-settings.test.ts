import { describe, expect, it } from 'vitest';

import { withTransportDefaults } from '../../src/email/headless/normalize-email-settings.js';
import { NO_SECRET, SAVED_SECRET, emailSettingsFixture } from './fixtures.js';

/** A response as an API older than pluggable transports served it. */
function oldResponse() {
  const { transports, descriptors, secretStatuses, ...old } = emailSettingsFixture({
    sesRegion: 'eu-west-1',
    sesAccessKeyId: 'AKIAEXAMPLEKEYID0001',
    smtpHost: 'smtp.example.test',
    smtpPort: 465,
    smtpUseTls: false,
    smtpUsername: 'mailer',
    smtpPasswordStatus: SAVED_SECRET,
    sesSecretAccessKeyStatus: NO_SECRET,
  });
  void transports;
  void descriptors;
  void secretStatuses;
  return old;
}

describe('withTransportDefaults', () => {
  it('returns a current response untouched', () => {
    const current = emailSettingsFixture();
    expect(withTransportDefaults(current)).toBe(current);
  });

  it('builds transports, descriptors and secret statuses from the flat fields of an older response', () => {
    const view = withTransportDefaults(oldResponse());

    expect(view.transports).toEqual({
      ses: { region: 'eu-west-1', accessKeyId: 'AKIAEXAMPLEKEYID0001' },
      smtp: { host: 'smtp.example.test', port: 465, useTls: false, username: 'mailer' },
    });
    expect(view.descriptors.map((descriptor) => [descriptor.id, descriptor.label])).toEqual([
      ['ses', 'Amazon SES'],
      ['smtp', 'SMTP'],
    ]);
    expect(view.secretStatuses).toEqual({ ses: { secretAccessKey: NO_SECRET }, smtp: { password: SAVED_SECRET } });
  });

  it('defaults what an older response left absent: port 587, TLS on, empty text', () => {
    const { smtpPort, smtpUseTls, smtpHost, smtpUsername, ...rest } = oldResponse();
    void smtpPort;
    void smtpUseTls;
    void smtpHost;
    void smtpUsername;

    expect(withTransportDefaults(rest).transports.smtp).toEqual({ host: '', port: 587, useTls: true, username: '' });
  });

  it('keeps the fields a partly new response does carry', () => {
    const { descriptors, ...partial } = emailSettingsFixture();
    void descriptors;

    const view = withTransportDefaults(partial);

    expect(view.transports).toBe(partial.transports);
    expect(view.descriptors).toHaveLength(2);
  });
});
