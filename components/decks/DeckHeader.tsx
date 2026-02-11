import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

type DeckHeaderProps = {
  title: string;
  subtitle?: string;
};

export default function DeckHeader({ title, subtitle }: DeckHeaderProps) {
  const router = useRouter();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 48,
        marginBottom: 12,
      }}
    >
      <Pressable
        onPress={() => router.back()}
        style={{
          minWidth: 44,
          minHeight: 44,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#9aa4b2', fontSize: 16 }}>Back</Text>
      </Pressable>
      <View style={{ flex: 1, marginHorizontal: 8 }}>
        <Text style={{ color: '#ffffff', fontSize: 22, fontWeight: '600' }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: '#9aa4b2', fontSize: 13 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={{ width: 44 }} />
    </View>
  );
}
