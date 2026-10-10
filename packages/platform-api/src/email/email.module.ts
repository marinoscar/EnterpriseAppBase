import { DynamicModule, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';

import { CredentialsModule } from '../credentials/index';
import { EmailSettingsController } from './email-settings.controller';
import { EmailSettingsService } from './email-settings.service';
import { EmailTestSendService } from './email-test-send.service';
import { EmailConfigDoctorCheck } from './doctor/email-config.doctor-check';
import { EmailEgressContributor } from './doctor/egress/email.egress.contributor';
import { EMAIL_OPTIONS, resolveEmailModuleOptions, type EmailModuleOptions } from './email.options';
import { SesEmailProvider } from './providers/ses-email.provider';
import { SmtpEmailProvider } from './providers/smtp-email.provider';
import { EmailTransportResolver } from './transports/email-transport.resolver';
import { listEmailTemplateOverrides, registerPlatformEmailTemplates } from './templates/email-template.registry';
import { configureEmailRendering } from './templates/render-context';

// =============================================================================
// EmailModule (issue #122, epic #109)
// =============================================================================
//
// The transport layer, plus (as of #124) the admin surface over it. #123
// added templates; #125 adds the dispatcher that decides which provider to use
// for which event.
//
// #122 SHIPPED NO CONTROLLER, on the grounds that adding an HTTP surface
// before there is something to expose puts a route to review in
// infrastructure rather than in the diff that needs it. #124 is that diff:
// `EmailSettingsController` is the admin settings page's three operations, all
// gated on `system_settings:read`/`:write`, reviewed here where they are the
// point rather than buried in shared plumbing.
//
// THAT CONTROLLER RETURNS NO SECRET. The SMTP password reaches this module
// only as a write -- request body -> `EmailSettingsService.update` ->
// `CredentialsService.setSecret` -- and the read side uses `describe`, whose
// return type carries a compile-time proof that it has no field able to hold
// secret material. `CredentialsService.getSecret`, the plaintext one, is
// called from exactly one place in this module: `SmtpEmailProvider`, at the
// moment it opens a connection.
//
// BOTH PROVIDERS ARE REGISTERED UNCONDITIONALLY, not chosen here from the
// configured `provider` setting. Provider selection is a per-send, runtime
// decision: the setting lives in the database and an admin can change it
// without a restart, so a module-construction-time choice would be stale the
// moment they did. Both classes are cheap to instantiate -- neither opens a
// socket or reads a credential until its first send -- so registering both and
// letting #125 pick costs nothing and keeps the choice where it can respond to
// a settings change.
//
// NOT @Global(). SmtpEmailProvider depends transitively on
// `CredentialsService.getSecret`, which returns plaintext; the set of modules
// that can reach it should stay a list a person can read, which means every
// consumer writes `imports: [EmailModule]` and shows up in a diff.
// =============================================================================

/** Overrides already logged in this process: "logged once at bootstrap", even across several apps in one test worker. */
const loggedOverrides = new Set<string>();

/**
 * Logs every template override once, at bootstrap: an override replaces what
 * a platform message says, and that must be visible in the boot log rather
 * than discovered in somebody's inbox.
 *
 * @internal
 *
 * @stability experimental
 */
@Injectable()
export class EmailTemplateOverrideReporter implements OnApplicationBootstrap {
  private readonly logger = new Logger('EmailTemplates');

  onApplicationBootstrap(): void {
    for (const { name, registrant } of listEmailTemplateOverrides()) {
      const key = `${name}\u0000${registrant}`;
      if (loggedOverrides.has(key)) continue;
      loggedOverrides.add(key);
      this.logger.log(`Email template "${name}" is overridden by ${registrant}.`);
    }
  }
}

/**
 * The email slice: the SES and SMTP transports, the `email` settings row and
 * its admin routes (`GET`/`PUT /api/email-settings`,
 * `POST /api/email-settings/test`, all `system_settings:read|write`), the
 * template registry and layout, and the doctor check.
 *
 * NOT GLOBAL: `SmtpEmailProvider` reaches `CredentialsService.getSecret`
 * (plaintext), so every consumer writes `imports: [EmailModule]` and shows up
 * in a diff. Export the one `forRoot()` result and import that object
 * everywhere (one module to Nest).
 *
 * @stability experimental
 */
@Module({})
export class EmailModule {
  /**
   * The slice for one app. Configures the render context (product name, URL,
   * layout theme, brand mark) and registers the platform's nine templates
   * (unless `registerDefaultTemplates: false`); both are idempotent.
   *
   * Needs, from the app: `SettingsModule.forRoot()` (the row store),
   * `PlatformHostModule` (`PLATFORM_PRISMA`, `AUDIT_SINK`), the doctor
   * registries and the credentials store's encryption key.
   *
   * @param options - see {@link EmailModuleOptions}.
   * @returns the dynamic module. It exports `EmailSettingsService`,
   *   `EmailTransportResolver`, `SesEmailProvider`, `SmtpEmailProvider` and
   *   `EMAIL_OPTIONS`.
   * @throws Error when an option is invalid (a missing `appName`, a theme
   *   colour that is not hex, a malformed brand mark).
   *
   * @example
   * ```ts
   * export const EmailModule = PlatformEmailModule.forRoot({
   *   appName: APP_NAME,
   *   appUrl: () => process.env.APP_URL,
   *   classifyRateLimit,
   * });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: EmailModuleOptions): DynamicModule {
    const resolved = resolveEmailModuleOptions(options);
    configureEmailRendering({ appName: resolved.appName, appUrl: resolved.appUrl, layout: resolved.layout });
    if (resolved.registerDefaultTemplates) registerPlatformEmailTemplates();

    return {
      module: EmailModule,
      imports: [
        // The SMTP password and the SES secret access key. Imported explicitly
        // (CredentialsModule is deliberately not global) so this module's
        // access to a plaintext-returning service is visible right here.
        CredentialsModule,
      ],
      controllers: [EmailSettingsController],
      providers: [
        { provide: EMAIL_OPTIONS, useValue: resolved },
        EmailSettingsService,
        // The test-send path (#124): one method over the transports this
        // module owns; reached only through the controller.
        EmailTestSendService,
        SesEmailProvider,
        SmtpEmailProvider,
        // The configured transport, resolved from the registry (PP-14.8):
        // the ONE thing the notification channel and the test send depend on.
        EmailTransportResolver,
        // Doctor check (#634): reads the admin view, never sends.
        EmailConfigDoctorCheck,
        // Egress inventory (#773): the SMTP relay or the SES regional endpoint.
        EmailEgressContributor,
        EmailTemplateOverrideReporter,
      ],
      // EmailTestSendService is deliberately NOT exported: sending a test
      // message is an admin action reached through this module's controller.
      exports: [EMAIL_OPTIONS, EmailSettingsService, EmailTransportResolver, SesEmailProvider, SmtpEmailProvider],
    };
  }
}
