import { Module } from '@nestjs/common';
import { SubmissionsController } from './submissions.controller.js';

@Module({
  controllers: [SubmissionsController],
})
export class SubmissionsModule {}
