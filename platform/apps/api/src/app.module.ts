import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loadEnv } from '@vcp/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { EventsModule } from './events/events.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ChallengesModule } from './challenges/challenges.module.js';
import { SubmissionsModule } from './submissions/submissions.module.js';
import { UsersModule } from './users/users.module.js';
import { FeedModule } from './feed/feed.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: loadEnv().RATE_LIMIT_TTL_MS, limit: loadEnv().RATE_LIMIT_MAX }],
      // In Tests deaktiviert, damit schnelle Testfolgen nicht in 429 laufen.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    PrismaModule,
    EventsModule,
    AuthModule,
    PaymentsModule,
    UsersModule,
    ChallengesModule,
    SubmissionsModule,
    FeedModule,
    ReportsModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
