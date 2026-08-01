import { Global, Module } from '@nestjs/common';
import { LoggingEventPublisher } from './event-publisher.js';

/** DI-Token für den EventPublisher (Interface hat keine Laufzeitrepräsentation). */
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

@Global()
@Module({
  providers: [{ provide: EVENT_PUBLISHER, useClass: LoggingEventPublisher }],
  exports: [EVENT_PUBLISHER],
})
export class EventsModule {}
