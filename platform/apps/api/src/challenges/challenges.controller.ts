import {
  Body,
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
import type { PaymentProvider } from '@vcp/payments';
import { loadEnv } from '@vcp/config';
import type { EventPublisher } from '../events/event-publisher.js';
import { EVENT_PUBLISHER } from '../events/events.module.js';
import { PAYMENT_PROVIDER } from '../payments/payments.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard.js';
import { CurrentUser, CurrentUserId } from '../auth/current-user.decorator.js';
import { joinChallenge, type JoinChallengeResult } from './join-challenge.js';
import {
  createChallenge,
  type CreateChallengeInput,
  type CreateChallengeResult,
} from './create-challenge.js';
import { closeSubmissions } from './close-submissions.js';
import { selectWinner } from './select-winner.js';
import { submitEntry } from '../submissions/submit-entry.js';
import { castVote } from '../submissions/cast-vote.js';
import { processPayout } from '../funding/process-payout.js';

@Controller('v1/challenges')
export class ChallengesController {
  // @Inject explizit, damit die DI auch unter Transpilern ohne
  // emitDecoratorMetadata (esbuild/tsx) funktioniert, nicht nur unter SWC.
  private readonly payoutsEnabled = loadEnv().PAYOUTS_ENABLED;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  private get deps() {
    return { prisma: this.prisma, events: this.events };
  }

  /** Erstellt eine Challenge (Zustand PENDING_FUNDING) samt Finanzierungs-Absicht. */
  @Post()
  @HttpCode(201)
  @UseGuards(AuthGuard)
  async create(
    @CurrentUserId() userId: string,
    @Body() body: Omit<CreateChallengeInput, 'creatorId'>,
  ): Promise<CreateChallengeResult> {
    return createChallenge(
      { prisma: this.prisma, payments: this.payments, events: this.events },
      { ...body, creatorId: userId },
    );
  }

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
    return joinChallenge(this.deps, { challengeId: id, userId });
  }

  /** Reicht die Einsendung des Teilnehmers ein (Stub ohne echtes Video). */
  @Post(':id/submit')
  @HttpCode(201)
  @UseGuards(AuthGuard)
  async submit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() userId: string,
  ) {
    return submitEntry(this.deps, { challengeId: id, userId });
  }

  /** Zählt eine Community-Stimme für eine Einsendung. */
  @Post(':id/vote')
  @HttpCode(201)
  @UseGuards(AuthGuard)
  async vote(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() userId: string,
    @Body() body: { submissionId?: string },
  ) {
    return castVote(this.deps, {
      challengeId: id,
      submissionId: String(body.submissionId ?? ''),
      voterId: userId,
    });
  }

  /** Schließt die Einsendungsphase (Admin). */
  @Post(':id/close')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async close(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthenticatedUser) {
    return closeSubmissions(this.deps, { challengeId: id, isAdmin: user.isAdmin });
  }

  /** Wählt den Gewinner aus (Ersteller oder Admin-Fallback). */
  @Post(':id/select-winner')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async selectWinner(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { winnerSubmissionId?: string },
  ) {
    return selectWinner(this.deps, {
      challengeId: id,
      actorId: user.id,
      isAdmin: user.isAdmin,
      winnerSubmissionId: body.winnerSubmissionId,
    });
  }

  /** Führt die idempotente Auszahlung aus (Admin; Geldfluss nur bei PAYOUTS_ENABLED). */
  @Post(':id/payout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async payout(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthenticatedUser) {
    return processPayout(this.deps, {
      challengeId: id,
      isAdmin: user.isAdmin,
      payoutsEnabled: this.payoutsEnabled,
    });
  }
}
