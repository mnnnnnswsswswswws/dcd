import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { EventsModule } from './events/events.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ChallengesModule } from './challenges/challenges.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    PrismaModule,
    EventsModule,
    AuthModule,
    PaymentsModule,
    ChallengesModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
