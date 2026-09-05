/**
 * The event x channel notification preferences matrix.
 *
 * Issue #126, epic #109. Rendered by `pages/UserNotificationsPage.tsx` at
 * `/settings/notifications`.
 *
 * =============================================================================
 * THE SPARSE ABSENT-KEY CONTRACT — READ THIS BEFORE CHANGING ANYTHING HERE
 * =============================================================================
 *
 * The stored document is `user_settings.value.notifications`, channel-outer:
 *
 *     { email: { 'user.welcome': false }, browser: { ... } }
 *
 * A key is present ONLY where the user deliberately chose. Absent — at the
 * namespace, the channel, or the event level — means "use the registry's
 * `defaultEnabled`", resolved at read time by the API
 * (`notifications/notification-preferences.ts`). Three properties depend on
 * that, and each breaks in a way nobody notices for weeks:
 *
 *   1. NO MIGRATION, NO BACKFILL. The feature shipped by reading a key that
 *      does not exist for anybody.
 *   2. NOBODY IS MUTED ON ARRIVAL. Every pre-existing account has no
 *      `notifications` namespace at all; if absent meant "off", the framework
 *      would ship silent for the entire user base, and the only symptom would
 *      be mail nobody receives — a failure with no error anywhere.
 *   3. AN EVENT ADDED LATER IS OPT-OUT, NOT SILENTLY OFF. A user who saved a
 *      preference today has a stored map that says nothing about an event
 *      declared next year; absent-means-default gives them that event's
 *      intended default, where a materialised blob would give them "not in my
 *      map, therefore off".
 *
 * THREE RULES THIS FILE ENFORCES, EACH THE PRECISE OPPOSITE OF THE OBVIOUS
 * IMPLEMENTATION:
 *
 *   A. EVERY CONTROL DERIVES ITS STATE (see `isEventChannelEnabled`) from the
 *      fetched preferences compared against the registry's `defaultEnabled`.
 *      There is NO local `Record<event, boolean>` state in this component, and
 *      there must never be one. The moment a defaulted local object exists, the
 *      first save serialises it and materialises every key in it.
 *
 *   B. NEVER WRITE A FULL PREFERENCES OBJECT — not on mount, not on first
 *      change. Each toggle emits exactly the one `(channel, event, value)` it
 *      changed and the page PATCHes that single key; the API deep-merges per
 *      event, so everything else stays absent.
 *
 *   C. RETURNING A CONTROL TO ITS DEFAULT SENDS A NULL-DELETE (see
 *      `preferenceWriteFor`), never the default value. Writing the default
 *      explicitly works today, and it opts that user in permanently: the key is
 *      materialised, the blob grows for no reason, and if the default ever
 *      changes that user is frozen at the old one with nothing to show why.
 *
 * NO SAVE BUTTON, DELIBERATELY. A batched save needs a full local mirror to
 * diff against, which is exactly the shape that ends up POSTing a materialised
 * object — rule A and rule B fall together the moment a Save button appears.
 * Every toggle is its own PATCH and its own snackbar.
 *
 * =============================================================================
 * RESPONSIVE WITHOUT A BREAKPOINT GATE
 * =============================================================================
 *
 * There is no `useMediaQuery` here and no `display: { xs, sm }` switch between
 * two layouts. `CLAUDE.md` names five coupled breakpoint gates that move
 * together or not at all (`Layout.tsx`'s `showRail`, `BottomNav`'s self-gate,
 * `<main>`'s padding, and `isCompactWindow` in both `SettingsHub.tsx` and
 * `AppBar.tsx`); a sixth gate here would be a sixth thing to keep in lockstep
 * for no gain.
 *
 * Instead each row is ONE flex container that wraps: the event's label and
 * description take the left, the channel switches the right, and on a narrow
 * viewport the switches simply flow underneath. Every switch carries its own
 * visible channel label, so the matrix is self-describing at every width — no
 * column header row that has to survive being wrapped away, which is precisely
 * where a table layout breaks down in a 320px drill-down.
 */

import { useId } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Switch,
  Typography,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import type {
  NotificationChannel,
  NotificationEventDef,
  NotificationPreferences,
} from '../../types';
import type { BrowserNotificationPermission } from '../../hooks/useBrowserNotificationPermission';

// =============================================================================
// Derivation — the pure half, exported so it can be reasoned about and tested
// without a DOM.
// =============================================================================

