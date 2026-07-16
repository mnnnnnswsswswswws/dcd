import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { WebhookVerifier } from '@vcp/payments';
import type { EventPublisher } from '../events/event-publisher.js';
import { EVENT_PUBLISHER } from '../events/events.module.js';
import { WEBHOOK_VERIFIER } from '../payments/payments.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { confirmFunding } from '../funding/confirm-funding.js';

/**
 * Eingang für Zahlungs-Webhooks. Die Bestätigung der Vollfinanzierung ist die
 * **einzige** Quelle für die Veröffentlichung einer Challenge — niemals eine
 * Client-Erfolgsmeldung. Die Verifikation (Mock-Secret bzw. Stripe-Signatur)
 * übernimmt der konfigurierte `WebhookVerifier` über den Raw-Body.
 */
@Controller('v1/webhooks')
export class WebhooksController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(WEBHOOK_VERIFIER) private readonly verifier: WebhookVerifier,
  ) {}

  @Post('payments')
  @HttpCode(200)
  async payments(
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: true; published: boolean; alreadyConfirmed: boolean }> {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

    let event;
    try {
      event = await this.verifier.verify(rawBody, req.headers);
    } catch {
      throw new UnauthorizedException('Webhook-Verifikation fehlgeschlagen.');
    }
    if (event.type !== 'funding.succeeded') {
      throw new BadRequestException('Ungültige Webhook-Nutzlast.');
    }

    const result = await confirmFunding(
      { prisma: this.prisma, events: this.events },
      { providerRef: event.providerRef, amountCents: event.amountCents },
    );
    return { received: true, published: result.published, alreadyConfirmed: result.alreadyConfirmed };
  }
}
