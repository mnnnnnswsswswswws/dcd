import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { buildDatasourceUrl } from './pool-url.js';

/**
 * PrismaClient als injizierbarer Nest-Provider mit Lifecycle-Anbindung.
 *
 * Die Poolgröße wird aus `DB_POOL_SIZE` abgeleitet — von Terraform gesetzt, vom
 * CI-Verbindungsbudget geprüft. Ohne das übernähme Prisma seinen Default
 * (`CPUs × 2 + 1`), der weder aus der Datenbankkapazität folgt noch zu den
 * Terraform-Werten passt; eine Instanz öffnete dann unter Last mehr Verbindungen,
 * als das Budget vorsieht (Architekturregel 9).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = buildDatasourceUrl();
    // Ohne DATABASE_URL bleibt es beim Schema-Default — relevant für Werkzeuge und
    // Tests, die den Client ohne vollständige Umgebung erzeugen.
    super(url !== undefined ? { datasources: { db: { url } } } : {});
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
