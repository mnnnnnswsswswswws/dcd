import { Figtree_400Regular, Figtree_600SemiBold, Figtree_700Bold } from '@expo-google-fonts/figtree';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppBackground } from '../components/ui';
import { SessionProvider } from '../lib/session';
import { colors, fonts } from '../lib/theme';

/** Navigations-Theme: ruhiges neutrales Dunkel als Screen-Grund. */
const AppTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    primary: colors.accent,
    border: colors.border,
  },
};

export default function RootLayout() {
  const [loaded] = useFonts({
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
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <AppBackground />
          <ThemeProvider value={AppTheme}>
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
              <Stack.Screen name="play" options={{ headerShown: false }} />
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
