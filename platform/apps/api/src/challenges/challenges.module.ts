import { Module } from '@nestjs/common';
import { ChallengesController } from './challenges.controller.js';

@Module({
  controllers: [ChallengesController],
})
export class ChallengesModule {}
