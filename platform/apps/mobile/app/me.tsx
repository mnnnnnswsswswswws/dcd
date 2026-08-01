import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, ErrorText, Muted, Row, StatusBadge } from '../components/ui';
import { api, euro, selectionModeLabel, type ChallengeSummary, type MyChallenges } from '../lib/api';
import { useSession } from '../lib/session';
import { colors, fonts } from '../lib/theme';
import { useDemo } from '../lib/demo/useDemo';
import { challengeById, type Submission } from '../lib/demo/store';

function List({ items, onOpen }: { items: (ChallengeSummary & { slotStatus?: string })[]; onOpen: (id: string) => void }) {
  if (items.length === 0) return <Muted>Keine.</Muted>;
  return (
    <>
      {items.map((c) => (
        <Card key={`${c.id}-${c.slotStatus ?? 'own'}`} onPress={() => onOpen(c.id)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.title}>{c.title || 'Ohne Titel'}</Text>
            <Text style={styles.prize}>{euro(c.prizeAmountCents)}</Text>
          </Row>
          <Row>
            <StatusBadge status={c.status} />
            <Badge label={selectionModeLabel(c.selectionMode)} />
            {c.slotStatus ? <Badge label={`Slot: ${c.slotStatus}`} /> : null}
          </Row>
        </Card>
      ))}
    </>
  );
}

function relTime(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  if (s < 60) return 'gerade eben';
  const m = Math.floor(s / 60);
  if (m < 60) return `vor ${m} Min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std`;
  return `vor ${Math.floor(h / 24)} T`;
}

const subStatusLabel: Record<Submission['status'], string> = {
  processing: 'In Prüfung',
  accepted: 'Angenommen',
  rejected: 'Abgelehnt',
};
const subStatusColor: Record<Submission['status'], string> = {
  processing: colors.muted,
  accepted: colors.accent,
  rejected: '#f2696e',
};

/** Live aus dem zentralen Demo-Store: jede Einsendung, die im Play-Flow entsteht,
 *  taucht hier sofort auf — inkl. Hinweis, ob ein echter In-App-Clip aufgenommen wurde. */
function MySubmissions({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useDemo();
  if (s.loading || s.submissions.length === 0) return null;
  return (
    <View style={{ marginBottom: 6 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={styles.h2}>Meine Einsendungen</Text>
        <Text style={styles.count}>{s.submissions.length}</Text>
      </Row>
      {s.submissions.map((sub) => {
        const ch = challengeById(sub.challengeId);
        return (
          <Card key={`${sub.challengeId}-${sub.at}`} onPress={() => onOpen(sub.challengeId)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.title}>{ch ? `${ch.emoji} ${ch.title}` : 'Challenge'}</Text>
              {ch ? <Text style={styles.prize}>{euro(ch.prizeCents)}</Text> : null}
            </Row>
            <Row style={{ marginTop: 6, gap: 8, alignItems: 'center' }}>
              <View style={[styles.dot, { backgroundColor: subStatusColor[sub.status] }]} />
              <Text style={[styles.subStatus, { color: subStatusColor[sub.status] }]}>{subStatusLabel[sub.status]}</Text>
              <Text style={styles.meta}>· {relTime(sub.at, s.now)}</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.clip}>{sub.videoUri ? '● In-App-Clip' : '○ Beweis'}</Text>
            </Row>
          </Card>
        );
      })}
    </View>
  );
}

export default function MeScreen() {
  const router = useRouter();
  const { token } = useSession();
  const [data, setData] = useState<MyChallenges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setData(null);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      setData(await api<MyChallenges>('/v1/users/me/challenges'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <MySubmissions onOpen={(cid) => router.push(`/challenge/${cid}`)} />
      {!token && <Muted>Melde dich an, um erstellte und beigetretene Challenges zu sehen.</Muted>}
      {error && <ErrorText>Fehler: {error}</ErrorText>}
      {data && (
        <>
          <Text style={styles.h2}>Erstellt</Text>
          <List items={data.created} onOpen={(cid) => router.push(`/challenge/${cid}`)} />
          <Text style={styles.h2}>Beigetreten</Text>
          <List items={data.joined} onOpen={(cid) => router.push(`/challenge/${cid}`)} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  h2: { fontSize: 19, fontFamily: fonts.heading, color: colors.text, marginVertical: 10 },
  title: { fontSize: 16, fontFamily: fonts.bodyBold, color: colors.text, flexShrink: 1 },
  prize: { fontSize: 17, fontFamily: fonts.heading, color: colors.gold },
  count: { fontSize: 13, fontFamily: fonts.bodySemibold, color: colors.accent },
  dot: { width: 8, height: 8, borderRadius: 4 },
  subStatus: { fontSize: 13, fontFamily: fonts.bodyBold },
  meta: { fontSize: 13, fontFamily: fonts.body, color: colors.muted },
  clip: { fontSize: 12, fontFamily: fonts.bodySemibold, color: colors.muted },
});
