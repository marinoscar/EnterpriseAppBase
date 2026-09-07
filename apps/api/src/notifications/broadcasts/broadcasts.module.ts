// =============================================================================
// Broadcasts module (issue #323, epic #319)
// =============================================================================
//
// The fan-out half of admin broadcasts: the two job handlers and nothing else.
// Its whole purpose is to be somewhere Nest constructs those handlers, so that
// their `onModuleInit()` runs and each self-registers with
// `JobHandlerRegistry`. That single `this.registry.register(this)` line per
// handler is the entire wiring cost of a new job type — no migration, no enum
// arm, no `switch` in the worker, no central list of types — and this module
// is the "add it to your feature module" step from `jobs/handlers/README.md`.
//
// NO CONTROLLER AND NO SERVICE YET. #324 adds `/api/admin/broadcasts` (create,
// list, get, cancel, delete, test send, audience count) and the service behind
// it; #325 adds the admin page. This module is deliberately shipped ahead of
// them, in the same spirit as `JobsModule` and `NotificationsModule` being
// registered in `app.module.ts` before anything used them: a broken DI graph
// then fails at boot, and the handlers' self-registration is exercised on
// every boot, which is what proves the extension point actually works. It
// costs nothing at runtime — no loop is started and no query is issued until a
// broadcast job is claimed.
//
// A SIBLING OF `NotificationsModule`, NOT PART OF IT. The two are separate on
// purpose: broadcasts CONSUME the dispatcher through its one public entry
// point (`NotificationsService.notifyNow`) exactly as `UsersService` and
// `AllowlistService` consume `notify()`. Folding these providers into
// `NotificationsModule` would give the fan-out the dispatcher's internals —
// the channel senders, the delivery service, the store — as constructor
// candidates, which is precisely the surface that module's barrel comment
// refuses to export because the preference gate and the `mandatory` override
// live behind it.
//
// WHY EACH IMPORT IS HERE:
//
//   - `PrismaModule`  — `notification_broadcasts` and `users`; both handlers.
//   - `JobsModule`    — `JobHandlerRegistry` (registration) and `JobsService`
//                       (the chunk chain enqueues its own successor).
//   - `NotificationsModule` — `NotificationsService.notifyNow`, the ONLY way
//                       a recipient is reached. It exports that service and
//                       nothing else, which is the point.
//   - `ConfigModule`  — `appUrl`, for the absolute CTA URL the email layout
//                       requires. Listed explicitly even though
//                       `ConfigModule.forRoot({ isGlobal: true })` in
//                       `app.module.ts` already makes `ConfigService`
//                       injectable everywhere: an import that states a real
//                       dependency documents it, and survives the day somebody
//                       reconsiders `isGlobal`.
// =============================================================================

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { JobsModule } from '../../jobs/jobs.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications.module';
import { BroadcastChunkHandler } from './handlers/broadcast-chunk.handler';
import { BroadcastStartHandler } from './handlers/broadcast-start.handler';

@Module({
  imports: [PrismaModule, JobsModule, NotificationsModule, ConfigModule],
  providers: [BroadcastStartHandler, BroadcastChunkHandler],
})
export class BroadcastsModule {}
