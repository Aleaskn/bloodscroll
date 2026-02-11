import React, { useState } from 'react';
import { View, Text, Pressable, FlatList, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addCardToDeck, getCard, getDeck, setCommander, upsertCard } from '../../../data/db';
import { getCachedArtImageUri, getCachedImageUri, normalizeCard, searchCards } from '../../../data/scryfall';
import DeckHeader from '../../../components/decks/DeckHeader';
import DeckBottomBar from '../../../components/decks/DeckBottomBar';

export default function CardSearchScreen() {
  const { deckId } = useLocalSearchParams();
  const { mode } = useLocalSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [deck, setDeck] = useState(null);
  const [commander, setCommanderCard] = useState(null);

  React.useEffect(() => {
    const loadDeck = async () => {
      if (!deckId) return;
      const data = await getDeck(String(deckId));
      setDeck(data);
      if (data?.commander_card_id) {
        const cmd = await getCard(data.commander_card_id);
        setCommanderCard(cmd);
      } else {
        setCommanderCard(null);
      }
    };
    loadDeck();
  }, [deckId]);

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const data = await searchCards(query.trim());
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const addCard = async (card) => {
    if (!deckId) return;
    setError('');
    setFeedback('');
    const isCommanderMode = mode === 'commander';
    const commanderLegal = card.legalities?.commander === 'legal';
    const totalCards = deck?.cards?.reduce((sum, c) => sum + (c.quantity || 0), 0) ?? 0;
    const deckHasCard = deck?.cards?.find((c) => c.card_id === card.id);
    const isBasicLand = (card.type_line || '').includes('Basic Land');
    const commanderColors = commander?.color_identity
      ? JSON.parse(commander.color_identity)
      : [];
    const cardColors = card.color_identity ?? [];

    if (isCommanderMode) {
      if (!commanderLegal) {
        setError('This card is not legal as a Commander.');
        return;
      }
      const imageUri = await getCachedImageUri(card);
      const artImageUri = await getCachedArtImageUri(card);
      const normalized = normalizeCard(card, imageUri, artImageUri);
      await upsertCard(normalized);
      await setCommander(String(deckId), normalized);
      router.replace(`/(tabs)/decks/${String(deckId)}`);
      return;
    }

    if (!commander) {
      setError('Set a Commander before adding cards.');
      return;
    }
    if (!commanderLegal) {
      setError('This card is not Commander‑legal.');
      return;
    }
    if (totalCards >= 100) {
      setError('Deck already has 100 cards.');
      return;
    }
    if (deckHasCard && !isBasicLand) {
      setError('Singleton rule: only one copy allowed.');
      return;
    }
    const colorMismatch = cardColors.some((c) => !commanderColors.includes(c));
    if (colorMismatch) {
      setError('Card color identity is outside Commander colors.');
      return;
    }

    const imageUri = await getCachedImageUri(card);
    const artImageUri = await getCachedArtImageUri(card);
    const normalized = normalizeCard(card, imageUri, artImageUri);
    await upsertCard(normalized);
    await addCardToDeck(String(deckId), normalized.id, 1);
    setDeck((prev) => {
      if (!prev) return prev;
      const existing = prev.cards?.find((c) => c.card_id === normalized.id);
      let nextCards = prev.cards ?? [];
      if (existing) {
        nextCards = nextCards.map((c) =>
          c.card_id === normalized.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      } else {
        nextCards = [
          ...nextCards,
          {
            ...normalized,
            card_id: normalized.id,
            quantity: 1,
            is_commander: 0,
          },
        ];
      }
      return { ...prev, cards: nextCards };
    });
    setFeedback(`Added: ${card.name}`);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, paddingHorizontal: 20, gap: 12 }}>
        <DeckHeader
          title={mode === 'commander' ? 'Set Commander' : 'Search Cards'}
          subtitle="Ricerca da Scryfall"
        />
        {error ? <Text style={{ color: '#ff8a8a' }}>{error}</Text> : null}
        {feedback ? <Text style={{ color: '#82d68b' }}>{feedback}</Text> : null}
        <TextInput
          placeholder="Search Scryfall"
          placeholderTextColor="#8a93a0"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={runSearch}
          style={{
            backgroundColor: '#111722',
            color: '#ffffff',
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            minHeight: 44,
          }}
        />
        <Pressable
          onPress={runSearch}
          style={{
            minHeight: 44,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: query.trim() ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)',
            alignSelf: 'flex-start',
            opacity: query.trim() ? 1 : 0.6,
            justifyContent: 'center',
          }}
          disabled={!query.trim()}
        >
          <Text style={{ color: '#ffffff' }}>Search</Text>
        </Pressable>
        {searching ? (
          <Text style={{ color: '#b6c0cf' }}>Searching...</Text>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ gap: 8, paddingBottom: 100 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => addCard(item)}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.15)',
                }}
              >
                <Text style={{ color: '#ffffff', fontSize: 14 }}>{item.name}</Text>
                <Text style={{ color: '#9aa4b2', fontSize: 12 }}>{item.type_line}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={{ color: '#9aa4b2' }}>Nessun risultato.</Text>}
          />
        )}
      </View>
      <DeckBottomBar />
    </SafeAreaView>
  );
}
