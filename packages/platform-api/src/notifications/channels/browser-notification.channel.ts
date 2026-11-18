import { Injectable, Logger, Inject } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import type { NotificationsPrisma } from '../data/notifications-db';
import { describeThrown } from '../describe-thrown';
import type { NotificationChannel } from '../notification-events';
import { isBrowserToastAllowed } from '../notification-policy';
import { NotificationInboxWriter, type InboxContent, type InboxWriteResult } from '../notification-inbox-writer';
import { NotificationStreamService } from '../notification-stream.service';
import { eventBrowserTemplateRegistry } from '../registry';
import type {
  ChannelDeliveryResult,
  NotificationChannelSender,
  NotificationDispatchContext,
  NotificationRecipient,
} from '../notification.types';
import type {
  BrowserNotificationContent,
  BrowserNotificationTemplate,
} from './browser-templates';

// =============================================================================
// BrowserNotificationChannel (issue #127, epic #109)
// =============================================================================
//
// The second `NotificationChannelSender`, and the one #125 deliberately
// refused to stub. It does two things, IN THIS ORDER, and the order is the
// design:
//
//   1. WRITE a `notifications` row — the durable, per-user inbox.
//   2. PUBLISH to whatever streams that user currently has open.
//
// Step 1 is the delivery. Step 2 is liveness. If step 2 reaches nobody —
// because no tab is open, because the tab is connected to a different replica,
// because the network dropped a second ago — the notification has still been
// delivered and the bell will show it. Reversing the order, or treating a
// zero-subscriber publish as a failure, would make the browser channel report
// failed deliveries for the ordinary case of a user who is not currently
// looking at the app.
//
// -----------------------------------------------------------------------------
// WHY THE ROW IS THE PRODUCT AND THE OS TOAST IS NOT
// -----------------------------------------------------------------------------
//
// Nothing in this file raises a native `Notification`. It cannot: the Web API
// lives in the page, and whether it fires depends on a permission this server
// has no visibility into and no way to influence. The web half of #127 may
// turn a streamed event into a toast if permission happens to be `granted`,
// and does nothing if it is not.
//
// That is exactly why the row exists. Browser notification permission is
// denied often and, once denied, effectively permanently — the app cannot
// re-prompt. A channel whose only artefact was an OS toast would silently be a
// no-op for those accounts, including for `security.role_changed`, which is
// `mandatory: true` precisely so a privilege change is never silent. The
// server's obligation ends at a durable row the user can find; the toast is a
// decoration on top of it.
//
// #226 IS THAT DISTINCTION MADE ENFORCEABLE. An operator can now switch browser
// notifications off deployment-wide, or suppress one event, from system
// settings — and what that switch reaches is the `toast` flag on the published
// event, NOT the INSERT above it. For an event the policy allows to be dropped
// entirely, the dispatcher never calls this channel at all (`resolveChannels`
// filters it out upstream); for a `mandatory` event the channel still runs, the
// row is still written, the frame is still published, and only `toast` goes
// false. See notification-policy.ts.
// =============================================================================

// The content contract and the platform renderers moved to
// `./browser-templates.ts` (#678), a leaf the declaration files can import
// without importing this class. Re-exported here so existing imports keep
// working.
export type {
  BrowserNotificationContent,
  BrowserNotificationTemplate,
} from './browser-templates';

// `EVENT_BROWSER_TEMPLATES` (a frozen snapshot of the binding registry) is gone from the
// package since #738: taken at package load, before the app's manifest ran,
// it would be empty. The channel reads the registry live; the reference app
// keeps the snapshot in `apps/api/src/platform/notifications/index.ts`.


/** Length caps applied before the row is written. See {@link truncate}. */
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 2_000;

/**
 * Exported for an app's own unit tests (`@marinoscar/platform-api/notifications/testing`); not an extension point: reach it through `NotificationsModule` and its documented seams.
 *
 * @internal
 */
@Injectable()
export class BrowserNotificationChannel implements NotificationChannelSender {
  readonly channel: NotificationChannel = 'browser';

