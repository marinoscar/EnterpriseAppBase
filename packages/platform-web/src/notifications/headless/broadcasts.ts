/**
 * The admin broadcast API, as the web app sees it (issue #325, epic #319).
 *
 * ONE MODULE FOR SEVEN ROUTES, following `services/jobs.ts` rather than adding
 * seven more functions to `services/api.ts`. That file is the transport
 * (`ApiService`, the refresh dance, the maintenance recogniser) plus the
 * endpoints that predate the convention; this epic's surface — an audience
 * count, a test send, a list, a create, a read, a cancel, a resume and a
 * delete — is
 * large enough that keeping it together is what lets the types below sit next
 * to the calls that produce them. Everything still goes through the shared
 * `api` client, so a broadcast request inherits the token refresh, the 401
 * retry and the maintenance interception like every other call in the app.
 *
 * =============================================================================
 * THE TYPES ARE MIRRORS OF `apps/api/src/notifications/broadcasts/dto/`
 * =============================================================================
 *
 * Every interface below is the TypeScript shadow of a Zod schema on the API
 * side, field for field and nullability for nullability:
 *
 *   `Broadcast`              → `broadcastSchema`              (dto/broadcast-response.dto.ts)
 *   `BroadcastDetail`        → `broadcastDetailSchema`        (same file)
 *   `BroadcastDeliveryCount` → `broadcastDeliveryCountSchema` (same file)
 *   `BroadcastCreateResult`  → `broadcastCreateResultSchema`  (same file)
 *   `BroadcastAudience`      → `broadcastAudienceSchema`      (same file)
 *   `BroadcastTestResult`    → `broadcastTestResultSchema`    (same file)
 *   `BroadcastListResponse`  → `@ApiDataResponse(BroadcastDto, { pagination: 'flat' })`
 *   `CreateBroadcastRequest` → `createBroadcastSchema`        (dto/create-broadcast.dto.ts)
 *   `BroadcastListParams`    → `broadcastListQuerySchema`     (dto/broadcast-list-query.dto.ts)
 *
 * `recipientsTargeted` is `number | null` for the same reason `services/jobs.ts`
 * keeps its nullable durations nullable: the audience is not counted until the
 * fan-out claims the broadcast and stamps its cutoff, so a `scheduled` row has
 * no target count at all. Defaulting it to `0` at a call site would print a
 * measurement that was never taken — "0 recipients" beside a broadcast that is
 * about to reach everybody.
 *
 * =============================================================================
 * WHY THE LIMITS ARE RESTATED HERE
 * =============================================================================
 *
 * `BROADCAST_TITLE_MAX`, `BROADCAST_BODY_MAX` and friends are copies of the
 * DTO's own constants. There is no shared type surface between the two
 * workspaces, so the composer's character counters would otherwise be numbers
 * invented in the UI — and a counter that disagrees with the validator is worse
 * than no counter, because it promises an acceptance the API will refuse. The
 * copies were asserted against the API file on disk until #738 moved both
 * sides onto the contract's constants.
 */

import { api } from './api.js';
import type { NotificationChannel } from './types.js';

// =============================================================================
// Enumerations and limits — the API's own, restated so a bad value cannot compile
// =============================================================================

// The limits and statuses are the wire contract's own values since #738
// (`@marinoscar/platform-contract/notifications`), the same constants the
// API's schemas validate with: a counter here can no longer drift from the
// validator it previews. `BROADCAST_CHUNK_SIZE` is the fan-out's page size,
// which the cancel confirmation names out loud.
export {
  BROADCAST_BODY_MAX,
  BROADCAST_CHUNK_SIZE,
  BROADCAST_CTA_LABEL_MAX,
  BROADCAST_LINK_MAX,
  BROADCAST_STATUSES,
  BROADCAST_TITLE_MAX,
} from '@marinoscar/platform-contract/notifications';
export type { BroadcastStatusName } from '@marinoscar/platform-contract/notifications';
import type { BroadcastStatusName } from '@marinoscar/platform-contract/notifications';

// =============================================================================
// Response shapes
// =============================================================================

