import { loadEnv } from '@vcp/config';
import { closeExpiredSubmissions } from '@vcp/api';
import { runLoop } from './loop.js';

/** Fristen-Worker: schließt Einsendungen abgelaufener Challenges (→ SUBMISSIONS_CLOSED). */
loadEnv();
void runLoop('close-submissions', async ({ prisma, events }) => {
  const result = await closeExpiredSubmissions({ prisma, events });
  if (result.closedChallengeIds.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[close-submissions] geschlossen=${result.closedChallengeIds.length}`);
  }
});
