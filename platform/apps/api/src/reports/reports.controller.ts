import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { apiError } from '@vcp/contracts';
import type { EventPublisher } from '../events/event-publisher.js';
import { EVENT_PUBLISHER } from '../events/events.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard.js';
import { CurrentUser, CurrentUserId } from '../auth/current-user.decorator.js';
import { createReport, type CreateReportInput } from './create-report.js';
import { updateReport } from './update-report.js';

@Controller('v1/reports')
export class ReportsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  /** Meldet einen Inhalt oder ein Konto (jeder authentifizierte Nutzer). */
  @Post()
  @HttpCode(201)
  @UseGuards(AuthGuard)
  async create(
    @CurrentUserId() userId: string,
    @Body() body: Omit<CreateReportInput, 'reporterId'>,
  ) {
    return createReport({ prisma: this.prisma, events: this.events }, { ...body, reporterId: userId });
  }

  /** Moderations-/Admin-Queue der Meldungen (nur Admin), optional nach Status. */
  @Get()
  @UseGuards(AuthGuard)
  async list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    if (!user.isAdmin) {
      throw apiError('NOT_ADMIN');
    }
    const validStatuses = ['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'];
    if (status !== undefined && !validStatuses.includes(status)) {
      throw apiError('INVALID_INPUT');
    }
    return this.prisma.report.findMany({
      where: status !== undefined ? { status: status as 'OPEN' } : {},
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 100,
      select: {
        id: true,
        targetType: true,
        targetId: true,
        reason: true,
        description: true,
        status: true,
        priority: true,
        createdAt: true,
      },
    });
  }

  /** Setzt den Bearbeitungsstatus einer Meldung (nur Admin). */
  @Patch(':id')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { status?: string },
  ) {
    return updateReport(
      { prisma: this.prisma, events: this.events },
      { reportId: id, status: body.status as never, isAdmin: user.isAdmin },
    );
  }
}
