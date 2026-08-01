'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  api,
  avatarColor,
  categoryEmoji,
  euro,
  feedGradient,
  getToken,
  selectionModeLabel,
  type ChallengeSummary,
} from '../lib/api';
import { IconBookmark, IconComment, IconFlag, IconHeart, IconShare } from './icons';

function deadlineText(iso: string | null): string {
  if (!iso) return 'kein Einsendeschluss';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Frist abgelaufen';
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 1) return 'Frist heute';
  return `Frist in ${days} Tagen`;
}

function handleOf(c: ChallengeSummary): string {
  return `@${c.creator?.username ?? c.creator?.displayName?.replace(/\s+/g, '').toLowerCase() ?? 'creator'}`;
}

function initialOf(c: ChallengeSummary): string {
  return (c.creator?.displayName ?? c.creator?.username ?? c.title ?? '?').charAt(0).toUpperCase();
}

export default function FeedPage() {
  const router = useRouter();
  const [items, setItems] = useState<ChallengeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Echte Engagement-Zustände (aus dem Backend).
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [reported, setReported] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api<ChallengeSummary[]>('/v1/challenges?status=OPEN', { auth: false });
      setItems(list);
      setLikeCounts(Object.fromEntries(list.map((c) => [c.id, c.likeCount ?? 0])));
      if (getToken()) {
        const [myLikes, myBookmarks] = await Promise.all([
          api<string[]>('/v1/users/me/likes').catch(() => []),
          api<string[]>('/v1/users/me/bookmarks').catch(() => []),
        ]);
        setLikes(Object.fromEntries(myLikes.map((id) => [id, true])));
        setSaved(Object.fromEntries(myBookmarks.map((id) => [id, true])));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function requireLogin(): boolean {
    if (getToken()) return true;
    router.push('/profile');
    return false;
  }

  async function like(c: ChallengeSummary) {
    if (!requireLogin()) return;
    try {
      const res = await api<{ liked: boolean; likeCount: number }>(`/v1/challenges/${c.id}/like`, { method: 'POST' });
      setLikes((l) => ({ ...l, [c.id]: res.liked }));
      setLikeCounts((n) => ({ ...n, [c.id]: res.likeCount }));
    } catch {
      /* ignoriert */
    }
  }

  async function bookmark(c: ChallengeSummary) {
    if (!requireLogin()) return;
    try {
      const res = await api<{ saved: boolean }>(`/v1/challenges/${c.id}/bookmark`, { method: 'POST' });
      setSaved((s) => ({ ...s, [c.id]: res.saved }));
    } catch {
      /* ignoriert */
    }
  }

  async function report(c: ChallengeSummary) {
    if (!requireLogin()) return;
    setReported((r) => ({ ...r, [c.id]: true }));
    try {
      await api('/v1/reports', { method: 'POST', body: { targetType: 'CHALLENGE', targetId: c.id, reason: 'OTHER' } });
    } catch {
      /* Melden ist unkritisch */
    }
  }

  if (loading) {
    return (
      <div className="feed">
        <section className="skel-item">
          <div className="skel" style={{ width: 140, height: 40, borderRadius: 999 }} />
          <div className="skel" style={{ width: '70%', height: 30 }} />
          <div className="skel" style={{ width: '45%', height: 26 }} />
          <div className="skel" style={{ width: '58%', height: 16 }} />
          <div className="skel" style={{ width: 190, height: 48, borderRadius: 16 }} />
        </section>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="feed" style={{ display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
        <div>
          <div style={{ fontSize: '3rem' }}>🎬</div>
          <h1>Noch keine Challenges im Feed</h1>
          {error && <p className="error">{error}</p>}
          <Link href="/create" className="feed-cta" style={{ display: 'inline-block', marginTop: 8 }}>
            Erste Challenge erstellen
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="feed">
      {items.map((c) => {
        const free = Math.max(0, c.maxSlots - (c.occupiedSlots ?? 0));
        return (
          <section key={c.id} className="feed-item">
            <div className="feed-bg" style={{ background: feedGradient(c.id) }} />
            <div className="feed-emoji">{categoryEmoji(c.category, c.title)}</div>

            <div className="feed-rail">
              <button className={`rail-btn${likes[c.id] ? ' on' : ''}`} onClick={() => like(c)}>
                <IconHeart filled={likes[c.id]} />
                {likeCounts[c.id] ?? 0}
              </button>
              <button className="rail-btn" onClick={() => router.push(`/challenges/${c.id}`)}>
                <IconComment />
                {c.commentCount ?? 0}
              </button>
              <button className="rail-btn" onClick={() => router.push(`/challenges/${c.id}`)}>
                <IconShare />
                Teilen
              </button>
              <button className={`rail-btn${saved[c.id] ? ' on' : ''}`} onClick={() => bookmark(c)}>
                <IconBookmark filled={saved[c.id]} />
                Merken
              </button>
              <button className="rail-btn" onClick={() => report(c)} disabled={reported[c.id]}>
                <IconFlag />
                {reported[c.id] ? 'Gemeldet' : 'Melden'}
              </button>
            </div>

            <div className="feed-content">
              <div className="feed-creator">
                <span className="avatar-grad" style={{ background: avatarColor(handleOf(c)) }}>{initialOf(c)}</span>
                <span className="handle">{handleOf(c)}</span>
              </div>
              <h2 className="feed-title">{c.title || 'Ohne Titel'}</h2>
              <div className="feed-prizeline">
                <span className="feed-prize">
                  {euro(c.prizeAmountCents)}
                  <small>Preisgeld</small>
                </span>
                <span className="status-pill">Offen · {free} frei</span>
              </div>
              <div className="feed-sub">
                {selectionModeLabel(c.selectionMode)} · {deadlineText(c.submissionDeadline)}
              </div>
              <button className="feed-cta" onClick={() => router.push(`/challenges/${c.id}`)}>
                Challenge ansehen →
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
