// The notifications conformance suite (#738): it passes a conformant app and
// fails each violation.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withTemporaryEntries } from '../../src/core/registry/index';
import { eventEmailTemplateRegistry } from '../../src/notifications/registry/bindings.registry';
import { notificationEventRegistry } from '../../src/notifications/registry/event.registry';
import {
  checkEmailBindings,
  checkNotifyAfterCommit,
  checkPlatformNotifications,
  checkPushSchemas,
  notificationsConformanceSuite,
} from '../../src/notifications/testing/index';
import { conformanceSuites } from '../../src/testing/index';
import { registerTestNotifications } from './support';

registerTestNotifications();

function sources(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'notifications-conformance-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

describe('the notifications conformance suite', () => {
  it('is registered by importing the testing entry', () => {
    expect(conformanceSuites.get('notifications')).toBe(notificationsConformanceSuite);
  });

  it('passes an app with its registrations complete and notify() after commit', () => {
    const root = sources({
      'ok.service.ts': `
        async create() {
          const row = await this.prisma.$transaction(async (tx) => tx.thing.create({ data }));
          await this.notifications.notify('user.welcome', row.userId, {});
        }`,
    });
    const report = notificationsConformanceSuite.check({ sourceRoots: [root] }, {});
    expect(report.findings).toEqual([]);
    expect(report.scanned.files).toBe(1);
  });

  it('fails a notify() inside a $transaction callback, and honours the allowlist', () => {
    const root = sources({
      'bad.service.ts': `
        async create() {
          await this.prisma.$transaction(async (tx) => {
            await tx.thing.create({ data });
            // a comment naming this.notifications.notify( is not a call
            await this.notifications.notifyNow('user.welcome', id, {});
          });
        }`,
    });
    const { findings } = checkNotifyAfterCommit({ sourceRoots: [root] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toMatch(/^bad\.service\.ts:\d+$/);
    expect(checkNotifyAfterCommit({ sourceRoots: [root] }, ['bad.service.ts']).findings).toEqual([]);
  });

  it('fails an email-capable event with no template', async () => {
    await withTemporaryEntries(
      notificationEventRegistry,
      [{ key: 'billing.invoice_ready', label: 'Invoice', description: 'Ready.', channels: ['email'], defaultEnabled: true }],
      () => {
        expect(checkEmailBindings().map((finding) => finding.message)).toEqual([
          expect.stringContaining('"billing.invoice_ready" declares email but no email template is bound'),
        ]);
      },
    );
    expect(eventEmailTemplateRegistry.has('billing.invoice_ready')).toBe(false);
  });

  it('passes the platform registrations and the push schemas', () => {
    expect(checkPlatformNotifications()).toEqual([]);
    expect(checkPushSchemas()).toEqual([]);
  });
});
