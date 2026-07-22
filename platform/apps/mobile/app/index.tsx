import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SessionBar } from '../components/SessionBar';
import { Badge, Button, Card, ErrorText, Muted, Row, StatusBadge } from '../components/ui';
import { api, euro, selectionModeLabel, type ChallengeSummary } from '../lib/api';
import { colors, fonts } from '../lib/theme';

export default function DiscoverScreen() {
  const router = useRouter();
  const [open, setOpen] = useState<ChallengeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOpen(await api<ChallengeSummary[]>('/v1/challenges?status=OPEN', { auth: false }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

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
      <SessionBar />

      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Zeig, was du kannst.</Text>
        <Muted>
          Tritt bezahlten Video-Challenges bei, nimm deinen Beweis in der App auf und gewinne das Preisgeld.
          Max. 10 Plätze pro Challenge.
        </Muted>
      </View>

      <Row style={{ marginBottom: 8 }}>
        <Button title="+ Erstellen" variant="primary" onPress={() => router.push('/create')} />
        <Button title="Meine" onPress={() => router.push('/me')} />
        <Button title="Mitteilungen" onPress={() => router.push('/notifications')} />
        <Button title="Profil" onPress={() => router.push('/profile')} />
      </Row>

      {error && <ErrorText>Fehler: {error}</ErrorText>}

      <Text style={styles.h2}>Offene Challenges</Text>
      {!loading && open.length === 0 && <Muted>Derzeit keine offenen Challenges.</Muted>}

      {open.map((c) => (
        <Card key={c.id} onPress={() => router.push(`/challenge/${c.id}`)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.title}>{c.title || 'Ohne Titel'}</Text>
            <Text style={styles.prize}>{euro(c.prizeAmountCents)}</Text>
          </Row>
          <Row>
            <StatusBadge status={c.status} />
            {c.category ? <Badge label={c.category} /> : null}
            <Badge label={selectionModeLabel(c.selectionMode)} />
          </Row>
          <Muted>
            Einsendeschluss: {c.submissionDeadline ? new Date(c.submissionDeadline).toLocaleString('de-DE') : '—'}
          </Muted>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  hero: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    gap: 6,
  },
  heroTitle: { fontSize: 26, fontFamily: fonts.heading, color: colors.text },
  h2: { fontSize: 19, fontFamily: fonts.heading, color: colors.text, marginVertical: 10 },
  title: { fontSize: 16, fontFamily: fonts.bodyBold, color: colors.text, flexShrink: 1 },
  prize: { fontSize: 17, fontFamily: fonts.heading, color: colors.accent, flexShrink: 0 },
});
