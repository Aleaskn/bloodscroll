import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function HomeSelectorScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }}>
      <View style={{ flex: 1, padding: 20, justifyContent: 'center', gap: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: '#ffffff', fontSize: 30, fontWeight: '700' }}>Bloodscroll</Text>
          <Pressable
            onPress={() => router.push('/settings')}
            style={{
              minWidth: 44,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.25)',
              backgroundColor: 'rgba(255,255,255,0.03)',
            }}
          >
            <Ionicons name="settings-outline" size={22} color="#ffffff" />
          </Pressable>
        </View>
        <Text style={{ color: '#9aa4b2', fontSize: 16 }}>
          Scegli la sezione da aprire
        </Text>
        <Pressable
          onPress={() => router.push('/life-counter')}
          style={{
            borderRadius: 16,
            paddingVertical: 18,
            paddingHorizontal: 16,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.2)',
            backgroundColor: 'rgba(255,255,255,0.04)',
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '600' }}>Life Counter</Text>
          <Text style={{ color: '#9aa4b2', marginTop: 6 }}>Commander match tracking</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/(tabs)/decks')}
          style={{
            borderRadius: 16,
            paddingVertical: 18,
            paddingHorizontal: 16,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.2)',
            backgroundColor: 'rgba(255,255,255,0.04)',
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '600' }}>Decks</Text>
          <Text style={{ color: '#9aa4b2', marginTop: 6 }}>Commander deck builder</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/search')}
          style={{
            borderRadius: 16,
            paddingVertical: 18,
            paddingHorizontal: 16,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.2)',
            backgroundColor: 'rgba(255,255,255,0.04)',
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '600' }}>Search</Text>
          <Text style={{ color: '#9aa4b2', marginTop: 6 }}>Scryfall card explorer</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
