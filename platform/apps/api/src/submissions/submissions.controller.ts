import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { apiError } from '@vcp/contracts';
import type { EventPublisher } from '../events/event-publisher.js';
import { EVENT_PUBLISHER } from '../events/events.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { moderateSubmission } from './moderate-submission.js';

@Controller('v1/submissions')
export class SubmissionsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  /** Moderationsentscheidung über eine Einsendung (Admin). */
  @Post(':id/moderate')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async moderate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { decision?: string },
  ) {
    if (body.decision !== 'APPROVED' && body.decision !== 'REJECTED') {
      throw apiError('INVALID_INPUT');
    }
    return moderateSubmission(
      { prisma: this.prisma, events: this.events },
      { submissionId: id, decision: body.decision, isAdmin: user.isAdmin },
    );
  }
}
