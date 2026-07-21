import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';
import { Button, ErrorText, Row } from './ui';

/** Kompakte Session-Leiste: Registrierung (18+-Gate) bzw. Anmeldestatus + Abmelden. */
export function SessionBar() {
  const { token, isAdmin, register, logout } = useSession();
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRegister() {
    setBusy(true);
    setError(null);
    try {
      await register();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.bar}>
      {token ? (
        <Row style={{ justifyContent: 'space-between', width: '100%' }}>
          <Text style={styles.who}>{isAdmin ? 'Admin' : `Angemeldet · ${token.slice(0, 6)}…`}</Text>
          <Button title="Abmelden" onPress={logout} />
        </Row>
      ) : (
        <Row style={{ justifyContent: 'space-between', width: '100%' }}>
          <Row>
            <Switch value={adult} onValueChange={setAdult} />
            <Text style={styles.who}>Ich bin 18+</Text>
          </Row>
          <Button title="Registrieren" variant="primary" disabled={!adult} loading={busy} onPress={onRegister} />
        </Row>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  who: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
