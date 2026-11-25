import { Injectable, OnModuleInit } from '@nestjs/common';

import { DoctorCheck, DoctorCheckOutcome } from '../../doctor/index';
import { DoctorCheckRegistry } from '../../doctor/index';
import { EmailSettingsAdminView, EmailSettingsService } from '../email-settings.service';
import { parsedTransportSettings } from '../email-settings-compat';
import { emailTransportKind, missingEmailTransportFields } from '../transports/email-transport';
// The built-in transports register on import: the Doctor judges them like any other.
import '../transports/builtin-email-transports';

/**
 * The admin page every email finding links to.
 *
 * @stability experimental
 */
export const EMAIL_SETTINGS_PATH = '/admin/settings/email';

const REMEDY_OPEN = `Complete the email settings at ${EMAIL_SETTINGS_PATH}, then use "Send test email" there.`;

/**
 * Which of a transport's declared secrets the admin view says are stored. Reads
 * `secretStatuses`, and the two legacy statuses for a view an older caller built.
 */
function storedSecrets(view: EmailSettingsAdminView, id: string): Record<string, boolean> {
  const present: Record<string, boolean> = {};
  for (const [name, status] of Object.entries(view.secretStatuses?.[id] ?? {})) present[name] = status.configured;
  if (id === 'smtp' && present.password === undefined && view.smtpPasswordStatus) present.password = view.smtpPasswordStatus.configured;
  if (id === 'ses' && present.secretAccessKey === undefined && view.sesSecretAccessKeyStatus) {
    present.secretAccessKey = view.sesSecretAccessKeyStatus.configured;
  }
  return present;
}

/**
 * Pure: judges the admin view of the email settings.
 *
 * The view carries credential STATUS (configured or not), never material —
 * `describeForAdmin` does not select the ciphertext — so nothing here can leak
 * a password. The access key id is not reported either. The selected
 * transport decides what "complete" means (`EmailTransportDefinition.missing`)
 * and how it is summarised (`summary`), so a transport an app registered is
 * judged exactly as `ses` and `smtp` are.
 *
 * @stability experimental
 */
export function decideEmailConfig(view: EmailSettingsAdminView): DoctorCheckOutcome {
  if (view.settingsError) {
    return { status: 'fail', detail: view.settingsError, remedy: REMEDY_OPEN };
  }

  if (!view.provider) {
    return {
      status: 'warn',
      detail: 'Email is not configured; notifications are delivered in-app only',
      remedy: `Choose a transport at ${EMAIL_SETTINGS_PATH}.`,
    };
  }

  if (!emailTransportKind.has(view.provider)) {
    return {
      status: 'fail',
      detail: `Email transport "${view.provider}" is selected but not registered (registered: ${emailTransportKind.ids().join(', ') || '(none)'})`,
      remedy: `Choose a registered transport at ${EMAIL_SETTINGS_PATH}, or register "${view.provider}" with registerEmailTransport.`,
      data: { provider: view.provider, enabled: view.enabled },
    };
  }

  const transport = emailTransportKind.get(view.provider);
  const settings = parsedTransportSettings(view, view.provider);

  const missing: string[] = [];

  if (!view.fromAddress) missing.push('from address');

  missing.push(...missingEmailTransportFields(transport as never, settings, storedSecrets(view, view.provider)));

  const data = { provider: view.provider, enabled: view.enabled };

  if (missing.length > 0) {
    return {
      status: 'fail',
      detail: `Email (${view.provider}) is missing: ${missing.join(', ')}`,
      remedy: REMEDY_OPEN,
      data,
    };
  }

  const summarise = (transport as { summary?: (settings: Record<string, unknown>) => string }).summary;
  const via = summarise ? summarise(settings) : transport.label;

  if (!view.enabled) {
    return {
      status: 'warn',
      detail: `${via} is configured but switched off; no email is sent`,
      remedy: `Turn email on at ${EMAIL_SETTINGS_PATH} when it should be delivered.`,
      data,
    };
  }

  return { status: 'pass', detail: `${via}, from ${view.fromAddress}`, data };
}

/**
 * `email` / `email.config` — outgoing email is configured. Never sends.
 *
 * @stability experimental
 */
@Injectable()
export class EmailConfigDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'email.config';
  readonly category = 'email';
  readonly label = 'Email delivery';
  readonly settingsPath = EMAIL_SETTINGS_PATH;

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly emailSettings: EmailSettingsService,
  ) {}

  /** Registers this contributor with the doctor's registry. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    return decideEmailConfig(await this.emailSettings.describeForAdmin());
  }
}