/**
 * Is this event enabled on this channel, for this user?
 *
 * THE MIRROR OF THE API'S `isChannelEnabled`, function for function, including
 * the order of its checks — `mandatory` first, then the three-level fallback.
 * Two implementations of one rule is a drift risk, and it is accepted here for
 * one reason: the alternative is a per-user "resolved preferences" endpoint,
 * i.e. the server materialising exactly the defaulted object this whole design
 * refuses to store. The UI reads the raw sparse document and applies the same
 * rule; the SERVER's copy remains the only one that decides delivery, so a
 * drift shows as a wrong checkbox, never as a wrong send.
 *
 * `mandatory` is checked BEFORE the stored value, so a preference row that
 * disables a mandatory event — one written before the event became mandatory,
 * or by a crafted PATCH — renders as ON, which is what the user will actually
 * receive. Rendering the stored `false` there would be an honest reading of the
 * document and a lie about the behaviour.
 *
 * @param preferences the raw stored namespace, or `undefined` when the user has
 *                    never saved a preference — the single most common case.
 */
export function isEventChannelEnabled(
  event: NotificationEventDef,
  channel: NotificationChannel,
  preferences: NotificationPreferences | undefined,
): boolean {
  if (event.mandatory) return true;

  const channelPrefs = preferences?.[channel];
  // Level 1: no namespace, or nothing stored for this channel.
  if (!channelPrefs) return event.defaultEnabled;

  // Level 2: `hasOwnProperty`, never `channelPrefs[key] !== undefined` and
  // never a truthiness test. A stored `false` is a real, deliberate choice and
  // must not collapse into "absent"; and an own-property check is also what
  // keeps an event key like `constructor` or `toString` from resolving to a
  // function off `Object.prototype`. This object came out of a user-writable
  // JSONB column, so that is not hypothetical.
  if (!Object.prototype.hasOwnProperty.call(channelPrefs, event.key)) {
    return event.defaultEnabled;
  }

  // Level 3: honour it only if it is a boolean. Anything else was not written
  // by this system, so it is not a choice this system will honour.
  const choice = channelPrefs[event.key];
  return typeof choice === 'boolean' ? choice : event.defaultEnabled;
}

/**
 * What to send for a control the user has just moved to `nextEnabled`.
 *
 * `null` is a JSON Merge Patch DELETE and is the WHOLE POINT of this function:
 * when the new state equals the registry default, the correct write is to
 * remove the key and return the user to "no opinion", not to pin today's
 * default into their document. See rule C in the file header.
 *
 * Both directions matter, which is why this compares against `defaultEnabled`
 * rather than special-casing "re-enabling":
 *   * default `true`, user muted it, user un-mutes  -> next `true`  -> DELETE
 *   * default `false`, user opted in, user opts out -> next `false` -> DELETE
 * and a first, non-default change stores the explicit boolean.
 */
export function preferenceWriteFor(
  event: NotificationEventDef,
  nextEnabled: boolean,
): boolean | null {
  return nextEnabled === event.defaultEnabled ? null : nextEnabled;
}

// =============================================================================
// Channel presentation
// =============================================================================

/**
 * The visible label per channel.
 *
 * Keyed by the channels this build knows about. `channelLabel` is DEFENSIVE
 * about the lookup — a newer server can declare a channel this bundle has
 * never heard of (the registry is server-owned, which is the entire point of
 * fetching it rather than mirroring it), and the right behaviour then is to
 * render the raw key rather than put an empty label on a live control.
 */
const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: 'Email',
  browser: 'Browser',
  // THE REAL PUSH COLUMN (issue #228, epic #215) — not a placeholder anymore.
  // `pushChannelState()` below renders it disabled with an honest
  // "not available yet" explanation for as long as the server's
  // `pushEnabled` stays hardcoded `false` (`notifications.controller.ts`).
  // No entry in `NOTIFICATION_EVENTS` declares `push` in its `channels` yet,
  // so `showsPushChannel` below is `false` and this label is currently
  // unreachable through `event.channels.map` — the column renders no rows.
  // THAT IS THE INTENDED STATE OF #228, NOT A BUG: this issue widens
  // `NotificationChannel` and builds the column ahead of there being
  // anything to put in it; wiring a real event to `push` and implementing
  // delivery are #229/#230's job.
  push: 'Push',
};

function channelLabel(channel: NotificationChannel): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

