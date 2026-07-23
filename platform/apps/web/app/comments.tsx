'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, type CommentRow } from '../lib/api';
import { IconBookmark, IconComment, IconHeart } from './icons';

/** Like-/Merken-Zeile mit echten Zählern (Backend). */
export function SocialRow({
  challengeId,
  likeCount,
  commentCount,
}: {
  challengeId: string;
  likeCount: number;
  commentCount: number;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [count, setCount] = useState(likeCount);

  useEffect(() => {
    setCount(likeCount);
  }, [likeCount]);

  useEffect(() => {
    if (!getToken()) return;
    void (async () => {
      const [likes, marks] = await Promise.all([
        api<string[]>('/v1/users/me/likes').catch((): string[] => []),
        api<string[]>('/v1/users/me/bookmarks').catch((): string[] => []),
      ]);
      setLiked(likes.includes(challengeId));
      setSaved(marks.includes(challengeId));
    })();
  }, [challengeId]);

  function requireLogin(): boolean {
    if (getToken()) return true;
    router.push('/profile');
    return false;
  }

  async function like() {
    if (!requireLogin()) return;
    const res = await api<{ liked: boolean; likeCount: number }>(`/v1/challenges/${challengeId}/like`, { method: 'POST' });
    setLiked(res.liked);
    setCount(res.likeCount);
  }
  async function bookmark() {
    if (!requireLogin()) return;
    const res = await api<{ saved: boolean }>(`/v1/challenges/${challengeId}/bookmark`, { method: 'POST' });
    setSaved(res.saved);
  }

  return (
    <div className="row" style={{ gap: 14 }}>
      <button className={`sm ghost${liked ? '' : ''}`} onClick={like} style={{ color: liked ? 'var(--like)' : undefined }}>
        <span style={{ width: 18, height: 18, display: 'inline-flex' }}>
          <IconHeart filled={liked} />
        </span>
        {count}
      </button>
      <span className="row" style={{ gap: 6, color: 'var(--muted)', fontSize: '0.85rem' }}>
        <span style={{ width: 18, height: 18, display: 'inline-flex' }}>
          <IconComment />
        </span>
        {commentCount}
      </span>
      <button className="sm ghost" onClick={bookmark} style={{ color: saved ? 'var(--accent)' : undefined }}>
        <span style={{ width: 18, height: 18, display: 'inline-flex' }}>
          <IconBookmark filled={saved} />
        </span>
        {saved ? 'Gemerkt' : 'Merken'}
      </button>
    </div>
  );
}

/** Kommentar-Sektion: öffentliche Liste + Eingabe (wenn angemeldet). */
export function CommentsSection({ challengeId, onPosted }: { challengeId: string; onPosted?: () => void }) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loggedIn = Boolean(getToken());

  const load = useCallback(async () => {
    try {
      setComments(await api<CommentRow[]>(`/v1/challenges/${challengeId}/comments`, { auth: false }));
    } catch {
      setComments([]);
    }
  }, [challengeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/challenges/${challengeId}/comments`, { method: 'POST', body: { body: body.trim() } });
      setBody('');
      await load();
      onPosted?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Kommentare ({comments.length})</h2>
      {loggedIn ? (
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Kommentar schreiben…"
            maxLength={500}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
          />
          <button className="primary" onClick={send} disabled={busy || !body.trim()}>
            Senden
          </button>
        </div>
      ) : (
        <p className="muted">Melde dich an, um zu kommentieren.</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="stack">
        {comments.map((c) => (
          <div key={c.id} className="sub" style={{ alignItems: 'flex-start' }}>
            <span className="avatar">{c.author.charAt(0).toUpperCase()}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>@{c.author}</div>
              <div>{c.body}</div>
              <div className="muted" style={{ fontSize: '0.78rem' }}>
                {new Date(c.createdAt).toLocaleString('de-DE')}
              </div>
            </div>
          </div>
        ))}
        {comments.length === 0 && <p className="muted">Noch keine Kommentare.</p>}
      </div>
    </>
  );
}
