import {
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { EventPublisher } from '../events/event-publisher.js';
import { EVENT_PUBLISHER } from '../events/events.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { joinChallenge, type JoinChallengeResult } from './join-challenge.js';

@Controller('v1/challenges')
export class ChallengesController {
  // @Inject(PrismaService) explizit, damit die DI auch unter Transpilern ohne
  // emitDecoratorMetadata (esbuild/tsx) funktioniert, nicht nur unter SWC.
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  /** Öffentliche Leseansicht einer Challenge (Zustand einsehen). */
  @Get(':id')
  async getById(@Param('id', new ParseUUIDPipe()) id: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        selectionMode: true,
        prizeAmountCents: true,
        maxSlots: true,
        submissionDeadline: true,
        createdAt: true,
      },
    });
    if (challenge === null) {
      throw new NotFoundException('Diese Challenge existiert nicht.');
    }
    const occupied = await this.prisma.slot.count({
      where: { challengeId: id, status: { in: ['RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED'] } },
    });
    return { ...challenge, occupiedSlots: occupied };
  }

  /** Reserviert einen Teilnehmerplatz für den authentifizierten Nutzer. */
  @Post(':id/join')
  @HttpCode(201)
  @UseGuards(AuthGuard)
  async join(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() userId: string,
  ): Promise<JoinChallengeResult> {
    return joinChallenge(
      { prisma: this.prisma, events: this.events },
      { challengeId: id, userId },
    );
  }
}