/**
 * How a gated channel column must behave: whether its control is disabled,
 * the terse note beside it, and the banner above the whole matrix.
 *
 * SHARED BY `browserChannelState` AND `pushChannelState` — originally this
 * was `BrowserChannelState`, named for its one caller, but `push` needs the
 * exact same three fields (a control can be live or not, with or without a
 * one-line reason, with or without a banner explaining why) for a completely
 * different underlying reason (an unimplemented feature, not a browser
 * permission). Two interfaces that are structurally identical and diverge
 * only in field NAMES would be the worse choice here: every caller below —
 * the channel-state lookup, the render column, the banner block — treats
 * both the same way, and a shared name says so instead of asking the reader
 * to notice two shapes happen to line up. `email` never produces one of
 * these at all: it is never gated, so it simply has no entry wherever these
 * are collected (see `channelStates` in the component below).
 */
interface ChannelState {
  disabled: boolean;
  /** Terse note beside the control. `null` when there is nothing to add. */
  note: string | null;
  /** The banner above the matrix. `null` when the channel is fully working. */
  alert: { severity: 'info' | 'warning'; title: string; body: string } | null;
}

/**
 * How the browser column must behave for a given permission state.
 *
 * SEPARATED FROM THE JSX so the honest answer to "what does `denied` do?" is
 * one readable table rather than three ternaries spread through a render.
 *
 * `disabled` is true only where the app genuinely cannot deliver AND cannot
 * recover:
 *   * `denied`      — the browser refused; nothing this application does can
 *                     undo that, only the user in their browser's site
 *                     settings. A control that looks live but can never take
 *                     effect is worse than one that explains itself.
 *   * `unsupported` — no `Notification` API at all. Nothing to configure.
 *   * `default`     — NOT disabled. The permission has not been asked for yet,
 *                     and the stored preference is still meaningful: it is what
 *                     takes effect the moment permission is granted. Disabling
 *                     it would force the user to grant permission before they
 *                     are allowed to express an opinion, which is backwards.
 *   * `granted`     — nothing to say.
 */
export function browserChannelState(
  permission: BrowserNotificationPermission,
): ChannelState {
  switch (permission) {
    case 'granted':
      return { disabled: false, note: null, alert: null };
    case 'denied':
      return {
        disabled: true,
        note: 'Blocked by your browser',
        alert: {
          severity: 'warning',
          title: 'Browser notifications are blocked',
          // Names the remedy AND who owns it. This application cannot re-ask
          // for a permission the user has denied, so telling them to "try
          // again here" would be a lie.
          body:
            'Your browser is blocking notifications from this site, so these ' +
            'preferences cannot take effect. Allow notifications for this site ' +
            'in your browser settings to turn them back on.',
        },
      };
    case 'unsupported':
      return {
        disabled: true,
        note: 'Not supported by this browser',
        alert: {
          severity: 'info',
          title: 'This browser cannot show notifications',
          body:
            'Browser notifications need a browser that supports them over a ' +
            'secure (HTTPS) connection. Email notifications are unaffected.',
        },
      };
    case 'default':
    default:
      return {
        disabled: false,
        note: 'Permission not granted yet',
        alert: {
          severity: 'info',
          title: 'Browser notifications need your permission',
          body:
            'Your browser has not been asked for permission yet, so these ' +
            'notifications will not appear until you allow them. Your choices ' +
            'here are saved and take effect as soon as permission is granted.',
        },
      };
  }
}

/**
 * How the push column must behave, given whether the server can currently
 * deliver push notifications at all.
 *
 * `pushEnabled` comes from `GET /api/notifications/config`'s `pushEnabled`
 * field (`notification-config.dto.ts`); wiring that fetch into
 * `UserNotificationsPage` is issue #227's scope, not this one, so today every
 * caller passes (or defaults to) `false` — matching the controller's own
 * hardcoded `pushEnabled: false`, since Web Push is not implemented until
 * #229/#230. This function is nonetheless written to be correct for BOTH
 * values now, so nothing here needs to change again once the server starts
 * returning `true`.
 *
 * Unlike `browserChannelState`, there is no permission axis to report on —
 * this codebase has no service-worker subscription and no `PushManager` call
 * anywhere yet, so there is exactly one way to be unable to deliver, not a
 * four-way switch:
 *
 *   * `pushEnabled === false` — disabled, with a "not available yet" note and
 *                     banner. This is DELIBERATELY NOT phrased like
 *                     `browserChannelState`'s `denied`/`unsupported` copy
 *                     ("blocked by your browser", "not supported by this
 *                     browser"): those describe a BROWSER's refusal, which is
 *                     the user's browser's doing and something only the user
 *                     can fix in its settings. This describes a FEATURE this
 *                     application has not built yet, which the user cannot
 *                     fix at all and which it would be dishonest to blame on
 *                     their browser.
 *   * `pushEnabled === true`  — nothing to say, mirroring `granted` above. No
 *                     caller can reach this branch until #229/#230 land and
 *                     issue #227 wires the real fetch, but the function must
 *                     already be correct for it.
 */
