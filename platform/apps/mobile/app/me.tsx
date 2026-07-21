import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';
import { Badge, Card, ErrorText, Muted, Row, StatusBadge } from '../components/ui';
import { api, euro, selectionModeLabel, type ChallengeSummary, type MyChallenges } from '../lib/api';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';

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
      {!token && <Muted>Bitte auf der Startseite registrieren/anmelden.</Muted>}
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
  h2: { fontSize: 17, fontWeight: '700', color: colors.text, marginVertical: 10 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1 },
  prize: { fontSize: 16, fontWeight: '800', color: colors.text },
});
