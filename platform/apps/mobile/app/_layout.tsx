import { Caprasimo_400Regular } from '@expo-google-fonts/caprasimo';
import { Figtree_400Regular, Figtree_600SemiBold, Figtree_700Bold } from '@expo-google-fonts/figtree';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../lib/session';
import { colors, fonts } from '../lib/theme';

export default function RootLayout() {
  const [loaded] = useFonts({
    Caprasimo_400Regular,
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  // Bis die Organic-Schriften geladen sind, warmen Hintergrund zeigen (kein
  // System-Font-Flash), dann die App rendern.
  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTitleStyle: { fontFamily: fonts.heading, color: colors.text },
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