/** One row of `GET /api/admin/broadcasts`. */
export interface Broadcast {
  id: string;
  title: string;
  body: string;
  link: string | null;
  ctaLabel: string | null;
  /**
   * `admin.broadcast` or `admin.broadcast_critical`, DERIVED by the API from
   * the `critical` flag and never accepted from a client. It is how a stored
   * row says whether recipients may mute it — there is no `critical` column.
   */
  eventKey: string;
  /** A narrowing of what the event declares. Typed as the API sends it: strings. */
  channels: string[];
  status: BroadcastStatusName;
  scheduledFor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  canceledAt: string | null;
  /** Stamped when the fan-out claims the row; the instant the audience froze. */
  audienceCutoff: string | null;
  /** `null` until the audience is frozen and counted — never treat it as 0. */
  recipientsTargeted: number | null;
  recipientsDispatched: number;
  lastError: string | null;
  createdById: string | null;
  /**
   * The organization the broadcast targets (#738): `null` for a system
   * broadcast (every active user), set for one organization's members.
   */
  targetOrgId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One `(channel, status)` cell of the delivery breakdown.
 *
 * APPROXIMATE by construction, and the API says so in its own field name:
 * delivery rows carry no broadcast id, so attribution is by event key and time
 * window. A second broadcast raised under the same key during this one's send
 * contributes to the total and nothing can separate them — which is why the
 * detail dialog labels the section rather than printing bare numbers.
 */
export interface BroadcastDeliveryCount {
  channel: string;
  status: string;
  count: number;
}

export interface BroadcastDetail extends Broadcast {
  approximateDeliveryAttempts: BroadcastDeliveryCount[];
}

export interface BroadcastListResponse {
  items: Broadcast[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * What `POST /api/admin/broadcasts` answers with.
 *
 * `warnings` is NON-FATAL and must be rendered rather than swallowed: the only
 * warning the API raises today is "browser notifications are off
 * deployment-wide", which is a legitimate thing to schedule around and
 * therefore explicitly not an error.
 */
export interface BroadcastCreateResult {
  broadcast: Broadcast;
  warnings: string[];
}

export interface BroadcastAudience {
  activeUsers: number;
}

export interface BroadcastTestResult {
  eventKey: string;
  channels: string[];
  sentToUserId: string;
}

// =============================================================================
// Requests
// =============================================================================

/**
 * The body `POST /` and `POST /test` both take, mirroring `createBroadcastSchema`.
 *
 * NO `eventKey`. The API derives it from `critical` and refuses to accept it,
 * because a caller who could name the event could pick one whose
 * `mandatory: true` makes it unmuteable — or borrow a template from an event
 * that is not a broadcast at all.
 *
 * `scheduledFor` is an ISO-8601 instant. The composer's `datetime-local` input
 * does not produce one; `localInputToIso` below is the only supported way to
 * get from that control's value to this field.
 */
export interface CreateBroadcastRequest {
  title: string;
  body: string;
  link?: string;
  ctaLabel?: string;
  channels: NotificationChannel[];
  scheduledFor?: string;
  critical: boolean;
  /**
   * Target one organization's active members (#738). A system administrator
   * may name any organization or none; an organization administrator's
   * broadcasts always target their active organization.
   */
  targetOrgId?: string;
}

/** The query `GET /` accepts, mirroring `broadcastListQuerySchema`. */
export interface BroadcastListParams {
  page?: number;
  pageSize?: number;
  status?: BroadcastStatusName;
}

export async function getBroadcasts(
  params: BroadcastListParams = {},
): Promise<BroadcastListResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.status) query.set('status', params.status);

