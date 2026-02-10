import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { createDeck, initDb, listDecks } from '../../../data/db';

export default function DecksScreen() {
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const load = async () => {
    setLoading(true);
    await initDb();
    const data = await listDecks();
    setDecks(data);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d10', padding: 20 }}>
      <Text style={{ color: '#ffffff', fontSize: 22, fontWeight: '600', marginBottom: 12 }}>
        Decks
      </Text>
      <Pressable
        onPress={async () => {
          await createDeck(`New Deck ${decks.length + 1}`);
          await load();
        }}
        style={{
          paddingVertical: 10,
          paddingHorizontal: 16,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.6)',
          alignSelf: 'flex-start',
        }}
      >
        <Text style={{ color: '#ffffff' }}>Crea Deck</Text>
      </Pressable>
      {loading ? (
        <Text style={{ color: '#b6c0cf', marginTop: 16 }}>Loading…</Text>
      ) : (
        <FlatList
          data={decks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: 16, gap: 8 }}
          renderItem={({ item }) => (
            <View
              style={{
                padding: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)',
                backgroundColor: 'rgba(255,255,255,0.03)',
                gap: 8,
              }}
            >
              <Pressable onPress={() => router.push(`/(tabs)/decks/${item.id}`)}>
                <Text style={{ color: '#ffffff', fontSize: 16 }}>{item.name}</Text>
              </Pressable>
              <Text style={{ color: '#9aa4b2', fontSize: 12, marginTop: 4 }}>
                Updated {new Date(item.updated_at).toLocaleString()}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}
