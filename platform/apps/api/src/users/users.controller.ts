import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { apiError } from '@vcp/contracts';
import type { EventPublisher } from '../events/event-publisher.js';
import { EVENT_PUBLISHER } from '../events/events.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { registerUser } from './register-user.js';

@Controller('v1/users')
export class UsersController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  /** Registriert einen Nutzer (18+-Gate). Die zurückgegebene ID dient als Bearer-Token. */
  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async register(@Body() body: { isAdult?: boolean }) {
    return registerUser(
      { prisma: this.prisma, events: this.events },
      { isAdult: body.isAdult === true },
    );
  }

  /** Profil des authentifizierten Nutzers. */
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUserId() userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isAdult: true, createdAt: true },
    });
    if (user === null) {
      throw apiError('USER_NOT_FOUND');
    }
    return user;
  }
}