  private readonly logger = new Logger(BrowserNotificationChannel.name);

  private readonly writer: NotificationInboxWriter;

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: NotificationsPrisma,
    private readonly stream: NotificationStreamService,
  ) {
    this.writer = new NotificationInboxWriter(prisma);
  }

  /**
   * The "address" for this channel is the ACCOUNT ITSELF.
   *
   * There is no address to resolve: a browser notification is delivered to a
   * row in `notifications`, which is keyed by user id. So the user id is what
   * goes in `notification_deliveries.recipient` — the column that answers
   * "where did this actually go?" — and the answer for this channel is "into
   * user X's inbox".
   *
   * `null` FOR A RECIPIENT WITH NO ACCOUNT (#128's `allowlist.invitation`,
   * whose recipient is an email address that has not signed up yet). That is
   * not a limitation to fix later: `notifications.user_id` is NOT NULL because
   * an inbox with no account has nobody to open it, and the registry already
   * declares that event as email-only for the same reason. Returning `null`
   * means the dispatcher writes no delivery row and makes no attempt, rather
   * than inventing a placeholder recipient.
   */
  resolveTo(recipient: NotificationRecipient): string | null {
    return recipient.userId;
  }

  /**
   * Write the inbox row, then nudge any open tab.
   *
   * NEVER THROWS. Every branch returns a `ChannelDeliveryResult`; the one
   * genuinely failure-prone operation (the INSERT) is wrapped, and the publish
   * that follows it cannot throw by its own contract.
   *
   * @param to - the user id from {@link resolveTo}, passed in rather than
   *           re-derived so the delivery row's `recipient` and the row this
   *           writes can never disagree about who was notified.
   */
  async deliver(
    context: NotificationDispatchContext,
    to: string,
  ): Promise<ChannelDeliveryResult> {
    const eventKey = context.event.key;

    // STATE and COUNTED rows (issue #1077) are upserted under an advisory
    // lock; the template runs inside the write, on the final total.
    if (context.inbox) {
      return this.deliverFolded(context, to, context.inbox);
    }

    const rendered = this.render(context);
    if (!rendered.ok) {
      return { success: false, error: rendered.error };
    }

    const title = truncate(rendered.content.title, MAX_TITLE_LENGTH);
    const body = truncate(rendered.content.body, MAX_BODY_LENGTH);
    const link = sanitizeLink(rendered.content.link);

    let notification: { id: string; createdAt: Date };

    try {
      notification = await this.prisma.notification.create({
        data: { userId: to, eventKey, title, body, link },
        select: { id: true, createdAt: true },
      });
    } catch (err) {
      return {
        success: false,
        error: `Could not write the notification record: ${describeThrown(err)}`,
      };
    }

    const delivered = this.stream.publish(to, {
      id: notification.id,
      eventKey,
      title,
      body,
      link,
      createdAt: notification.createdAt.toISOString(),
      toast: isBrowserToastAllowed(eventKey, context.policy),
      pushed: context.channels.includes('push'),
    });

    this.logger.log(
      `Recorded '${eventKey}' for user ${to} (live to ${delivered} connection(s)).`,
    );

    // The row id is the message id. It is the one durable handle tying a
    // `notification_deliveries` row to the `notifications` row it produced,
    // which is how "the delivery record says sent — what did they actually
    // see?" gets answered.
    return { success: true, messageId: notification.id };
  }

  /**
   * Write a STATE or COUNTED row and nudge open tabs when it is news.
   *
   * Never throws. A refresh that changes nothing the user can see (`quiet`)
   * writes the row but sends no frame. A frame never raises an OS toast for an
   * `incremented` row: the user already has that row unread, and a toast per
   * folded occurrence would be the 4 000 notifications the fold exists to
   * prevent.
   */
  private async deliverFolded(
    context: NotificationDispatchContext,
    to: string,
    mode: NonNullable<NotificationDispatchContext['inbox']>,
  ): Promise<ChannelDeliveryResult> {
    const eventKey = context.event.key;
    const render = (data: Record<string, unknown>): InboxContent => {
      const rendered = this.render({ ...context, data });
      if (!rendered.ok) throw new Error(rendered.error);
      return {
        title: truncate(rendered.content.title, MAX_TITLE_LENGTH),
        body: truncate(rendered.content.body, MAX_BODY_LENGTH),
        link: sanitizeLink(rendered.content.link),
      };
    };
    const data = (context.data ?? {}) as Record<string, unknown>;

    let written: InboxWriteResult;
    try {
      written =
        mode.kind === 'state'
          ? await this.writer.upsertState(to, eventKey, mode, data, render)
          : await this.writer.upsertCounted(to, eventKey, mode, data, render);
    } catch (err) {
      return {
        success: false,
        error: `Could not write the notification record: ${describeThrown(err)}`,
      };
    }

    if (!written.quiet) {
      // Re-read nothing: the frame carries what the writer returned. Title and
      // body come from a second pure render of the same total, so they match the row.
      let content: InboxContent | null = null;
      try {
        content = render({ ...data, count: written.count });
      } catch {
        content = null;
      }
      if (content) {
        this.stream.publish(to, {
          id: written.id,
          eventKey,
          ...content,
          createdAt: written.createdAt.toISOString(),
          toast: written.reason !== 'incremented' && isBrowserToastAllowed(eventKey, context.policy),
          pushed: context.channels.includes('push'),
          count: written.count,
          scopeId: written.scopeId,
          updatedAt: written.updatedAt.toISOString(),
          reason: written.reason,
        });
      }
    }

    this.logger.log(`Recorded '${eventKey}' (${written.reason}, count ${written.count}) for user ${to}.`);
    return { success: true, messageId: written.id };
  }

  /**
   * Render an event's untyped payload into what the user sees.
   *
   * -----------------------------------------------------------------------------
   * ON A TEMPLATE MISS THIS FALLS BACK TO THE REGISTRY. THE EMAIL CHANNEL FAILS.
   * THE ASYMMETRY IS DELIBERATE.
   * -----------------------------------------------------------------------------
   *
   * `EmailNotificationChannel` records a failed delivery when no template is
   * registered, because a substituted email is an irreversible message sent to
   * an address outside this system: wrong copy arrives in someone's mailbox and
   * cannot be recalled, so refusing is strictly safer than improvising.
   *
   * Here the destination is a row in the user's own inbox, inside the app,
   * correctable by an edit and a redeploy. And there is already user-facing
   * copy for every event: `label` and `description` are written for the
   * preferences page (#126), reviewed as product copy, and answer "what is this
   * and why did I get it?" — generically, but truthfully.
   *
   * So the choice on a miss is between a bell that shows a slightly generic
   * line and a bell that shows NOTHING for an event the registry says the user
   * should be told about — including `security.role_changed`, which is
   * `mandatory: true` exactly so it can never be silent. Generic wins.
   *
   * It is NOT silent about it: the fallback logs a `warn` naming the event, so
   * "#128 forgot a template" is visible in the same place an operator already
   * looks, rather than hiding behind plausible-looking output.
   */
  private render(
    context: NotificationDispatchContext,
  ):
    | { ok: true; content: BrowserNotificationContent }
    | { ok: false; error: string } {
    const { event, data } = context;
    const template = eventBrowserTemplateRegistry.get(event.key)?.render;

    if (!template) {
      this.logger.warn(
        `No browser template registered for '${event.key}'; ` +
          `falling back to the registry's label and description.`,
      );
      return {
        ok: true,
        content: { title: event.label, body: event.description },
      };
    }

    try {
      // The cast is the boundary, for the reason spelled out at length on
      // `EmailNotificationChannel.render`: `notify` takes `data: unknown` by
      // design, so this is the one call site in the system where a payload's
      // shape is checked by nothing. A template reading `data.actor.email` on
      // a caller's typo throws a `TypeError` at runtime, and letting that
      // propagate would violate #125's containment rule — a bad payload would
      // take down the role change that triggered it.
      return { ok: true, content: template(data as never, { timeZone: context.recipient.timeZone ?? null }) };
    } catch (err) {
      return {
        ok: false,
        // The message only, never the payload: `data` is the caller's object
        // and may hold anything, and this string is persisted.
        error: `Rendering the browser notification for '${event.key}' failed: ${describeThrown(err)}`,
      };
    }
  }
}

