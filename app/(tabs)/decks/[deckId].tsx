import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DeckBottomBar from '../../../components/decks/DeckBottomBar';
import DeckHeader from '../../../components/decks/DeckHeader';
import DeckCardRow from '../../../components/decks/DeckCardRow';
import { getCard, getDeck } from '../../../data/db';

export default function DeckDetailScreen() {
  const { deckId } = useLocalSearchParams();
  const router = useRouter();
  const [deck, setDeck] = useState(null);
  const [loading, setLoading] = useState(true);
  const [commander, setCommander] = useState(null);

  const load = useCallback(async () => {
    if (!deckId) return;
    setLoading(true);
    const data = await getDeck(String(deckId));
    setDeck(data);
    if (data?.commander_card_id) {
      const cmd = await getCard(data.commander_card_id);
      setCommander(cmd);
    } else {
      setCommander(null);
    }
    setLoading(false);
  }, [deckId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const totalCards = deck?.cards?.reduce((sum, c) => sum + (c.quantity || 0), 0) ?? 0;
  const nonCommanderCards =
    deck?.cards?.filter((c) => !c.is_commander).reduce((sum, c) => sum + c.quantity, 0) ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <DeckHeader
          title={loading || !deck ? 'Deck' : deck.name}
          subtitle={
            loading || !deck
              ? undefined
              : `Total ${totalCards} • Non-Commander ${nonCommanderCards}`
          }
        />
        {loading || !deck ? (
          <Text style={{ color: '#b6c0cf' }}>Loading...</Text>
        ) : (
          <>
            <Text style={{ color: '#9aa4b2', marginTop: 2 }}>
              Commander: {commander?.name ?? 'None'}
            </Text>
            {!commander ? (
              <Text style={{ color: '#ffb347', marginTop: 6 }}>
                Set a Commander to unlock card validation.
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable
                onPress={() => router.push(`/(tabs)/decks/search?deckId=${deck.id}&mode=commander`)}
                style={{
                  minHeight: 44,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.4)',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#ffffff' }}>Set Commander</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push(`/(tabs)/decks/search?deckId=${deck.id}`)}
                style={{
                  minHeight: 44,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.4)',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#ffffff' }}>Search & Add Cards</Text>
              </Pressable>
            </View>
            <FlatList
              data={deck.cards ?? []}
              keyExtractor={(item) => item.card_id}
              contentContainerStyle={{ paddingVertical: 16, gap: 8, paddingBottom: 100 }}
              renderItem={({ item }) => (
                <DeckCardRow
                  name={item.name}
                  typeLine={item.type_line}
                  quantity={item.quantity}
                  onPress={() =>
                    router.push(`/(tabs)/decks/card/${item.card_id}?deckId=${deck.id}`)
                  }
                />
              )}
              ListEmptyComponent={
                <Text style={{ color: '#9aa4b2' }}>
                  Nessuna carta ancora. Usa Search & Add Cards.
                </Text>
              }
            />
          </>
        )}
      </View>
      <DeckBottomBar />
    </SafeAreaView>
  );
}
