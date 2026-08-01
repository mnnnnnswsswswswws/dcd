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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { PaymentProvider } from '@vcp/payments';
import { ChallengeStatus } from '@vcp/domain';
import { apiError } from '@vcp/contracts';
import { loadEnv } from '@vcp/config';
import type { EvidenceStorageProvider } from '../storage/storage-provider.js';
import { EVIDENCE_STORAGE } from '../storage/storage.module.js';
import { createEvidenceIntent } from '../submissions/create-evidence-intent.js';
import type { EventPublisher } from '../events/event-publisher.js';
import { EVENT_PUBLISHER } from '../events/events.module.js';
import { PAYMENT_PROVIDER } from '../payments/payments.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard.js';
import { CurrentUser, CurrentUserId } from '../auth/current-user.decorator.js';
import { ChallengeDetailCache } from './challenge-detail-cache.js';
import { ChallengeListCache } from './challenge-list-cache.js';
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
import { addComment, listComments, toggleBookmark, toggleLike } from '../social/social.js';

@Controller('v1/challenges')
export class ChallengesController {
  // @Inject explizit, damit die DI auch unter Transpilern ohne
  // emitDecoratorMetadata (esbuild/tsx) funktioniert, nicht nur unter SWC.
  private readonly payoutsEnabled = loadEnv().PAYOUTS_ENABLED;
  private readonly longCaptureEnabled = loadEnv().LONG_CAPTURE_ENABLED;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    @Inject(EVIDENCE_STORAGE) private readonly storage: EvidenceStorageProvider,
    @Inject(ChallengeDetailCache) private readonly detailCache: ChallengeDetailCache,
    @Inject(ChallengeListCache) private readonly listCache: ChallengeListCache,
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

    // Über den Cache statt direkt an die Datenbank. Diese Route ist der heißeste
    // Lesepfad — ein Feed ruft sie bei jedem Scroll auf. Vorher lief hier bei
    // jedem Request ein Aggregat über `slots` plus zwei über Likes und
    // Kommentare, obwohl Projektion und Cache bereits existierten und nur an der
    // Detail-Route hingen. Ein Cache neben dem heißen Pfad entlastet nichts.
    const items = await this.listCache.list({ status, limit: take });

    // `occupiedSlots` bleibt im Vertrag, ist aber ausdrücklich ein Anzeigewert:
    // Über einen Platz entscheidet allein `joinChallenge` unter FOR UPDATE.
    return items.map(({ occupiedSlotsForDisplay, ...rest }) => ({
      ...rest,
      occupiedSlots: occupiedSlotsForDisplay,
    }));
  }

  /** Like auf eine Challenge togglen. */
  @Post(':id/like')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async like(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUserId() userId: string) {
    return toggleLike({ prisma: this.prisma }, id, userId);
  }

  /** Challenge merken (Bookmark) togglen. */
  @Post(':id/bookmark')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async bookmark(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUserId() userId: string) {
    return toggleBookmark({ prisma: this.prisma }, id, userId);
  }

  /** Kommentare einer Challenge (öffentlich lesbar). */
  @Get(':id/comments')
  async comments(@Param('id', new ParseUUIDPipe()) id: string) {
    return listComments({ prisma: this.prisma }, id);
  }

  /** Kommentar hinzufügen. */
  @Post(':id/comments')
  @HttpCode(201)
  @UseGuards(AuthGuard)
  async addComment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() userId: string,
    @Body() body: { body?: string },
  ) {
    return addComment({ prisma: this.prisma }, id, userId, body);
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
    // Der Platzstand kommt aus dem Cache über der Projektion statt aus einem
    // COUNT über `slots`. Genau dieser Aggregat-Scan ist der Teil, der bei einer
    // viral gehenden Challenge zuerst nachgibt — das Nachschlagen der Stammdaten
    // über den Primärschlüssel nicht.
    //
    // Der Wert ist ausdrücklich anzeigeorientiert und darf hinterherhinken. Für die
    // Platzvergabe wird er nie herangezogen: `joinChallenge` zählt unter
    // `SELECT … FOR UPDATE` gegen die Primärtabelle (Architekturregeln 2, 3 und 9).
    const view = await this.detailCache.get(id);
    const occupied = view?.occupiedSlotsForDisplay ?? 0;
    const decision = await this.prisma.winnerDecision.findUnique({
      where: { challengeId: id },
      select: { winnerSubmissionId: true, decisionSource: true },
    });
    const [likeCount, commentCount] = await Promise.all([
      this.prisma.challengeLike.count({ where: { challengeId: id } }),
      this.prisma.comment.count({ where: { challengeId: id } }),
    ]);
    return { ...challenge, occupiedSlots: occupied, winner: decision, likeCount, commentCount };
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

  /**
   * Erzeugt eine Upload-Absicht für die In-App-Beweisaufnahme. Nur verfügbar, wenn
   * `LONG_CAPTURE_ENABLED` gesetzt ist — sonst existiert der Endpunkt schlicht nicht (404).
   */
  @Post(':id/evidence-intent')
  @HttpCode(201)
  @UseGuards(AuthGuard)
  async evidenceIntent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() userId: string,
    @Body() body: { contentType?: string },
  ) {
    if (!this.longCaptureEnabled) {
      throw new NotFoundException('Die In-App-Aufnahme ist nicht aktiviert.');
    }
    return createEvidenceIntent(
      { prisma: this.prisma, storage: this.storage },
      { challengeId: id, userId, contentType: body?.contentType },
    );
  }

  /**
   * Reicht die Einsendung des Teilnehmers ein. Bei aktivierter In-App-Aufnahme
   * (`LONG_CAPTURE_ENABLED`) ist ein gültiger `evidenceRef` erforderlich; sonst Stub.
   */
  @Post(':id/submit')
  @UseGuards(AuthGuard)
  async submit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() userId: string,
    @Body() body: { evidenceRef?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await submitEntry(this.deps, {
      challengeId: id,
      userId,
      evidenceRef: body?.evidenceRef,
      requireEvidence: this.longCaptureEnabled,
    });

    // Ohne Beweisvideo ist mit der Antwort alles erledigt: 201 Created.
    if (result.operationId === undefined) {
      res.status(201);
      return result;
    }

    // Mit Beweisvideo steht die Prüfung noch aus — die Einsendung existiert, ist
    // aber noch nicht vollständig verarbeitet. Genau dafür ist 202 da
    // (Architekturregel 7). Der Client verfolgt den Rest über die URL, statt eine
    // Verbindung offen zu halten.
    res.status(202);
    res.setHeader('Location', `/v1/operations/${result.operationId}`);
    return { ...result, operationUrl: `/v1/operations/${result.operationId}` };
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
