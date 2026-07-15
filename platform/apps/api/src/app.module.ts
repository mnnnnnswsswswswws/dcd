import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { EventsModule } from './events/events.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ChallengesModule } from './challenges/challenges.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [PrismaModule, EventsModule, AuthModule, ChallengesModule],
  controllers: [HealthController],
})
export class AppModule {}
