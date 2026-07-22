import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addComment, countsFor, listComments, toggleBookmark, toggleLike } from '../src/social/social.js';
import { resetDb } from './reset-db.js';

/** Social-Layer: Likes, Bookmarks, Kommentare, Aggregat-Zähler. */
const prisma = new PrismaClient();

async function seedChallenge(): Promise<string> {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const c = await prisma.challenge.create({
    data: { creatorId: creator.id, status: 'OPEN', selectionMode: 'COMMUNITY_VOTE', prizeAmountCents: 5000, maxSlots: 10 },
  });
  return c.id;
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await resetDb(prisma);
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb(prisma);
});

describe('Social-Layer', () => {
  it('Like togglen: an → likeCount 1, erneut → 0', async () => {
    const cid = await seedChallenge();
    const user = await prisma.user.create({ data: { isAdult: true } });

    const on = await toggleLike({ prisma }, cid, user.id);
    expect(on).toEqual({ liked: true, likeCount: 1 });

    const off = await toggleLike({ prisma }, cid, user.id);
    expect(off).toEqual({ liked: false, likeCount: 0 });
  });

  it('Bookmark togglen', async () => {
    const cid = await seedChallenge();
    const user = await prisma.user.create({ data: { isAdult: true } });
    expect(await toggleBookmark({ prisma }, cid, user.id)).toEqual({ saved: true });
    expect(await toggleBookmark({ prisma }, cid, user.id)).toEqual({ saved: false });
  });

  it('Kommentar anlegen + listen (Autor-Handle)', async () => {
    const cid = await seedChallenge();
    const user = await prisma.user.create({ data: { isAdult: true, username: 'lena' } });
    const created = await addComment({ prisma }, cid, user.id, { body: 'Sauberer Trick!' });
    expect(created).toMatchObject({ body: 'Sauberer Trick!', author: 'lena' });

    const list = await listComments({ prisma }, cid);
    expect(list).toHaveLength(1);
    expect(list[0]?.author).toBe('lena');
  });

  it('countsFor aggregiert Likes und Kommentare je Challenge', async () => {
    const cid = await seedChallenge();
    const u1 = await prisma.user.create({ data: { isAdult: true } });
    const u2 = await prisma.user.create({ data: { isAdult: true } });
    await toggleLike({ prisma }, cid, u1.id);
    await toggleLike({ prisma }, cid, u2.id);
    await addComment({ prisma }, cid, u1.id, { body: 'top' });

    const counts = await countsFor({ prisma }, [cid]);
    expect(counts.get(cid)).toEqual({ likeCount: 2, commentCount: 1 });
  });
});