/**
 * Characters that must never appear in a stored link.
 *
 * C0 controls, DEL, and the space. Browsers STRIP tab, newline and carriage
 * return from a URL before parsing it, so `java<TAB>script:alert(1)` is a live
 * payload that would otherwise sail past every structural test below by not
 * literally starting with `javascript:`.
 */
const FORBIDDEN_LINK_CHARS = /[\u0000-\u0020\u007F]/;

/**
 * Accept a link only if it is unambiguously internal; otherwise drop it.
 *
 * -----------------------------------------------------------------------------
 * A SECURITY CONTROL, ENFORCED ON THE WAY IN
 * -----------------------------------------------------------------------------
 *
 * The web client will put this value in an `href` or hand it to the router.
 * That makes an unchecked link two vulnerabilities at once:
 *
 *   * `https://evil.example/login` — an open redirect wearing this
 *     application's chrome and its user's trust. Phishing that arrives *inside*
 *     the product is considerably more convincing than phishing that arrives by
 *     email.
 *   * `javascript:...` (and `data:text/html,...`) — script execution in this
 *     application's own origin, with the user's session, from a string that
 *     travelled through a notification template.
 *
 * VALIDATED AT WRITE TIME, NOT AT RENDER TIME. Storing whatever a template
 * produced and sanitising on the way out means every current and future
 * consumer — the bell, the toast, an export, a mobile client — has to remember
 * to sanitise, and the first one that forgets is the vulnerability. Validating
 * here means the column only ever holds values that are already safe, so a
 * consumer that forgets is merely unlucky rather than exploitable.
 *
 * ALLOWLIST, NOT DENYLIST: a single leading `/`, no second one, no control
 * characters. Everything else is rejected, so a scheme nobody has thought of
 * yet is rejected by default rather than by having been enumerated.
 *
 *   accepted:  "/settings", "/admin/users?tab=roles", "/x#frag"
 *   rejected:  "//evil.example/x"  protocol-relative — a full URL as far as a
 *                                  browser is concerned, and the classic
 *                                  bypass of a naive "starts with /" check
 *              "https://evil/x", "javascript:alert(1)", "data:..."
 *              "settings"          relative to wherever the user happens to
 *                                  be, so it resolves differently per page
 *              "/\\evil.example"   a backslash after the slash: several
 *                                  browsers normalise `\` to `/`, which makes
 *                                  this protocol-relative in practice
 *
 * A REJECTED LINK IS DROPPED, NOT AN ERROR. The notification itself is still
 * worth delivering without its link — refusing the whole thing would let a
 * malformed link silence a mandatory security alert, trading a small usability
 * bug for the exact failure mode `mandatory` exists to prevent.
  *
  * @stability experimental
 */
export function sanitizeLink(link: string | undefined): string | null {
  if (!link) return null;

  const trimmed = link.trim();

  if (FORBIDDEN_LINK_CHARS.test(trimmed)) return null;
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//')) return null;
  if (trimmed.startsWith('/\\')) return null;

  return trimmed;
}

/**
 * Hard cap on stored text, cutting at a character boundary and marking it.
 *
 * The column is `text` so a legitimately long message is never truncated by
 * the database, which makes an explicit cap the only remaining guard against
 * an unbounded one — a body that is a megabyte of accidentally-interpolated
 * JSON is a bell that never renders and a list page that never returns.
 *
 * The ellipsis matters: a silently truncated sentence reads as a bug in the
 * message, while a marked one reads as a message that was too long.
 */
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
