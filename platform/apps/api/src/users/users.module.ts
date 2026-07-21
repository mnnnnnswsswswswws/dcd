import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { ProfilesController } from './profiles.controller.js';

@Module({
  controllers: [UsersController, ProfilesController],
})
export class UsersModule {}
