import { loadEnv } from '@vcp/config';
import { expireSlots } from '@vcp/api';
import { runLoop } from './loop.js';

/** Slot-Expiration-Worker: gibt abgelaufene Reservierungen frei (FULL → OPEN). */
loadEnv();
void runLoop('expire-slots', async ({ prisma, events }) => {
  const result = await expireSlots({ prisma, events });
  if (result.expiredSlotCount > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[expire-slots] freigegeben=${result.expiredSlotCount} reopened=${result.reopenedChallengeIds.length}`,
    );
  }
});