export function pushChannelState(pushEnabled: boolean): ChannelState {
  if (pushEnabled) {
    return { disabled: false, note: null, alert: null };
  }
  return {
    disabled: true,
    note: 'Not available yet',
    alert: {
      severity: 'info',
      title: 'Push notifications are not available yet',
      body:
        'Push notifications are planned but not yet implemented on this ' +
        'server. Email and browser notifications are unaffected.',
    },
  };
}

// =============================================================================
// Component
// =============================================================================

export interface NotificationSettingsProps {
  /**
   * The registry, in server order. Rendered as given and NEVER sorted — the
   * order is meaningful and is the API's to decide.
   */
  events: NotificationEventDef[];
  /**
   * The raw stored namespace. `undefined` when the user has never saved a
   * preference, which is the normal case and is NOT a loading state — every
   * control resolves to its registry default.
   */
  preferences: NotificationPreferences | undefined;
  /**
   * One toggle happened. `value` is the boolean to store, or `null` to DELETE
   * the key and restore the registry default (see `preferenceWriteFor`).
   *
   * The caller turns this into `{ notifications: { [channel]: { [key]: value } } }`
   * — one channel, one key, nothing else on the wire.
   */
  onToggle: (channel: NotificationChannel, event: NotificationEventDef, value: boolean | null) => void;
  /**
   * A save is in flight. EVERY control is disabled, not just the one that was
   * clicked, and that is on purpose: `useUserSettings` sends `If-Match` with
   * the settings version it currently holds, so two toggles racing produce two
   * PATCHes with the same expected version and the second 409s. Serialising
   * them costs a few hundred milliseconds and removes the conflict entirely.
   */
  isSaving?: boolean;
  /** Live `Notification.permission`, from `useBrowserNotificationPermission`. */
  browserPermission: BrowserNotificationPermission;
  /**
   * Whether the server can currently deliver push notifications at all, from
   * `GET /api/notifications/config`'s `pushEnabled` field. Unlike
   * `browserPermission`, this has no dedicated hook yet — fetching this
   * endpoint into `UserNotificationsPage` is issue #227's scope, not this
   * one's.
   *
   * Optional, defaulting to `false` below. That default is not merely "the
   * safe choice while nobody supplies one" — it is LITERALLY the value the
   * server hardcodes today (`notifications.controller.ts` returns
   * `pushEnabled: false` unconditionally until Web Push ships in #229/#230),
   * so an omitted prop and a real fetch of today's server both render
   * identically. A caller passes an actual fetched value once #227 lands.
   */
  pushEnabled?: boolean;
  /**
   * Ask the browser for notification permission (#127).
   *
   * FILLS THE SEAM #126 LEFT in the `default`-state banner below. The component
   * does NOT call `Notification.requestPermission()` itself — it raises this
   * callback from a click, and the page owns the call plus the `refresh()` that
   * follows it. That split is what keeps the prompt out of this component's
   * render path entirely: there is no code here that COULD fire it on mount,
   * because the API call is not in this file.
   *
   * Optional, and the button is only rendered when it is supplied. A promptless
   * host renders the same honest banner #126 shipped.
   */
  onRequestPermission?: () => void;
  /**
   * The permission prompt is open. Disables the button so a second click cannot
   * stack a second request behind the browser's modal.
   */
  isRequestingPermission?: boolean;
}

