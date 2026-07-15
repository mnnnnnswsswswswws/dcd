import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  // @Inject explizit (siehe ChallengesController): DI ohne emitDecoratorMetadata.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: 'ok'; db: 'up' | 'down' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch {
      return { status: 'ok', db: 'down' };
    }
  }
}
