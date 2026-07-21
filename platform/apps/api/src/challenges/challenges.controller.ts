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
  Query,
  UseGuards,
} from '@nestjs/common';
import type { PaymentProvider } from '@vcp/payments';
import { ChallengeStatus } from '@vcp/domain';
import { apiError } from '@vcp/contracts';
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
import { cancelChallenge } from './cancel-challenge.js';
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

  /** Öffentliche Liste von Challenges, optional nach Status gefiltert (Discover/Admin). */
  @Get()
  async list(@Query('status') status?: string, @Query('limit') limit?: string) {
    if (status !== undefined && !(status in ChallengeStatus)) {
      throw apiError('INVALID_INPUT');
    }
    const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
    return this.prisma.challenge.findMany({
      where: status !== undefined ? { status: status as (typeof ChallengeStatus)[keyof typeof ChallengeStatus] } : {},
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        selectionMode: true,
        prizeAmountCents: true,
        maxSlots: true,
        submissionDeadline: true,
        createdAt: true,
      },
    });
  }

  /** Einsendungen einer Challenge inkl. Stimmenzahl (für die Moderations-/Auswahlansicht). */
  @Get(':id/submissions')
  @UseGuards(AuthGuard)
  async submissions(@Param('id', new ParseUUIDPipe()) id: string) {
    const subs = await this.prisma.submission.findMany({
      where: { challengeId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, participantId: true, status: true, finalizedAt: true, createdAt: true },
    });
    const counts = await this.prisma.vote.groupBy({
      by: ['submissionId'],
      where: { challengeId: id },
      _count: { _all: true },
    });
    const countById = new Map(counts.map((c) => [c.submissionId, c._count._all]));
    return subs.map((s) => ({ ...s, voteCount: countById.get(s.id) ?? 0 }));
  }

  /** Öffentliche Leseansicht einer Challenge (Zustand einsehen). */
  @Get(':id')
  async getById(@Param('id', new ParseUUIDPipe()) id: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        status: true,
        selectionMode: true,
        prizeAmountCents: true,
        maxSlots: true,
        submissionDeadline: true,
        createdAt: true,
        creatorId: true,
        criteria: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, title: true, description: true, mandatory: true, evidenceType: true, sortOrder: true },
        },
      },
    });
    if (challenge === null) {
      throw new NotFoundException('Diese Challenge existiert nicht.');
    }
    const occupied = await this.prisma.slot.count({
      where: { challengeId: id, status: { in: ['RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED'] } },
    });
    const decision = await this.prisma.winnerDecision.findUnique({
      where: { challengeId: id },
      select: { winnerSubmissionId: true, decisionSource: true },
    });
    return { ...challenge, occupiedSlots: occupied, winner: decision };
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

  /** Bricht die Challenge ab und erstattet ggf. die Preissumme (Ersteller oder Admin). */
  @Post(':id/cancel')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthenticatedUser) {
    return cancelChallenge(this.deps, { challengeId: id, actorId: user.id, isAdmin: user.isAdmin });
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