export function NotificationSettings({
  events,
  preferences,
  onToggle,
  isSaving = false,
  browserPermission,
  onRequestPermission,
  isRequestingPermission = false,
  pushEnabled = false,
}: NotificationSettingsProps) {
  // `useId` rather than interpolating `event.key`: two instances of this
  // component (or a future second matrix on the page) would otherwise emit
  // duplicate ids, and a duplicated id silently points every `aria-describedby`
  // at the first match.
  const idPrefix = useId();

  const browser = browserChannelState(browserPermission);
  const push = pushChannelState(pushEnabled);

  // ONE LOOKUP, BUILT ONCE PER RENDER, REPLACING A GROWING `isBrowser` /
  // `isPush` TERNARY CHAIN. With one gated channel the explicit-branch style
  // the rest of this file favours (see the file header's "READ THIS BEFORE
  // CHANGING ANYTHING" rules, all written as explicit named checks) still
  // read fine; with two — and #229/#230 plausibly landing a third kind of
  // gating later, once real push delivery exists — the ternary chain grows
  // one branch per channel while this map grows one KEY per channel, in the
  // same shape every time. `email` is deliberately absent: it is never
  // gated, so it has no entry, and the per-channel lookups below (`?? false`,
  // `?? null`) fall through to "nothing to disable, nothing to say" for it
  // and for any channel a newer server declares that this build has no
  // `ChannelState` for at all.
  const channelStates: Partial<Record<NotificationChannel, ChannelState>> = {
    browser,
    push,
  };

  // Only relevant if some event actually declares the channel. Today only
  // `security.role_changed` declares `browser`, and an event list that
  // declares none must not show a banner about a column that is not on
  // screen.
  const showsBrowserChannel = events.some((event) => event.channels.includes('browser'));
  // Always `false` today (see `CHANNEL_LABELS`'s `push` entry above) — no
  // registry event declares `push` yet — but written the same way as
  // `showsBrowserChannel` rather than hardcoded to `false`, so the push
  // banner appears on its own the day #229/#230 add the first `push` event,
  // with no change needed here.
  const showsPushChannel = events.some((event) => event.channels.includes('push'));

  if (events.length === 0) {
    // A REAL ANSWER, not a loading state — the caller renders a spinner while
    // the registry is unknown. An empty matrix with no explanation reads as a
    // page that failed to load.
    return (
      <Alert severity="info">
        This application does not send any notifications yet.
      </Alert>
    );
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Notifications
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Choose what reaches you, and how. Changes are saved as you make them.
        </Typography>

        {showsBrowserChannel && browser.alert && (
          <Alert severity={browser.alert.severity} sx={{ mb: 2 }}>
            <AlertTitle>{browser.alert.title}</AlertTitle>
            {browser.alert.body}
            {/*
              ===================================================================
              THE PERMISSION PROMPT (#127) — FILLING THE SEAM #126 MARKED HERE
              ===================================================================
              Rendered ONLY in the `default` state: `granted` has nothing to ask
              for, and in `denied` / `unsupported` a button would be a lie —
              neither is recoverable from inside this application, which is why
              `browserChannelState` gives those two an explanatory alert and no
              action.

              THE CLICK IS THE WHOLE MECHANISM. `Notification.requestPermission()`
              runs from this handler and NOWHERE ELSE in the app:

                * A DENIAL IS EFFECTIVELY PERMANENT. Nothing this application
                  does can undo it — only the user, in browser site settings. The
                  prompt is a ONE-SHOT RESOURCE, so spending it on somebody who
                  never asked for notifications kills the feature for them for
                  good.
                * Browsers actively penalise gestureless prompts: Chrome demotes
                  them to a quiet UI, Firefox requires the gesture outright, and
                  Safari throws. A prompt on mount frequently never reaches the
                  user while still burning the coin.

              DO NOT MOVE THIS CALL TO MOUNT, AN EFFECT, A TIMER, OR A ROUTE
              TRANSITION. The button sits inside the banner that explains what it
              does, on a page the user navigated to deliberately, which is the
              only context in which asking is fair.

              The state afterwards is re-read through
              `useBrowserNotificationPermission().refresh()` in
              `UserNotificationsPage`, so this banner becomes the `granted` or
              `denied` treatment without a reload — including the case where the
              user dismisses the prompt without choosing, which leaves the
              permission at `default` and correctly leaves this button in place.
            */}
            {browserPermission === 'default' && onRequestPermission && (
              <Box sx={{ mt: 1.5 }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={onRequestPermission}
                  disabled={isRequestingPermission}
                  startIcon={
                    isRequestingPermission ? <CircularProgress size={16} /> : undefined
                  }
                >
                  {/* The label names the ACTION and its consequence. "Enable" or
                      "Turn on" would over-promise: this button opens the
                      browser's own prompt, and the browser — not this app —
                      decides what happens next. */}
                  {isRequestingPermission ? 'Waiting for your browser…' : 'Allow notifications'}
                </Button>
              </Box>
            )}
          </Alert>
        )}

        {showsPushChannel && push.alert && (
          <Alert severity={push.alert.severity} sx={{ mb: 2 }}>
            <AlertTitle>{push.alert.title}</AlertTitle>
            {push.alert.body}
            {/*
              NO ACTION BUTTON HERE, UNLIKE THE BROWSER BANNER ABOVE. That
              button asks the BROWSER for a permission that already exists to
              ask for; push has no such mechanism anywhere in this codebase
              yet — no service-worker subscription, no `PushManager` call, no
              code path that can ever produce `pushEnabled: true` today. A
              button wired to nothing would be worse than no button, so this
              banner is purely informational until #229/#230 give it
              something to do.
            */}
          </Alert>
        )}

        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {events.map((event, index) => {
            const descriptionId = `${idPrefix}-${event.key}-description`;

            return (
              <Box component="li" key={event.key}>
                {index > 0 && <Divider />}

                {/*
                  ONE WRAPPING FLEX ROW — see the header. The label block has a
                  flex BASIS rather than a width so it takes the leftover space
                  on a desktop and drops the switches onto their own line on a
                  phone, with no breakpoint gate deciding which.
                */}
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                    py: 2,
                  }}
                >
                  <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="subtitle1" component="h3">
                        {event.label}
                      </Typography>
                      {event.mandatory && (
                        // VISIBLY LOCKED, WITH THE REASON. The alternative —
                        // hiding the row, or leaving a switch that silently
                        // refuses — is what epic #109's success criterion 5
                        // rules out: a user who cannot find the security alert
                        // in their preferences assumes it is not being sent,
                        // and a control that does nothing when clicked reads as
                        // a bug rather than as a policy.
                        <Chip
                          size="small"
                          icon={<LockIcon fontSize="small" />}
                          label="Always on"
                        />
                      )}
                    </Box>
                    <Typography id={descriptionId} variant="body2" color="text.secondary">
                      {event.description}
                      {event.mandatory && (
                        <>
                          {' '}
                          <Box component="span" sx={{ fontStyle: 'italic' }}>
                            This is a security notification and cannot be turned off.
                          </Box>
                        </>
                      )}
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'flex-start',
                      columnGap: 2,
                      rowGap: 0.5,
                    }}
                  >
                    {/*
                      ONLY THE CHANNELS THIS EVENT DECLARES. Rendering the full
                      channel set for every row would offer, for instance, a
                      browser toggle for `allowlist.invitation` — whose
                      recipient has no session and no open tab by definition.
                    */}
                    {event.channels.map((channel) => {
                      const checked = isEventChannelEnabled(event, channel, preferences);
                      // See `channelStates` above: `email` (and any channel a
                      // newer server declares that this build has no
                      // `ChannelState` for) has no entry, so both fallbacks
                      // below apply — nothing disabled, nothing to note.
                      const channelState = channelStates[channel];
                      const channelDisabled = channelState?.disabled ?? false;
                      const note = channelState?.note ?? null;
                      const noteId = note ? `${idPrefix}-${event.key}-${channel}-note` : undefined;

                      return (
                        <Box
                          key={channel}
                          sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
                        >
                          <FormControlLabel
                            // `mandatory` disables EVERY channel, not "all but
                            // one": the API resolves a mandatory event as
                            // all-or-nothing, so a per-channel opt-out here
                            // would render a choice the server ignores.
                            disabled={isSaving || event.mandatory || channelDisabled}
                            label={channelLabel(channel)}
                            control={
                              <Switch
                                checked={checked}
                                onChange={(_e, next) =>
                                  onToggle(channel, event, preferenceWriteFor(event, next))
                                }
                                // `slotProps.input`, never `<Switch aria-label>`:
                                // MUI forwards unknown props to the ROOT span,
                                // leaving the element that actually carries
                                // `role="switch"` nameless. Same rule as
                                // `admin/featureFlagColumns.tsx`.
                                //
                                // The name is per ROW as well as per channel —
                                // "Email" alone repeats on every row and gives a
                                // screen-reader user three identically-named
                                // switches with no way to tell them apart.
                                slotProps={{
                                  input: {
                                    'aria-label': `${channelLabel(channel)} notifications for ${event.label}`,
                                    'aria-describedby': [descriptionId, noteId]
                                      .filter(Boolean)
                                      .join(' '),
                                  },
                                }}
                              />
                            }
                            sx={{ mr: 0 }}
                          />
                          {note && (
                            // The per-control half of "disabled WITH an
                            // explanation". Terse here because the banner above
                            // carries the full remedy; between them the control
                            // is never silently inert.
                            <Typography
                              id={noteId}
                              variant="caption"
                              color="text.secondary"
                              sx={{ ml: 6, mt: -0.5 }}
                            >
                              {note}
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      </CardContent>
    </Card>
  );
}

export default NotificationSettings;
