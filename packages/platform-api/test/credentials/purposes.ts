// Fixture purposes for the credentials slice's specs (issue #735).
//
// Importing this file registers them, exactly as an app's manifest would: the
// stores refuse a write to an unregistered purpose. Jest gives every spec file
// its own module registry, so these never leak into another file.

import { registerCredentialPurpose, registerUserCredentialPurpose } from '../../src/credentials/registry';

registerCredentialPurpose({ purpose: 'smtp', owner: 'email', label: 'SMTP password', tiers: ['system'] });
registerCredentialPurpose({ purpose: 'oauth', owner: 'test', label: 'OAuth client secret', tiers: ['system'] });
registerCredentialPurpose({ purpose: 'webhook_org', owner: 'test', label: 'Deployment webhook key', tiers: ['system'] });
registerCredentialPurpose({ purpose: 'partner_api', owner: 'test', label: 'Partner API token', tiers: ['system', 'org'] });
registerCredentialPurpose({ purpose: 'org_only', owner: 'test', label: 'Org-only key', tiers: ['org'] });

registerUserCredentialPurpose({
  purpose: 'webhook',
  label: 'Webhook signing secret',
  description: 'Signs outbound webhooks sent on your behalf.',
  system: { purpose: 'webhook_org', name: 'default' },
});
registerUserCredentialPurpose({ purpose: 'other', label: 'Other key', description: 'A second purpose.', system: null });
registerUserCredentialPurpose({ purpose: 'smtp', label: 'Own SMTP password', description: 'Your own relay.', system: null });
