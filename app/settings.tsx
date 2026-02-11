import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DeckHeader from '../components/decks/DeckHeader';

export default function SettingsScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <DeckHeader title="Impostazioni" subtitle="Placeholder" />
        <Text style={{ color: '#9aa4b2' }}>Configurazioni in arrivo.</Text>
      </View>
    </SafeAreaView>
  );
}
