import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function DeckBottomBar() {
  const router = useRouter();

  return (
    <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#0f141c' }}>
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.12)',
          paddingVertical: 8,
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={() => router.replace('/')}
          style={{
            minWidth: 120,
            minHeight: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.3)',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 16,
          }}
        >
          <Text style={{ color: '#ffffff', fontWeight: '600' }}>Home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