  const suffix = query.toString();
  return api.get<BroadcastListResponse>(`/admin/broadcasts${suffix ? `?${suffix}` : ''}`);
}

/** One broadcast, plus its approximate delivery breakdown. */
export async function getBroadcast(id: string): Promise<BroadcastDetail> {
  return api.get<BroadcastDetail>(`/admin/broadcasts/${id}`);
}

/** Create and queue. Returns the row PLUS non-fatal warnings — render both. */
export async function createBroadcast(
  body: CreateBroadcastRequest,
): Promise<BroadcastCreateResult> {
  return api.post<BroadcastCreateResult>('/admin/broadcasts', body);
}

/**
 * The only recall mechanism this feature has.
 *
 * 409 for anything that is not `scheduled`, `sending` or `failed` — mirrored by
 * `isBroadcastCancelable` so the UI disables rather than merely handles the
 * failure. Cancelling a `failed` broadcast (issue #459) is how an operator says
 * "do not resume this": it records the decision without deleting the row.
 */
export async function cancelBroadcast(id: string): Promise<Broadcast> {
  return api.post<Broadcast>(`/admin/broadcasts/${id}/cancel`);
}

/**
 * Continue a `failed` broadcast from where its fan-out stopped (issue #459).
 *
 * Answers the row, now `sending`, to the SAME frozen audience — the cutoff is
 * not re-stamped. 409 for anything that is not `failed`, mirrored by
 * `isBroadcastResumable`; 404 when the row is gone.
 */
export async function resumeBroadcast(id: string): Promise<Broadcast> {
  return api.post<Broadcast>(`/admin/broadcasts/${id}/resume`);
}

/** Remove the record. 409 while `sending` — see `isBroadcastDeletable`. */
export async function deleteBroadcast(id: string): Promise<void> {
  await api.delete<void>(`/admin/broadcasts/${id}`);
}

/**
 * Send this composition to the CALLING USER ONLY.
 *
 * Stores nothing and queues nothing, so a test send never appears in the list.
 * There is no recipient parameter by design — an endpoint that could send
 * arbitrary admin-composed content to an arbitrary address would be a spam
 * relay.
 */
export async function sendTestBroadcast(
  body: CreateBroadcastRequest,
): Promise<BroadcastTestResult> {
  return api.post<BroadcastTestResult>('/admin/broadcasts/test', body);
}

/**
 * How many active users a broadcast created right now would reach.
 *
 * An ESTIMATE for a scheduled send: the real audience is frozen at a cutoff
 * stamped when sending begins, so users created or deactivated in between
 * change it. Counted with the same predicate the fan-out pages with, so the
 * composer and the send can never disagree about the method — only about when
 * it was run.
 */
export async function getBroadcastAudience(targetOrgId?: string): Promise<BroadcastAudience> {
  const suffix = targetOrgId ? `?targetOrgId=${encodeURIComponent(targetOrgId)}` : '';
  return api.get<BroadcastAudience>(`/admin/broadcasts/audience${suffix}`);
}

// =============================================================================
// Shared predicates
// =============================================================================

/**
 * Whether a cancel will be accepted at all.
 *
 * A MIRROR of the API's own refusal (`broadcasts.service.ts` raises 409 outside
 * `scheduled`, `sending` and `failed`), not an independent policy. Restated in
 * the UI because a `sent` broadcast has nothing to cancel: offering the action
 * and then reporting a 409 tells the operator the system failed, when in fact
 * the message had already gone out and the only honest answer is that it cannot
 * be recalled. `failed` is accepted since issue #459: a stopped broadcast is
 * resumable, and cancelling it is the explicit "leave it stopped" decision.
 */
export function isBroadcastCancelable(broadcast: Pick<Broadcast, 'status'>): boolean {
  return (
    broadcast.status === 'scheduled' ||
    broadcast.status === 'sending' ||
    broadcast.status === 'failed'
  );
}

/**
 * Whether a resume will be accepted (issue #459).
 *
 * A MIRROR of the API's own refusal — `POST /:id/resume` answers 409 for every
 * status except `failed` — not an independent policy. Only a broadcast whose
 * fan-out stopped on a permanently failed chunk has anything left to continue;
 * a `sent` one is finished and a `canceled` one was stopped on purpose.
 */
export function isBroadcastResumable(broadcast: Pick<Broadcast, 'status'>): boolean {
  return broadcast.status === 'failed';
}

/**
 * Whether a delete will be accepted.
 *
 * `false` only while `sending`, mirroring the API's 409 — and the server's
 * reason is why the UI must disable rather than handle the failure: deleting
 * the row would not stop the fan-out, which would keep running against a
 * record that no longer exists. Cancel first.
 */
export function isBroadcastDeletable(broadcast: Pick<Broadcast, 'status'>): boolean {
  return broadcast.status !== 'sending';
}

// =============================================================================
// `datetime-local` ⇄ ISO-8601
// =============================================================================
//
// A NATIVE `<input type="datetime-local">` VALUE IS LOCAL WALL-CLOCK WITH NO
// ZONE. The string `"2026-03-08T02:30"` means half past two in the morning
// wherever the administrator is sitting, and carries nothing that says where
// that is. The API, correctly, takes an instant. These two functions are the
// entire bridge between the two representations, and they are separated out
// here — rather than inlined in the composer — so they can be unit-tested
// directly, including across a DST boundary, which is the case that breaks
// every naive implementation.

/**
 * A `datetime-local` value → the ISO-8601 instant the API stores.
 *
 * `new Date(value)` is correct here and is NOT the loose parse the API's DTO
 * warns about: a string in this exact `YYYY-MM-DDTHH:mm` shape is defined by
 * the ECMAScript specification to be interpreted as LOCAL time (a date-only
 * string would be UTC — the asymmetry is real, and it is why this helper takes
 * the input control's value and nothing else). `toISOString()` then resolves it
 * against the browser's current offset, which is exactly the "what instant did
 * the admin mean by that wall-clock time" question being asked.
 *
 * Returns `null` for an empty or unparseable value rather than the string
 * `"Invalid Date"`, so a caller cannot post garbage the API will reject with a
 * message about a malformed date the admin never typed.
 */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** Two digits, zero-padded — the shape every `datetime-local` field expects. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * An ISO-8601 instant → the `datetime-local` value that displays it.
 *
 * ⚠ BUILT FROM THE LOCAL GETTERS, DELIBERATELY. The tempting one-liner —
 * `new Date(iso).toISOString().slice(0, 16)` — is the classic bug in this
 * conversion: `toISOString` is UTC, so an admin in UTC+2 who scheduled a send
 * for 09:00 reopens the form and reads 07:00, "corrects" it, and moves the
 * broadcast two hours earlier. The offset is invisible in the control, so
 * nothing on screen would have told them.
 *
 * `getMonth()` is zero-based; `getFullYear()` is padded to four digits so a
 * year before 1000 cannot produce a value the input silently rejects.
 * Round-trips with `localInputToIso` to the minute — seconds are truncated,
 * which is all a minute-resolution control can represent.
 */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const year = String(date.getFullYear()).padStart(4, '0');
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
