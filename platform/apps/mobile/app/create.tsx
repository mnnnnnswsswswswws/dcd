import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Button, Card, ErrorText, Muted } from '../components/ui';
import { api, euro, selectionModeLabel } from '../lib/api';
import { useSession } from '../lib/session';
import { colors, fonts } from '../lib/theme';

interface CreatedResult {
  challenge: { id: string; status: string; prizeAmountCents: number };
  funding: { providerRef: string; clientSecret: string; amountCents: number };
}

export default function CreateScreen() {
  const router = useRouter();
  const { token } = useSession();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [prizeEuro, setPrizeEuro] = useState('100');
  const [days, setDays] = useState('7');
  const [mode, setMode] = useState('CREATOR_DECIDES');
  const [result, setResult] = useState<CreatedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const prizeAmountCents = Math.round(Number(prizeEuro) * 100);
      const deadlineDays = Math.max(1, Math.round(Number(days) || 7));
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        selectionMode: mode,
        prizeAmountCents,
        submissionDeadline: new Date(Date.now() + deadlineDays * 24 * 3600 * 1000).toISOString(),
      };
      setResult(await api<CreatedResult>('/v1/challenges', { method: 'POST', body }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Muted>Bitte auf der Startseite registrieren (18+), um eine Challenge zu erstellen.</Muted>
      </ScrollView>
    );
  }

  if (result) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.h1}>Challenge erstellt</Text>
          <Text style={styles.prize}>{euro(result.challenge.prizeAmountCents)}</Text>
          <Badge label="Finanzierung ausstehend" />
          <Muted>
            Die Challenge geht erst öffentlich, wenn das Preisgeld per Webhook bestätigt ist — eine Erfolgsmeldung
            im Client genügt bewusst nicht.
          </Muted>
          <Button title="Zur Challenge" variant="primary" onPress={() => router.replace(`/challenge/${result.challenge.id}`)} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {error && <ErrorText>Fehler: {error}</ErrorText>}
      <Card>
        <Field label="Titel">
          <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={80} placeholder="z. B. Bester Freiwurf" placeholderTextColor={colors.muted} />
        </Field>
        <Field label="Beschreibung">
          <TextInput
            style={[styles.input, { height: 80 }]}
            value={description}
            onChangeText={setDescription}
            maxLength={2000}
            multiline
            placeholder="Worum geht es? Was zählt als gültiger Beweis?"
            placeholderTextColor={colors.muted}
          />
        </Field>
        <Field label="Kategorie">
          <TextInput style={styles.input} value={category} onChangeText={setCategory} maxLength={80} placeholder="z. B. Sport & Skills" placeholderTextColor={colors.muted} />
        </Field>
        <Field label="Preisgeld (EUR)">
          <TextInput style={styles.input} value={prizeEuro} onChangeText={setPrizeEuro} keyboardType="numeric" />
        </Field>
        <Field label="Tage bis Einsendeschluss">
          <TextInput style={styles.input} value={days} onChangeText={setDays} keyboardType="numeric" />
        </Field>
        <Field label="Auswahlmodus">
          <View style={styles.pickerWrap}>
            <Picker selectedValue={mode} onValueChange={setMode}>
              <Picker.Item label={selectionModeLabel('CREATOR_DECIDES')} value="CREATOR_DECIDES" />
              <Picker.Item label={selectionModeLabel('COMMUNITY_VOTE')} value="COMMUNITY_VOTE" />
            </Picker>
          </View>
        </Field>
        <Muted>Der Auswahlmodus wird jetzt festgelegt und ist danach unveränderlich.</Muted>
        <Button title="Challenge erstellen" variant="primary" loading={busy} disabled={title.trim().length === 0} onPress={submit} />
      </Card>
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
  h1: { fontSize: 22, fontFamily: fonts.heading, color: colors.text },
  prize: { fontSize: 19, fontFamily: fonts.heading, color: colors.gold },
  label: { fontSize: 13, color: colors.muted, fontFamily: fonts.body },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontFamily: fonts.body,
    backgroundColor: colors.surface,
  },
  pickerWrap: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
});
