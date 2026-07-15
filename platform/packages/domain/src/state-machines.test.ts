import { describe, expect, it } from 'vitest';
import {
  COUNTING_SLOT_STATUSES,
  SlotStatus,
  canTransitionChallenge,
  canTransitionSlot,
  canTransitionSubmission,
  isCountingSlotStatus,
} from './index.js';

describe('counting slot statuses', () => {
  it('zählt RESERVED/CAPTURING/UPLOADING/SUBMITTED', () => {
    expect([...COUNTING_SLOT_STATUSES].sort()).toEqual(
      ['CAPTURING', 'RESERVED', 'SUBMITTED', 'UPLOADING'].sort(),
    );
  });

  it('zählt EXPIRED und CANCELLED nicht', () => {
    expect(isCountingSlotStatus(SlotStatus.EXPIRED)).toBe(false);
    expect(isCountingSlotStatus(SlotStatus.CANCELLED)).toBe(false);
  });
});

describe('challenge transitions', () => {
  it('erlaubt OPEN -> FULL und zurück FULL -> OPEN', () => {
    expect(canTransitionChallenge('OPEN', 'FULL')).toBe(true);
    expect(canTransitionChallenge('FULL', 'OPEN')).toBe(true);
  });

  it('verbietet Sprünge aus Endzuständen', () => {
    expect(canTransitionChallenge('PAID_OUT', 'OPEN')).toBe(false);
    expect(canTransitionChallenge('CANCELLED', 'OPEN')).toBe(false);
  });
});

describe('slot transitions', () => {
  it('erlaubt RESERVED -> CAPTURING und RESERVED -> EXPIRED', () => {
    expect(canTransitionSlot('RESERVED', 'CAPTURING')).toBe(true);
    expect(canTransitionSlot('RESERVED', 'EXPIRED')).toBe(true);
  });

  it('verbietet Übergänge aus EXPIRED', () => {
    expect(canTransitionSlot('EXPIRED', 'RESERVED')).toBe(false);
  });
});

describe('submission transitions', () => {
  it('erlaubt den Review-Pfad', () => {
    expect(canTransitionSubmission('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransitionSubmission('SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTransitionSubmission('APPROVED', 'WINNER')).toBe(true);
  });

  it('verbietet Reaktivierung aus REJECTED', () => {
    expect(canTransitionSubmission('REJECTED', 'SUBMITTED')).toBe(false);
  });
});
