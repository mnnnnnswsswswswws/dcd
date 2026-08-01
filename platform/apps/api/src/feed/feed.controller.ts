import { Controller, Get, Inject, NotFoundException, Query } from '@nestjs/common';
import { loadEnv } from '@vcp/config';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Öffentlicher Social-Feed der entschiedenen Challenges (Gewinner sichtbar).
 * Hinter dem Flag `PUBLIC_FEED_ENABLED` (default false) — ist es aus, ist der Feed
 * schlicht nicht vorhanden (404).
 */
@Controller('v1/feed')
export class FeedController {
  private readonly enabled = loadEnv().PUBLIC_FEED_ENABLED;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async feed(@Query('limit') limit?: string) {
    if (!this.enabled) {
      throw new NotFoundException('Der öffentliche Feed ist nicht aktiviert.');
    }
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const rows = await this.prisma.challenge.findMany({
      where: { status: { in: ['WINNER_LOCKED', 'PAID_OUT'] } },
      orderBy: { updatedAt: 'desc' },
      take,
      select: {
        id: true,
        status: true,
        selectionMode: true,
        prizeAmountCents: true,
        updatedAt: true,
        decision: { select: { winnerSubmissionId: true, decisionSource: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      selectionMode: r.selectionMode,
      prizeAmountCents: r.prizeAmountCents,
      decidedAt: r.updatedAt,
      winner: r.decision,
    }));
  }
}
