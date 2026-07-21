import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, ErrorText, Muted } from '../components/ui';
import { api, type MyProfile } from '../lib/api';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';

export default function ProfileScreen() {
  const { token } = useSession();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setProfile(null);
      return;
    }
    setError(null);
    try {
      const me = await api<MyProfile>('/v1/users/me');
      setProfile(me);
      setUsername(me.username ?? '');
      setDisplayName(me.displayName ?? '');
      setBio(me.bio ?? '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const body: Record<string, string> = {};
      if (username.trim()) body.username = username.trim();
      if (displayName.trim()) body.displayName = displayName.trim();
      if (bio.trim()) body.bio = bio.trim();
      await api('/v1/users/me', { method: 'PATCH', body });
      setNote('Profil gespeichert ✓');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Muted>Bitte auf der Startseite registrieren/anmelden.</Muted>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {error && <ErrorText>Fehler: {error}</ErrorText>}
      {note && <Muted>{note}</Muted>}
      {profile && (
        <Card>
          <Field label="Nutzername (öffentlich, a–z 0–9 _)">
            <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" maxLength={20} placeholder="z. B. acemaker" placeholderTextColor={colors.muted} />
          </Field>
          <Field label="Anzeigename">
            <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} maxLength={40} placeholder="z. B. Ace" placeholderTextColor={colors.muted} />
          </Field>
          <Field label="Bio">
            <TextInput style={[styles.input, { height: 76 }]} value={bio} onChangeText={setBio} multiline maxLength={200} placeholder="Kurz über dich." placeholderTextColor={colors.muted} />
          </Field>
          <Button title="Speichern" variant="primary" loading={busy} onPress={save} />
          {profile.username ? <Muted>Dein öffentliches Profil: /u/{profile.username}</Muted> : null}
        </Card>
      )}
    </ScrollView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 13, color: colors.muted },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.surface,
  },
});
