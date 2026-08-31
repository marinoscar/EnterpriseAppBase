import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';

// =============================================================================
// NotificationsModule (issue #124, epic #109)
// =============================================================================
//
// #121 shipped the event registry as pure data with no module at all, which
// was right: a constant needs no DI. #124 adds the one endpoint that serves it
// (see the controller for why the web reads the list rather than copying it),
// and an endpoint needs a module.
//
// STILL NO PROVIDERS. The controller reads a compiled-in constant, so there is
// nothing to inject and nothing to export. #125's dispatcher and delivery
// records land here and will bring their own; keeping the module empty until
// then means the graph says exactly what exists.
// =============================================================================

@Module({
  controllers: [NotificationsController],
})
export class NotificationsModule {}
