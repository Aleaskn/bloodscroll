import React, { useState } from 'react';
import { View, Text, Pressable, FlatList, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addCardToDeck, upsertCard } from '../../../data/db';
import { getCachedImageUri, normalizeCard, searchCards } from '../../../data/scryfall';

export default function CardSearchScreen() {
  const { deckId } = useLocalSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const data = await searchCards(query.trim());
      setResults(data);
    } catch (e) {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const addCard = async (card) => {
    if (!deckId) return;
    const imageUri = await getCachedImageUri(card);
    const normalized = normalizeCard(card, imageUri);
    await upsertCard(normalized);
    await addCardToDeck(String(deckId), normalized.id, 1);
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d10', padding: 20, gap: 12 }}>
      <Pressable onPress={() => router.back()}>
        <Text style={{ color: '#9aa4b2' }}>Back</Text>
      </Pressable>
      <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '600' }}>Search Cards</Text>
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
        }}
      />
      <Pressable
        onPress={runSearch}
        style={{
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.4)',
          alignSelf: 'flex-start',
        }}
      >
        <Text style={{ color: '#ffffff' }}>Search</Text>
      </Pressable>
      {searching ? (
        <Text style={{ color: '#b6c0cf' }}>Searching…</Text>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 8, paddingBottom: 16 }}
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
        />
      )}
    </View>
  );
}
