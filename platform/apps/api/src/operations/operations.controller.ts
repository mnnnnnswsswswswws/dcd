import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { getOperation, type OperationView } from './async-operations.js';

/**
 * Statusabfrage für asynchrone Operationen (Scale S1, Aufgabe 10).
 *
 * Gegenstück zu `202 Accepted`: Statt eine Verbindung für die Dauer der
 * Videoverarbeitung offen zu halten, bekommt der Client eine Operations-ID und
 * fragt hier nach. Der Endpunkt ist absichtlich leichtgewichtig (ein
 * Primärschlüssel-Lookup) und darf deshalb häufig abgefragt werden.
 *
 * Die Antwort ist **nutzerspezifisch** und darf niemals zwischen Nutzern geteilt
 * oder im CDN abgelegt werden (Architekturregel 10) — sie kann Ressourcen-IDs und
 * Fehlermeldungen enthalten.
 */
@Controller('v1/operations')
export class OperationsController {
  // @Inject explizit, damit DI auch ohne emitDecoratorMetadata funktioniert.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() userId: string,
  ): Promise<OperationView> {
    const op = await getOperation(this.prisma, id, userId);
    // Fremde und nicht existierende Operationen sind ununterscheidbar — sonst
    // verrät der Endpunkt, welche IDs es gibt.
    if (op === null) {
      throw new NotFoundException({
        error: { code: 'OPERATION_NOT_FOUND', message: 'Diese Operation existiert nicht.' },
      });
    }
    return op;
  }
}
