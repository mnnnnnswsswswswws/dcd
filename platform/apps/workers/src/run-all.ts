import { loadEnv } from '@vcp/config';
import { closeExpiredSubmissions, expireSlots } from '@vcp/api';
import { runLoop } from './loop.js';

/** Kombinierter Worker: führt pro Durchlauf alle periodischen Sweeps aus. */
loadEnv();
void runLoop('all', async ({ prisma, events }) => {
  const expired = await expireSlots({ prisma, events });
  const closed = await closeExpiredSubmissions({ prisma, events });
  if (expired.expiredSlotCount > 0 || closed.closedChallengeIds.length > 0) {
     
    console.log(
      `[all] slots_freigegeben=${expired.expiredSlotCount} challenges_geschlossen=${closed.closedChallengeIds.length}`,
    );
  }
});
