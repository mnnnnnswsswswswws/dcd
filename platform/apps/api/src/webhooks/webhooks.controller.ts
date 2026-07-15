import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { loadEnv } from '@vcp/config';
import type { EventPublisher } from '../events/event-publisher.js';
import { EVENT_PUBLISHER } from '../events/events.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { confirmFunding } from '../funding/confirm-funding.js';

interface PaymentWebhookBody {
  type?: string;
  providerRef?: string;
  amountCents?: number;
}

/**
 * Eingang für Zahlungs-Webhooks. Die Bestätigung der Vollfinanzierung ist die
 * **einzige** Quelle für die Veröffentlichung einer Challenge — niemals eine
 * Client-Erfolgsmeldung. Das Secret wird gegen `WEBHOOK_SECRET` geprüft.
 */
@Controller('v1/webhooks')
export class WebhooksController {
  private readonly webhookSecret = loadEnv().WEBHOOK_SECRET;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  @Post('payments')
  @HttpCode(200)
  async payments(
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() body: PaymentWebhookBody,
  ): Promise<{ received: true; published: boolean; alreadyConfirmed: boolean }> {
    if (!secret || secret !== this.webhookSecret) {
      throw new UnauthorizedException('Ungültiges Webhook-Secret.');
    }
    if (body.type !== 'funding.succeeded' || !body.providerRef || typeof body.amountCents !== 'number') {
      throw new BadRequestException('Ungültige Webhook-Nutzlast.');
    }

    const result = await confirmFunding(
      { prisma: this.prisma, events: this.events },
      { providerRef: body.providerRef, amountCents: body.amountCents },
    );
    return { received: true, published: result.published, alreadyConfirmed: result.alreadyConfirmed };
  }
}
