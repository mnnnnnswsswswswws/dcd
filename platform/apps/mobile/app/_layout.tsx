import { Figtree_400Regular, Figtree_600SemiBold, Figtree_700Bold } from '@expo-google-fonts/figtree';
import { Unbounded_700Bold } from '@expo-google-fonts/unbounded';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Aurora } from '../components/ui';
import { SessionProvider } from '../lib/session';
import { colors, fonts } from '../lib/theme';

/** Navigations-Theme: transparenter Screen-Hintergrund, damit die Aurora hinter
 *  allen Screens durchscheint (react-navigation legt sonst helles Grau darüber). */
const GlassTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: 'transparent',
    card: colors.bg,
    text: colors.text,
    primary: colors.accent,
    border: 'rgba(255,255,255,0.1)',
  },
};

export default function RootLayout() {
  const [loaded] = useFonts({
    Unbounded_700Bold,
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  // Bis die Schriften geladen sind, dunklen Grund zeigen (kein System-Font-Flash),
  // dann die App rendern.
  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        {/* Aurora liegt hinter allen Screens; die Screens selbst sind transparent,
            damit die Glas-Flächen etwas zum Durchscheinen haben. */}
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <Aurora />
          <ThemeProvider value={GlassTheme}>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.bg },
                headerTitleStyle: { fontFamily: fonts.heading, color: colors.text },
                headerTintColor: colors.accent,
                headerShadowVisible: false,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            >
              <Stack.Screen name="index" options={{ title: 'Video-Challenges' }} />
              <Stack.Screen name="create" options={{ title: 'Challenge erstellen' }} />
              <Stack.Screen name="me" options={{ title: 'Meine Challenges' }} />
              <Stack.Screen name="notifications" options={{ title: 'Mitteilungen' }} />
              <Stack.Screen name="profile" options={{ title: 'Profil' }} />
              <Stack.Screen name="challenge/[id]" options={{ title: 'Challenge' }} />
            </Stack>
          </ThemeProvider>
        </View>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
