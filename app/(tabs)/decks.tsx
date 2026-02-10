import React from 'react';
import { View, Text, Pressable } from 'react-native';

export default function DecksScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d10', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '600' }}>Decks</Text>
      <Text style={{ color: '#b6c0cf', fontSize: 14 }}>In arrivo</Text>
      <Pressable
        style={{
          paddingVertical: 10,
          paddingHorizontal: 16,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.6)',
        }}
      >
        <Text style={{ color: '#ffffff' }}>Crea Deck</Text>
      </Pressable>
    </View>
  );
}
