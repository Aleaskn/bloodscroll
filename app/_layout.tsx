import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { checkForCatalogUpdate, downloadAndApplyCatalogUpdate } from '../data/catalogUpdate';

import { useColorScheme } from '@/hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS === 'web') return undefined;

    const run = async () => {
      const result = await checkForCatalogUpdate();
      if (cancelled || result.status !== 'update_available' || !result.manifestItem) return;

      const nextVersion = result.manifestVersion ?? result.manifestItem.version;
      Alert.alert(
        'Aggiornamento catalogo disponibile',
        `È disponibile il catalogo ${nextVersion}. Vuoi scaricarlo ora?`,
        [
          { text: 'Non ora', style: 'cancel' },
          {
            text: 'Aggiorna',
            onPress: () => {
              void (async () => {
                try {
                  await downloadAndApplyCatalogUpdate(result.manifestItem);
                  if (!cancelled) {
                    Alert.alert('Catalogo aggiornato', `Versione installata: ${nextVersion}`);
                  }
                } catch {
                  if (!cancelled) {
                    Alert.alert('Update fallito', 'Impossibile aggiornare il catalogo ora.');
                  }
                }
              })();
            },
          },
        ]
      );
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="life-counter" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ headerShown: false }} />
        <Stack.Screen name="scan" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
