import React from 'react';
import { Pressable, Text, View } from 'react-native';

const IDENTITY_COLORS: Record<string, string> = {
  W: '#f5e9c9',
  U: '#5ba4ff',
  B: '#5f5f68',
  R: '#f4745e',
  G: '#52bb6c',
};

type DeckCardRowProps = {
  name: string;
  typeLine?: string;
  quantity: number;
  onPress?: () => void;
};

export default function DeckCardRow({ name, typeLine, quantity, onPress }: DeckCardRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(255,255,255,0.03)',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#ffffff', fontSize: 15 }} numberOfLines={1}>
          {name}
        </Text>
        {typeLine ? (
          <Text style={{ color: '#9aa4b2', fontSize: 12 }} numberOfLines={1}>
            {typeLine}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>x{quantity}</Text>
    </Pressable>
  );
}

export function DeckIdentityDots({ identity }: { identity: string[] }) {
  if (!identity?.length) {
    return <Text style={{ color: '#7f8794', fontSize: 12 }}>No commander</Text>;
  }
  return (
    <View style={{ flexDirection: 'row', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      {identity.map((symbol) => (
        <View
          key={symbol}
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: IDENTITY_COLORS[symbol] || '#8a8a8a',
          }}
        />
      ))}
    </View>
  );
}
