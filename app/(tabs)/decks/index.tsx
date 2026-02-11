import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import DeckBottomBar from '../../../components/decks/DeckBottomBar';
import { DeckIdentityDots } from '../../../components/decks/DeckCardRow';
import { createDeck, initDb, listDecksWithCommanderMeta } from '../../../data/db';

export default function DecksScreen() {
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const load = async () => {
    setLoading(true);
    await initDb();
    const data = await listDecksWithCommanderMeta();
    setDecks(data);
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const createDeckOptimistic = async () => {
    const optimistic = {
      id: `tmp_${Date.now()}`,
      name: `New Deck ${decks.length + 1}`,
      updated_at: new Date().toISOString(),
      commander_name: null,
      commander_image_uri: null,
      commander_color_identity: null,
    };
    setDecks((prev) => [optimistic, ...prev]);
    await createDeck(`New Deck ${decks.length + 1}`);
    await load();
  };

  const parseIdentity = (value) => {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <Text style={{ color: '#ffffff', fontSize: 30, fontWeight: '700', marginTop: 8 }}>Decks</Text>
        <Pressable
          onPress={createDeckOptimistic}
          style={{
            marginTop: 16,
            minHeight: 44,
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.6)',
            alignSelf: 'flex-start',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 18 }}>Crea Deck</Text>
        </Pressable>
        {loading ? (
          <Text style={{ color: '#b6c0cf', marginTop: 16 }}>Loading...</Text>
        ) : (
          <>
            {decks.length === 0 ? (
              <Text style={{ color: '#9aa4b2', marginTop: 16 }}>
                Nessun deck ancora. Crea il tuo primo deck.
              </Text>
            ) : null}
            <FlatList
              data={decks}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingVertical: 16, gap: 10, paddingBottom: 100 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => router.push(`/(tabs)/decks/${item.id}`)}
                  style={{
                    padding: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.1)',
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#ffffff', fontSize: 16 }} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={{ color: '#9aa4b2', fontSize: 12, marginTop: 4 }}>
                      Updated {new Date(item.updated_at).toLocaleString()}
                    </Text>
                  </View>
                  <View
                    style={{
                      width: 92,
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    {item.commander_image_uri ? (
                      <Image
                        source={{ uri: item.commander_image_uri }}
                        style={{ width: 74, height: 54, borderRadius: 8 }}
                        contentFit="cover"
                      />
                    ) : (
                      <View
                        style={{
                          width: 74,
                          height: 54,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.2)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: '#7f8794', fontSize: 10 }}>No commander</Text>
                      </View>
                    )}
                    <DeckIdentityDots identity={parseIdentity(item.commander_color_identity)} />
                  </View>
                </Pressable>
              )}
            />
          </>
        )}
      </View>
      <DeckBottomBar />
    </SafeAreaView>
  );
}
