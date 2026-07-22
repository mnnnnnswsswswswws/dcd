import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';
import { Badge, Button, Card, ErrorText, Muted, Row } from '../components/ui';
import { api, type NotificationsResult } from '../lib/api';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';

export default function NotificationsScreen() {
  const router = useRouter();
  const { token } = useSession();
  const [data, setData] = useState<NotificationsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setData(null);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      setData(await api<NotificationsResult>('/v1/users/me/notifications'));
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

  async function markRead() {
    setBusy(true);
    try {
      await api('/v1/users/me/notifications/read', { method: 'POST' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {!token && <Muted>Bitte auf der Startseite registrieren/anmelden.</Muted>}
      {error && <ErrorText>Fehler: {error}</ErrorText>}

      {data && data.unreadCount > 0 && (
        <Row style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
          <Button title="Alle als gelesen" loading={busy} onPress={markRead} />
        </Row>
      )}
      {data && data.items.length === 0 && <Muted>Keine Mitteilungen.</Muted>}

      {data?.items.map((n) => (
        <Card key={n.id} onPress={n.challengeId ? () => router.push(`/challenge/${n.challengeId}`) : undefined}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.title}>{n.title}</Text>
            {!n.read && <Badge label="neu" tone="open" />}
          </Row>
          <Muted>{n.body}</Muted>
          <Text style={styles.time}>{new Date(n.createdAt).toLocaleString('de-DE')}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
  time: { fontSize: 12, color: colors.muted },
});
