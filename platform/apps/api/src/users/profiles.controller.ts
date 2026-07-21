import { Controller, Get, Inject, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { getProfileByUsername } from './get-profile.js';

/**
 * Öffentliche Profile per Nutzername. Eigener Pfad (`/v1/profiles/:username`), damit es
 * keine Kollision mit `/v1/users/me` gibt.
 */
@Controller('v1/profiles')
export class ProfilesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get(':username')
  async byUsername(@Param('username') username: string) {
    return getProfileByUsername({ prisma: this.prisma }, username);
  }
}
