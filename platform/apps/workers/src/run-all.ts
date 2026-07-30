import { loadEnv } from '@vcp/config';
import {
  closeExpiredSubmissions,
  createEvidenceStorage,
  expireSlots,
  processEvidenceOperations,
  purgeExpiredOperations,
} from '@vcp/api';
import { runLoop } from './loop.js';

/** Kombinierter Worker: führt pro Durchlauf alle periodischen Sweeps aus. */
loadEnv();

// Ein Provider für den gesamten Prozess: Der S3-Adapter ist zustandslos, aber ihn
// je Durchlauf neu zu bauen würde die Konfiguration erneut lesen und validieren.
const storage = createEvidenceStorage();

void runLoop('all', async ({ prisma, events }) => {
  const expired = await expireSlots({ prisma, events });
  const closed = await closeExpiredSubmissions({ prisma, events });
  // Beweisprüfung: schließt die Operationen, für die der Request bereits `202`
  // geantwortet hat. Ohne diesen Schritt bliebe jede Verfolgungs-URL für immer
  // auf PENDING stehen — eine Zusage ohne Einlösung.
  const evidence = await processEvidenceOperations(prisma, storage);
  // Abgelaufene Operationen abräumen (Retention).
  const purged = await purgeExpiredOperations(prisma);

  if (
    expired.expiredSlotCount > 0 ||
    closed.closedChallengeIds.length > 0 ||
    evidence.claimed > 0 ||
    purged > 0
  ) {
    console.log(
      `[all] slots_freigegeben=${expired.expiredSlotCount} ` +
        `challenges_geschlossen=${closed.closedChallengeIds.length} ` +
        `beweise_geprueft=${evidence.claimed} (ok=${evidence.succeeded} fehlgeschlagen=${evidence.failed}) ` +
        `operationen_abgeraeumt=${purged}`,
    );
  }
});
