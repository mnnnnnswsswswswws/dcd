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

  /** Challenges des Nutzers: selbst erstellt und beigetreten (inkl. Slot-Status). */
  @Get('me/challenges')
  @UseGuards(AuthGuard)
  async myChallenges(@CurrentUserId() userId: string) {
    const summary = {
      id: true,
      status: true,
      selectionMode: true,
      prizeAmountCents: true,
      maxSlots: true,
      submissionDeadline: true,
      createdAt: true,
    } as const;

    const created = await this.prisma.challenge.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      select: summary,
    });

    const slots = await this.prisma.slot.findMany({
      where: { participantId: userId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, challenge: { select: summary } },
    });
    const joined = slots.map((s) => ({ ...s.challenge, slotStatus: s.status }));

    return { created, joined };
  }
}
