import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiDataResponse } from '../common/decorators/api-data-response.decorator';
import { Auth } from '../auth/decorators/auth.decorator';
import { NOTIFICATION_EVENTS } from './notification-events';
import {
  NotificationEventDto,
  type NotificationEventResponse,
} from './dto/notification-event.dto';

// =============================================================================
// NotificationsController (issue #124, epic #109)
// =============================================================================
//
// One endpoint: the notification event registry, over HTTP.
//
// #121 shipped the registry and deliberately shipped NO endpoint for it,
// leaving that to "#125/#126 when they have a consumer". #126 (the per-user
// preferences page) is that consumer and flagged the endpoint as unowned
// scope; it lands here because it is small, it is API work, and it belongs
// next to the other API half of this epic rather than being invented twice.
//
// -----------------------------------------------------------------------------
// WHY AN ENDPOINT AT ALL, RATHER THAN A COPY IN `apps/web`
// -----------------------------------------------------------------------------
//
// The argument is written out at length in notification-events.ts: the API
// owns the declaration and the web reads the server's answer, so there is
// exactly one list in the repository and nothing to drift. A duplicated
// registry in the web app would make `mandatory` — a SECURITY gate — exist in
// two places, and it would break epic #109's headline promise that adding a
// notification costs ONE registry entry.
//
// -----------------------------------------------------------------------------
// AUTHENTICATED, BUT NOT ADMIN-GATED. THIS IS DELIBERATE.
// -----------------------------------------------------------------------------
//
// `@Auth()` with no permissions: every signed-in user may read this. It is
// what #126's preferences page renders its matrix against, and that page
// belongs to every user, not to administrators — gating it on
// `system_settings:read` (the reflex, since the other endpoints in this issue
// use it) would leave a Viewer with a preferences page and no rows in it.
//
// Nothing here is sensitive: the payload is a static, compiled-in list of
// event names and descriptions, identical for every caller. It carries no user
// data, no configuration, and no per-account state — a caller learns only what
// this application can notify anyone about.
//
// It is not PUBLIC either. An unauthenticated endpoint enumerating an app's
// security events is free reconnaissance for no benefit, and there is no
// signed-out screen that needs the list.
// =============================================================================

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  @Get('events')
  @Auth()
  @ApiOperation({
    summary: 'List notification events',
    description:
      'The registry of events this application can raise, in the order the ' +
      'preferences UI should render them. Readable by **any authenticated user** — ' +
      'every user renders their own preferences against it.\n\n' +
      'This describes what events *exist*, not what the caller has chosen. An event ' +
      'with `mandatory: true` cannot be switched off; that is enforced server-side ' +
      'during delivery, and the flag is here so the UI can show the control disabled ' +
      'with a reason rather than hiding it.',
  })
  @ApiDataResponse(NotificationEventDto, {
    isArray: true,
    description: 'The notification event registry',
  })
  listEvents(): NotificationEventResponse[] {
    // Mapped field by field rather than returned directly, for three reasons:
    //
    //   1. `mandatory` is normalised from `boolean | undefined` to `boolean`,
    //      so no client has to know that absent means "the user is in charge".
    //   2. `channels` is COPIED. The arrays in `NOTIFICATION_EVENTS` are the
    //      registry's own state and this is a module-level constant living for
    //      the process lifetime; handing out the live array would let a
    //      serialiser or an interceptor that sorts in place reconfigure
    //      delivery for every later dispatch.
    //   3. The response shape is decided here, in code that is about the
    //      response shape. A spread would make it a consequence of whatever
    //      the registry happens to hold, so a field added for the dispatcher's
    //      internal use would silently become public API.
    return NOTIFICATION_EVENTS.map((event) => ({
      key: event.key,
      label: event.label,
      description: event.description,
      channels: [...event.channels],
      defaultEnabled: event.defaultEnabled,
      mandatory: event.mandatory === true,
    }));
  }
}
