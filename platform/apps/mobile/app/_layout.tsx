import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../lib/session';
import { colors } from '../lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTitleStyle: { fontWeight: '700', color: colors.text },
            headerTintColor: colors.accent,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Video-Challenges' }} />
          <Stack.Screen name="create" options={{ title: 'Challenge erstellen' }} />
          <Stack.Screen name="me" options={{ title: 'Meine Challenges' }} />
          <Stack.Screen name="notifications" options={{ title: 'Mitteilungen' }} />
          <Stack.Screen name="profile" options={{ title: 'Profil' }} />
          <Stack.Screen name="challenge/[id]" options={{ title: 'Challenge' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
