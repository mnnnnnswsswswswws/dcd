'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, type PublicProfile } from '../../../lib/api';

export default function PublicProfilePage() {
  const params = useParams<{ username: string }>();
  const username = params.username;
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProfile(await api<PublicProfile>(`/v1/profiles/${username}`, { auth: false }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [username]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <p>
        <Link href="/">← Alle Challenges</Link>
      </p>
      {error && <p className="error">Profil nicht gefunden.</p>}
      {profile && (
        <div className="card stack">
          <h1 style={{ margin: 0 }}>{profile.displayName || `@${profile.username}`}</h1>
          <span className="badge">@{profile.username}</span>
          {profile.bio && <p>{profile.bio}</p>}
          <div className="row" style={{ gap: 20 }}>
            <Stat value={profile.createdCount} label="Erstellt" />
            <Stat value={profile.participatedCount} label="Teilgenommen" />
            <Stat value={profile.wonCount} label="Gewonnen" />
          </div>
          <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
            Dabei seit {new Date(profile.joinedAt).toLocaleDateString('de-DE')}
          </p>
        </div>
      )}
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.8rem' }}>
        {label}
      </div>
    </div>
  );
}
