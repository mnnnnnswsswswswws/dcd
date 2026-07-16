import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller.js';

@Module({
  controllers: [FeedController],
})
export class FeedModule {}
