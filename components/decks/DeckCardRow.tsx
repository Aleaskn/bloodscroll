import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import ManaSymbols, { parseManaCost, renderManaSymbol } from './ManaSymbols';

type DeckCardRowProps = {
  name: string;
  imageUri?: string | null;
  manaCost?: string | null;
  typeLine?: string;
  quantity: number;
  onPress?: () => void;
};

export default function DeckCardRow({
  name,
  imageUri,
  manaCost,
  typeLine,
  quantity,
  onPress,
}: DeckCardRowProps) {
  const manaTokens = parseManaCost(manaCost);

  return (
    <Pressable
      onPress={onPress}
      style={{
        padding: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(255,255,255,0.03)',
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={{ width: 64, height: 48, borderRadius: 8 }}
          contentFit="cover"
          contentPosition="top"
        />
      ) : (
        <View
          style={{
            width: 64,
            height: 48,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.2)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#7f8794', fontSize: 10 }}>No img</Text>
        </View>
      )}
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={{ color: '#ffffff', fontSize: 15 }} numberOfLines={1}>
          {name}
        </Text>
        <View style={{ marginTop: 4 }}>
          {manaTokens.length ? (
            <ManaSymbols tokens={manaTokens} size={14} gap={3} />
          ) : typeLine ? (
            <Text style={{ color: '#9aa4b2', fontSize: 12 }} numberOfLines={1}>
              {typeLine}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ minWidth: 34, alignItems: 'flex-end' }}>
        <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '600' }}>{quantity}</Text>
      </View>
    </Pressable>
  );
}

export function DeckIdentityDots({ identity }: { identity: string[] }) {
  if (!identity?.length) {
    return <Text style={{ color: '#7f8794', fontSize: 12 }}>No commander</Text>;
  }
  return (
    <View style={{ justifyContent: 'center', alignItems: 'center', minHeight: 18 }}>
      <ManaSymbols tokens={identity} size={16} gap={3} />
    </View>
  );
}

export { parseManaCost, renderManaSymbol };
