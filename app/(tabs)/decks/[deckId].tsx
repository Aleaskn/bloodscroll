import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getDeck } from '../../../data/db';

export default function DeckDetailScreen() {
  const { deckId } = useLocalSearchParams();
  const router = useRouter();
  const [deck, setDeck] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!deckId) return;
    setLoading(true);
    const data = await getDeck(String(deckId));
    setDeck(data);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [deckId]);

  const totalCards = deck?.cards?.reduce((sum, c) => sum + (c.quantity || 0), 0) ?? 0;
  const nonCommanderCards =
    deck?.cards?.filter((c) => !c.is_commander).reduce((sum, c) => sum + c.quantity, 0) ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d10', padding: 20 }}>
      <Pressable onPress={() => router.back()} style={{ marginBottom: 12 }}>
        <Text style={{ color: '#9aa4b2' }}>Back</Text>
      </Pressable>
      {loading || !deck ? (
        <Text style={{ color: '#b6c0cf' }}>Loading…</Text>
      ) : (
        <>
          <Text style={{ color: '#ffffff', fontSize: 22, fontWeight: '600' }}>{deck.name}</Text>
          <Text style={{ color: '#9aa4b2', marginTop: 6 }}>
            Total: {totalCards} • Non‑Commander: {nonCommanderCards}
          </Text>
          <Pressable
            onPress={() => router.push(`/(tabs)/decks/search?deckId=${deck.id}`)}
            style={{
              marginTop: 12,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.4)',
              alignSelf: 'flex-start',
            }}
          >
            <Text style={{ color: '#ffffff' }}>Search & Add Cards</Text>
          </Pressable>
          <FlatList
            data={deck.cards ?? []}
            keyExtractor={(item) => item.card_id}
            contentContainerStyle={{ paddingVertical: 16, gap: 8 }}
            renderItem={({ item }) => (
              <View
                style={{
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.1)',
                  backgroundColor: 'rgba(255,255,255,0.03)',
                }}
              >
                <Text style={{ color: '#ffffff', fontSize: 15 }}>
                  {item.name} ×{item.quantity}
                </Text>
                <Text style={{ color: '#9aa4b2', fontSize: 12 }}>{item.type_line}</Text>
              </View>
            )}
          />
        </>
      )}
    </View>
  );
}
